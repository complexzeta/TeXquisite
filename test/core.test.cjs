const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PDFDocument}=require('pdf-lib');
const {ArtifactStore,BuildController,runProcess,validatePdf,hash}=require('../dist/core');
const base=path.resolve('.test-output');
async function store(){return new ArtifactStore(path.join(base,randomUUID()));}
async function pdf(text='one'){const d=await PDFDocument.create();d.addPage().drawText(text);return d.save();}
const details={revision:1,root:'main.tex',engine:'pdflatex'};

test('An already prefetched intermediate revision publishes once before the newest pending edit',async t=>{
 const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});const root=path.join(project,'main.tex');
 const source='\\documentclass{article}\n\\begin{document}\nVERSION\n\\end{document}\n';await fs.writeFile(root,source);
 const bytes=Buffer.from(await pdf()),calls=[],commits=[];let began,release;
 const blocked=new Promise(resolve=>began=resolve),gate=new Promise(resolve=>release=resolve);
 const controller=new BuildController(s,{prepare:async()=>{if(!commits.length){began();await gate;}},commit:b=>commits.push(b.sourceHash),discard:()=>{}},()=>{},()=>{});t.after(()=>controller.cancel());
 controller.resident.compile=async text=>{calls.push(text);return bytes;};
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,automatic:true};
 const a=source.replace('VERSION','Alpha'),b=source.replace('VERSION','Beta'),c=source.replace('VERSION','Gamma');
 const first=controller.request({...options,sourceText:a});await blocked;
 const second=controller.request({...options,sourceText:b});assert.ok(calls.includes(b));
 const third=controller.request({...options,sourceText:c});release();await Promise.all([first,second,third]);
 assert.deepEqual(calls,[a,b,c]);assert.deepEqual(commits,[hash(a),hash(b),hash(c)]);
});

test('Chapter prefetch publishes each captured resource revision once while retaining the newest pending buffers',{timeout:30000},async t=>{
 const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});const root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex');
 const source='\\documentclass{article}\n\\begin{document}\n\\input{chapter}\n\\end{document}\n';await fs.writeFile(root,source);await fs.writeFile(chapter,'Disk.');
 const bytes=Buffer.from(await pdf()),calls=[],published=[];let began,release;
 const blocked=new Promise(resolve=>began=resolve),gate=new Promise(resolve=>release=resolve);
 const controller=new BuildController(s,{prepare:async(_bundle,_bytes,map)=>{published.push(map.sources[chapter]);if(published.length===1){began();await gate;}},commit:()=>{},discard:()=>{}},()=>{},()=>{});t.after(()=>controller.cancel());
 controller.resident.navigation=JSON.stringify(['chapter.tex',1,1,0,0,1,1]);
 controller.resident.compile=async(_text,_signal,_timeout,_log,context)=>{calls.push(Buffer.from(context.resources.find(([name])=>name==='chapter.tex')[1]).toString());return bytes;};
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,automatic:true,sourceText:source};
 const first=controller.request({...options,sourceFiles:{[chapter]:'Alpha'}});await blocked;
 const second=controller.request({...options,sourceFiles:{[chapter]:'Beta'}});assert.deepEqual(calls,['Alpha','Beta']);
 const third=controller.request({...options,sourceFiles:{[chapter]:'Gamma'}});release();await Promise.all([first,second,third]);
 assert.deepEqual(calls,['Alpha','Beta','Gamma']);assert.deepEqual(published,['Alpha','Beta','Gamma'].map(hash));
});

test('Automatic unfinished math retains the resident checkpoint without native retries; manual verification remains available',async t=>{
 const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});
 const root=path.join(project,'main.tex'),source='\\documentclass{article}\n\\begin{document}\nMath: PLACEHOLDER\n\\end{document}\n';await fs.writeFile(root,source);
 const logs=[],controller=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},m=>logs.push(m));t.after(()=>controller.cancel());
 let nativeRetries=0;controller.warm.compile=async()=>{nativeRetries++;throw Error('Native retry probe');};
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,automatic:true};
 await controller.request({...options,sourceText:source.replace('PLACEHOLDER','')});const good=controller.current;assert.ok(good);
 for(const expression of ['$','$\\s','$\\sqrt','$\\sqrt\\p','$\\frac','$\\frac{','$\\frac{1}','$\\frac{1}{']){
  await controller.request({...options,sourceText:source.replace('PLACEHOLDER',expression)});
  assert.equal(controller.current.id,good.id,'Incomplete math must retain the accepted PDF');
  assert.equal(nativeRetries,0,expression+'\n'+logs.join('').slice(-1600));
 }
 assert.equal(nativeRetries,0);assert.match(logs.join(''),/without a native retry/);
 const completed=source.replace('PLACEHOLDER','$\\sqrt\\pi$');await controller.request({...options,sourceText:completed});
 assert.equal(controller.current.sourceHash,hash(completed));assert.notEqual(controller.current.id,good.id);
 await controller.request({...options,automatic:false,sourceText:source.replace('PLACEHOLDER','$\\undefinedManualProbe$')});
 assert.equal(nativeRetries,1,'An explicit build may still verify an engine difference with native TeX');
});

