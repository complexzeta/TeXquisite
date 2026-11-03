// Synthetic cloud experiment: measure the next word after a locally repaired
// error and a one-second pause. Explicit Build/Export remains strict.
const {_electron:electron}=require('playwright'),fs=require('fs/promises'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const wait=require('./wait-for-async.cjs'),hash=s=>crypto.createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const stats=xs=>{const a=xs.toSorted((a,b)=>a-b);return{n:a.length,median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
(async()=>{
 assert.equal(process.env.CI,'true');const dir=require('./test-artifacts.cjs').testDirectory('repair-pause'),report={passed:false,synthetic:true,endpoint:'completed canvas, not physical paint',trials:[]};
 const original='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nTargetSentinel ordinary lecture words, followed by $\\int_0^1 x$ and more plain words.\n\nRemoteSentinel independent context.\n\n\\end{document}\n';
 try{for(const candidate of [false,true,false,true]){
  const trial={candidate,samples:[]},profile=path.join(dir,'profile-'+report.trials.length),project=path.join(dir,'project-'+report.trials.length),root=path.join(project,'main.tex');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);await fs.writeFile(root,original);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:original,diskHash:hash(original),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,autoClose:false,followPreview:false,backups:false,lastCursor:{file:root,at:original.indexOf('TargetSentinel')+14}}));
  const app=await electron.launch({args:['.'],env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_TEST_KEEP_INITIAL_REPAIR:candidate?'1':'0'},timeout:120000});let page,source=original;
  try{
   page=await app.firstWindow();await page.locator('.cm-content').waitFor();await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});await wait(page,async()=>{const p=await window.desktop.call('previewPerformance');return p.localReady&&!p.localBusy;},null,{timeout:60000});
   await page.evaluate(()=>{window.pauseCommits=0;window.desktop.on(m=>{if(m.type==='commit')window.pauseCommits++;});});
   const edit=async(kind,from,to,insert)=>{
    const input=await page.evaluate(({from,to,insert})=>{const v=document.querySelector('.cm-content').cmTile.root.view,at=performance.now();v.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},userEvent:insert?'input.type':'delete.backward'});return{id:v.dom.dataset.editorEditId,at};},{from,to,insert});source=source.slice(0,from)+insert+source.slice(to);
    await page.waitForFunction(id=>JSON.parse(document.querySelector('#pages').dataset.displayedFrame||'{}').id===id,input.id,{timeout:15000,polling:10});
    const frame=await page.evaluate(()=>JSON.parse(document.querySelector('#pages').dataset.displayedFrame));assert.equal(frame.sourceHash,hash(source));const performance=await page.evaluate(()=>window.desktop.call('previewPerformance',true));const sample={kind,ms:Math.ceil(frame.at-input.at),layout:frame.layout,ready:performance.localReady,busy:performance.localBusy,trace:performance.trace};trial.samples.push(sample);return sample;
   };
   for(let n=0;n<12;n++){
    const typo=source.indexOf('\\int_')+4;assert.ok(typo>3);const first=await edit('new-typo',typo,typo,'t');await page.waitForFunction(()=>Number(document.querySelector('#errorCount').dataset.errors)>0,null,{timeout:10000});
    const commits=await page.evaluate(()=>window.pauseCommits);await delay(1000);const before=await page.evaluate(()=>window.desktop.call('previewPerformance'));const at=source.indexOf('TargetSentinel')+14;const next=await edit('word-after-pause',at,at,' testing');next.readyBefore=before.localReady;next.busyBefore=before.localBusy;next.idleCommits=await page.evaluate(()=>window.pauseCommits)-commits;next.firstRepairLocal=first.layout!=='full';
    const corrected=source.indexOf('\\intt_')+4;await edit('correct-typo',corrected,corrected+1,'');await page.waitForFunction(()=>document.querySelector('#errorCount').dataset.errors==='0',null,{timeout:10000});
    const word=source.indexOf(' testing');await edit('remove-word',word,word+8,'');assert.equal(source,original);await delay(1000);
   }
   trial.nextWord=stats(trial.samples.filter(s=>s.kind==='word-after-pause').map(s=>s.ms));trial.allRepairsLocal=trial.samples.filter(s=>s.kind==='word-after-pause').every(s=>s.firstRepairLocal);assert.ok(trial.allRepairsLocal,'Experiment must actually exercise local repair');
   // A preview-only skip must never allow a broken source to be exported.
   const typo=source.indexOf('\\int_')+4;await edit('export-error',typo,typo,'t');const output=path.join(project,'must-not-export.pdf');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);const failure=await page.evaluate(async()=>{try{await window.desktop.call('export');return '';}catch(e){return String(e);}});assert.match(failure,/error|verified|Undefined/i);assert.equal(await fs.stat(output).then(()=>true,()=>false),false);trial.strictExportRejected=true;
   await edit('final-correction',typo,typo+1,'');await page.waitForFunction(()=>document.querySelector('#errorCount').dataset.errors==='0',null,{timeout:10000});assert.equal(await fs.readFile(root,'utf8'),source);trial.sourceSavedExactly=true;trial.passed=true;
  }catch(e){trial.error=String(e);throw e;}finally{if(page)await fs.writeFile(path.join(project,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.close().catch(()=>{});report.trials.push(trial);await fs.writeFile(path.join(project,'result.json'),JSON.stringify(trial,null,2));console.log(JSON.stringify({candidate,passed:trial.passed,nextWord:trial.nextWord,error:trial.error}));}
 }}finally{report.passed=report.trials.length===4&&report.trials.every(t=>t.passed);await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
