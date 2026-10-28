const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('diagnostics-ui'),project=path.join(directory,'source');await fs.mkdir(project,{recursive:true});
 const profile=path.join(directory,'profile'),root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex');
 const source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nRootMarker.\n\\input{chapter}\n\\end{document}\n',chapterText='\\newpage\nChapterMarker.\n';
 await fs.mkdir(profile);await fs.writeFile(root,source);await fs.writeFile(chapter,chapterText);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 let app=await launch(),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&!document.querySelector('#status').textContent.includes('queued'),null,{timeout:90000,polling:25});
 const canvas=()=>page.locator('#pages canvas').evaluate(c=>c.toDataURL());
 try{
  await settled();const good=await canvas();
  await page.locator('.cm-line').filter({hasText:'RootMarker.'}).click();await page.keyboard.press('End');await page.keyboard.insertText('$\\sqrt\\p');
  await page.locator('#diagnostics').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#diagnosticLocation').textContent==='main.tex · line 4');
  assert.equal(await page.locator('#logs').getAttribute('open'),null,'Draft errors must not open the build log');assert.match(await page.locator('#previewState').textContent(),/behind/);assert.equal(await canvas(),good);assert.match(await page.locator('#diagnosticMessage').textContent(),/Undefined control sequence/);await page.locator('.cm-lintRange-error').first().waitFor();assert.match(await page.locator('#diagnosticHint').textContent(),/spelling/);
  await page.keyboard.insertText('i$');await settled();assert.equal(await page.locator('#diagnostics').isVisible(),false);assert.equal(await page.locator('#previewState').textContent(),'Preview up to date');assert.equal(await page.locator('#logs').getAttribute('open'),null);
  // Error in an unopened included file, triggered by an ordinary root edit.
  await fs.writeFile(chapter,'\\newpage\nChapterMarker \\undefinedChapterError.\n');await page.keyboard.press('End');await page.keyboard.insertText(' ');
  await page.locator('#diagnostics').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#diagnosticLocation').textContent==='chapter.tex · line 2');
  const failedCanvas=await canvas();await page.locator('#diagnosticLocation').click();await page.waitForFunction(()=>document.querySelector('#tabs .active').textContent==='chapter.tex');assert.match(await page.locator('.cm-activeLine').textContent(),/undefinedChapterError/);assert.match(await page.locator('#rootLabel').textContent(),/main.tex/);await page.locator('.cm-lintRange-error').first().waitFor();
  // Explicitly opened logs stay open through recovery.
  await page.locator('#diagnosticLog').click();assert.equal(await page.locator('#logs').getAttribute('open'),'');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText(chapterText);await settled();assert.equal(await page.locator('#diagnostics').isVisible(),false);assert.equal(await page.locator('#logs').getAttribute('open'),'');
  // Pause and edit to ensure a diagnostic cannot navigate old line numbers.
  await page.locator('#logs summary').click();await page.locator('.cm-line').filter({hasText:'ChapterMarker.'}).click();await page.keyboard.press('End');await page.keyboard.insertText('$');await page.locator('#diagnostics').waitFor({state:'visible'});
  await page.locator('#live').click();await page.locator('.cm-line').filter({hasText:'ChapterMarker.'}).click();await page.keyboard.press('End');await page.keyboard.insertText(' ');
  assert.equal(await page.locator('#diagnosticLocation').isDisabled(),true);assert.equal(await page.locator('.cm-lintRange-error').count(),0);assert.match(await page.locator('#diagnosticState').textContent(),/Source changed/);assert.match(await page.locator('#previewState').textContent(),/paused|behind/);
  const before=await page.locator('#tabs .active').textContent();
  const stale=await page.evaluate(async()=>{try{await window.desktop.call('navigateDiagnostic','made-up-id');return 'unexpected';}catch(e){return String(e);}});assert.match(stale,/older source|next build/);assert.equal(await page.locator('#tabs .active').textContent(),before);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText(chapterText);await page.locator('#live').click();await settled();assert.equal(await page.locator('#diagnostics').isVisible(),false);
  // Persist an invalid chapter and recover the last good PDF across restart.
  await page.locator('.cm-line').filter({hasText:'ChapterMarker.'}).click();await page.keyboard.press('End');await page.keyboard.insertText('$\\sqrt\\p');await page.locator('#diagnostics').waitFor({state:'visible'});const retained=await canvas();assert.equal(await page.locator('#logs').getAttribute('open'),null);
  if(process.env.PERSISTENT_TEX_CAPTURE_DIAGNOSTICS){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.screenshot({path:path.join(directory,'diagnostics.png')});}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));
  await page.locator('#diagnostics').waitFor({state:'visible',timeout:90000});assert.equal(await canvas(),retained);assert.equal(await page.locator('#logs').getAttribute('open'),null);assert.match(await page.locator('#diagnosticLocation').textContent(),/chapter.tex/);
  await page.locator('.cm-line').filter({hasText:'ChapterMarker.'}).click();await page.keyboard.press('End');await page.keyboard.insertText('i$');await settled();assert.equal(await page.locator('#diagnostics').isVisible(),false);assert.deepEqual(errors,[]);
  const result={directory,passed:true,quietMath:true,includedErrorNavigation:true,manualLogPreserved:true,staleLocationDisabled:true,restartRecovery:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#diagnostics').textContent()+'\n'+await page.locator('#log').textContent());throw e;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
