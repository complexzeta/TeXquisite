const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
(async()=>{
 const dir=path.resolve('.test-output','ui-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:dir,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:30000});
 let app=await launch();
 try{
  let page=await app.firstWindow();page.on('console',m=>console.log('UI:',m.type(),m.text()));page.on('pageerror',e=>console.log('PAGE ERROR',e));
  await page.locator('#example').click();await page.locator('.cm-content').waitFor();
  await page.locator('#build').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='1 / 2',null,{timeout:120000});
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 2');
  const oldWidth=await page.locator('#pages canvas').evaluate(c=>c.width);
  await page.locator('#zoom').selectOption('1.5');await page.waitForFunction(width=>document.querySelector('#pages canvas').width>width,oldWidth);
  await page.locator('#pdfViewport').evaluate(el=>el.scrollTop=180);
  const before=digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL()));
  const root=path.join(dir,'examples','main.tex'),valid=await fs.readFile(root,'utf8');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText(valid.replace('\\end{document}','\\undefinedFailure\n\\end{document}'));
  await page.keyboard.press('Control+S');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Build failed'),null,{timeout:120000});
  assert.equal(digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL())),before);
  assert.equal(await page.locator('#pdfViewport').evaluate(el=>el.scrollTop),180);
  assert.equal(await page.locator('#pageLabel').textContent(),'2 / 2');
  await page.keyboard.press('Control+Z');await page.keyboard.press('Control+S');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview updated'),null,{timeout:120000});
  const repaired=digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL()));
  await page.evaluate(()=>{window.originalGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(){throw new Error('Injected canvas failure');};});
  await page.locator('#build').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Injected canvas failure'),null,{timeout:120000});
  assert.equal(digest(await page.locator('#pages canvas').evaluate(c=>c.toDataURL())),repaired);
  await page.evaluate(()=>HTMLCanvasElement.prototype.getContext=window.originalGetContext);
  await fs.writeFile(root,valid.replace('\\end{document}','\\undefinedFailure\n\\end{document}'));
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n% recovered draft');
  await page.waitForTimeout(800);
  const status=await page.locator('#status').textContent();
  await page.screenshot({path:path.join(dir,'preview.png'),scale:'css',timeout:60000});
  await app.evaluate(({app})=>app.exit(0));
  app=await launch();page=await app.firstWindow();
  await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='1 / 2',null,{timeout:30000});
  assert.match(await page.locator('.cm-content').textContent(),/recovered draft/);
  assert.equal(await fs.readFile(root,'utf8'),valid.replace('\\end{document}','\\undefinedFailure\n\\end{document}'));
  await fs.writeFile(root,valid.replace('A useful invariant','Repaired after restart'));
  await page.locator('#build').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('preview updated'),null,{timeout:120000});
  // Functional assertions use actual canvas hashes above. Capturing a second hidden
  // packaged-window screenshot can stall Chromium's compositor on Windows; the
  // first screenshot and development-app screenshots cover visual inspection.
  if(!process.env.PERSISTENT_TEX_EXECUTABLE)await page.screenshot({path:path.join(dir,'repaired.png'),scale:'css',timeout:60000});
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,status,screenshot:path.join(dir,'preview.png')},null,2));
  console.log('UI TEST PASSED:',dir);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
