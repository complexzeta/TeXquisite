const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');const {testDirectory}=require('./test-artifacts.cjs');
(async()=>{
 const directory=testDirectory('toolchain-ui'),profile=path.join(directory,'profile');await fs.mkdir(profile);const errors=[];
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PATH:path.join(process.env.SystemRoot,'System32'),PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 let app=await launch(),page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));const close=()=>app.evaluate(({app})=>app.exit(0));
 try{
  await page.waitForFunction(()=>document.querySelector('#settingsDialog')?.open&&document.querySelector('#toolchainSummary').textContent.includes('Ready for compilation'),null,{timeout:90000});
  const bin=await page.locator('#texBin').inputValue();assert.match(bin,/texlive/i);assert.match(await page.locator('#toolchainSummary').textContent(),/Fast local preview is compatible/);
  await page.screenshot({path:path.join(directory,'first-run.png')});
  await page.locator('#texBin').fill(path.join(directory,'missing-installation'));await page.locator('#checkTeX').click();await page.waitForFunction(()=>document.querySelector('#toolchainSummary').textContent.includes('Installation needs attention'));
  assert.match(await page.locator('#toolchainDetails').textContent(),/No TeX executables/);assert.equal(await page.locator('#toolchainNotice').isVisible(),false,'Unsaved checks must not change the active installation notice');
  await app.evaluate(({dialog},bin)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[bin]});},path.dirname(path.dirname(bin)));
  await page.locator('#browseTeX').click();await page.waitForFunction(()=>document.querySelector('#toolchainSummary').textContent.includes('Ready for compilation'));assert.equal(await page.locator('#texBin').inputValue(),bin);
  await page.locator('#engine').selectOption('xelatex');await page.locator('#checkTeX').click();await page.waitForFunction(()=>document.querySelector('#toolchainSummary').textContent.includes('uses native compilation'));
  await page.locator('#applySettings').click();await page.waitForFunction(()=>!document.querySelector('#settingsDialog').open);assert.equal(await page.locator('#toolchainNotice').isVisible(),true);assert.match(await page.locator('#toolchainNoticeText').textContent(),/native compilation/);
  const saved=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));assert.equal(saved.texBin,bin);assert.equal(saved.engine,'xelatex');
  await close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>document.querySelector('#toolchainNoticeText').textContent.includes('native compilation'),null,{timeout:90000});assert.equal(await page.locator('#settingsDialog').evaluate(e=>e.open),false,'An acknowledged native-only configuration must not reopen the wizard every launch');
  await page.locator('#settings').click();await page.locator('#engine').selectOption('pdflatex');await page.locator('#applySettings').click();await page.waitForFunction(()=>!document.querySelector('#settingsDialog').open);assert.equal(await page.locator('#toolchainNotice').isVisible(),false);assert.deepEqual(errors,[]);
  const result={passed:true,directory,noTexOnPath:true,firstRun:true,discovered:bin,invalidFolderExplained:true,folderPicker:true,explicitNativeNotice:true,persistedChoice:true,acknowledgedNativeRestart:true,fastModeRestored:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#toolchainSummary').textContent().catch(()=>''));throw e;}finally{await close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
