const {test}=require('node:test'),assert=require('node:assert/strict');
const {PDFDocument,PDFName,PDFNumber,PDFString,PDFRef}=require('pdf-lib');
const {pdfPageIdentities}=require('../dist/pdf-page-identity');
const {PageRasterCache}=require('../dist/page-raster-cache');
const equal=(a,b)=>Buffer.from(a).equals(Buffer.from(b));
test('Page identity survives reference renumbering and edits to sibling pages',async()=>{
 const d=await PDFDocument.create();d.addPage().drawText('Unchanged');d.addPage().drawText('Before');const bytes=await d.save({useObjectStreams:false});
 const e=await PDFDocument.load(bytes,{updateMetadata:false});e.getPage(1).drawText('After');const before=await pdfPageIdentities(bytes),after=await pdfPageIdentities(await e.save());
 assert.ok(before.every(Boolean)&&after.every(Boolean));assert.ok(equal(before[0],after[0]));assert.ok(!equal(before[1],after[1]));
 const copy=await PDFDocument.create();copy.addPage();const [page]=await copy.copyPages(d,[0]);copy.addPage(page);const ids=await pdfPageIdentities(await copy.save());assert.ok(equal(before[0],ids[1]));
});
test('Font resources, inherited geometry, stream bytes and catalog features invalidate reuse',async()=>{
 const d=await PDFDocument.create();d.addPage().drawText('Same');const bytes=await d.save(),base=(await pdfPageIdentities(bytes))[0];assert.ok(base);
 for(const change of [p=>p.getPage(0).setSize(700,500),p=>p.getPage(0).setRotation(require('pdf-lib').degrees(90)),p=>p.getPage(0).drawText('Changed'),p=>{const resources=p.getPage(0).node.Resources();resources.set(PDFName.of('DifferentResource'),PDFString.of('not ignored'));}]){const e=await PDFDocument.load(bytes,{updateMetadata:false});change(e);assert.ok(!equal(base,(await pdfPageIdentities(await e.save()))[0]));}
 const inherited=await PDFDocument.load(bytes,{updateMetadata:false}),node=inherited.getPage(0).node,parent=inherited.context.lookup(node.get(PDFName.of('Parent')));parent.set(PDFName.of('Rotate'),PDFNumber.of(90));node.delete(PDFName.of('Rotate'));assert.ok(!equal(base,(await pdfPageIdentities(await inherited.save()))[0]));
 d.catalog.set(PDFName.of('OCProperties'),d.context.obj({}));assert.deepEqual(await pdfPageIdentities(await d.save()),[]);assert.deepEqual(await pdfPageIdentities(new Uint8Array([1,2,3])),[]);
});
test('Raster cache requires exact bytes and scale, owns identities, evicts and closes images',()=>{
 let closed=0;const image=()=>({image:{close(){closed++;}},width:2,height:2}),cache=new PageRasterCache(40),key=new Uint8Array([1,2]);const a=image();cache.set(key,1,a);key[0]=9;assert.equal(cache.get(new Uint8Array([1,2]),1),a);assert.equal(cache.get(key,1),undefined);assert.equal(cache.get(new Uint8Array([1,2]),2),undefined);cache.set(new Uint8Array([3]),1,image());cache.set(new Uint8Array([4]),1,image());assert.equal(closed,1);assert.equal(cache.get(new Uint8Array([1,2]),1),undefined);assert.ok(cache.retainedBytes<=40);cache.clear();assert.equal(closed,3);assert.equal(cache.retainedBytes,0);
});

test('Unresolved unused native colour resources match only the same unresolved reference',async()=>{
 const d=await PDFDocument.create();const page=d.addPage();page.drawText('Stable');page.node.Resources().set(PDFName.of('ColorSpace'),PDFRef.of(9000));const bytes=await d.save({useObjectStreams:false}),base=(await pdfPageIdentities(bytes))[0];assert.ok(base);
 const same=await PDFDocument.load(bytes,{updateMetadata:false});assert.ok(equal(base,(await pdfPageIdentities(await same.save()))[0]));
 const changed=await PDFDocument.load(bytes,{updateMetadata:false});changed.getPage(0).node.Resources().set(PDFName.of('ColorSpace'),PDFRef.of(9001));assert.ok(!equal(base,(await pdfPageIdentities(await changed.save()))[0]));
 const resolved=await PDFDocument.load(bytes,{updateMetadata:false});resolved.context.assign(PDFRef.of(9000),resolved.context.obj({Changed:true}));assert.ok(!equal(base,(await pdfPageIdentities(await resolved.save()))[0]));
});

test('Large live PDFs bypass identity parsing and many small rasters remain bounded',async()=>{
 const d=await PDFDocument.create(),p=d.addPage();p.node.set(PDFName.of('Contents'),d.context.register(d.context.stream(new Uint8Array(2*1024*1024))));const bytes=await d.save({useObjectStreams:false});assert.ok(bytes.length>2*1024*1024);assert.deepEqual(await pdfPageIdentities(bytes),[]);
 let closed=0;const cache=new PageRasterCache(1024,2);for(let i=0;i<10;i++)cache.set(new Uint8Array([i]),1,{image:{close(){closed++;}},width:1,height:1});assert.equal(closed,8);assert.equal(cache.get(new Uint8Array([0]),1),undefined);assert.ok(cache.get(new Uint8Array([9]),1));cache.clear();assert.equal(closed,10);
});
