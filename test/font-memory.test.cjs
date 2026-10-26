const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
async function eagerPrepare(compiler,source,range,project){const old=process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY;process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY='1';try{await compiler.prepareRegion(source,range,signal(),60000,()=>{},project);}finally{if(old===undefined)delete process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY;else process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY=old;}}

test('On-demand font metrics retain pixels and navigation across growth, checkpoint restore and error recovery',{timeout:120000},async t=>{
 const dir=path.resolve('.test-output','font-memory-'+randomUUID());await fs.mkdir(dir,{recursive:true});const compact=new ResidentCompiler(),eager=new ResidentCompiler();t.after(()=>{compact.stop();eager.stop();});
 const prefix='\\documentclass{article}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\nBefore.\n\n\\font\\grow=cmr10 at11pt\n',region='Target ordinary text.\n\n',suffix='After.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 await eagerPrepare(eager,source,range,project);await compact.prepareRegion(source,range,signal(),60000,()=>{},project);
 let initialCapacity;
 for(const [i,body]of [region,'\\fontdimen2000000\\grow=3pt '+region,region,'\\fontdimen3000000\\grow=4pt '+region,region].entries()){
  const text=prefix+body+suffix,r={from:prefix.length,to:prefix.length+body.length},a=await compact.previewRegionFlow(text,r,signal(),30000,()=>{},project,true),b=await eager.previewRegionFlow(text,r,signal(),30000,()=>{},project,true);
  assert.equal(b.timing.fontMemoryCapacity,8000000);assert.ok(a.timing.fontMemoryCapacity<8000000);assert.ok(a.timing.fontMemoryCapacity>=a.timing.fontMemoryUsed);if(i===0)initialCapacity=a.timing.fontMemoryCapacity;if(i===0||i===2||i===4)assert.equal(a.timing.fontMemoryCapacity,initialCapacity);else assert.ok(a.timing.fontMemoryCapacity>initialCapacity);
  assert.deepEqual(a.fragment.shape,b.fragment.shape);assert.equal(a.navigation,b.navigation);
  for(const [kind,pdf]of [['compact',a.pdf],['eager',b.pdf]]){const stem=i+'-'+kind;await fs.writeFile(path.join(dir,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',stem+'.pdf',stem],dir,30000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,i+'-compact-1.png'))),hash(await fs.readFile(path.join(dir,i+'-eager-1.png'))));compact.prepareNextRegionEdit();
 }
 const excessive='\\fontdimen9000000\\grow=1pt '+region;await assert.rejects(compact.previewRegionFlow(prefix+excessive+suffix,{from:range.from,to:prefix.length+excessive.length},signal(),30000,()=>{},project,true));
 const repaired=await compact.previewRegionFlow(source,range,signal(),30000,()=>{},project,true);assert.equal(repaired.timing.fontMemoryCapacity,initialCapacity);assert.ok(repaired.pdf.length>100);assert.ok((await compact.compile(source,signal(),60000,()=>{},project)).length>100);
});

test('Many new fonts and microtype expansion can exceed the initial allocation with ordinary output preserved',{timeout:120000},async t=>{
 const dir=path.resolve('.test-output','font-growth-'+randomUUID());await fs.mkdir(dir,{recursive:true});const compact=new ResidentCompiler(),eager=new ResidentCompiler();t.after(()=>{compact.stop();eager.stop();});
 const source='\\documentclass{article}\n\\usepackage{microtype}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\\newcount\\probe\\probe=0\n\\loop\\ifnum\\probe<220\\advance\\probe by1\\expandafter\\font\\csname metricprobe\\the\\probe\\endcsname=cmr10 at\\the\\probe pt\\repeat\n'+('Ordinary expanding font text with bold \\textbf{words}. '.repeat(50))+'\n\\end{document}\n';
 const old=process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY;process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY='1';let b;try{b=await eager.compile(source,signal(),60000,()=>{},{characterMapping:true});}finally{if(old===undefined)delete process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY;else process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY=old;}
 const a=await compact.compile(source,signal(),60000,()=>{},{characterMapping:true});assert.ok(a&&b);assert.equal(compact.navigation,eager.navigation);
 for(const [kind,pdf]of [['compact',a],['eager',b]]){await fs.writeFile(path.join(dir,kind+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',kind+'.pdf',kind],dir,30000,signal(),()=>{});}
 const pages=(await fs.readdir(dir)).filter(n=>/^compact-\d+\.png$/.test(n));assert.ok(pages.length);for(const page of pages)assert.equal(hash(await fs.readFile(path.join(dir,page))),hash(await fs.readFile(path.join(dir,page.replace('compact','eager')))));
});
