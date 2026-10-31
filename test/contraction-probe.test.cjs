const {test}=require('node:test'),assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib'),{LocalPreview}=require('../dist/local-preview');

test('Contraction probing rejects missing old pages early and never reuses a different revision',{timeout:5000},async()=>{
 const document=await PDFDocument.create();document.addPage();document.addPage();const pdf=await document.save();
 const single=await PDFDocument.create();single.addPage();const onePagePdf=await single.save();
 const source='Before.\n\nTarget '+('word '.repeat(180))+'\n\nAfter.\n\n',draft=source.replace('word '.repeat(120),''),root='contraction-fixture.tex';
 const rows=[['main.tex',3,0,1,10,20,6,10,84,1],['main.tex',3,850,2,10,20,6,10,119,1]],navigation=rows.map(glyph=>JSON.stringify({glyph})).join('\n');
 const original={pdf,fragment:{page:1},navigation:rows.map(g=>JSON.stringify({glyph:[...g.slice(0,3),1,...g.slice(4)]})).join('\n')};
 for(const mode of ['contract','reuse','supersede','proof-fails','continuation','probe-error','slow-baseline']){
  const calls=[],fallbacks=[],published=[];let proofs=0,returned=0,done;const displayed=new Promise(r=>done=r);
  const compiler={initialized:true,busy:false,prepareRegion:async()=>({regionKey:'fixture',navigation}),previewRegionFlow:async()=>original,previewRegionPage:async(text,range)=>{calls.push({text,range:{...range}});if(mode==='probe-error'&&calls.length===1)throw Error('Probe unavailable');const last=mode==='contract'||mode==='continuation'&&text!==source?1:2;return {pdf:last===1?onePagePdf:pdf,pageSpan:{first:1,last},navigation,timing:{totalMs:1,...(mode==='continuation'?{continuation:'suffix'}:{})}};},useRegion(){},prepareNextRegionEdit(){},stop(){}};
  if(mode==='slow-baseline')compiler.lastTiming={baselinePageCostMs:201};
  const basis={source,compilerSource:source,pdf,bundle:{id:'fixture'},options:{root},project:{jobName:'main'},returnCompiler:owner=>{assert.equal(owner,compiler);assert.equal(owner.busy,false);returned++;return true;}};
  let local;local=new LocalPreview(async()=>false,async candidate=>{assert.equal(proofs,1,'Edited output requires the original page proof');published.push(candidate);done();return true;},id=>fallbacks.push(id),()=>{},()=>{},async()=>{proofs++;if(mode==='supersede')local.pending={source:draft.replace('Target','Targets'),editId:'newer',at:12};return mode!=='proof-fails';});
  local.basis=basis;local.cursor={file:root,at:source.indexOf('Target')+2};local.continuous=true;local.warmCompiler=compiler;local.pending={source:draft,editId:'draft',at:12};
  try{
   await local.arm(true);
   if(mode==='contract'||mode==='proof-fails'){assert.equal(calls.length,mode==='contract'?1:2);assert.equal(proofs,mode==='contract'?0:1);assert.equal(returned,1);assert.deepEqual(fallbacks,['draft']);assert.equal(local.ready,false);assert.equal(published.length,0);}
   else{
    await displayed;assert.equal(calls.length,mode==='supersede'||mode==='probe-error'?3:2);assert.equal(calls[0].text,mode==='slow-baseline'?source:draft);assert.equal(calls[1].text,mode==='slow-baseline'?draft:source);assert.equal(returned,0);assert.deepEqual(fallbacks,[]);assert.equal(published[0].editId,mode==='supersede'?'newer':'draft');
    if(mode==='supersede')assert.equal(calls[2].text,draft.replace('Target','Targets'));
    assert.equal(local.slot.pageProbe,undefined,'Computed output must be consumed or discarded once');
   }
   assert.equal(basis.source,source,'The accepted source must not be modified');
  }finally{local.stop();}
 }
});
