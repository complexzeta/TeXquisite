const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
(async()=>{
 const profile=path.resolve('.test-output','manuscript-'+randomUUID());await fs.mkdir(profile,{recursive:true});
 const file=path.resolve('projects/bakoma-test/bakoma-test.tex'),buffer=await fs.readFile(file);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:file,text:buffer.toString().replace(/\r\n/g,'\n'),diskHash:createHash('sha256').update(buffer).digest('hex'),dirty:false,eol:'\r\n'}],active:file,root:file,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated'),null,{timeout:120000});
  const label=await page.locator('#pageLabel').innerText();if(label!=='1 / 6')throw new Error('Unexpected page count: '+label);
  await page.screenshot({path:path.join(profile,'preview.png')});
  console.log('PASS: actual prepared manuscript displayed six pages; '+profile);
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
