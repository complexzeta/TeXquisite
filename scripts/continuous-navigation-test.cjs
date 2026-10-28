const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('continuous-navigation'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 // Browser profile and project are siblings: source discovery must not scan browser locks.
 const root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex'),source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nBefore with $\\sqrt{\\pi}$.\n\nLiveMark ordinary text.\n\nAfterMark following paragraph.\n\nSuffixMark unchanged paragraph.\n\n\\newpage\n'+Array.from({length:5},(_,i)=>'PageMark'+(i+2)+' text.\n\n\\newpage\n').join('')+'\\input{chapter}\n\\end{document}\n',included='IncludedMark text.\n';
 await fs.writeFile(root,source);await fs.writeFile(chapter,included);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'},{path:chapter,text:included,diskHash:hash(included),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false,continuousPreview:true,lastCursor:{file:root,at:source.indexOf('LiveMark')+8}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const clickAt=async at=>{await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;document.querySelector('.navigation-marker')?.remove();v.dispatch({selection:{anchor:at},scrollIntoView:true});},at);await delay(100);const pos=await page.evaluate(at=>{const r=document.querySelector('.cm-content').cmTile.root.view.coordsAtPos(at);return {x:r.left+1,y:(r.top+r.bottom)/2};},at);await page.mouse.click(pos.x,pos.y);};
 const marked=async number=>{await page.waitForFunction(n=>{const m=document.querySelector('.navigation-marker'),v=document.querySelector('#pdfViewport').getBoundingClientRect(),r=m?.getBoundingClientRect();return m?.parentElement.dataset.page===String(n)&&r.top>=v.top&&r.top<v.bottom;},number,{timeout:10000});};
 try{
  await page.waitForFunction(()=>document.querySelectorAll('.flow-page').length===7,null,{timeout:90000});
  await page.evaluate(()=>window.originalFirst=document.querySelector('.flow-page'));
  await clickAt(source.indexOf('PageMark5')+4);await marked(5);
  assert.equal(await page.locator('#follow').getAttribute('aria-pressed'),'false');
  await clickAt(source.indexOf('LiveMark')+8);await marked(1);
  assert.ok(await page.evaluate(()=>window.originalFirst===document.querySelector('.flow-page')),'Source navigation must not rebuild continuous wrappers');
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  await page.keyboard.insertText(' growing text'.repeat(500)+'\nA later physical source line with inline $\\sqrt{\\pi}$ and final words.');
  let expected=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#previewState').textContent.includes('paginated PDF verified'),null,{timeout:60000});
  await page.evaluate(()=>{window.liveBlock=document.querySelector('[data-local-layout="flow"]');document.querySelector('.flow-page[data-page="6"]').scrollIntoView();});
  await clickAt(expected.indexOf('final words')+4);await marked(1);
  const nearEnd=await page.locator('.navigation-marker').evaluate(e=>e.getBoundingClientRect().top);
  await page.locator('.flow-page[data-page="6"]').evaluate(e=>e.scrollIntoView());await clickAt(expected.indexOf('LiveMark')+2);await marked(1);
  assert.ok(await page.evaluate(()=>window.liveBlock===document.querySelector('[data-local-layout="flow"]')),'Navigating live output must retain the block');
  // The adjacent paragraph shares the live block and has its own mappings.
  await clickAt(expected.indexOf('AfterMark')+4);await marked(1);
  assert.ok(await page.evaluate(()=>{const m=document.querySelector('.navigation-marker').getBoundingClientRect(),b=document.querySelector('[data-local-layout="flow"]').getBoundingClientRect();return m.top>=b.top&&m.bottom<=b.bottom+2;}),'Adjacent paragraph must use its live block position');
  // Unchanged suffix positions use the displayed baseline and its live height,
  // even after a newer, differently paginated full PDF has been accepted.
  await clickAt(expected.indexOf('SuffixMark')+4);await marked(1);
  assert.ok(await page.evaluate(()=>document.querySelector('.navigation-marker').getBoundingClientRect().top>=document.querySelector('[data-local-layout="flow"]').getBoundingClientRect().bottom-2),'Unchanged suffix must use its shifted continuous position');
  await clickAt(expected.indexOf('PageMark5')+4);await marked(5);
  await page.locator('#tabs button').filter({hasText:'chapter.tex'}).click();await clickAt(4);await marked(7);
  await page.locator('#tabs button').filter({hasText:'main.tex'}).click();
  await page.locator('#live').click();
  await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,insert:'% unsaved changed source\n'}});document.querySelector('#pages .navigation-marker')?.remove();document.querySelector('#pdfViewport').scrollTop=2000;});
  const staleScroll=await page.locator('#pdfViewport').evaluate(e=>e.scrollTop);await clickAt(5);await delay(250);
  assert.equal(await page.locator('.navigation-marker').count(),0,'Stale source must not navigate to obsolete mappings');assert.equal(await page.locator('#pdfViewport').evaluate(e=>e.scrollTop),staleScroll);
  assert.equal(await fs.readFile(root,'utf8'),expected,'Clicks must not edit source; paused changes must stay unsaved');assert.deepEqual(errors,[]);
  // A Lecture section has state effects, but its own literal body must retain
  // both navigation directions after nonvisual write nodes are filtered.
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()),expected);
  await page.locator('#live').click();await page.locator('#previewMode').selectOption('lecture');
  await page.waitForFunction(()=>document.body.dataset.previewMode==='lecture');
  await clickAt(expected.indexOf('AfterMark')+'AfterMark'.length);await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  await page.keyboard.insertText('\n\n\\section{NavigationHeading}\\label{nav:section}\n\nSectionAnchor ordinary words.\n\n');
  const sectionSource=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(sectionSource),{timeout:15000});
  const sectionPage=await page.locator('[data-local-layout="flow"]').evaluate(c=>Number(c.closest('[data-page]').dataset.page)),word=sectionSource.indexOf('SectionAnchor');
  await clickAt(word+4);await marked(sectionPage);
  const hit=await page.locator('.navigation-marker').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});},word+'SectionAnchor ordinary '.length);
  await page.mouse.click(hit.x,hit.y);await page.waitForFunction(({from,to})=>{const head=document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head;return head>=from&&head<=to;},{from:word,to:word+'SectionAnchor'.length},{timeout:10000});
  await page.locator('#live').click();
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,insert:'X'},selection:{anchor:0}});},word);
  await page.mouse.click(hit.x,hit.y);await delay(150);
  assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head),0,'A live canvas for different source text must not move the caret');
  assert.deepEqual(errors,[]);
  const result={passed:true,directory,sourceClickWithFollowOff:true,staticPageNavigation:true,liveWrappedText:true,inlineMath:true,adjacentParagraph:true,unchangedSuffix:true,includedSource:true,liveBlockPreserved:true,staleSourceRejected:true,lectureSectionSourceNavigation:true,lectureSectionInverseNavigation:true,staleLectureSectionRejected:true,nearEnd};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#navState').textContent()+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
