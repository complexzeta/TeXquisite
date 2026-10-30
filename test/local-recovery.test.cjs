const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
// The app bundles these modules together. A shared in-memory test bundle keeps
// their error constructors identical rather than importing two CJS copies.
const runtime={exports:{}},code=require('esbuild').buildSync({stdin:{contents:"export {LocalPreview} from './local-preview';export {ResidentSourceError,ResidentSupersededError} from './resident';",resolveDir:path.resolve(__dirname,'../src')},bundle:true,platform:'node',format:'cjs',external:['pdf-lib'],write:false}).outputFiles[0].text;
new Function('require','module','__dirname',code)(require,runtime,path.resolve(__dirname,'../dist'));
const {LocalPreview,ResidentSourceError,ResidentSupersededError}=runtime.exports;
const baseline='Before\n\nTarget ordinary words.\n\nAfter\n',draft=baseline.replace('ordinary','\\broken'),range={from:baseline.indexOf('Target'),to:baseline.indexOf('After')};
const make=()=>new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{});
test('Local repair keeps the editor draft and baseline immutable and returns explicit approximate metadata',async()=>{
 const local=make(),slot={basis:{source:baseline},range,abort:new AbortController()},request={source:draft,editId:'edit',at:20};let calls=0,compiled;
 local.output=async(_slot,r)=>{calls++;if(r.source.includes('\\broken'))throw new ResidentSourceError('! Undefined control sequence.\nl.3 Target \\broken\n');compiled=r.source;return {kind:'flow',output:{},flow:{}};};
 const result=await local.runOutput(slot,request);
 assert.equal(calls,2);assert.equal(result.kind,'flow');assert.match(result.recovery.message,/skipped undefined/);assert.equal(request.source,draft);assert.equal(slot.basis.source,baseline);assert.equal(compiled,draft.replace('\\broken','       '));
});
test('Recovery cannot overwrite carried edits or repair outside the proved region',async()=>{
 for(const outside of [false,true]){
  const local=make();let calls=0;const ledger={dirty:[{id:'other'}]};if(!outside)local.neutral=ledger;
  const text=outside?'Before \\broken\n\nTarget ordinary words.\n\nAfter\n':draft,base=outside?text:baseline,slot={basis:{source:base},range:{from:base.indexOf('Target'),to:base.indexOf('After')},abort:new AbortController()};
  local.output=async()=>{calls++;throw new ResidentSourceError(outside?'! Undefined control sequence.\nl.1 Before \\broken\n':'! Undefined control sequence.\nl.3 Target \\broken\n');};
  await assert.rejects(local.runOutput(slot,{source:text,editId:'edit',at:20}),ResidentSourceError);assert.equal(calls,1);if(!outside)assert.equal(local.neutral,ledger);
 }
});
test('A sole retained active block can use bounded repair; any other carried history still refuses it',async()=>{
 const id=range.from+':'+range.to;
 for(const another of [false,true]){
  const local=make(),ledger={ids:another?[id,'other']:[id],dirty:[{id}]},slot={basis:{source:baseline},range,abort:new AbortController()},request={source:draft,editId:'repair',at:20};local.retainedFlowEnabled=true;local.neutral=ledger;let calls=0;
  local.output=async(_slot,r)=>{calls++;if(r.source.includes('\\broken'))throw new ResidentSourceError('! Undefined control sequence.\nl.3 Target \\broken\n');return {kind:'flow',output:{},flow:{}};};
  if(another){await assert.rejects(local.runOutput(slot,request),ResidentSourceError);assert.equal(calls,1);assert.equal(local.neutral,ledger);}else{const result=await local.runOutput(slot,request);assert.ok(result.recovery);assert.equal(calls,2);assert.equal(local.neutral,undefined);assert.equal(request.source,draft);assert.equal(slot.basis.source,baseline);}
 }
});
test('A newer pending edit supersedes local recovery without replaying the obsolete draft',async()=>{
 const local=make();local.pending={source:draft+'new',editId:'new',at:20};let calls=0;
 local.output=async()=>{calls++;throw new ResidentSourceError('! Undefined control sequence.\nl.3 Target \\broken\n');};
 await assert.rejects(local.runOutput({basis:{source:baseline},range},{source:draft,editId:'old',at:20}),ResidentSupersededError);assert.equal(calls,1);
});
test('A fatal worker failure is not disguised as supersession when newer input is waiting',async()=>{
 const local=make(),failure=Error('Resident compiler stopped.');local.pending={source:draft+'new',editId:'new',at:20};local.output=async()=>{throw failure;};
 await assert.rejects(local.runOutput({basis:{source:baseline},range},{source:draft,editId:'old',at:20}),error=>error===failure);
});
