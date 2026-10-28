const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('paste'),project=path.join(directory,'source'),profile=path.join(directory,'profile');
 await fs.mkdir(project,{recursive:true});await fs.mkdir(profile,{recursive:true});
 const file=path.join(project,'main.tex'),copy=path.join(project,'copy.tex');
 const original='\\documentclass{article}\n\\begin{document}\nCurrent disk text.\n\\end{document}\n';
 await fs.writeFile(file,original);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:file,text:'Stale clean session',diskHash:hash('Stale clean session'),dirty:false,eol:'\n'}],active:file,root:file,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 try{
  const page=await app.firstWindow();await page.locator('.cm-content').waitFor();
  assert.match(await page.locator('.cm-content').innerText(),/Current disk text/);
  const settled=async text=>{const expected=hash(text??await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()));await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h||c.dataset.localSourceHash===h),expected,{timeout:90000});};
  await settled();
  const paste=async text=>{
   await page.locator('.cm-content').click();await page.keyboard.press('Control+A');
   await page.evaluate(text=>{const data=new DataTransfer();data.setData('text/plain',text);document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},text);
  };
  const large=original.replace('Current disk text.','Pasted document.\n'+('% A long pasted manuscript comment.\n'.repeat(1100)));
  await paste(large);
  await page.waitForFunction(()=>!document.querySelector('#tabs').textContent.includes('•'));
  assert.equal(await fs.readFile(file,'utf8'),large);await settled();console.log('large paste saved and displayed');
  await fs.writeFile(file,'External file preserved\n');await paste(large.replace('Pasted document.','New pasted draft.'));
  await page.waitForFunction(()=>/changed outside|externally changed/.test(document.querySelector('#status').textContent));
  await app.evaluate(({dialog},copy)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:copy});},copy);
  await page.locator('#saveCopy').click();
  console.log('save copy clicked');
  await page.waitForFunction(()=>document.querySelector('#rootLabel').textContent.endsWith('copy.tex'));
  await settled();
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n% Continues saving');
  await page.waitForFunction(()=>!document.querySelector('#tabs').textContent.includes('•'));
  assert.match(await fs.readFile(copy,'utf8'),/Continues saving/);
  assert.equal(await fs.readFile(file,'utf8'),'External file preserved\n');
  await settled();
  // An unrelated conflicted tab must not prevent opening and building a new root.
  await fs.writeFile(copy,'Another external edit\n');await paste(large);
  await page.waitForFunction(()=>/changed outside|externally changed/.test(document.querySelector('#status').textContent));
  const next=path.join(directory,'other-project','next.tex');await fs.mkdir(path.dirname(next));await fs.writeFile(next,original);
  await app.evaluate(({dialog},next)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[next]});},next);
  await page.locator('#open').click();
  await page.waitForFunction(()=>document.querySelector('#rootLabel').textContent.endsWith('next.tex'));
  await page.waitForFunction(next=>document.querySelector('#tabs .active')?.title===next,next,{timeout:15000});
  assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()),original,'Opening another project must activate its exact source');
  await settled(original);
  const state=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));
  assert.equal(state.docs.find(doc=>doc.path===copy).text,large);
  assert.equal(state.docs.find(doc=>doc.path===copy).dirty,true);
  console.log(JSON.stringify({passed:true,directory,staleSessionUsesDisk:true,largePastePreviewMatchesSource:true,externalSourcePreserved:true,copyResumesSaving:true,unrelatedProjectBuilds:true}));
  console.log('PASS: stale clean session, 38 KB clipboard paste, automatic preview, conflict copy, continued saving, unrelated project open; '+directory);
 }catch(error){const page=await app.firstWindow();console.error('UI:',await page.locator('#status').innerText(),await page.locator('#rootLabel').innerText());const identity=await page.evaluate(()=>({active:document.querySelector('#tabs .active')?.title,text:document.querySelector('.cm-content').cmTile.root.view.state.doc.toString(),frames:[...document.querySelectorAll('#pages canvas')].map(c=>({hash:c.dataset.sourceHash,local:c.dataset.localSourceHash,width:c.width}))}));const {text,...metadata}=identity;console.error('Preview identity:',JSON.stringify({...metadata,sourceHash:hash(text)}));console.error((await page.locator('body').innerText()).slice(-2000));throw error;}
 finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
