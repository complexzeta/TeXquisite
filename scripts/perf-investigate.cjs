const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const os=require('node:os');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const directory=path.resolve('.test-output','profile-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const profileDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-perf-'));
 const source=await fs.readFile(process.argv[2]||'fixtures/article/main.tex','utf8');
 const sourceDirectory=path.join(directory,'source');await fs.mkdir(sourceDirectory);
 const root=path.join(sourceDirectory,'main.tex');await fs.writeFile(root,source);
 await fs.writeFile(path.join(profileDirectory,'session.json'),JSON.stringify({docs:[{path:root,text:source.replace(/\r\n/g,'\n'),diskHash:createHash('sha256').update(source).digest('hex'),dirty:false,eol:source.includes('\r\n')?'\r\n':'\n'}],active:root,root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:!!process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT,supportFolders:process.env.PERSISTENT_TEX_SUPPORT_FOLDERS?.split(path.delimiter).filter(Boolean)}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profileDirectory,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}});
 try{
  const page=await app.firstWindow();
  const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&!document.querySelector('#status').textContent.includes('queued'),null,{timeout:120000});
  await settled();
  if(process.env.PERSISTENT_TEX_PERF_LAST_PAGE){const count=Number((await page.locator('#pageLabel').textContent()).split('/')[1]);for(let p=1;p<count;p++){await page.locator('#nextPage').click();await page.waitForFunction(p=>Number(document.querySelector('#pageLabel').textContent.split('/')[0])===p+1,p);}}
  if(process.env.PERSISTENT_TEX_PERF_FOLLOW)await page.locator('#follow').click();
  await page.evaluate(()=>{
   window.profileEdits=[];window.profileCommits=[];window.profileInputs=[];window.profileCommitRecords=[];window.pendingProfileInput=0;
   document.addEventListener('beforeinput',()=>{window.pendingProfileInput=performance.now();window.profileInputs.push(window.pendingProfileInput);},true);
   let lastCanvas=document.querySelector('#pages canvas');
   new MutationObserver(()=>{const canvas=document.querySelector('#pages canvas');if(canvas===lastCanvas)return;lastCanvas=canvas;const now=performance.now();window.profileCommits.push(now);window.profileCommitRecords.push({time:now,hash:canvas?.dataset.sourceHash});if(window.pendingProfileInput)window.profileEdits.push(now-window.pendingProfileInput);}).observe(document.querySelector('#pages'),{childList:true});
  });
  for(let i=0;i<10;i++){
   await page.locator('.cm-content').click();await page.keyboard.press('Control+A');
   const count=await page.evaluate(()=>window.profileCommits.length);
   await page.keyboard.insertText(source.replace('\\end{document}',`Speed measurement ${i}.\n\\end{document}`));
   await page.waitForFunction(count=>window.profileCommits.length>count,count,{timeout:60000});await settled();await delay(100);
  }
  const isolated=await page.evaluate(()=>window.profileEdits.slice());
  await page.evaluate(()=>{window.profileCommits=[];window.profileEdits=[];window.profileInputs=[];window.profileCommitRecords=[];});
  // Keep the end-document command on its own line so continuous typing tests
  // the same accelerated path as isolated edits. Its location is significant
  // to the current conservative fast-path eligibility screen.
  const line=source.replace('\\end{document}','Speed measurement 9.\n\\end{document}').replace(/\r\n/g,'\n').split('\n').findIndex(s=>s==='Speed measurement 9.');
  await page.keyboard.press('Control+End');
  await page.locator('.cm-line').filter({hasText:/^Speed measurement 9\.$/}).click();
  await page.keyboard.press('End');
  if(process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT){
   const hash=createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,32),folder=path.join(profileDirectory,'projects',hash),records=(await fs.readdir(path.join(folder,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(folder,'commits',records.at(-1)))),nav=JSON.parse(await fs.readFile(path.join(folder,'bundles',record.id,'navigation.json'))),g=nav.characters.filter(g=>g[0]===root&&g[1]===line+1).sort((a,b)=>a[2]-b[2]).at(-1);
   assert.ok(g);await page.locator('#pages canvas').click({position:{x:g[4]+g[6]-.1,y:g[5]+g[7]/2}});await page.waitForFunction(()=>document.activeElement?.id==='previewInput');
  }
  for(let i=0;i<50;i++){await page.keyboard.type('x');await delay(100);}
  await settled();
  const continuous=await page.evaluate(()=>({commits:window.profileCommits.length,gaps:window.profileCommits.slice(1).map((time,i)=>time-window.profileCommits[i]),inputs:window.profileInputs,records:window.profileCommitRecords}));
  const expectedBase=source.replace(/\r\n/g,'\n').replace('\\end{document}','Speed measurement 9.\n\\end{document}');
  assert.equal((await fs.readFile(root,'utf8')).replace(/\r\n/g,'\n'),expectedBase.replace('Speed measurement 9.','Speed measurement 9.'+'x'.repeat(50)),'Typing must occur inside the document, before end-document');
  const characters=Array.from({length:50},(_,i)=>{
   const text=expectedBase.replace('Speed measurement 9.','Speed measurement 9.'+'x'.repeat(i+1));
   const hash=createHash('sha256').update(text).digest('hex'),commit=continuous.records.find(r=>r.hash===hash);
   return {character:i+1,displayed:!!commit,latencyMs:commit?commit.time-continuous.inputs[i]:null,beforeNextInput:!!commit&&i<49&&commit.time<continuous.inputs[i+1]};
  });
  const log=await page.locator('#log').textContent();
  const result={directory,profileDirectory,previewEditing:!!process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT,sourceFile:process.argv[2]||'fixtures/article/main.tex',sourceBytes:Buffer.byteLength(source),devicePixelRatio:await page.evaluate(()=>devicePixelRatio),finalPage:await page.locator('#pageLabel').textContent(),follow:!!process.env.PERSISTENT_TEX_PERF_FOLLOW,isolatedInputToCanvasMs:isolated,continuous,
   characters,builds:log.split('\n').filter(s=>s.startsWith('Profile build ')).map(s=>JSON.parse(s.slice(14))),saves:log.split('\n').filter(s=>s.startsWith('Profile save ')).map(s=>JSON.parse(s.slice(13))),engineTimings:log.split('\n').filter(s=>s.startsWith('Timing: engine')||s.startsWith('Timing: resident'))};
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(directory,'build.log'),log);
  console.log(JSON.stringify(result,null,2));
 }finally{
  await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
