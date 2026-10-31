// A disposable cloud editor: blank-space gestures are not navigation requests,
// and error revisions must never resize/cover the document or steal selection.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('status-bar'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),root=path.join(project,'status.tex');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);
 const source='\\documentclass{article}\n\\begin{document}\n\nAlphaSentinel ordinary words with $x^2$.\n\nFirstErrorSentinel ordinary paragraph.\n\nSecondErrorSentinel ordinary paragraph.\n\n\\newpage\nTailSentinel ordinary ending.\n\n\\end{document}\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nIgnoredSentinel text after the document.',result={passed:false};let expected=source;
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,followPreview:false,autoClose:false,statusBar:false,lastCursor:{file:root,at:source.indexOf('AlphaSentinel')+3}}));
 assert.ok(os.freemem()>1024*1024*1024,'Insufficient memory for an isolated app');
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0'}});let page;const errors=[];
 try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#errorCount').dataset.errors==='0');
  assert.equal(await page.locator('#statusBar').isVisible(),true);assert.equal(await page.locator('#statusDetails').isVisible(),false);assert.equal(await page.locator('#previewNotice').isVisible(),false);result.permanentWithLegacyHiddenPreference=true;
  const geometry=()=>page.evaluate(()=>{const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,height:r.height};};return {bar:box('#statusBar'),source:box('#editor'),preview:box('#pdfViewport'),selection:document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head};});
  const initial=await geometry();assert.ok(initial.bar.height>=22&&initial.bar.height<=32);
  // A click in the editor's blank lower padding clamps to an unmapped EOF.
  // It must not be mistaken for an explicit request to locate that source.
  await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.length}});v.contentDOM.style.setProperty('padding-bottom','900px','important');v.scrollDOM.scrollTop=v.scrollDOM.scrollHeight;});await delay(100);
  const blank=await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,r=v.scrollDOM.getBoundingClientRect(),x=r.left+100,y=r.bottom-45,target=document.elementFromPoint(x,y);return {x,y,blank:!!target&&v.contentDOM.contains(target)&&!target.closest('.cm-line')};});assert.ok(blank.blank,'Fixture must point below all source lines');await page.mouse.click(blank.x,blank.y);await delay(1300);
  assert.equal(await page.locator('#previewNotice').isVisible(),false);assert.equal(await page.locator('#errorCount').getAttribute('data-errors'),'0');result.blankSourceGestureQuiet=true;
  // Scrolling the output into page margins is equally harmless.
  await page.locator('#pdfViewport').evaluate(e=>{e.scrollTop=e.scrollHeight;});await delay(200);assert.equal(await page.locator('#previewNotice').isVisible(),false);result.blankPreviewScrollQuiet=true;
  // Preserve intentional source-text clicking even with Follow typing off.
  const at=source.indexOf('AlphaSentinel')+4,line=source.slice(0,at).split('\n').length;
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);await delay(100);
  const point=await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view,r=v.coordsAtPos(at);return {x:r.left+1,y:(r.top+r.bottom)/2};},at);await page.mouse.click(point.x,point.y);await page.waitForFunction(line=>document.querySelector('#navState').textContent.includes('line '+line),line,{timeout:10000});result.explicitTextClickPreserved=true;
  // A genuine unmapped explicit request is a single-line footer message.
  await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.length}});});await page.locator('#locate').click();await page.waitForFunction(()=>!document.querySelector('#previewNotice').hidden);assert.equal(await page.locator('#errorCount').getAttribute('data-errors'),'0');
  assert.equal(await page.locator('#previewNotice').evaluate(e=>e.parentElement.id),'statusBar');assert.equal(await page.locator('#previewNotice').evaluate(e=>getComputedStyle(e).position),'static');
  await page.locator('#pdfViewport').evaluate(e=>{e.scrollTop=e.scrollTop?0:e.scrollHeight;});await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);result.navigationMessageNonmodalAndClearsOnScroll=true;
  const replace=async text=>{expected=text;await page.evaluate(text=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.indexOf('AlphaSentinel')+3}});},text);};
  const waitCount=async count=>{await page.waitForFunction(count=>document.querySelector('#errorCount').dataset.errors===String(count),count,{timeout:45000,polling:20});await delay(100);};
  await replace(source.replace('FirstErrorSentinel','\\badFirst FirstErrorSentinel').replace('SecondErrorSentinel','\\badSecond SecondErrorSentinel'));const beforeErrors=await geometry();await waitCount(2);const withErrors=await geometry();
  for(const key of ['bar','source','preview'])assert.deepEqual(withErrors[key],beforeErrors[key],key+' geometry changed when errors arrived');assert.equal(withErrors.selection,beforeErrors.selection);assert.equal(await page.locator('#statusBar').getAttribute('data-severity'),'error');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#problems').getAttribute('open'),null);result.twoErrorsWithoutPopupOrLayoutShift=true;
  await page.screenshot({path:path.join(directory,'status-error.png'),timeout:15000});
  await page.locator('#previewNoticeDetails').click();assert.equal(await page.locator('#problems').getAttribute('open'),'');assert.match(await page.locator('#problemList').textContent(),/Undefined|undefined/);await page.locator('#previewNoticeError').click();result.actionsAvailableOnDemand=true;
  await replace(source.replace('SecondErrorSentinel','\\badSecond SecondErrorSentinel'));await waitCount(1);await replace(source);await waitCount(0);await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);result.countsTrackTwoOneZero=true;
  await page.locator('#problems').evaluate(e=>e.open=false);
  await page.locator('#toggleStatus').click();assert.equal(await page.locator('#statusBar').isVisible(),true);await page.locator('#toggleStatus').click();assert.equal(await page.locator('#statusDetails').isVisible(),false);assert.equal(await page.locator('#statusBar').isVisible(),true);result.onlyTimingDetailsCanHide=true;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('event',{type:'backupStatus',text:'Synthetic backup destination unavailable.',error:true}));await waitCount(1);assert.equal(await page.locator('#backupWarning').isVisible(),false);assert.equal(await page.locator('dialog[open]').count(),0);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('event',{type:'backupStatus',text:'Backup available again.',error:false}));await waitCount(0);result.backupErrorsUseFooter=true;
  await page.screenshot({path:path.join(directory,'status-healthy.png'),timeout:15000});assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);result.sourceSavedExactly=true;result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{if(page){await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));result.footer=await page.locator('#statusBar').textContent().catch(()=>'');}await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
