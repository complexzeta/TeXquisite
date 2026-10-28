const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('active-close'),sourceDirectory=path.join(directory,'source');
 await fs.mkdir(sourceDirectory,{recursive:true});
 const file=path.join(sourceDirectory,'main.tex'),text='\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}\n';
 await fs.writeFile(file,text);await fs.writeFile(path.join(directory,'session.json'),JSON.stringify({docs:[{path:file,text,diskHash:createHash('sha256').update(text).digest('hex'),dirty:false,eol:'\n'}],active:file,root:file,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:directory,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 let closed=false;
 try{
  const page=await app.firstWindow();await page.locator('.cm-content').waitFor();await page.waitForTimeout(2500);
  const exited=app.waitForEvent('close',{timeout:10000});
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});await exited;closed=true;
  assert.equal(await fs.readFile(file,'utf8'),text);
  console.log(JSON.stringify({passed:true,directory,activeCompilerClose:true,sourceRetained:true}));
 }finally{if(!closed)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
