const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('Restoring after publication matches demand restoration across immediate edits, pages, failures and full builds',{timeout:120000},async t=>{
 const dir=path.resolve('.test-output','ready-restore-'+randomUUID());await fs.mkdir(dir,{recursive:true});const fast=new ResidentCompiler();t.after(()=>fast.stop());
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\year=2020\\month=1\\day=1\\time=0\n\\AtEndDocument{\\typeout{FORBIDDEN_READY_END}}\n\\begin{document}\n\nPrefix paragraph.\n\n',region='Target paragraph $\\sqrt{\\pi}$ with ordinary words.\n\n',suffix='Following paragraph.\n\n\\newpage\nBridge.\\newpage\n\\typeout{FORBIDDEN_READY_TAIL}\nTail.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 await fast.prepareRegion(source,range,signal(),60000,()=>{},project);
 // The reuse contract is the identical checkpoint instance. Compare the
 // optimized and reference paths within that instance, including exact state.
 const outputs=[];let originalHash;
 for(const [i,next]of [region,region.replace('ordinary','different'),region.replace('\\pi','x\\pi'),region.replace('ordinary words','\\global\\advance\\count20 by1 ordinary words'),region].entries()){
  const text=prefix+next+suffix,r={from:prefix.length,to:prefix.length+next.length},logs=[];
  const a=await fast.previewRegionNodes(text,r,signal(),30000,s=>logs.push(s),project),b=await fast.previewRegionNodes(text,r,signal(),30000,()=>{},project);
  assert.equal(a.fragment.stateHash,b.fragment.stateHash,'iteration '+i+' preRestored='+a.timing.preRestored);assert.equal(a.timing.preRestored,i>0);assert.equal(b.timing.preRestored,false);assert.ok(a.timing.roundTripMs>=a.timing.totalMs-1);assert.ok(!/FORBIDDEN_READY_END|FORBIDDEN_READY_TAIL/.test(logs.join('')));
  if(i){assert.equal(a.timing.restoreDetail.heapBytes,0);assert.ok(a.timing.previousRestoreDetail.heapBytes>0);assert.equal(a.timing.previousRestoreDetail.heapBytes,b.timing.restoreDetail.heapBytes);assert.ok(a.timing.previousRestoreMs>0);assert.ok(a.timing.preRestoreIdleMs>=0);}
  if(i===0)originalHash=a.fragment.stateHash;
  if(next===region)assert.equal(a.fragment.stateHash,originalHash);
  if(next.includes('\\global'))assert.notEqual(a.fragment.stateHash,originalHash);
  outputs.push(a.timing);
  fast.prepareNextRegionEdit();
 }
 const grown=region.replace('ordinary words','wrapping words '.repeat(80)),text=prefix+grown+suffix,r={from:prefix.length,to:prefix.length+grown.length};
 const a=await fast.previewRegionPage(text,r,1,signal(),30000,()=>{},project),b=await fast.previewRegionPage(text,r,1,signal(),30000,()=>{},project);assert.deepEqual(a.pageSpan,b.pageSpan);assert.equal(a.timing.preRestored,true);assert.equal(b.timing.preRestored,false);
 for(const [name,out]of [['ready',a],['demand',b]]){await fs.writeFile(path.join(dir,name+'.pdf'),out.pdf);await runProcess('pdftoppm',['-r','72','-f','1','-l','1',name+'.pdf',name],dir,30000,signal(),()=>{});}assert.equal(hash(await fs.readFile(path.join(dir,'ready-1.ppm'))),hash(await fs.readFile(path.join(dir,'demand-1.ppm'))));
 fast.prepareNextRegionEdit();
 await assert.rejects(fast.previewRegionNodes(prefix+region.replace('ordinary words','\\UndefinedReadyProbe')+suffix,{from:prefix.length,to:prefix.length+region.replace('ordinary words','\\UndefinedReadyProbe').length},signal(),30000,()=>{},project));
 const repaired=await fast.previewRegionNodes(source,range,signal(),30000,()=>{},project);assert.equal(repaired.timing.preRestored,false);assert.equal(repaired.fragment.stateHash,originalHash);
 fast.prepareNextRegionEdit();await fast.compile(source,signal(),60000,()=>{},project);await assert.rejects(fast.previewRegionNodes(source,range,signal(),30000,()=>{},project),/Prepare/);
 await fast.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal((await fast.previewRegionNodes(source,range,signal(),30000,()=>{},project)).timing.preRestored,false);
 fast.prepareNextRegionEdit();fast.stop();await fast.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal((await fast.previewRegionNodes(source,range,signal(),30000,()=>{},project)).timing.preRestored,false);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,outputs},null,2));
});
