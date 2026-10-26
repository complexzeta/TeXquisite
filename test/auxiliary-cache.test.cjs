const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
test('Cold compiler reuses converged auxiliary inputs only for the exact document and validated dependencies',{timeout:120000},async()=>{
 const directory=path.resolve('.test-output','auxiliary-cache-'+randomUUID()),support=path.join(directory,'support'),cache=path.join(directory,'cache','resident.json');await fs.mkdir(support,{recursive:true});
 const helper=path.join(support,'helper.tex');await fs.writeFile(helper,'\\def\\HelperWord{Original}\n');
 const source='\\documentclass{article}\n\\input{helper.tex}\n\\begin{document}\n\\section{Title}\\label{title}\nReference \\ref{title}, \\HelperWord.\n\\end{document}\n',project={auxiliaryCache:cache,supportFolders:[support],characterMapping:true};
 async function cold(text=source){const c=new ResidentCompiler();try{const pdf=await c.compile(text,new AbortController().signal,60000,()=>{},project);assert.ok(pdf);return {pdf,timing:c.lastTiming};}finally{c.stop();}}
 const first=await cold();assert.equal(first.timing.diskAuxiliaryReused,false);assert.ok(first.timing.passes>=2);
 const reopened=await cold();assert.equal(reopened.timing.diskAuxiliaryReused,true);assert.equal(reopened.timing.passes,1);
 for(const [name,pdf]of [['first',first.pdf],['reopened',reopened.pdf]]){await fs.writeFile(path.join(directory,name+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96',name+'.pdf',name],directory,30000,new AbortController().signal,()=>{});}
 assert.equal(hash(await fs.readFile(path.join(directory,'first-1.ppm'))),hash(await fs.readFile(path.join(directory,'reopened-1.ppm'))),'Reopening must preserve exact rendered output');
 const saved=await fs.readFile(cache,'utf8');assert.equal((await cold(source.replace('Reference','Changed reference'))).timing.diskAuxiliaryReused,false,'A changed buffer cannot seed from the old document');
 await fs.writeFile(cache,saved);await fs.writeFile(helper,'\\def\\HelperWord{Changed}\n');assert.equal((await cold()).timing.diskAuxiliaryReused,false,'Changed support inputs invalidate disk reuse');
 await fs.writeFile(cache,'{broken');assert.equal((await cold()).timing.diskAuxiliaryReused,false,'Corrupt cache falls back to normal convergence');
 const damaged=JSON.parse(await fs.readFile(cache,'utf8'));damaged.files[0][1]=Buffer.from('\\undefinedCachedAuxiliaryCommand\n').toString('base64');await fs.writeFile(cache,JSON.stringify(damaged));const recovered=await cold();assert.equal(recovered.timing.diskAuxiliaryRejected,true);assert.equal(recovered.timing.diskAuxiliaryReused,false,'Invalid TeX in a cache must retry normally');
 const valid=JSON.parse(await fs.readFile(cache,'utf8'));valid.files.push(['../escape.tex',Buffer.from('Bad').toString('base64')]);await fs.writeFile(cache,JSON.stringify(valid));assert.equal((await cold()).timing.diskAuxiliaryReused,false,'Cache paths cannot inject source or escape the working directory');
});
test('Application restart finds its converged cache and cleanup respects overlapping controller lifetimes',{timeout:90000},async()=>{
 const {BuildController,ArtifactStore}=require('../dist/core'),{cleanCaches}=require('../dist/cache-cleanup');
 const directory=path.resolve('.test-output','auxiliary-restart-'+randomUUID()),storeDir=path.join(directory,'projects','a'.repeat(32)),root=path.join(directory,'source','main.tex'),source='\\documentclass{article}\n\\begin{document}\n\\section{Title}\\label{title}Reference \\ref{title}.\n\\end{document}\n';await fs.mkdir(path.dirname(root),{recursive:true});await fs.writeFile(root,source);
 const create=()=>new BuildController(new ArtifactStore(storeDir),{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},()=>{}),options={root,sourceText:source,engine:'pdflatex',executable:'latexmk',timeoutMs:60000};
 const first=create();try{await first.request(options);assert.ok(first.current);assert.equal(first.resident.lastTiming.diskAuxiliaryReused,false);}finally{await first.dispose();}
 const reopened=create(),overlapping=create();try{await reopened.request(options);assert.ok(reopened.current);assert.equal(reopened.resident.lastTiming.diskAuxiliaryReused,true);assert.equal(reopened.resident.lastTiming.passes,1);await reopened.dispose();await reopened.dispose();
  const auxiliary=path.join(storeDir,'auxiliary'),profile=(await fs.readdir(auxiliary))[0],cache=path.join(auxiliary,profile,'resident.json');
  await cleanCaches(directory,{clearInactive:true,protectedPaths:()=>BuildController.protectedPaths()});assert.ok(await fs.stat(cache),'Another controller still owns this cache');
  await overlapping.dispose();await cleanCaches(directory,{clearInactive:true,protectedPaths:()=>BuildController.protectedPaths()});assert.equal(await fs.stat(cache).then(()=>true,()=>false),false,'Unused auxiliary caches participate in cleanup');
 }finally{await reopened.dispose();await overlapping.dispose();}
});
