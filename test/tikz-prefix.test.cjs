const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
test('An unsuccessful TikZ prefix search stops at the cursor line and preserves exact page output',{timeout:90000},async t=>{
 const dir=path.resolve('.test-output','tikz-prefix-'+randomUUID());await fs.mkdir(dir,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n',picture='\\begin{tikzpicture}\n\\node at (1,1) {CursorMark};\n\\foreach \\i in {1,...,120} {\\draw[gray] (0,0) -- ({4*cos(\\i*3)},{2*sin(\\i*3)});}\n\\draw[red,domain=0:4,samples=180] plot (\\x,{sin(\\x*180)/2});\n\\end{tikzpicture}\n\n',suffix='After.\n\n\\end{document}\n',source=prefix+picture+suffix,range={from:prefix.length,to:prefix.length+picture.length},project={characterMapping:true,jobName:'main'},signal=new AbortController().signal;
 await local.compile(source,signal,30000,()=>{},project);const focus=source.indexOf('CursorMark')+6;await local.prepareRegion(source,range,signal,30000,()=>{},project,focus);
 assert.equal(local.lastTiming.reusedBaseline,true);assert.equal(local.lastTiming.prefixProbeStoppedAtFocus,true);assert.equal(local.lastTiming.prefixProbeAttempts,1);assert.equal(local.lastTiming.prefixCheckpointOffset,undefined);assert.ok(local.lastTiming.prefixProbeMs>=0);
 for(const [label,next]of [['label',source.replace('CursorMark','ChangedLabel')],['geometry',source.replace('(1,1)','(1,2)')]]){
  const edited={from:range.from,to:range.to+next.length-source.length},page=await local.previewRegionPage(next,edited,1,signal,15000,()=>{},project,true),reference=await full.compile(next,signal,30000,()=>{},project);assert.ok(reference);
  for(const [kind,pdf]of [['local',page.pdf],['full',reference]]){const stem=path.join(dir,label+'-'+kind);await fs.writeFile(stem+'.pdf',pdf);await runProcess('pdftoppm',['-singlefile','-r','100',stem+'.pdf',stem],dir,10000,signal,()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,label+'-local.ppm'))),hash(await fs.readFile(path.join(dir,label+'-full.ppm'))));
 }
});
