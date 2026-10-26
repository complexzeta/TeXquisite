const {test}=require('node:test'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident');
const signal=()=>new AbortController().signal;
test('Direct TeX state digests equal complete file snapshots, including edits, assignments and error recovery',{timeout:90000},async t=>{
 const previous=process.env.PERSISTENT_TEX_VERIFY_STATE_HASH;process.env.PERSISTENT_TEX_VERIFY_STATE_HASH='1';
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nPrefix paragraph.\n\n',region='Target paragraph $\\sqrt{\\pi}$ and plain words.\n\n',suffix='Following stable paragraph.\n\n\\newpage\nTail.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 try{await compiler.prepareRegion(source,range,signal(),60000,()=>{},project);}finally{if(previous===undefined)delete process.env.PERSISTENT_TEX_VERIFY_STATE_HASH;else process.env.PERSISTENT_TEX_VERIFY_STATE_HASH=previous;}
 const output=async text=>compiler.previewRegionNodes(prefix+text+suffix,{from:prefix.length,to:prefix.length+text.length},signal(),30000,()=>{},project);
 let original,reused=0;
 for(const text of [region,region.replace('plain words','other words'),region.replace('\\pi','x\\pi'),region.replace('plain words','\\global\\advance\\count20 by1 plain words'),region]){
  const result=await output(text);assert.equal(result.timing.directStateHash,true);assert.equal(result.timing.stateHashVerified,true);assert.ok(result.timing.stateHashBytes>200000);assert.match(result.fragment.stateHash,/^[a-f0-9]{64}$/);
  if(result.timing.stateHashReused)reused++;
  if(original===undefined)original=result.fragment.stateHash;
  if(text.includes('\\global'))assert.notEqual(result.fragment.stateHash,original,'State-changing input must still invalidate paragraph reuse');
  if(text===region)assert.equal(result.fragment.stateHash,original,'Restoration must recover the original complete state digest');
 }
 assert.ok(reused>0,'Exact byte comparison should reuse a verified unchanged table digest');
 await assert.rejects(output(region.replace('plain words','\\UndefinedStateHashProbe')));
 assert.equal((await output(region)).fragment.stateHash,original);
});
