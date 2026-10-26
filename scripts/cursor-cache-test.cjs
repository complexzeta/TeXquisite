// Sequential, isolated cursor-move benchmark. Canvas timings are not physical display timings.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {SourceMirror}=require('../dist/snapshot');const hash=x=>createHash('sha256').update(x).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const frozen=JSON.parse(await fs.readFile(process.env.PERSISTENT_TEX_WORKFLOW_INPUT,'utf8')),originalHash=hash(await fs.readFile(frozen.session.root)),results=[];
 for(const kind of (process.env.PERSISTENT_TEX_CURSOR_CASE?[process.env.PERSISTENT_TEX_CURSOR_CASE]:['neighbor','manuscript','chapter'])){
  const directory=path.resolve('.test-output','cursor-cache-'+kind+'-'+randomUUID()),project=path.join(directory,'project'),profile=path.join(directory,'profile');await fs.mkdir(project,{recursive:true});await fs.mkdir(profile);
  let root=path.join(project,'main.tex'),active=root,source,text,first,other,chapter;
  if(kind==='neighbor'||kind==='rebase'){
   source='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\nAlpha ordinary words.\n\nBeta ordinary words.\n\nGamma ordinary words.\n\nDelta ordinary words.\n\n\\newpage\nTail.\\end{document}\n';text=source;first=source.indexOf('Alpha')+3;other=source.indexOf('Gamma')+3;
  }else{
   await new SourceMirror().capture(frozen.session.root,project,frozen.session.supportFolders,frozen.source,{});root=path.join(project,path.basename(frozen.session.root));active=root;source=frozen.source;text=source;first=source.lastIndexOf('Testing testing testing ')+'Testing testing testing '.length;other=source.indexOf('Testing 123 testing')+'Testing 123 testing'.length;
   if(kind==='chapter'){const marker='Testing testing testing \n\n',at=source.lastIndexOf(marker);source=source.slice(0,at)+'\\input{chapters/workflow.tex}\n\n'+source.slice(at+marker.length);text=marker+'Nearby marker ordinary words.\n\nThird marker ordinary words.\n\n';chapter=active=path.join(project,'chapters','workflow.tex');await fs.mkdir(path.dirname(chapter));await fs.writeFile(chapter,text);first=marker.indexOf('\n');other=text.indexOf('Third')+3;}
  }
  await fs.writeFile(root,source);const docs=[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'},...(chapter?[{path:chapter,text,diskHash:hash(text),dirty:false,eol:'\n'}]:[])];await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({...frozen.session,root,active,docs,onSave:true,continuousPreview:true,previewEditing:false,followPreview:false,lastCursor:{file:active,at:first}}));
  const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const move=async at=>page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);
  const ready=()=>page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  try{
   await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:120000});await ready();
   if(kind==='rebase'){
    const accepted=await page.evaluate(()=>(document.querySelector('#log').textContent.match(/Accepted \d+ pages/g)||[]).length);
    await move(first);await page.keyboard.type('q');text=source=text.slice(0,first)+'q'+text.slice(first);other++;
    await page.waitForFunction(count=>(document.querySelector('#log').textContent.match(/Accepted \d+ pages/g)||[]).length>count,accepted,{timeout:60000});await delay(2000);await ready();
    if(process.env.PERSISTENT_TEX_REQUIRE_CURSOR_CACHE==='1')assert.ok((await page.locator('#log').textContent()).includes('Local preparation adopted the verified revision.'));
   }else if(kind==='neighbor')await delay(1500);else{await move(other);await ready();}
   const target=kind==='neighbor'||kind==='rebase'?other:first,before=await page.evaluate(()=>({ids:[...document.querySelectorAll('#pages canvas')].map(c=>c.dataset.editId).filter(Boolean),hits:(document.querySelector('#log').textContent.match(/Local prepared-region cache hit/g)||[]).length}));
   await move(target);const readyImmediately=await page.locator('#previewState').getAttribute('data-local-state')==='ready';await page.keyboard.type('z');const expected=text.slice(0,target)+'z'+text.slice(target),digest=hash(expected);
   await page.waitForFunction(({digest,ids})=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===digest&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.editId&&!ids.includes(c.dataset.editId)&&c.dataset.editLatencyMs),{digest,ids:before.ids},{timeout:90000,polling:10});
   const frame=await page.evaluate(({digest,ids})=>{const c=[...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===digest&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.editId&&!ids.includes(c.dataset.editId)&&c.dataset.editLatencyMs),local=c.dataset.localSourceHash===digest;return {local,ms:Number(local?c.dataset.localLatencyMs:c.dataset.editLatencyMs),layout:c.dataset.localLayout,hits:(document.querySelector('#log').textContent.match(/Local prepared-region cache hit/g)||[]).length};},{digest,ids:before.ids});
   assert.equal(await fs.readFile(active,'utf8'),expected);assert.deepEqual(errors,[]);if(process.env.PERSISTENT_TEX_REQUIRE_CURSOR_CACHE==='1'){assert.ok(readyImmediately,'Prepared cursor target must activate immediately');assert.ok(frame.hits>before.hits,'Cursor target must use the proved region cache');assert.ok(frame.local,'First edit must render locally');}const result={kind,...frame,readyImmediately,cacheHit:frame.hits>before.hits,directory,executable:process.env.PERSISTENT_TEX_EXECUTABLE??'workspace',measurement:'Hidden matching-canvas latency from first edit after cursor move'};results.push(result);await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
 }
 assert.equal(hash(await fs.readFile(frozen.session.root)),originalHash);console.log(JSON.stringify({passed:true,results,userDocumentUnchanged:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
