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

test('Typing after a confirmed undefined command uses one compile and correcting it stops the skip',async()=>{
 const local=make(),slot={basis:{source:baseline},range,abort:new AbortController()};let calls=0;
 local.output=async(_slot,r)=>{calls++;if(r.source.includes('\\broken'))throw new ResidentSourceError('! Undefined control sequence.\nl.3 Target \\broken\n');return {kind:'flow',output:{},flow:{}};};
 await local.runOutput(slot,{source:draft,editId:'first',at:20});assert.equal(calls,2);
 const edited=draft.replace('words.','words continued.');
 const recovered=await local.runOutput(slot,{source:edited,editId:'next',at:30});
 assert.equal(calls,3);assert.ok(recovered.recovery);assert.equal(recovered.repairedSource,edited.replace('\\broken','       '));assert.equal(edited.includes('\\broken'),true);
 const fixed=await local.runOutput(slot,{source:edited.replace('\\broken','ordinary'),editId:'corrected',at:30});
 assert.equal(calls,4);assert.equal(fixed.recovery,undefined);assert.equal(fixed.repairedSource,undefined);
});

test('Changing preceding definitions must recheck the command, even when its diagnostic line is unchanged',async()=>{
 const base=baseline.replace('Target','\\def\\name{old}\nTarget'),broken=base.replace('ordinary','\\broken'),local=make();
 const slot={basis:{source:base},range:{from:range.from,to:base.indexOf('After')},abort:new AbortController()};let calls=0;
 local.output=async(_slot,r)=>{calls++;if(r.source.includes('\\broken')&&!r.source.includes('\\def\\broken{}'))throw new ResidentSourceError('! Undefined control sequence.\nl.4 Target \\broken\n');return {kind:'flow',output:{},flow:{}};};
 await local.runOutput(slot,{source:broken,editId:'first',at:30});assert.equal(calls,2);
 const defined=broken.replace('\\def\\name{old}','\\def\\broken{}');
 const result=await local.runOutput(slot,{source:defined,editId:'defined',at:30});
 assert.equal(calls,3);assert.equal(result.recovery,undefined);
});

test('Confirmed skips cannot cross prepared slots or changes outside their source region',async()=>{
 const local=make(),slot={basis:{source:baseline},range,abort:new AbortController()};let calls=0;
 local.output=async(_slot,r)=>{calls++;if(r.source.includes('\\broken'))throw new ResidentSourceError('! Undefined control sequence.\nl.3 Target \\broken\n');return {kind:'flow',output:{},flow:{}};};
 await local.runOutput(slot,{source:draft,editId:'first',at:20});assert.equal(calls,2);
 await local.runOutput({...slot},{source:draft,editId:'new-slot',at:20});assert.equal(calls,4);
 const outside=draft.replace('After','ChangedAfter');
 await assert.rejects(local.runOutput(slot,{source:outside,editId:'outside',at:20}),ResidentSourceError);assert.equal(calls,5);
});

test('A recovered document accepts edits before and after its error while typesetting the repaired baseline',async()=>{
 const original='Before ordinary words.\n\nBroken \\bad words.\n\nAfter ordinary words.\n\n',compiled=original.replace('\\bad','    ');
 for(const marker of ['Before','After']){
  const from=original.indexOf(marker),to=original.indexOf('\n\n',from)+2,range={from,to},local=make();local.continuous=true;let rendered;
  const basis={source:compiled,originalSource:original,compilerSource:compiled,options:{root:'main.tex'},project:{}};
  const slot={basis,range,compiledRange:range,sourceText:compiled,abort:new AbortController(),diskInputs:[],compiler:{useRegion(){},async previewRegionFlow(source){rendered=source;return {navigation:'',fragment:{page:1},pdf:Buffer.alloc(0)};}},compositor:{flow(){return {rect:{x:0,y:0,width:1,height:1},fragmentRect:{x:0,y:0,width:1,height:1},leading:0};}}};
  const draft=original.slice(0,from)+original.slice(from).replace('ordinary','new ordinary'),request={source:draft,editId:marker,at:from+8};
  assert.ok(local.regionText(slot,draft));const result=await local.runOutput(slot,request);assert.equal(result.kind,'flow');assert.equal(result.recovery,undefined);
  assert.equal(rendered,draft.replace('\\bad','    '));assert.ok(request.source.includes('\\bad'));assert.equal(basis.source,compiled);
  assert.equal(local.regionText(slot,draft.replace('\\bad','\\different')),undefined,'A new change outside this region still needs validation');
 }
});

test('Original root text does not replace an included-file baseline, and healthy publication retires recovery context',()=>{
 const local=make(),basis={source:'Repaired root',originalSource:'Original root',options:{root:'main.tex'},project:{},bundle:{recovered:true}},text='Included words.\n\n';
 assert.equal(local.regionText({basis,input:{file:'chapter.tex',text},sourceText:text,range:{from:0,to:text.length}},'Included new words.\n\n'),'Included new words.\n\n');
 assert.equal(local.sameContext({basis},{...basis,bundle:{recovered:false}}),false);
});
