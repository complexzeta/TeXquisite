// A disposable app, source and clipboard mock; never touches the user's profile
// or operating-system clipboard. Exercises the actual native menu and renderer.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('performance-report'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),root=path.join(project,'lecture.tex'),result={passed:false};await fs.mkdir(profile);await fs.mkdir(project);
 require('./retained-test-format.cjs').seedProfile(profile);
 let source='\\documentclass{article}\n\\pdfpagewidth=8.5in\n\\pdfpageheight=11in\n\\begin{document}\n\nAlpha paragraph has ordinary lecture words. Stable words keep this paragraph useful for testing the live preview.\n\nBeta paragraph remains unchanged.\n\\end{document}\n',at=source.indexOf('ordinary');
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,autoClose:false,followPreview:false,lastCursor:{file:root,at}}));
 assert.ok(os.freemem()>=1024*1024*1024,'Not enough free memory for an isolated editor');
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0',PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});let page;const errors=[];const guard=setInterval(()=>{if(os.freemem()<256*1024*1024)void app.evaluate(({app})=>app.exit(0)).catch(()=>{});},1000);guard.unref();
 try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});},at);
  await page.waitForFunction(async()=>{const p=await window.desktop.call('previewPerformance');return p.localReady&&!p.localBusy;},null,{timeout:60000});
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,insert:'new '},selection:{anchor:at+4}});},at);source=source.slice(0,at)+'new '+source.slice(at);
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId),hash(source),{timeout:30000});
  const before=await page.evaluate(()=>window.desktop.call('performanceReport'));assert.equal(before.mode,'lecture');assert.equal(before.retainedLayoutEnabled,false);assert.ok(before.latencyMs.local.count>0);assert.equal(before.latestEdit.frameAcknowledged,true);
  await app.evaluate(({Menu,clipboard})=>{global.__reportWrites=[];global.__reportOriginalWrite=clipboard.writeText;clipboard.writeText=text=>global.__reportWrites.push(text);const build=Menu.getApplicationMenu().items.find(i=>i.id==='build-menu'),item=build.submenu.items.find(i=>i.label==='Copy performance report');if(!item)throw Error('Report menu missing');item.click();});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Performance report copied'),null,{timeout:10000});
  const writes=await app.evaluate(()=>global.__reportWrites);assert.equal(writes.length,1);const report=JSON.parse(writes[0]);assert.equal(report.schema,1);assert.equal(report.mode,'lecture');assert.ok(!writes[0].includes(root));assert.ok(!writes[0].includes(source));assert.ok(!/[A-Za-z]:[/\\]+Users[/\\]+/i.test(writes[0]));
  // Switching out of a local flow must request canonical document pages even
  // when retained mode was never enabled and the PDF bundle ID is unchanged.
  await page.selectOption('#previewMode','document');await page.waitForFunction(h=>{const canvases=[...document.querySelectorAll('#pages canvas')];return canvases.length>0&&canvases.every(c=>!c.dataset.localEditId)&&canvases.some(c=>c.dataset.sourceHash===h);},hash(source),{timeout:60000});
  assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()),source);assert.deepEqual(errors,[]);
  Object.assign(result,{passed:true,version:report.version,menuCopied:true,clipboardMocked:true,privateSourceExcluded:true,canonicalModeHandoff:true,retainedLayoutEnabled:report.retainedLayoutEnabled,localSamples:report.latencyMs.local.count});
 }catch(error){result.error=String(error);throw error;}finally{
  clearInterval(guard);await app.evaluate(({clipboard})=>{if(global.__reportOriginalWrite)clipboard.writeText=global.__reportOriginalWrite;}).catch(()=>{});
  if(page)await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));
 }
})().catch(error=>{console.error(String(error));process.exitCode=1;});
