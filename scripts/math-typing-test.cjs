const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const hash=text=>createHash('sha256').update(text).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','math-typing-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-math-'));
 const original=(await fs.readFile(process.argv[2]||'fixtures/article/main.tex','utf8')).replace(/\r\n/g,'\n');
 const source=original.replace('\\end{document}','Math probe: \n\\end{document}');
 const root=path.join(directory,'main.tex');await fs.writeFile(root,source);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',followPreview:!!process.env.PERSISTENT_TEX_MATH_FOLLOW,supportFolders:process.env.PERSISTENT_TEX_SUPPORT_FOLDERS?.split(path.delimiter).filter(Boolean)}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}});
 try{
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated'),null,{timeout:120000});
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');
  await page.locator('.cm-line').filter({hasText:/^Math probe: $/}).click();await page.keyboard.press('End');
  await page.evaluate(()=>{
   window.mathInputs=[];window.mathDisplays=[];
   document.querySelector('.cm-content').addEventListener('beforeinput',()=>window.mathInputs.push(performance.now()),true);
   new MutationObserver(()=>window.mathDisplays.push({time:performance.now(),hash:document.querySelector('#pages canvas')?.dataset.sourceHash})).observe(document.querySelector('#pages'),{childList:true});
  });
  const expression=process.env.PERSISTENT_TEX_MATH_EXPRESSION||'$\\sqrt\\pi$';await page.keyboard.type(expression,{delay:100});
  const expected=source.replace('Math probe: ','Math probe: '+expression),expectedHash=hash(expected);
  await page.waitForFunction(expectedHash=>document.querySelector('#pages canvas')?.dataset.sourceHash===expectedHash&&document.querySelector('#status').textContent.startsWith('Preview updated'),expectedHash,{timeout:120000,polling:20});
  const result=await page.evaluate(()=>({inputs:window.mathInputs,displays:window.mathDisplays,status:document.querySelector('#status').textContent,page:document.querySelector('#pageLabel').textContent}));
  const displayed=result.displays.find(d=>d.hash===expectedHash);result.finalCharacterToCanvasMs=displayed.time-result.inputs.at(-1);
  const log=await page.locator('#log').textContent();result.nativeFallbacks=(log.match(/Resident capability check failed/g)||[]).length;result.directory=directory;result.expression=expression;
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(directory,'build.log'),log);
  assert.equal(await fs.readFile(root,'utf8'),expected);assert.ok(displayed);
  if(process.env.PERSISTENT_TEX_ASSERT_FAST_MATH){assert.equal(result.nativeFallbacks,0,'Incomplete math must not launch native capability retries');assert.ok(result.finalCharacterToCanvasMs<500,`Final expression waited ${result.finalCharacterToCanvasMs} ms`);}
  console.log(JSON.stringify(result,null,2));
 }finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
