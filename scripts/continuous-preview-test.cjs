const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const {validatePdf}=require('../dist/core');
(async()=>{
 const directory=path.resolve('.test-output','continuous-ui-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-continuous-'));await fs.mkdir(path.join(directory,'source'),{recursive:true});
 const root=path.join(directory,'source','main.tex'),source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nBefore with $\\sqrt{\\pi}$.\n\nTarget text.\n\nFollowing stable material.\\newpage\n'+Array.from({length:30},(_,i)=>'Tail page '+i+'.\\newpage\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false,continuousPreview:true,lastCursor:{file:root,at:source.indexOf('Target text.')+'Target text.'.length}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h&&document.querySelectorAll('.flow-page').length>20,hash(source),{timeout:90000});
  assert.ok(await page.locator('#pages canvas').count()<10,'Continuous scrolling must not rasterize every page at once');
  assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head),source.indexOf('Target text.')+'Target text.'.length,'Source cursor must restore automatically');await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.focus());
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  // Keep an unrelated later page in view while editing the source. Neither
  // local updates nor a full fallback may collapse the document to page one.
  await page.locator('.flow-page[data-page="20"]').evaluate(e=>e.scrollIntoView());
  const scrollBefore=await page.locator('#pdfViewport').evaluate(e=>{window.scrollSamples=[];e.addEventListener('scroll',()=>window.scrollSamples.push(e.scrollTop));return e.scrollTop;});
  let expected=source;const latencies=[];
  for(const char of ' ordinarywords'){
   await page.keyboard.type(char);expected=expected.replace('Target text.'+(' ordinarywords'.slice(0,latencies.length)),'Target text.'+(' ordinarywords'.slice(0,latencies.length+1)));
   await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});latencies.push(Number(await page.locator('[data-local-layout="flow"]').getAttribute('data-local-latency-ms')));
  }
  assert.ok(Math.abs(await page.locator('#pdfViewport').evaluate(e=>e.scrollTop)-scrollBefore)<=1,'Typing must preserve the scrolled preview');
  await page.evaluate(()=>{window.flowTail=document.querySelector('.flow-page[data-page="2"]');window.flowStrips=[...document.querySelector('.flow-page[data-page="1"]').children];window.flowTop=window.flowTail.getBoundingClientRect().top+document.querySelector('#pdfViewport').scrollTop;window.flowHeight=document.querySelector('[data-local-layout="flow"]').height;});
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('A new paragraph with inline math $\\sqrt{\\pi}$.');
  expected=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});const paragraphLatencyMs=Number(await page.locator('[data-local-layout="flow"]').getAttribute('data-local-latency-ms'));
  assert.ok(await page.evaluate(()=>document.querySelector('[data-local-layout="flow"]').height>window.flowHeight&&window.flowTail===document.querySelector('.flow-page[data-page="2"]')&&window.flowTail.getBoundingClientRect().top+document.querySelector('#pdfViewport').scrollTop>window.flowTop&&window.flowStrips[0]===document.querySelector('.flow-page[data-page="1"]').children[0]),'Following content must move by browser layout, preserving unchanged strips and following pages');
  const preparationCount=await page.locator('#log').evaluate(e=>e.textContent.split('Local preparation: ').length);
  await page.keyboard.type('$');await delay(150);assert.equal(await page.locator('#previewState').getAttribute('data-local-state'),'ready','Incomplete math must retain the warm context');
  await page.keyboard.type('x$');expected=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:10000});assert.equal(await page.locator('#log').evaluate(e=>e.textContent.split('Local preparation: ').length),preparationCount,'Repairing math must not rebuild its preamble or baseline');
  assert.ok(await page.evaluate(()=>Math.min(...window.scrollSamples)>10000),'Local updates must never jump to the top');
  await page.locator('#follow').click();await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.focus());
  await page.keyboard.insertText(' Growing ordinary text.'.repeat(350));expected=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});
  assert.ok(await page.locator('#pdfViewport').evaluate(e=>e.scrollTop)>0,'Follow typing must track the growing continuous block');
  const grownHeight=await page.locator('[data-local-layout="flow"]').evaluate(c=>c.height),growLatencyMs=Number(await page.locator('[data-local-layout="flow"]').getAttribute('data-local-latency-ms'));assert.ok(grownHeight>792*await page.evaluate(()=>window.devicePixelRatio),'Live block must grow beyond a former page boundary');
  await page.waitForFunction(()=>document.querySelector('#previewState').textContent.includes('paginated PDF verified'),null,{timeout:60000});assert.equal(await page.locator('[data-local-layout="flow"]').evaluate(c=>c.height),grownHeight,'Background verification must not repaginate the live block');assert.equal(await fs.readFile(root,'utf8'),expected);
  await page.locator('.flow-page[data-page="20"]').evaluate(e=>e.scrollIntoView());await page.waitForFunction(()=>document.querySelector('.flow-page[data-page="20"] canvas')?.width>0,null,{timeout:10000});await page.locator('[data-local-layout="flow"]').evaluate(e=>e.scrollIntoView());
  const exported=path.join(directory,'export.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Exported'),null,{timeout:10000});assert.ok((await fs.stat(exported)).size>1000);const exportPages=await validatePdf(await fs.readFile(exported));assert.ok(exportPages>31,'Export must contain the fully repaginated document');
  await page.locator('#follow').click();
  await page.locator('.flow-page[data-page="20"]').evaluate(e=>e.scrollIntoView());
  const beforeFull=await page.locator('.flow-page[data-page="20"]').evaluate(e=>{window.scrollSamples=[];return e.getBoundingClientRect().top;});
  await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,insert:'% Force a new full baseline\n'}});});
  expected=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('#pages canvas[data-source-hash="'+h+'"]'),hash(expected),{timeout:60000});
  await delay(250);
  assert.ok(Math.abs(await page.locator('.flow-page[data-page="20"]').evaluate(e=>e.getBoundingClientRect().top)-beforeFull)<=1,'Full fallback must preserve the visible page and offset');
  assert.ok(await page.evaluate(()=>window.scrollSamples.every(y=>y>10000)),'Full updates must never transiently jump to the top');
  await page.locator('#layoutMode').selectOption('paged');await page.waitForFunction(()=>!document.querySelector('#pages').classList.contains('continuous'),null,{timeout:30000});assert.equal(await page.locator('#pages canvas').count(),1);assert.deepEqual(errors,[]);const diagnostics=JSON.parse(await fs.readFile(path.join(profile,'preview-diagnostics.json'),'utf8'));assert.ok(diagnostics.events.length<=64&&diagnostics.events.some(e=>e.event==='local-displayed'&&e.layout==='flow'));assert.ok(!JSON.stringify(diagnostics).includes('Target text'),'Diagnostics must not store document text');
  const result={passed:true,directory,latenciesMs:latencies,paragraphLatencyMs,growLatencyMs,grownHeight,lazyPages:true,scrollAfterVerification:true,cursorRestored:true,followTyping:true,incompleteMathRetained:true,boundedDiagnostics:true,unchangedContentRetained:true,noRepaginationOnVerification:true,exported,exportPages,autosave:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
