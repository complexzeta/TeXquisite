const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=path.resolve('.test-output','local-preview-ui-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-local-preview-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),tailPages=Number(process.env.PERSISTENT_TEX_LOCAL_TAIL_PAGES||1),source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nTop material.\\par\n\\def\\BodyWord{Context}\n\\vfill\n\n\\BodyWord: target paragraph $\\sqrt{\\pi}+\\frac{a}{b}$ and plain words.\n\nRemaining material.\\par\n\\newpage\n'+Array.from({length:tailPages},(_,i)=>'Following page '+i+'.\n'+(i+1<tailPages?'\\newpage\n':'')).join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:process.env.PERSISTENT_TEX_TEST_VISIBLE==='1'?'':'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.text().startsWith('Local raster'))console.log(m.text());});
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(source),{timeout:60000});
  await page.evaluate(()=>{window.localMessages=[];window.desktop.on(m=>{if(m.type==='localPage')window.localMessages.push({editId:m.editId,page:m.page,pageOutput:m.pageOutput,sourceHash:m.sourceHash,timing:m.timing,canvas:document.querySelector('#pages canvas')?.dataset.sourceHash,at:performance.now()});});});
  await page.locator('.cm-line').filter({hasText:'target paragraph'}).click();await page.keyboard.press('End');
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:30000});
  let expected=source;const measurements=[],pipelines=[];
  for(let i=0;i<5;i++){
   expected=expected.replace('words.'+'x'.repeat(i),'words.'+'x'.repeat(i+1));await page.keyboard.type('x');
   await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h&&document.querySelector('#pages canvas')?.dataset.localLatencyEditId===document.querySelector('#pages canvas')?.dataset.localEditId,hash(expected),{timeout:10000,polling:10});
   measurements.push(Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms')));
   pipelines.push(JSON.parse(await page.locator('#pages canvas').getAttribute('data-local-pipeline')));
   assert.ok((await page.locator('#status').textContent()).includes('verification pending'));
   assert.notEqual(await page.locator('#pages canvas').getAttribute('data-source-hash'),hash(expected),'Local output must not masquerade as verified full-document output');
   await delay(50);
  }
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h&&document.querySelector('#pages canvas')?.dataset.renderScope!=='local',hash(expected),{timeout:30000});
  assert.equal(await fs.readFile(root,'utf8'),expected);
  await page.locator('.cm-line').filter({hasText:'target paragraph'}).click();await page.keyboard.press('Home');
  const line=expected.split('\n').find(line=>line.includes('target paragraph')),mathAt=line.indexOf('\\pi');for(let i=0;i<mathAt;i++)await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:30000});
  await page.keyboard.type('x');expected=expected.replace('\\sqrt{\\pi}','\\sqrt{x\\pi}');
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h&&document.querySelector('#pages canvas')?.dataset.localLatencyEditId===document.querySelector('#pages canvas')?.dataset.localEditId,hash(expected),{timeout:10000,polling:10});measurements.push(Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms')));
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:30000});
  // A line wrap uses TeX's actual page builder, preserving following text and
  // stretchable page glue without retypesetting subsequent pages.
  await page.locator('.cm-line').filter({hasText:'target paragraph'}).click();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:30000});
  const beforeWrap=expected,extra=' Longer words.'.repeat(90);await page.keyboard.insertText(extra);expected=expected.replace('words.'+'x'.repeat(5),'words.'+'x'.repeat(5)+extra);const wrappedHash=hash(expected);
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h&&document.querySelector('#pages canvas')?.dataset.localLatencyEditId===document.querySelector('#pages canvas')?.dataset.localEditId&&document.querySelector('#pages canvas')?.dataset.localLayout==='page',hash(expected),{timeout:10000,polling:10});
  const wrapLatencyMs=Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms'));
  assert.ok((await page.locator('#status').textContent()).includes('Affected page updated'));
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:60000});
  await page.keyboard.press('Control+z');expected=beforeWrap;
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h&&document.querySelector('#pages canvas')?.dataset.localLatencyEditId===document.querySelector('#pages canvas')?.dataset.localEditId&&document.querySelector('#pages canvas')?.dataset.localLayout==='page',hash(expected),{timeout:10000,polling:10});
  const shrinkLatencyMs=Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms'));
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:60000});
  assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);
  const messages=await page.evaluate(()=>window.localMessages),wrapped=messages.find(m=>m.pageOutput&&m.sourceHash===wrappedHash);assert.ok(wrapped);if(tailPages>10)assert.ok(wrapped.timing.excludedSuffixBytes>1000,'Following source pages must remain unread');
  const result={directory,passed:true,followingPages:tailPages,devicePixelRatio:await page.evaluate(()=>window.devicePixelRatio),localLatenciesMs:measurements,pipelines,timingEndpoint:await page.locator('#pages canvas').getAttribute('data-timing-endpoint'),localInlineMath:true,localOutputSeparateFromFull:true,fullVerification:true,localWrap:true,wrapLatencyMs,shrinkLatencyMs,wrapWork:wrapped.timing,draftSaved:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent());console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());await fs.writeFile(path.join(directory,'messages.json'),JSON.stringify(await page.evaluate(()=>window.localMessages),null,2));await fs.writeFile(path.join(directory,'errors.json'),JSON.stringify(errors));console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
