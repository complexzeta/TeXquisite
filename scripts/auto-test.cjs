const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const dir=path.resolve('.test-output','auto-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const root=path.join(dir,'examples','main.tex');
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:dir,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:30000});
 let app=await launch(),page=await app.firstWindow();const errors=[],measurements=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&!document.querySelector('#status').textContent.includes('queued'),null,{timeout:90000});
 const published=async()=>{
  const projects=await fs.readdir(path.join(dir,'projects'));
  const commits=await fs.readdir(path.join(dir,'projects',projects[0],'commits'));
  return commits.filter(x=>x.endsWith('.json')).sort().at(-1);
 };
 try{
  await page.locator('#example').click();await settled();
  const original=await fs.readFile(root,'utf8');
  // No Save, Build or keyboard save shortcuts anywhere in this test.
  for(let i=0;i<6;i++){
   const old=await published();
   await page.locator('.cm-content').click();await page.keyboard.press('Control+A');
   await page.evaluate(()=>{
    window.previewProbe={};
    document.querySelector('.cm-content').addEventListener('beforeinput',()=>window.previewProbe.start=performance.now(),{once:true});
    const observer=new MutationObserver(()=>{if(window.previewProbe.start!==undefined){window.previewProbe.canvasMs=performance.now()-window.previewProbe.start;observer.disconnect();}});
    observer.observe(document.querySelector('#pages'),{childList:true});
   });
   const start=Date.now();await page.keyboard.insertText(original.replace('A useful invariant','Automatic body edit '+i));
   while(!(await fs.readFile(root,'utf8')).includes('Automatic body edit '+i))await delay(20);
   const savedMs=Date.now()-start;
   while(await published()===old)await delay(30);
   await settled();measurements.push({saveMs:savedMs,editToPreviewMs:Date.now()-start,inputToCanvasMs:await page.evaluate(()=>Math.round(window.previewProbe.canvasMs)),status:await page.locator('#status').textContent()});
  }
  const saveCanvas=async name=>{const data=await page.locator('#pages canvas').evaluate(c=>c.toDataURL());await fs.writeFile(path.join(dir,name),Buffer.from(data.split(',')[1],'base64'));};
  await saveCanvas('page-one.png');
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 2');
  await saveCanvas('page-two.png');
  const canvas=digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL()));
  const valid=await fs.readFile(root,'utf8');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText(valid.replace('\\end{document}','\\undefinedAutomaticError\n\\end{document}'));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Build failed'),null,{timeout:90000});
  assert.equal(digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL())),canvas);
  await page.keyboard.press('Control+Z');await settled();
  // A failed offscreen raster must not replace the accepted page or prevent repair.
  await page.evaluate(()=>{window.originalPutImageData=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(){throw new Error('Injected raster failure');};});
  await page.keyboard.press('Control+End');await page.keyboard.insertText('\n% renderer failure test');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Injected raster failure'),null,{timeout:90000});
  assert.equal(digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL())),canvas);
  await page.evaluate(()=>{CanvasRenderingContext2D.prototype.putImageData=window.originalPutImageData;delete window.originalPutImageData;});
  await page.keyboard.press('Control+Z');await settled();
  // Continuous typing must save and publish without waiting for typing to stop.
  await page.evaluate(()=>{
   window.continuousPreviewTimes=[];
   window.continuousObserver=new MutationObserver(()=>window.continuousPreviewTimes.push(performance.now()));
   window.continuousObserver.observe(document.querySelector('#pages'),{childList:true});
  });
  const before=await published();await page.keyboard.press('Control+End');await page.keyboard.press('ArrowUp');await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.keyboard.press('ArrowUp');await page.keyboard.insertText('% continuous ');
  let savedWhileTyping=false,publishedWhileTyping=false;
  for(let i=0;i<65;i++){
   await page.keyboard.insertText('x');await delay(100);
   if((await fs.readFile(root,'utf8')).includes('% continuous x'))savedWhileTyping=true;
   if(await published()!==before)publishedWhileTyping=true;
  }
  assert.ok(savedWhileTyping,'No disk save during continuous typing');assert.ok(publishedWhileTyping,'No preview update during continuous typing');await settled();
  const continuousPreviewGaps=await page.evaluate(()=>{window.continuousObserver.disconnect();return window.continuousPreviewTimes.slice(1).map((time,i)=>Math.round(time-window.continuousPreviewTimes[i]));});
  // An external change cannot be overwritten by automatic saving.
  await fs.writeFile(root,original+'\n% externally changed\n');
  await page.keyboard.insertText(' draft');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('changed outside')||document.querySelector('#status').textContent.includes('externally changed'),null,{timeout:10000});
  assert.match(await fs.readFile(root,'utf8'),/externally changed/);
  assert.ok(!(await fs.readFile(root,'utf8')).includes(' draft'));
  assert.deepEqual(errors,[]);
  const timings=(await page.locator('#log').textContent()).split('\n').filter(line=>line.startsWith('Timing:'));
  // Reload the accepted PDF and conflicting draft in a fresh renderer/worker.
  await app.evaluate(({app})=>app.exit(0));
  app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));
  await page.waitForFunction(()=>document.querySelector('#pages canvas')&&document.querySelector('.cm-content').textContent.includes(' draft'),null,{timeout:30000});
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 2');
  assert.equal(digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL())),canvas);
  assert.ok(!(await fs.readFile(root,'utf8')).includes(' draft'));assert.deepEqual(errors,[]);
  const result={passed:true,measurements,savedWhileTyping,publishedWhileTyping,continuousPreviewGaps,restartRestoredPreviewAndDraft:true,timings};
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory:dir,...result},null,2));
 }catch(error){
  const diagnostic=await page.locator('#status').textContent().catch(()=>'<closed>');
  const buildLog=await page.locator('#log').textContent().catch(()=>'<closed>');
  await fs.writeFile(path.join(dir,'failure.log'),diagnostic+'\n'+buildLog);
  console.error('UI failure status: '+diagnostic+'\n'+buildLog.slice(-2500));
  throw error;
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