test('A newer automatic edit interrupts an obsolete speculative native retry',async t=>{
 const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});const root=path.join(project,'main.tex');
 const source='\\documentclass{custom}\n\\begin{document}\nOLD\n\\end{document}\n';await fs.writeFile(root,source);
 const bytes=Buffer.from(await pdf()),controller=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},()=>{});t.after(()=>controller.cancel());
 controller.resident.compile=async text=>{if(text.includes('OLD'))throw Error('Simulated unknown capability failure');return bytes;};
 let began;const blocked=new Promise(resolve=>began=resolve);let interrupted=false;
 controller.warm.compile=async(_source,_engine,_base,signal)=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>{interrupted=true;reject(Error('Build cancelled.'));},{once:true});began();
 });
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:30000};
 const first=controller.request({...options,sourceText:source});await blocked;
 const fresh=source.replace('OLD','NEW');await controller.request({...options,sourceText:fresh,automatic:true});await first;
 assert.equal(interrupted,true);assert.equal(controller.current.sourceHash,hash(fresh));
});

test('A resolved compatibility retry preserves required native processing when newer edits arrive',async t=>{
 const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});const root=path.join(project,'main.tex');
 const source='\\documentclass{article}\n\\usepackage{tkz-euclide}\n\\usetkzobj{all}\n\\begin{document}\nOLD\n\\end{document}\n';await fs.writeFile(root,source);
 const bytes=Buffer.from(await pdf()),controller=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},()=>{});t.after(()=>controller.cancel());
 let calls=0;controller.resident.compile=async()=>{if(++calls===1)throw Error("I can't find file `tkz-obj-angles.tex'.");return calls===2?undefined:bytes;};
 let began,release;const blocked=new Promise(resolve=>began=resolve),completion=new Promise(resolve=>release=resolve);let interrupted=false;
 controller.warm.compile=async(_source,_engine,_base,signal)=>{signal.addEventListener('abort',()=>{interrupted=true;},{once:true});began();await completion;return bytes;};
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:30000};
 const first=controller.request({...options,sourceText:source});await blocked;
 const fresh=source.replace('OLD','NEW'),next=controller.request({...options,sourceText:fresh,automatic:true});
 assert.equal(interrupted,false,'Required native processing must not be treated as a speculative retry');release();await next;await first;
 assert.equal(controller.current.sourceHash,hash(fresh));
});
test('Only committed bundles recover; corrupt latest falls back; exports match exact bytes',async()=>{
  const s=await store(),a=await s.stage(await pdf(),details);await s.commit(a);
  const b=await s.stage(await pdf('two'),{...details,revision:2});
  assert.equal((await s.history())[0].id,a.id);
  await s.commit(b);assert.equal((await s.history())[0].id,b.id);
  const destination=path.join(s.directory,'export.pdf');await s.export(a,destination);assert.equal(hash(await fs.readFile(destination)),a.pdfHash);
  await fs.writeFile(s.pdf(b),'truncated');assert.equal((await s.history())[0].id,a.id);
  await assert.rejects(s.export(b,destination));assert.equal(hash(await fs.readFile(destination)),a.pdfHash);
});
test('Missing pages, malformed PDF, and cancelled publication cannot replace current',async()=>{
  const s=await store(),a=await s.stage(await pdf(),details);await s.commit(a);
  await assert.rejects(validatePdf(Buffer.from('not a PDF')));
  await assert.rejects(validatePdf(await(await PDFDocument.create()).save({addDefaultPage:false})));
  const b=await s.stage(await pdf('cancelled'),{...details,revision:2});
  await assert.rejects(s.commit(b,()=>{throw Error('Cancelled');}));assert.equal((await s.history())[0].id,a.id);
});

