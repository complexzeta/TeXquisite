const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const state=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Persistent TeX/session.json'),'utf8')),original=state.docs.find(d=>d.path===state.root).text;
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'tex-typing-regression-')),directory=await fs.mkdtemp(path.resolve('.test-output/typing-source-')),root=path.join(directory,'source','main.tex');await fs.mkdir(path.dirname(root));await fs.writeFile(root,original);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({...state,root,active:root,docs:[{...state.docs.find(d=>d.path===state.root),path:root}],previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:process.env.PERSISTENT_TEX_TEST_VISIBLE==='1'?'':'1'}}),page=await app.firstWindow();
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(original),{timeout:120000});
  await page.evaluate(()=>{window.trace=[];window.desktop.on(m=>{if(['localState','localPage','status'].includes(m.type))window.trace.push({type:m.type,state:m.state,text:m.text,page:m.page,pageOutput:m.pageOutput,editId:m.editId,displayedPage:document.querySelector('#pageLabel').textContent,at:performance.now()});});new MutationObserver(()=>{const c=document.querySelector('#pages canvas');if(c?.dataset.localEditId&&c.dataset.localEditId===c.dataset.localLatencyEditId)window.trace.push({canvas:{...c.dataset},at:performance.now()});}).observe(document.querySelector('#pages'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-local-latency-edit-id']});});
  for(const scenario of ['existing','new']){
   await page.evaluate(scenario=>{const v=document.querySelector('.cm-content').cmTile.root.view,s=v.state.doc.toString(),at=scenario==='existing'?s.indexOf('Testing testing testing\n')+'Testing testing testing'.length:s.indexOf('\nTesting\n')+'\nTesting'.length;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},scenario);
   if(scenario==='new')await page.keyboard.press('Enter');
   const preparationStarted=Date.now();await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});const preparationMs=Date.now()-preparationStarted;
   const before=await page.evaluate(()=>({state:document.querySelector('#previewState').dataset.localState,status:document.querySelector('#status').textContent}));
   await page.keyboard.type(' ordinarywords',{delay:100});await delay(2000);
   const after=await page.evaluate(()=>({state:document.querySelector('#previewState').dataset.localState,status:document.querySelector('#status').textContent,canvas:{...document.querySelector('#pages canvas').dataset},trace:window.trace.splice(0)})),frames=[...new Map(after.trace.filter(t=>t.canvas).map(t=>[t.canvas.localEditId,t.canvas])).values()];
   await fs.writeFile(path.join(directory,scenario+'.json'),JSON.stringify({before,after},null,2));
   assert.ok(frames.length>=5,'Continuous typing must display intermediate frames');assert.ok(frames.every(f=>f.localLayout==='paragraph'),'Ordinary letters, including after Enter, must stay on the paragraph path');if(scenario==='existing')assert.ok(after.status.includes('Local preview appeared'),'Full verification must distinguish first local display from later verification');
   console.log(JSON.stringify({scenario,before,preparationMs,status:after.status,frames:frames.length,latenciesMs:frames.map(f=>Number(f.localLatencyMs)),layouts:[...new Set(frames.map(f=>f.localLayout))],directory}));
  }
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('A separate paragraph.');
  const structural=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h&&document.querySelector('#pages canvas')?.dataset.localLayout==='page',hash(structural),{timeout:10000});
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(structural),{timeout:60000});console.log(JSON.stringify({structuralPageFallback:true}));
  assert.equal((await fs.readFile(state.root,'utf8')).replace(/\r\n/g,'\n'),original,'User manuscript must remain unchanged');assert.equal(await fs.readFile(root,'utf8'),structural);await fs.mkdir('.test-output',{recursive:true});await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent());
 }finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
