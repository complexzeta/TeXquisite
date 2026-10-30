const {test}=require('node:test'),assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib'),{LocalPreview,paragraphAt,flowWindowAt}=require('../dist/local-preview');

test('A failed window raster uses page proof in the same context; failed page proof still narrows',async()=>{
 const document=await PDFDocument.create(),page=document.addPage([100,100]);page.drawText('AB',{x:20,y:60});const pdf=await document.save();
 const source='Before.\n\nFirst paragraph.\n\nSecond paragraph.\n\nAfter.\n\n',root='window-page-fixture.tex',at=source.indexOf('First')+2;
 const rows=[['main.tex',3,0,1,20,20,6,10,65,1],['main.tex',5,0,1,30,30,6,10,66,1]],navigation=rows.map(glyph=>JSON.stringify({glyph})).join('\n');
 const original={pdf,fragment:{page:1,paddingSp:655360,widthSp:1310720,heightSp:655360,depthSp:0,stateHash:'fixture',shape:[]},navigation:rows.map(row=>JSON.stringify({glyph:row.map((v,i)=>i===4||i===5?v-10:v)})).join('\n')};
 for(const matches of [true,false,'margin','margin-refused']){
  const ranges=[],logs=[],margins=[];let pageCalls=0,published=0;
  const compiler={initialized:true,busy:false,prepareRegion:async(_source,range)=>{ranges.push({...range});return {regionKey:'fixture',navigation};},previewRegionFlow:async()=>original,previewRegionPage:async()=>{pageCalls++;return {pdf,pageSpan:{first:1,last:1},timing:{}};},useRegion(){},prepareNextRegionEdit(){},stop(){}};
  const basis={source,compilerSource:source,pdf,bundle:{id:'fixture'},options:{root},project:{jobName:'main'},returnCompiler:()=>true};
  const local=new LocalPreview(async(...args)=>{const bleed=args[6]?.inkBleedBp??1;margins.push(bleed);return matches==='margin'&&bleed===.75;},async()=>{published++;return true;},()=>{},()=>{},line=>logs.push(line),async()=>!!matches);
  local.basis=basis;local.cursor={file:root,at};local.continuous=true;local.warmCompiler=compiler;
  local.lecture=typeof matches==='string';
  try{
   await local.arm();assert.deepEqual(ranges[0],flowWindowAt(source,at));assert.equal(published,0,'Preparing a context must not display unverified output');
   if(matches==='margin'){assert.equal(ranges.length,1);assert.equal(pageCalls,0);assert.equal(local.ready,true);assert.equal(local.slot.compositor.inkBleedBp,.75);assert.deepEqual(margins,[1,.75]);}
   else if(matches){assert.equal(ranges.length,1);assert.equal(pageCalls,1);assert.equal(local.ready,true);assert.equal(local.slot.pageMode,true);assert.equal(local.slot.pageReady,true);if(matches==='margin-refused')assert.deepEqual(margins,[1,.75,.5,.25]);}
   else{assert.equal(local.ready,false);assert.deepEqual(ranges[1],paragraphAt(source,at));assert.equal(pageCalls,2);assert.ok(logs.some(line=>line.includes('preparation narrowed')));}
  }finally{local.stop();}
 }
});