test('History pruning retains eight recent bundles and pins an ongoing export',async()=>{
  const s=await store(),first=await s.stage(await pdf(),details);await s.commit(first);
  const release=s.pin(first);
  for(let i=0;i<9;i++)await s.commit(await s.stage(await pdf(String(i)),{...details,revision:i+2}));
  await s.prune();assert.equal((await fs.readdir(path.join(s.directory,'commits'))).length,9);
  await fs.access(s.pdf(first));release();await s.prune();
  assert.equal((await fs.readdir(path.join(s.directory,'commits'))).length,8);
  await assert.rejects(fs.access(s.pdf(first)));
});
test('Timeout and cancellation stop owned processes',async()=>{
  const signal=new AbortController();
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],base,200,signal.signal,()=>{}),/timed out/);
  const cancel=new AbortController();const task=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],base,10000,cancel.signal,()=>{});
  setTimeout(()=>cancel.abort(),200);await assert.rejects(task,/cancelled/);
});
test('Real TeX: complete PDF survives late partial failure, viewer rejection, and repair',async(t)=>{
  const s=await store(),project=path.join(s.directory,'project with spaces Ω');await fs.mkdir(project,{recursive:true});
  const root=path.join(project,'main.tex'),source=await fs.readFile('fixtures/article/main.tex','utf8');await fs.writeFile(root,source);
  let rejectViewer=false;const statuses=[],messages=[];
  const controller=new BuildController(s,{prepare:async()=>{if(rejectViewer)throw Error('Injected viewer failure');},commit:()=>{},discard:()=>{}},m=>statuses.push(m),m=>messages.push(m));
  t.after(()=>controller.cancel());
  const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:120000};
  const start=Date.now();await controller.request(options);const first=controller.current;
  assert.ok(first,statuses.at(-1)+'\n'+messages.join(''));assert.equal(first.pages,2);
  await fs.writeFile(root,source.replace('\\end{document}','\\undefinedFailure\n\\end{document}'));
  await controller.request(options);assert.equal(controller.current.id,first.id);assert.match(statuses.at(-1),/failed/);
  await fs.writeFile(root,source.replace('A useful invariant','A repaired invariant'));
  rejectViewer=true;await controller.request(options);assert.equal(controller.current.id,first.id);
  rejectViewer=false;await controller.request(options);assert.notEqual(controller.current.id,first.id);
  const restored=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},()=>{});await restored.restore();assert.equal(restored.current.id,controller.current.id);
  await fs.writeFile(path.join(base,'real-tex-result.json'),JSON.stringify({durationMs:Date.now()-start,statuses,acceptedPages:controller.current.pages,platform:process.platform,node:process.version},null,2));
});

test('Standard latexmk path mirrors includes and recovers its cache after an error',async(t)=>{
  const s=await store(),project=path.join(s.directory,'source');await fs.mkdir(project,{recursive:true});
  const root=path.join(project,'main.tex'),part=path.join(project,'part.tex');
  await fs.writeFile(root,'\\documentclass{article}\n\\begin{document}\n\\input{part}\n\\end{document}\n');
  await fs.writeFile(part,'First section.\\newpage Second page.');
  const statuses=[],logs=[];
  const controller=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},s=>statuses.push(s),s=>logs.push(s));t.after(()=>controller.cancel());
  const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:120000};
  await controller.request(options);assert.equal(controller.current?.pages,2,statuses.at(-1)+'\n'+logs.join(''));
  const first=controller.current;assert.equal(first.synctex,false);assert.match(logs.join(''),/resident TeX checkpoint/);
  await fs.writeFile(part,'Broken \\undefinedIncludedCommand');await controller.request(options);assert.equal(controller.current.id,first.id);
  await fs.writeFile(part,'Repaired single page.');await controller.request(options);assert.equal(controller.current.pages,1);assert.notEqual(controller.current.id,first.id);
});

test('External BibTeX processing falls back with dynamic preamble resources and refreshes changed helpers',async t=>{
 const s=await store(),project=path.join(s.directory,'project'),support=path.join(s.directory,'support');await fs.mkdir(project,{recursive:true});await fs.mkdir(support);
 const root=path.join(project,'main.tex'),helper=path.join(support,'helper.tex');
 await fs.writeFile(root,'\\documentclass{article}\n\\def\\helpername{helper.tex}\\input{\\helpername}\n\\begin{document}\n\\HelperWord, citing \\cite{test}.\n\\bibliographystyle{plain}\\bibliography{refs}\n\\end{document}\n');
 await fs.writeFile(path.join(project,'refs.bib'),'@book{test,author={Test Author},title={A Test Book},year={2025}}\n');await fs.writeFile(helper,'\\newcommand{\\HelperWord}{Alpha}\n');
 const logs=[],controller=new BuildController(s,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},text=>logs.push(text));t.after(()=>controller.cancel());
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:120000,supportFolders:[support]};
 await controller.request(options);assert.ok(controller.current,logs.join(''));assert.equal(controller.current.synctex,true);assert.match(logs.join(''),/External bibliography/);
 await fs.writeFile(helper,'\\newcommand{\\HelperWord}{Beta}\n');await controller.request(options);
 const pdf=s.pdf(controller.current);await runProcess('pdftotext',[pdf,path.join(project,'result.txt')],project,30000,new AbortController().signal,()=>{});
 const result=await fs.readFile(path.join(project,'result.txt'),'utf8');assert.match(result,/Beta, citing/);assert.match(result,/A Test Book/);assert.doesNotMatch(result,/Alpha|\[\?\]/);
 const bib=path.join(project,'refs.bib');
 await controller.request({...options,sourceFiles:{[helper]:'\\newcommand{\\HelperWord}{BufferedHelper}\n',[bib]:'@book{test,author={Test Author},title={Buffered Book},year={2026}}\n'}});
 await runProcess('pdftotext',[s.pdf(controller.current),path.join(project,'buffered.txt')],project,30000,new AbortController().signal,()=>{});
 const buffered=await fs.readFile(path.join(project,'buffered.txt'),'utf8');assert.match(buffered,/BufferedHelper, citing/);assert.match(buffered,/Buffered Book/);assert.doesNotMatch(buffered,/A Test Book|\[\?\]/);
 assert.match(await fs.readFile(helper,'utf8'),/Beta/);assert.match(await fs.readFile(bib,'utf8'),/A Test Book/);

});
