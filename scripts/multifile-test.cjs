const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=path.resolve('.test-output','multifile-ui-'+randomUUID()),sourceDir=path.join(directory,'source');await fs.mkdir(sourceDir,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-multifile-'));
 const root=path.join(sourceDir,'main.tex'),chapter=path.join(sourceDir,'chapter6.tex');
 const source='\\documentclass[openany]{book}\n\\usepackage{amsmath,amssymb,amsthm,tikz,hyperref,graphicx,geometry,fancyhdr,xcolor,enumitem}\n\\begin{document}\n'+Array.from({length:6},(_,i)=>'\\input{chapter'+(i+1)+'}\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);let chapterText;
 for(let n=1;n<=6;n++){
  const text='\\chapter{Chapter '+n+'}\\label{chapter:'+n+'}\n'+('A paragraph about mathematical writing, references and diagrams. '.repeat(22))+'\n\\[\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\\]\n\\begin{tikzpicture}\\draw (0,0) rectangle (2,1);\\end{tikzpicture}\n\\newpage\nSee chapter \\ref{chapter:1}.\nTypingMarker.\n';
  await fs.writeFile(path.join(sourceDir,'chapter'+n+'.tex'),text);if(n===6)chapterText=text;
 }
 const docs=[[root,source],[chapter,chapterText]].map(([file,text])=>({path:file,text,diskHash:hash(text),dirty:false,eol:'\n'}));
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs,root,active:chapter,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',followPreview:true,previewEditing:!!process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}}),page=await app.firstWindow();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&!document.querySelector('#status').textContent.includes('queued'),null,{timeout:120000,polling:20});
 try{
  await settled();await page.locator('.cm-line').filter({hasText:/^TypingMarker\.$/}).click();await page.keyboard.press('End');
  if(process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT){
   const folder=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),records=(await fs.readdir(path.join(folder,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(folder,'commits',records.at(-1)))),nav=JSON.parse(await fs.readFile(path.join(folder,'bundles',record.id,'navigation.json'))),g=nav.characters.filter(g=>g[0]===chapter&&g[1]===7).at(-1);
   assert.ok(g);await page.locator('#pages canvas').click({position:{x:g[4]+g[6]-.1,y:g[5]+g[7]/2}});await page.waitForFunction(()=>document.activeElement?.id==='previewInput');
  }
  await page.evaluate(({chapter,preview})=>{
   window.measurements=[];window.inputTimes=[];const maps=new Map();let latest;
   document.querySelector(preview?'#previewInput':'.cm-content').addEventListener('beforeinput',()=>window.inputTimes.push(performance.now()),true);
   window.desktop.on(m=>{if(m.type==='prepare')maps.set(m.bundle.id,m.navigation?.sources?.[chapter]);if(m.type==='commit')latest={hash:maps.get(m.id)};});
   let last=document.querySelector('#pages canvas');new MutationObserver(()=>{const canvas=document.querySelector('#pages canvas');if(canvas===last)return;last=canvas;window.measurements.push({...latest,time:performance.now()});}).observe(document.querySelector('#pages'),{childList:true});
  },{chapter,preview:!!process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT});
  const isolated=[];
  for(let i=0;i<5;i++){
   const count=await page.evaluate(()=>window.measurements.length);await page.keyboard.insertText('x');await page.waitForFunction(n=>window.measurements.length>n,count,{timeout:60000});await settled();
   isolated.push(await page.evaluate(()=>window.measurements.at(-1).time-window.inputTimes.at(-1)));await delay(100);
  }
  await page.evaluate(()=>{window.measurements=[];window.inputTimes=[];});
  for(let i=0;i<30;i++){await page.keyboard.type('x');await delay(100);}
  await settled();await page.waitForFunction(()=>!document.querySelector('#tabs .active').textContent.includes('•'));
  const expected=chapterText.replace('TypingMarker.','TypingMarker.'+'x'.repeat(35));assert.equal(await fs.readFile(chapter,'utf8'),expected);assert.equal(await fs.readFile(root,'utf8'),source);
  const data=await page.evaluate(()=>({records:window.measurements,inputs:window.inputTimes}));
  const characters=Array.from({length:30},(_,i)=>{const h=hash(chapterText.replace('TypingMarker.','TypingMarker.'+'x'.repeat(6+i))),record=data.records.find(r=>r.hash===h);return {character:i+1,displayed:!!record,latencyMs:record?record.time-data.inputs[i]:null};});
  assert.ok(characters.at(-1).displayed,'The final chapter revision must be displayed');
  // Enter unfinished math, then repair through real editor input.
  if(process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT){await page.keyboard.press('Escape');await page.locator('.cm-line').filter({hasText:/^TypingMarker\./}).click();await page.keyboard.press('End');}
  const goodEdit=await page.locator('#pages canvas').getAttribute('data-edit-id');await page.keyboard.insertText('$\\sqrt\\p');await delay(500);if(process.env.PERSISTENT_TEX_ASSERT_FAST_MULTIFILE)assert.equal(await page.locator('#pages canvas').getAttribute('data-edit-id'),goodEdit,'Unfinished math must retain the accepted canvas');const during=await page.locator('#status').textContent();await page.keyboard.insertText('i$');await settled();
  assert.equal(await fs.readFile(chapter,'utf8'),expected.replace('x'.repeat(35),'x'.repeat(35)+'$\\sqrt\\pi$'));
  const log=await page.locator('#log').textContent(),latencies=characters.filter(c=>c.displayed).map(c=>c.latencyMs).sort((a,b)=>a-b);
  assert.deepEqual(errors,[]);const result={directory,previewEditing:!!process.env.PERSISTENT_TEX_PERF_PREVIEW_EDIT,executable:process.env.PERSISTENT_TEX_EXECUTABLE||'development',pages:await page.locator('#pageLabel').textContent(),isolated,characters,displayed:latencies.length,median:latencies[Math.floor(latencies.length/2)],mathRepairStatus:await page.locator('#status').textContent(),during,engineTimings:log.split('\n').filter(s=>s.startsWith('Timing: resident'))};
  if(process.env.PERSISTENT_TEX_ASSERT_FAST_MULTIFILE){
   assert.ok(isolated.every(ms=>ms<500),'Warm chapter edits must reach the displayed canvas in under 500 ms on this fixture');
   assert.ok(result.engineTimings.slice(1).every(line=>JSON.parse(line.slice('Timing: resident '.length)).preambleRebuilt===false),'Body edits must retain the preamble');
   assert.doesNotMatch(log,/Resident capability check failed|Resident fallback/);
  }
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(directory,'build.log'),log);console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());throw e;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
