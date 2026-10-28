const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {LocalPreview}=require('../dist/local-preview'),{ResidentCompiler}=require('../dist/resident');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),hash=s=>createHash('sha256').update(s).digest('hex');
test('Independent paragraph eligibility rejects active characters and immediate file writes',{timeout:90000},async t=>{
 const old=process.env.PERSISTENT_TEX_MULTI_BLOCK;process.env.PERSISTENT_TEX_MULTI_BLOCK='1';t.after(()=>{if(old===undefined)delete process.env.PERSISTENT_TEX_MULTI_BLOCK;else process.env.PERSISTENT_TEX_MULTI_BLOCK=old;});
 for(const [preamble,text,characters,writes] of [
  ['', 'Ordinary paragraph words.',true,true],
  ['\\catcode`\\!=13 \\def!{}', 'Ordinary! paragraph words.',false,true],
  ['\\newwrite\\ProbeStream\\immediate\\openout\\ProbeStream=probe.txt', 'Ordinary \\immediate\\write\\ProbeStream{observed} paragraph words.',false,false]
 ]){
  const compiler=new ResidentCompiler();try{
   const source='\\documentclass{article}\n'+preamble+'\n\\begin{document}\n\n'+text+'\n\nTail paragraph.\n\n\\end{document}\n',from=source.indexOf(text),range={from,to:from+text.length+2},signal=new AbortController().signal,project={characterMapping:true};
   await compiler.prepareRegion(source,range,signal,30000,()=>{},project);
   const output=await compiler.previewRegionFlow(source,range,signal,30000,()=>{},project,true,undefined,true);
   assert.equal(output.fragment.neutralCharacters,characters,text);assert.equal(output.fragment.neutralWriteFree,writes,text);
  }finally{compiler.stop();}
 }
});
async function until(check){for(let n=0;n<1500;n++){if(check())return;await delay(10);}throw Error('Neutral prototype timed out');}
test('A single resident worker carries proved ordinary edits across paragraph checkpoints',{timeout:90000},async t=>{
 const old=process.env.PERSISTENT_TEX_MULTI_BLOCK;process.env.PERSISTENT_TEX_MULTI_BLOCK='1';t.after(()=>{if(old===undefined)delete process.env.PERSISTENT_TEX_MULTI_BLOCK;else process.env.PERSISTENT_TEX_MULTI_BLOCK=old;});
 const compiler=new ResidentCompiler(),source='\\documentclass{article}\n\\begin{document}\n\nAlpha paragraph words.\n\nBeta paragraph words.\n\nGamma paragraph words.\n\n\\end{document}\n',project={characterMapping:true},pdf=await compiler.compile(source,new AbortController().signal,60000,()=>{},project),frames=[],fallbacks=[],logs=[];let borrowed=false;
 const local=new LocalPreview(async()=>true,async c=>{frames.push(c);return true;},id=>fallbacks.push(id),()=>{},s=>logs.push(s));t.after(()=>{local.stop();compiler.stop();});
 local.setContinuous(true);local.setLecture(true);local.setBasis({source,compilerSource:source,pdf,project,bundle:{id:'original'},options:{root:'main.tex'},takeCompiler:()=>borrowed?undefined:(borrowed=true,compiler)});
 let editor=source;const workerBefore=()=>compiler.worker;
 async function edit(marker,insert,id){const at=editor.indexOf(marker)+marker.length;local.move('main.tex',at);await until(()=>local.ready);const worker=workerBefore();editor=editor.slice(0,at)+insert+editor.slice(at);local.move('main.tex',at+insert.length,true);assert.equal(local.request('main.tex',editor,id),true);await until(()=>frames.some(f=>f.editId===id)||fallbacks.includes(id));const frame=frames.find(f=>f.editId===id);assert.ok(frame,logs.join(''));assert.ok(frame.neutralBlock,logs.join(''));assert.equal(frame.sourceHash,hash(editor));assert.equal(compiler.worker,worker);return frame;}
 const a=await edit('Alpha',' added','a'),worker=compiler.worker,b=await edit('Beta',' extra','b'),again=await edit('Alpha added',' again','again');
 assert.equal(compiler.worker,worker);assert.deepEqual(b.neutralBlock.prior,[a.neutralBlock.id]);assert.equal(again.neutralBlock.ranges.length,2);assert.deepEqual(fallbacks,[]);assert.ok(logs.some(s=>s.includes('cache hit')),'A revisit reuses its region checkpoint');
 const at=editor.indexOf('Beta')+4;local.move('main.tex',at);await until(()=>local.ready);editor=editor.slice(0,at)+'\\global\\advance\\count20 by1 '+editor.slice(at);local.move('main.tex',at+29,true);local.request('main.tex',editor,'state-change');await until(()=>fallbacks.includes('state-change'));assert.ok(!frames.some(f=>f.editId==='state-change'),'Stateful edits cannot reuse independent overlays');assert.ok(compiler.initialized);
});
