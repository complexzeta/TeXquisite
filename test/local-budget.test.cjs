const {test}=require('node:test'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident'),{RegionCompositor}=require('../dist/region-compositor'),{LocalPreview}=require('../dist/local-preview');
const signal=()=>new AbortController().signal;
async function prepared(t){
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());const prefix='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\n',region='Target paragraph.\n\n',suffix='Following.\\newpage\nTail.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 const base=await compiler.prepareRegion(source,range,signal(),60000,()=>{},project),original=await compiler.previewRegionFlow(source,range,signal(),30000,()=>{},project,true),compositor=await RegionCompositor.create(base.pdf,base.navigation,original),messages=[];
 const lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},m=>messages.push(m));lane.setContinuous(true);
 const slot={compiler,compositor,range,compiledRange:range,abort:new AbortController(),diskInputs:[],basis:{source,compilerSource:source,project,options:{root:'main.tex'}}};return {compiler,lane,slot,prefix,region,suffix,source,messages};
}
test('A delayed local request keeps its warm compiler and the next edit remains local',{timeout:30000},async t=>{
 const p=await prepared(t),worker=p.compiler.worker,originalPost=worker.postMessage.bind(worker);let delayed=false;
 worker.postMessage=(message,...args)=>{if(!delayed&&message.region?.action==='flow'){delayed=true;setTimeout(()=>originalPost(message,...args),350);return;}return originalPost(message,...args);};
 const next=p.region.replace('Target','Changed'),result=await p.lane.output(p.slot,{source:p.prefix+next+p.suffix,editId:'delayed',at:p.prefix.length+8});
 assert.equal(result.kind,'flow');assert.ok(result.output.timing.roundTripMs>=330,'The test must exceed the former 250 ms deadline');assert.equal(p.compiler.worker,worker);assert.ok(p.compiler.initialized);
 const nextResult=await p.lane.output(p.slot,{source:p.source,editId:'next',at:p.prefix.length+5});assert.equal(nextResult.kind,'flow');assert.equal(p.compiler.worker,worker);assert.ok(!p.messages.some(m=>m.includes('timed out')));
});
test('Nonterminating local TeX is still bounded and a full build can recover',{timeout:30000},async t=>{
 const p=await prepared(t),next='Target \\def\\spin{\\spin}\\spin\n\n';await assert.rejects(p.lane.output(p.slot,{source:p.prefix+next+p.suffix,editId:'loop',at:p.prefix.length+8}));
 assert.ok(p.messages.some(m=>m.includes('Build timed out.')));assert.equal(p.compiler.initialized,false,'The hard timeout must stop the stuck owned worker');assert.ok((await p.compiler.compile(p.source,signal(),60000,()=>{},{characterMapping:true})).length>100);
});

test('A page with a measured higher cost survives a delay over one second without losing its checkpoint',{timeout:30000},async t=>{
 const p=await prepared(t),range=p.slot.compiledRange,baseline=await p.compiler.previewRegionPage(p.source,range,1,signal(),10000,()=>{},{characterMapping:true},true),worker=p.compiler.worker,post=worker.postMessage.bind(worker);
 Object.assign(p.slot,{compositor:undefined,pageMode:true,pageReady:true,pageCostMs:1000,sourcePages:baseline.pageSpan,baselineSpan:baseline.pageSpan,continuation:baseline.timing.continuation});
 let delayed=false;worker.postMessage=(message,...args)=>{if(!delayed&&message.region?.action==='band'){delayed=true;setTimeout(()=>post(message,...args),1300);return;}return post(message,...args);};
 const output=await p.lane.output(p.slot,{source:p.source.replace('Target','Changed'),editId:'slow-page',at:p.prefix.length+5});assert.equal(output.kind,'page');assert.ok(output.output.timing.roundTripMs>=1250);assert.equal(p.compiler.worker,worker);assert.ok(p.compiler.initialized);
 const next=await p.lane.output(p.slot,{source:p.source,editId:'next-page',at:p.prefix.length+5});assert.equal(next.kind,'page');assert.equal(p.compiler.worker,worker);
 p.slot.pageCostMs=500;const loop=p.source.replace('Target','\\def\\spin{\\spin}\\spin');await assert.rejects(p.lane.output(p.slot,{source:loop,editId:'loop-page',at:p.prefix.length+5}),/timed out/);assert.equal(p.compiler.initialized,false);assert.ok((await p.compiler.compile(p.source,signal(),15000,()=>{},{characterMapping:true})).length>100);
});

test('Moving out of edited prose returns the warm worker and stale verification cannot replace it',{timeout:30000},async t=>{
 const p=await prepared(t),slot=p.slot,worker=p.compiler.worker;let returned=false,replaced=false;
 slot.basis.bundle={id:'before'};Object.assign(slot,{ready:true,edited:true,latestSource:p.source.replace('Target','Changed'),liveEnd:slot.range.to});
 const basis={...slot.basis,bundle:{id:'verified-but-behind'},source:p.source,replaceCompiler:()=>{replaced=true;return undefined;},returnCompiler:compiler=>{assert.equal(compiler,p.compiler);returned=true;return true;}};
 p.lane.basis=basis;p.lane.slot=slot;p.lane.scheduleIdle();await new Promise(r=>setTimeout(r,250));assert.equal(replaced,false);assert.equal(p.lane.slot,slot);
 p.lane.move('main.tex',p.source.indexOf('Following')+2);assert.equal(returned,true);assert.equal(p.lane.verifyingWithOwner,true,'A returned worker must keep new input on its full queue');assert.equal(p.lane.slot,undefined);assert.equal(p.compiler.worker,worker);assert.ok(p.compiler.initialized);p.lane.stop();
});
