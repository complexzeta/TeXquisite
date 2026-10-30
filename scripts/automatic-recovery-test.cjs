// No Retry/Build calls: typing, leaving a repaired paragraph and correcting it
// must continue automatically, including across pauses longer than the old timer.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('automatic-recovery'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),root=path.join(project,'main.tex');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);
 let expected='\\documentclass{article}\n\\begin{document}\n\nWarmupSentinel ordinary words.\n\nTargetSentinel ordinary words before $\\int_0^1 x$ AfterSentinel ordinary words after the math.\n\nRemoteSentinel '+('Distant ordinary context with $x^2$. '.repeat(20))+'\n\nTailSentinel ordinary ending.\n\n\\end{document}\n';
 await fs.writeFile(root,expected);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:expected,diskHash:hash(expected),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,followPreview:false,autoClose:false}));
 assert.ok(os.freemem()>1024**3,'Insufficient memory for an isolated app');
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0',PERSISTENT_TEX_TEST_HIDDEN:'1'}});os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const result={passed:false,samples:[]},guard=setInterval(()=>{if(os.freemem()<256*1024**2)void app.evaluate(({app})=>app.exit(0)).catch(()=>{});},1000);guard.unref();let page;
 try{
  page=await app.firstWindow();result.rendererFailures=[];page.on('console',m=>{if(/^Local page output rejected/.test(m.text())&&result.rendererFailures.length<12)result.rendererFailures.push(m.text());});result.version=await app.evaluate(({app})=>app.getVersion());await page.evaluate(()=>{window.autoRecoveryCommits=0;window.desktop.on(m=>{if(m.type==='commit')window.autoRecoveryCommits++;});});
  const commits=()=>page.evaluate(()=>window.autoRecoveryCommits);
  const full=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h&&!c.dataset.localEditId),hash(expected),{timeout:90000,polling:20});
  const focus=async at=>{await page.evaluate(async({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();await window.desktop.call('localCursor',root,at);},{root,at});};
  const ready=async(at,broken)=>{await focus(at);let streak=0;const h=hash(broken?expected.replace('\\intt','     '):expected);for(let i=0;i<900;i++){const p=await page.evaluate(()=>window.desktop.call('previewPerformance')),r=p.localRange;if(p.localReady&&!p.localBusy&&r?.file===root&&r.from<=at&&at<r.to&&r.sourceHash===h)streak++;else streak=0;if(streak>=3)return;await delay(50);}throw Error('The current recovery basis did not become ready');};
  const edit=async(at,insert,remove=0)=>{await page.evaluate(({at,insert,remove})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,to:at+remove,insert},selection:{anchor:at+insert.length}});},{at,insert,remove});expected=expected.slice(0,at)+insert+expected.slice(at+remove);};
  const local=async(broken,phase)=>{await page.waitForFunction(({h,broken})=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localRecovered===String(broken)&&c.dataset.localLatencyEditId===c.dataset.localEditId),{h:hash(expected),broken},{timeout:15000,polling:10});result.samples.push(await page.evaluate(({h,phase})=>{const c=[...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId);return {phase,layout:c.dataset.localLayout,ms:Number(c.dataset.localLatencyMs),stateChanged:c.dataset.localStateChanged==='true',editId:c.dataset.localEditId};},{h:hash(expected),phase}));};
  await full();await ready(expected.indexOf('TargetSentinel')+6,false);
  await edit(expected.indexOf('\\int')+4,'t');await full();await ready(expected.indexOf('TargetSentinel')+6,true);
  for(const marker of ['TargetSentinel','AfterSentinel','TargetSentinel']){
   const stable=await commits(),at=expected.indexOf(marker)+marker.length;await focus(at);await edit(at,' more');await local(true,'same-paragraph-'+marker);
   assert.match(await page.locator('#previewNotice').textContent(),/automatically/);assert.equal(await page.locator('#previewNoticeRetry').textContent(),'Check now');
   await delay(1000);assert.equal(await commits(),stable,'A confirmed repair must remain warm across ordinary words on either side');
  }
  result.sameParagraphStayedWarm=true;
  // Leaving an edited paragraph can need one canonical handoff. It must be
  // automatic, and subsequent remote typing must retain the recovered context.
  let at=expected.indexOf('RemoteSentinel')+'RemoteSentinel'.length;await focus(at);await edit(at,' first');await full();await ready(at+6,true);
  for(const word of [' second',' third']){const stable=await commits();at=expected.indexOf('RemoteSentinel')+'RemoteSentinel'.length;await focus(at);await edit(at,word);await local(true,'remote');await delay(1000);assert.equal(await commits(),stable);}
  result.remoteTypingStayedWarm=true;
  // Return to the errored paragraph and correct one token. Clear its notice
  // from the successful local proof before the optional canonical idle check.
  at=expected.indexOf('TargetSentinel')+'TargetSentinel'.length;await focus(at);await edit(at,' return');await full();
  at=expected.indexOf('\\intt')+4;await ready(at,true);const stable=await commits();await edit(at,'',1);await local(false,'corrected');
  const correction=result.samples.at(-1);await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden,null,{timeout:10000,polling:10});
  assert.ok(await page.evaluate(async id=>(await window.desktop.call('previewPerformance',true)).trace.some(e=>e.event==='recovery-cleared-locally'&&e.editId===id),correction.editId));result.correctionClearedLocally=true;
  const changedState=correction.stateChanged;
  if(changedState){await full();await ready(expected.indexOf('TargetSentinel')+6,false);result.correctionAutomaticallyVerified=true;}
  else{await delay(1000);assert.equal(await commits(),stable,'A history of errors must not reclaim the now healthy local context');result.correctionStayedWarm=true;}
  at=expected.indexOf('AfterSentinel')+'AfterSentinel'.length;await focus(at);await edit(at,' healthy');await local(false,'after-correction');
  await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);const healthyCommits=await commits();await delay(1000);assert.equal(await commits(),healthyCommits,'Corrected-source typing must keep the healthy compiler');assert.equal(await fs.readFile(root,'utf8'),expected);result.sourceSavedExactly=true;
  const exported=path.join(directory,'corrected.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);
  await page.evaluate(()=>window.desktop.call('export'));assert.ok((await fs.stat(exported)).size>0);await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);result.correctedStrictExportWorks=true;
  // A temporary closer changes byte counts. Healthy paragraphs elsewhere must
  // still use line-aligned original-editor offsets and the repaired compiler.
  let close=expected.indexOf('x$ AfterSentinel')+1;assert.ok(close>0);await focus(close);await edit(close,'',1);await full();
  at=expected.indexOf('RemoteSentinel')+'RemoteSentinel'.length;await ready(at,true);
  for(const word of [' structural',' continued']){const n=await commits();at=expected.indexOf('RemoteSentinel')+'RemoteSentinel'.length;await focus(at);await edit(at,word);await local(true,'remote-with-missing-math-closer');await delay(1000);assert.equal(await commits(),n,'A same-line temporary closer must not force full builds for other paragraphs');}
  result.nonLengthPreservingRepairStayedWarm=true;
  close=expected.indexOf('x AfterSentinel')+1;assert.ok(close>0);await focus(close);await edit(close,'$');await full();await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);assert.equal(await fs.readFile(root,'utf8'),expected);result.structuralCorrectionAutomatic=true;result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{clearInterval(guard);if(page){await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));result.performance=await page.evaluate(()=>window.desktop.call('previewPerformance',true)).catch(()=>undefined);}await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
