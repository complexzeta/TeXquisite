const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler,ResidentSupersededError}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');

test('Superseding a dense local edit retains its worker and checkpoint for exact latest output',{timeout:90000},async t=>{
 const directory=path.resolve('.test-output','local-supersession-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler(),reference=new ResidentCompiler();t.after(()=>{local.stop();reference.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n',picture='\\begin{tikzpicture}\n\\node at (1,2) {NodeQuartz};\n\\foreach \\i in {1,...,160}{\\draw (0,0)--({4*cos(\\i*2)},{2*sin(\\i*2)});}\n\\draw[domain=0:4,samples=180] plot (\\x,{sin(\\x*180)/2});\n\\end{tikzpicture}\n\n',source=prefix+picture+'After.\n\n\\end{document}\n',range={from:prefix.length,to:prefix.length+picture.length},project={characterMapping:true,jobName:'main'},signal=new AbortController().signal;
 assert.equal(local.supersedeRegionEdit(),false,'Idle workers have nothing to supersede');
 await local.compile(source,signal,30000,()=>{},project);await local.prepareRegion(source,range,signal,30000,()=>{},project);
 const checkpoint=local.lastTiming.checkpointOffset;
 for(let i=0;i<3;i++){
  const obsolete=source.replace('NodeQuartz','NodeQuartz'+i),started=local.previewRegionPage(obsolete,{from:range.from,to:range.to+1},1,signal,15000,()=>{},project,true);
  const timer=setTimeout(()=>assert.equal(local.supersedeRegionEdit(),true),40);
  try{await assert.rejects(started,e=>e instanceof ResidentSupersededError);}finally{clearTimeout(timer);}
  assert.equal(local.initialized,true,'Supersession must retain the resident worker');assert.equal(local.busy,false);
 }
 const latest=source.replace('NodeQuartz','LatestQuartz'),output=await local.previewRegionPage(latest,{from:range.from,to:range.to+2},1,signal,15000,()=>{},project,true);
 assert.equal(output.timing.checkpointOffset,checkpoint);assert.equal(output.documentComplete,false);
 const full=await reference.compile(latest,signal,30000,()=>{},project);assert.ok(full);
 for(const [name,pdf]of [['local',output.pdf],['reference',full]]){const stem=path.join(directory,name);await fs.writeFile(stem+'.pdf',pdf);await runProcess('pdftoppm',['-singlefile','-r','100',stem+'.pdf',stem],directory,15000,signal,()=>{});}
 assert.equal(hash(await fs.readFile(path.join(directory,'local.ppm'))),hash(await fs.readFile(path.join(directory,'reference.ppm'))));
 const verification=local.compile(latest,signal,30000,()=>{},project);assert.equal(local.supersedeRegionEdit(),false,'Full verification must not be cooperatively superseded');await verification;assert.equal(local.lastTiming.preambleRebuilt,false,'The next full verification must reuse the warm preamble');
});
