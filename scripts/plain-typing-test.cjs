// Copy the current source and project inputs; never operate on the user's editor.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {testDirectory}=require('./test-artifacts.cjs'),{SourceMirror}=require('../dist/snapshot');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=testDirectory('plain-typing'),project=path.join(directory,'project'),profile=path.join(directory,'profile');await fs.mkdir(project);await fs.mkdir(profile);
 const session=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Persistent TeX/session.json'),'utf8')),original=session.docs.find(d=>d.path===session.root).text;
 let source=original.replace(/\\end\{document\}\s*$/,'\n\nPlain typing target with ordinary words.\n\nAnother ordinary paragraph for cursor changes.\n\n\\end{document}\n');assert.notEqual(source,original);
 await new SourceMirror().capture(session.root,project,session.supportFolders,source,Object.fromEntries(session.docs.filter(d=>d.path!==session.root).map(d=>[d.path,d.text])));
 const root=path.join(project,path.basename(session.root)),at=source.indexOf('Plain typing target')+'Plain typing target'.length;
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({...session,root,active:root,docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],continuousPreview:true,previewEditing:false,followPreview:true,lastCursor:{file:root,at}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}}),page=await app.firstWindow(),samples=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const editor=()=>page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
 const move=at=>page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);
 async function type(text,label,burst=false){
  const began=Date.now();await page.keyboard.type(text,{delay:burst?70:0});source=await editor();const h=hash(source);
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.sourceHash===h&&!c.dataset.localSourceHash),h,{timeout:90000,polling:10});
  const observedMs=Date.now()-began,value=await page.evaluate(h=>{const c=[...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.sourceHash===h&&!c.dataset.localSourceHash);return {local:c.dataset.localSourceHash===h,layout:c.dataset.localLayout,reportedMs:Number(c.dataset.localLatencyMs??c.dataset.editLatencyMs),pipeline:c.dataset.localPipeline?JSON.parse(c.dataset.localPipeline):undefined,status:document.querySelector('#previewState').textContent};},h);
  const sample={label,text,observedMs,...value};samples.push(sample);await fs.writeFile(path.join(directory,'samples.json'),JSON.stringify(samples,null,2));console.log(JSON.stringify({label,text,observedMs,local:value.local,reportedMs:value.reportedMs}));
 }
 try{
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:120000});
  await move(at);await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready'||document.querySelector('#log').textContent.includes('Local preview unavailable'),null,{timeout:60000});
  for(const c of ' simple')await type(c,'warm-character');
  const handoffs=()=>page.locator('#log').evaluate(e=>e.textContent.split('Idle verification reclaimed').length-1),beforePause=await handoffs();
  await delay(1400);if(process.env.PERSISTENT_TEX_EXPECT_TYPING_IDLE==='1')assert.equal(await handoffs(),beforePause,'A pause between words must not reclaim the typing compiler');
  await type('a','after-pause');if(process.env.PERSISTENT_TEX_EXPECT_TYPING_IDLE==='1')assert.equal(samples.at(-1).local,true,'Resume typing through the prepared local preview');for(const c of 'bc')await type(c,'resumed-character');
  await type(' ordinary','typing-burst',true);
  await type('\n\n','paragraph-split');for(const c of 'New text')await type(c,'after-split');
  await move(source.indexOf('Another ordinary paragraph')+7);await type('new ','cursor-switch');for(const c of 'word')await type(c,'after-switch');
  // A continuous flow canvas can intentionally remain visible after full
  // verification. Check the durable commit rather than demanding its removal.
  const store=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),expectedHash=hash(source);let verified=false;
  for(let n=0;n<900&&!verified;n++){try{for(const name of await fs.readdir(path.join(store,'commits'))){const commit=JSON.parse(await fs.readFile(path.join(store,'commits',name),'utf8')),bundle=JSON.parse(await fs.readFile(path.join(store,'bundles',commit.id,'bundle.json'),'utf8'));if(bundle.sourceHash===expectedHash){verified=true;break;}}}catch{}if(!verified)await delay(100);}
  assert.ok(verified,'The final source must receive full-document verification');
  assert.equal(await fs.readFile(root,'utf8'),source);assert.deepEqual(errors,[]);
  const quantile=(a,q)=>a.sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*q))],summary={};for(const label of new Set(samples.map(s=>s.label))){const a=samples.filter(s=>s.label===label).map(s=>s.observedMs);summary[label]={count:a.length,medianMs:quantile([...a],.5),maxMs:Math.max(...a)};}
  const result={passed:true,directory,summary,samples,originalRoot:session.root,originalSourceHash:hash(original),autosave:true,fullVerification:true,measurement:'Hidden matching-source canvas, not physical monitor scanout. Burst includes intentional 70 ms inter-key intervals.'};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,directory,summary}));
 }catch(e){await fs.writeFile(path.join(directory,'failure.txt'),String(e));throw e;}
 finally{await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
