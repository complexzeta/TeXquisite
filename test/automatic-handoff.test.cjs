const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {PDFDocument}=require('pdf-lib'),{BuildController,ArtifactStore,hash}=require('../dist/core'),{LocalPreview,plainTextChange}=require('../dist/local-preview');
const source='\\documentclass{article}\n\\begin{document}\n\nTarget ordinary words.\n\nFollowing paragraph.\n\nOutside the window.\n\n\\end{document}\n';
test('Automatic handoff accepts literal edits while command, argument and structural edits stay full',()=>{
 for(const [a,b] of [['Some text.','Some more text.'],['Some text.','Some .'],['$x$ word.','$y$ word.'],['π text.','π texté.']])assert.equal(plainTextChange(a,b),true);
 for(const [a,b] of [['Word.','Word.\n\n'],['Word.','\\input{file}'],['\\sqrt{x}','\\sqrt{y}'],['\\input{file}','\\input{other}'],['\\input file','\\input other'],['\\alpha','\\alphabet'],['Same.','Same.']])assert.equal(plainTextChange(a,b),false,a+' -> '+b);
});
for(const change of ['text','stopped-owner','preamble','outside','syntax'])test('Local handoff checks the exact paragraph context: '+change,()=>{
 let calls=0;const compiler={initialized:true,stop(){}},lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{}),file='main.tex';
 const accepted=change==='text'||change==='stopped-owner';lane.setContinuous(true);const next=accepted?source.replace('Target','Target newest'):change==='preamble'?source.replace('article','report'):change==='outside'?source.replace('Outside','Changed outside'):source.replace('Target','Target $x$');
 lane.move(file,next.indexOf('Target')+6);lane.setBasis({options:{root:file},bundle:{id:'accepted'},source,compilerSource:source,pdf:new Uint8Array(),project:{},claimAutomatic:(_id,_source,previous)=>{assert.equal(previous,undefined);calls++;return compiler;}});if(change==='stopped-owner')lane.warmCompiler={initialized:false,stop(){}};
 try{assert.equal(lane.resumeAutomatic(file,next,'newest'),accepted);assert.equal(calls,accepted?1:0);assert.equal(lane.ready,false);if(accepted)assert.equal(lane.pending.source,next);}finally{lane.stop();}
});
for(const kind of ['automatic','manual','edit-id','source','resources','folders','mapping','engine','executable','root','busy','newer-capture','existing-owner','replace-owner'])test('Automatic compiler claim preserves request boundaries: '+kind,async t=>{
 const dir=require('../scripts/test-artifacts.cjs').testDirectory('automatic-claim'),root=path.join(dir,'source','main.tex');await fs.mkdir(path.dirname(root),{recursive:true});await fs.writeFile(root,source);
 const doc=await PDFDocument.create();doc.addPage();const bytes=Buffer.from(await doc.save());let entered,release,result,pendingAfter,ownerAfter,stopped=0;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r),previous={initialized:true,busy:false,stop(){stopped++;}};
 const options={root,sourceText:source,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,automatic:true,characterMapping:true,sourceFiles:{}},next=source.replace('Target','Target newest');
 const controller=new BuildController(new ArtifactStore(path.join(dir,'store')),{prepare:async()=>{entered();await gate;},commit:()=>{},discard:()=>{},localBasis:b=>{
  if(kind==='busy')Object.defineProperty(controller.resident,'busy',{get:()=>true});
  if(kind==='newer-capture')controller.active=new AbortController();
  if(kind==='existing-owner'||kind==='replace-owner'){controller.transferredCompiler=previous;controller.localCompilerTransferred=true;}
  result=b.claimAutomatic(kind==='edit-id'?'different':'newest',kind==='source'?next+'x':next,kind==='replace-owner'?previous:undefined);
  pendingAfter=controller.pending;ownerAfter=controller.resident;controller.cancel();
 }},()=>{},()=>{});const compiler=controller.resident;Object.defineProperty(compiler,'initialized',{get:()=>true});compiler.compile=async()=>bytes;t.after(async()=>{release();compiler.stop();await controller.dispose();});
 const first=controller.request(options);await began;const pending={...options,sourceText:next,editId:'newest'};
 if(kind==='manual')pending.automatic=false;if(kind==='resources')pending.sourceFiles={'helper.tex':'Changed'};if(kind==='folders')pending.supportFolders=[];if(kind==='mapping')pending.characterMapping=false;if(kind==='engine')pending.engine='xelatex';if(kind==='executable')pending.executable='custom';if(kind==='root')pending.root=path.join(dir,'other.tex');
 const second=controller.request(pending);release();await Promise.all([first,second]);const accepted=kind==='automatic'||kind==='replace-owner';assert.equal(result,accepted?compiler:undefined);assert.equal(pendingAfter?.editId,accepted?undefined:'newest');assert.equal(ownerAfter===compiler,!accepted);assert.equal(stopped,kind==='replace-owner'?1:0);assert.equal(controller.current.sourceHash,hash(source));
});

for(const automatic of [true,false])test('Real compiler handoff keeps pending edits behind proof and preserves manual builds: '+automatic,{timeout:90000},async t=>{
 t.mock.method(require('node:os'),'freemem',()=>512*1024*1024);
 const dir=require('../scripts/test-artifacts.cjs').testDirectory('automatic-local'),root=path.join(dir,'source','main.tex');await fs.mkdir(path.dirname(root),{recursive:true});await fs.writeFile(root,source);
 let enterBuild,releaseBuild,enterProof,releaseProof,editor=source,editId='first';const buildEntered=new Promise(r=>enterBuild=r),buildGate=new Promise(r=>releaseBuild=r),proofEntered=new Promise(r=>enterProof=r),proofGate=new Promise(r=>releaseProof=r),locals=[],full=[],claims=[],logs=[];
 const lane=new LocalPreview(async()=>{enterProof();await proofGate;return true;},async c=>{locals.push(c);return true;},()=>{},()=>{},s=>logs.push(s));lane.setContinuous(true);lane.move(root,source.indexOf('Target')+6);
 const controller=new BuildController(new ArtifactStore(path.join(dir,'store')),{prepare:async()=>{if(!full.length){enterBuild();await buildGate;}},commit:b=>full.push(b),discard:()=>{},localBasis:b=>{lane.setBasis(b);claims.push(lane.resumeAutomatic(root,editor,editId));}},()=>{},()=>{});t.after(async()=>{releaseBuild();releaseProof();lane.stop();await controller.dispose();});
 const options={root,sourceText:source,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,automatic:true,characterMapping:true,sourceFiles:{},focus:{line:4,column:6}},first=controller.request(options);await buildEntered;
 editor=source.replace('Target','Target newest');editId='newest';lane.move(root,editor.indexOf('newest')+6,true);const pending=controller.request({...options,sourceText:editor,editId,automatic});releaseBuild();await Promise.all([first,pending]);
 await Promise.race([proofEntered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No local proof: '+logs.join(''))),15000);timer.unref();})]);assert.equal(lane.ready,false);assert.equal(locals.length,0);assert.equal(full.length,automatic?1:2);assert.equal(claims.includes(true),automatic);assert.equal(controller.current.sourceHash,hash(automatic?source:editor));
 if(automatic){editor=editor.replace('newest','newest live');assert.equal(lane.request(root,editor,'live'),true);}
 releaseProof();for(let n=0;n<1500&&!(automatic?locals.some(c=>c.editId==='live'):lane.ready);n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(lane.ready,true,logs.join(''));if(automatic)assert.equal(locals.at(-1).sourceHash,hash(editor));
});
