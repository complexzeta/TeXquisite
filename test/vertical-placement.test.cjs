const {test}=require('node:test'),assert=require('node:assert/strict'),{PDFDocument}=require('pdf-lib');
const {verticalBands,RegionCompositor}=require('../dist/region-compositor');
const {proofDensityRetry}=require('../dist/local-raster');
test('Only independently matched faint-core failures can request a bounded complete denser proof',()=>{
 const result={ok:false,fringeFailure:{reason:'no-core',outline:true}};assert.equal(proofDensityRetry(result,1,600,800),2.5);
 for(const r of [{ok:true,fringeFailure:result.fringeFailure},{ok:false},{ok:false,fringeFailure:{reason:'no-core',outline:false}},{ok:false,fringeFailure:{reason:'quota',outline:true}},{ok:false,fringeFailure:{reason:'unmatched',outline:true}}])assert.equal(proofDensityRetry(r,1,600,800),undefined);
 for(const [scale,width,height]of [[NaN,600,800],[0,600,800],[2.5,600,800],[3,600,800],[1,10000,10000],[1,1.5,800],[1,0,800]])assert.equal(proofDensityRetry(result,scale,width,height),undefined);
});
test('Vertical placement cuts only separate nonoverlapping ink groups and rejects unsafe proposals',()=>{
 assert.deepEqual(verticalBands([{from:10,to:18,y:20},{from:11,to:17,y:20.001},{from:30,to:40,y:31}]),[{from:10,to:18,y:20},{from:30,to:40,y:31}]);
 assert.equal(verticalBands([{from:10,to:25,y:20},{from:20,to:30,y:31}]),undefined);
 assert.equal(verticalBands([{from:10,to:18,y:40},{from:30,to:40,y:0}]),undefined);
 assert.equal(verticalBands([{from:NaN,to:18,y:20}]),undefined);
 assert.equal(verticalBands([{from:10,to:18,y:0},{from:30,to:40,y:250}]),undefined);
});
test('Lecture variable placement remains a baseline proposal; strict placement and page separation refuse it',async()=>{
 const document=await PDFDocument.create();document.addPage([100,100]).drawText('A',{x:20,y:60,size:8});const pdf=await document.save();
 const row=(line,x,y)=>['main.tex',line,0,1,x,y,6,8,65,1],full=[row(3,20,20),row(4,20,50)],local=[row(3,10,10),row(4,10,30)],nav=rows=>rows.map(glyph=>JSON.stringify({glyph})).join('\n');
 const original={pdf,navigation:nav(local),fragment:{page:1,paddingSp:655360,widthSp:1310720,heightSp:2621440,depthSp:0,stateHash:'fixture',flowStateHash:'fixture',shape:[]}};
 await assert.rejects(RegionCompositor.create(pdf,nav(full),original),/nonuniform/);
 const compositor=await RegionCompositor.create(pdf,nav(full),original,true),slices=compositor.slices;assert.equal(slices.length,2);assert.equal(slices[0].to,slices[1].from);assert.equal(slices[1].dy-slices[0].dy,10);
 assert.ok(compositor.flow(original,true));assert.ok((await compositor.compose(original)).pdf.length);
 await assert.rejects(compositor.compose({...original}),/flowing output/);
 const old=compositor.footprint;compositor.adjust(.001,.001);assert.ok(Math.abs(compositor.footprint.y-old.y-.001)<1e-9);assert.ok(Math.abs(compositor.slices[1].dy-slices[1].dy-.001)<1e-9);
 await assert.rejects(RegionCompositor.create(pdf,nav([full[0],[...full[1].slice(0,3),2,...full[1].slice(4)]]),original,true),/spans pages/);
});
