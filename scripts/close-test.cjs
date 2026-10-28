const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');

async function scenario(mode){
  const directory=require('./test-artifacts.cjs').testDirectory('close-'+mode);
  await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,'draft.tex'),original='Original source\n';
  await fs.writeFile(file,original);
  await fs.writeFile(path.join(directory,'session.json'),JSON.stringify({
    docs:[{path:file,text:original,diskHash:createHash('sha256').update(original).digest('hex'),dirty:false,eol:'\n'}],
    active:file,root:'',engine:'pdflatex',latexmk:'latexmk',onSave:mode==='conflict',liveVersion:2
  }));
  const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:directory,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
  let exited=false;
  try{
    const page=await app.firstWindow();
    await page.locator('.cm-content').waitFor();
    await app.evaluate(({dialog})=>{
      globalThis.closeQuestions=0;globalThis.cancelClose=false;
      dialog.showMessageBox=async()=>{globalThis.closeQuestions++;return {response:globalThis.cancelClose?1:0,checkboxChecked:false};};
    });
    if(mode==='conflict')await fs.writeFile(file,'External source\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');await page.keyboard.insertText('Unsaved draft');
    if(mode==='conflict')await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('changed outside'));
    else await page.waitForTimeout(100);
    if(mode==='cancel'){
      await app.evaluate(({BrowserWindow})=>{globalThis.cancelClose=true;BrowserWindow.getAllWindows()[0].close();});
      await page.waitForTimeout(300);
      assert.equal(await app.evaluate(()=>globalThis.closeQuestions),1);
      assert.equal(page.isClosed(),false,'Cancel must keep the editor open');
      await app.evaluate(()=>{globalThis.cancelClose=false;});
    }
    if(mode==='crashed')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    const closed=app.waitForEvent('close',{timeout:12000});
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
    await closed;exited=true;
    const recovered=JSON.parse(await fs.readFile(path.join(directory,'session.json'),'utf8'));
    assert.match(recovered.docs[0].text,/Unsaved draft/);
    assert.equal(recovered.docs[0].dirty,true);
    assert.equal(await fs.readFile(file,'utf8'),mode==='conflict'?'External source\n':original);
    return {passed:true,mode,directory,draftRetained:true,externalSourceProtected:true};
  }finally{if(!exited)await app.evaluate(({app})=>app.exit(1)).catch(()=>{});}
}
(async()=>{const scenarios=[];for(const mode of ['conflict','cancel','crashed'])scenarios.push(await scenario(mode));console.log(JSON.stringify({passed:true,scenarios}));})().catch(error=>{console.error(error);process.exitCode=1;});
