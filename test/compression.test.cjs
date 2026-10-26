const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');const {ResidentCompiler}=require('../dist/resident'),{hash,runProcess}=require('../dist/core');
test('Native and Wasm PDF compression preserve TeX levels, long streams, warm recovery and exact rendered pages',{timeout:90000},async t=>{
 const directory=path.resolve('.test-output','compression-'+randomUUID());await fs.mkdir(directory,{recursive:true});const fast=new ResidentCompiler(),slow=new ResidentCompiler();t.after(()=>{fast.stop();slow.stop();});
 const compile=(compiler,source,native)=>{const prior=process.env.PERSISTENT_TEX_NATIVE_ZLIB;if(native)process.env.PERSISTENT_TEX_NATIVE_ZLIB='1';else delete process.env.PERSISTENT_TEX_NATIVE_ZLIB;const promise=compiler.compile(source,new AbortController().signal,60000,()=>{},{characterMapping:true});if(prior===undefined)delete process.env.PERSISTENT_TEX_NATIVE_ZLIB;else process.env.PERSISTENT_TEX_NATIVE_ZLIB=prior;return promise;};
 for(const level of [9,0,1]){const source='\\documentclass{article}\n\\usepackage{amsmath}\n\\pdfcompresslevel='+level+'\n\\pdfobjcompresslevel=2\n\\begin{document}\nLevel \\the\\pdfcompresslevel. $x^2+\\frac{a}{b}=\\sqrt{\\pi}$.\n\\newcount\\probe\\probe=0\n\\loop\\ifnum\\probe<4000\\pdfliteral direct{q 1 0 0 1 0 0 cm Q}\\advance\\probe by1\\repeat\n\\newpage\nSecond page.\n\\end{document}\n';const a=await compile(fast,source,true),b=await compile(slow,source,false);assert.equal(slow.lastTiming.nativeZipStreams,0);assert.equal(fast.lastTiming.nativeZipStreams>0,level>0);for(const [name,pdf]of [['native',a],['wasm',b]]){await fs.writeFile(path.join(directory,level+'-'+name+'.pdf'),pdf);await runProcess('pdftoppm',['-r','72',level+'-'+name+'.pdf',level+'-'+name],directory,30000,new AbortController().signal,()=>{});}for(const page of [1,2])assert.equal(hash(await fs.readFile(path.join(directory,level+'-native-'+page+'.ppm'))),hash(await fs.readFile(path.join(directory,level+'-wasm-'+page+'.ppm'))));
  await assert.rejects(compile(fast,source.replace('Second page.','Second page. \\undefinedprobe'),true));assert.ok((await compile(fast,source.replace('Second page.','Repaired page.'),true)).length>100);
 }
});

test('Cached local streams preserve all PDF pixels, math, navigation, compression levels and recovery',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','stream-cache-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const signal=()=>new AbortController().signal,project={characterMapping:true};let cases=0;
 for(const level of [9,0,1]){
  const local=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{local.stop();strict.stop();});
  const prefix='\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath,amssymb}\n\\pdfcompresslevel='+level+'\n\\pdfobjcompresslevel=2\n\\begin{document}\n\nEarlier page with {\\bfseries bold}, {\\itshape italic} and $\\alpha+\\sum_i i$.\\newpage\n\n',region='Target text with $\\sqrt{\\pi}+\\frac{a}{b}$.\n\n',suffix='Following material.\n\\end{document}\n',range={from:prefix.length,to:prefix.length+region.length};
  for(const c of [local,strict])await c.prepareRegion(prefix+region+suffix,range,signal(),60000,()=>{},project);
  const render=async(c,text,provisional)=>c.previewRegionFlow(prefix+text+suffix,{from:prefix.length,to:prefix.length+text.length},signal(),30000,()=>{},project,provisional);
  await render(local,region,true);
  for(const text of [region,region.replace('text','changed \\textbf{words}').replace('\\pi','\\theta^2'),region]){
   const a=await render(local,text,true),b=await render(strict,text,false);
   assert.equal(a.navigation,b.navigation,'Compression must preserve exact local navigation');assert.deepEqual(a.fragment.shape,b.fragment.shape);
   if(level>0)assert.ok(a.timing.sealTiming.streamCacheHits>0);else assert.equal(a.timing.sealTiming.streamCacheHits,0);
   assert.equal(b.timing.sealTiming.streamCacheHits,0,'Strict verification must use the existing output path');
   for(const [name,pdf]of [['cached',a.pdf],['strict',b.pdf]]){const stem=cases+'-'+name;await fs.writeFile(path.join(directory,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-r','72',stem+'.pdf',stem],directory,30000,signal(),()=>{});}
   for(const page of [1,2])assert.equal(hash(await fs.readFile(path.join(directory,cases+'-cached-'+page+'.ppm'))),hash(await fs.readFile(path.join(directory,cases+'-strict-'+page+'.ppm'))),'Cached compression must preserve every page pixel');cases++;
  }
  await assert.rejects(render(local,region.replace('Target','\\undefinedCacheProbe'),true));assert.ok((await render(local,region,true)).pdf.length>100);
  await local.compile(prefix+region+suffix,signal(),60000,()=>{},project);assert.equal(local.lastTiming.nativeZipStreams,0,'A local cache must not change later full builds');local.stop();strict.stop();
 }
});
