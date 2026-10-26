const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const hash=text=>createHash('sha256').update(text).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','latency-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-latency-'));
 const root=path.join(directory,'main.tex'),source='\\documentclass{article}\n\\begin{document}\nTiming test.\n\\end{document}\n';
 await fs.writeFile(root,source);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:process.env.PERSISTENT_TEX_TEST_VISIBLE?'':'1',PERSISTENT_TEX_PROFILE:'1'}});
 try{
  const page=await app.firstWindow();
  const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&document.querySelector('#previewState').textContent==='Preview up to date',null,{timeout:90000});
  await settled();
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.press('ArrowUp');await page.keyboard.press('Home');
  await page.evaluate(()=>{
   window.inputs=[];window.displays=[];window.delayStarted=false;
   document.querySelector('.cm-content').addEventListener('beforeinput',()=>window.inputs.push(performance.now()),true);
   const post=Worker.prototype.postMessage;
   Worker.prototype.postMessage=function(message,...args){
    if(message.method==='render'&&!window.delayStarted){window.delayStarted=true;setTimeout(()=>post.call(this,message,...args),800);return;}
    return post.call(this,message,...args);
   };
   new MutationObserver(()=>{
    const canvas=document.querySelector('#pages canvas');
    window.displays.push({time:performance.now(),hash:canvas?.dataset.sourceHash,status:document.querySelector('#status').textContent});
   }).observe(document.querySelector('#pages'),{childList:true});
  });
  await page.keyboard.type('x');
  await page.waitForFunction(()=>window.delayStarted,null,{polling:10});
  await page.keyboard.type('y');
  // While the preceding revision is rendering, the old success time must go.
  await page.waitForTimeout(200);
  assert.match(await page.locator('#status').textContent(),/Updating preview/);
  assert.match(await page.locator('#previewState').textContent(),/pending changes/);
  await settled();
  const result=await page.evaluate(()=>({inputs:window.inputs,displays:window.displays,status:document.querySelector('#status').textContent,visibility:document.visibilityState,reportedMs:Number(document.querySelector('#pages canvas').dataset.editLatencyMs),hash:document.querySelector('#pages canvas').dataset.sourceHash}));
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));
  await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent());
  const expected=source.replace('\\end{document}','xy\\end{document}');
  assert.equal(result.hash,hash(expected));
  assert.equal(await fs.readFile(root,'utf8'),expected);
  const display=result.displays.find(d=>d.hash===result.hash);
  assert.ok(display,'Newest revision must actually replace the canvas');
  const observed=display.time-result.inputs[1];
  assert.ok(result.reportedMs>=700,JSON.stringify(result));
  assert.ok(result.reportedMs>=observed-5,`Reported ${result.reportedMs} ms must include observed ${observed} ms`);
  assert.ok(result.reportedMs<observed+150,`Paint allowance must remain bounded: ${result.reportedMs} vs ${observed}`);
  const older=result.displays.find(d=>d.hash!==result.hash);
  assert.ok(older,'The delayed preceding revision must also be displayed');
  assert.doesNotMatch(older.status,/Preview updated/,'Old completion must not claim the new edit is displayed');
  // Selecting the same root must retain edit identity and settle normally.
  await page.locator('#root').click();await settled();
  assert.equal(await page.locator('#pages canvas').getAttribute('data-source-hash'),hash(expected));
  assert.equal(await page.locator('#pages canvas').getAttribute('data-edit-latency-ms'),'','A manual repeat must not report time since an already displayed edit');
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({...result,observedLatestInputToCanvasMs:observed},null,2));
  await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent());
  console.log(JSON.stringify({directory,reportedMs:result.reportedMs,observedMs:observed,status:result.status}));
 }finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
