const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');

async function check(method){
  const directory=path.resolve('.test-output','resolve-'+method+'-'+randomUUID());
  await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,'main.tex'),copy=path.join(directory,'draft-copy.tex'),original='Original\n';
  await fs.writeFile(file,original);
  await fs.writeFile(path.join(directory,'session.json'),JSON.stringify({docs:[{path:file,text:original,diskHash:createHash('sha256').update(original).digest('hex'),dirty:false,eol:'\n'}],active:file,root:'',onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
  const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:directory,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
  try{
    const page=await app.firstWindow();await page.locator('.cm-content').waitFor();
    await app.evaluate(({dialog},copy)=>{dialog.showMessageBox=async()=>({response:0});dialog.showSaveDialog=async()=>({canceled:false,filePath:copy});},copy);
    await fs.writeFile(file,'External equations\n');
    await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('My draft');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('changed outside'));
    await page.locator('#'+method).click();
    if(method==='reload'){
      await page.waitForFunction(()=>document.querySelector('.cm-content').textContent==='External equations');
      const recovery=await fs.readdir(path.join(directory,'recovery'));
      assert.match(await fs.readFile(path.join(directory,'recovery',recovery[0]),'utf8'),/My draft/);
      await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' Resumed');
      await page.waitForFunction(()=>!document.querySelector('#tabs').textContent.includes('•'));
      assert.match(await fs.readFile(file,'utf8'),/Resumed/);
    }else{
      await page.waitForFunction(()=>document.querySelector('#tabs').textContent.includes('draft-copy.tex'));
      assert.match(await fs.readFile(copy,'utf8'),/My draft/);
      assert.equal(await fs.readFile(file,'utf8'),'External equations\n');
      await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' Continued in copy');
      await page.waitForFunction(()=>!document.querySelector('#tabs').textContent.includes('•'));
      assert.match(await fs.readFile(copy,'utf8'),/Continued in copy/);
      assert.equal(await fs.readFile(file,'utf8'),'External equations\n');
      assert.doesNotMatch(await page.locator('#status').innerText(),/changed outside|paused/i);
    }
    console.log(method+': recovery button works despite failed autosave');
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
}
(async()=>{await check('reload');await check('saveCopy');})().catch(error=>{console.error(error);process.exitCode=1;});
