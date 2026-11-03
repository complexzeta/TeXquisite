const {test}=require('node:test'),assert=require('node:assert/strict');
const {LocalPreview,paragraphAt,followingParagraphWindow}=require('../dist/local-preview');
const source='Before.\n\nFirst paragraph.\n\nSecond paragraph.\n\nAfter.\n\n',root='window.tex',range=paragraphAt(source,source.indexOf('First')),joined=source.replace('paragraph.\n\nSecond','paragraph.\nSecond'),window={from:range.from,to:source.indexOf('After')};
test('Boundary window selects just the immediate neighbor with exact outside source',()=>{
 assert.deepEqual(followingParagraphWindow(source,joined,range),window);
 for(const text of [joined.replace('Before','Changed'),joined.replace('After','Changed'),joined.replace('\n\nAfter','\nAfter')])assert.equal(followingParagraphWindow(source,text,range),undefined);
 assert.equal(followingParagraphWindow(source,joined.replace('After.\n\n','After.\n'),range),undefined);
 const picture=source.replace('Second paragraph.','\\begin{tikzpicture}x\\end{tikzpicture}');assert.equal(followingParagraphWindow(picture,picture.replace('paragraph.\n\n','paragraph.\n'),range),undefined);
 const big=source.replace('Second paragraph.','x'.repeat(1200));assert.equal(followingParagraphWindow(big,big.replace('paragraph.\n\n','paragraph.\n'),range),undefined);
});
test('Joining paragraphs queues on the existing worker and coalesces newer edits during preparation',()=>{
 const prior=process.env.PERSISTENT_TEX_BOUNDARY_WINDOW;process.env.PERSISTENT_TEX_BOUNDARY_WINDOW='1';
 let stopped=0,scheduled=0,returned=0;const compiler={initialized:true,busy:false,stop(){stopped++;}},basis={source,compilerSource:source,bundle:{id:'base'},options:{root},project:{},returnCompiler(){returned++;return true;}};
 const lane=new LocalPreview(async()=>true,async()=>true,()=>assert.fail('No full fallback while queuing'),()=>{},()=>{});
 lane.lecture=true;lane.continuous=true;lane.basis=basis;lane.cursor={file:root,at:range.to-1};lane.schedule=()=>{scheduled++;};lane.slot={basis,range,liveEnd:range.to,compiledRange:range,sourceText:source,file:root,compiler,ready:true,abort:new AbortController()};
 try{
  assert.equal(lane.request(root,joined,'join-1'),true);assert.equal(stopped,0);assert.equal(returned,0);assert.equal(lane.warmCompiler,compiler);assert.deepEqual(lane.boundaryWindow.range,window);assert.equal(scheduled,1);
  const newer=joined.replace('Second','Second edited');assert.equal(lane.request(root,newer,'join-2'),true);assert.equal(lane.pending.editId,'join-2');assert.equal(scheduled,1,'New keys must not restart preparation');
  assert.equal(lane.request(root,newer.replace('Before','Changed'),'outside'),false);assert.equal(lane.boundaryWindow,undefined);assert.equal(returned,1,'Outside edits return the warm compiler for normal full work');
 }finally{lane.stop();if(prior===undefined)delete process.env.PERSISTENT_TEX_BOUNDARY_WINDOW;else process.env.PERSISTENT_TEX_BOUNDARY_WINDOW=prior;}
});
test('The widened context requires a complete page proof, retains the worker, and skips paragraph composition',async()=>{
 const {PDFDocument}=require('pdf-lib'),doc=await PDFDocument.create();doc.addPage([100,100]);const pdf=await doc.save();
 for(const accepted of [true,false]){
  let prepared=0,proved=0,composed=0,published=0;const compiler={initialized:true,busy:false,prepareRegion:async(text,r)=>{prepared++;assert.equal(text,source);assert.deepEqual(r,window);return{regionKey:'wide',navigation:JSON.stringify({glyph:['main.tex',3,0,1,10,10,5,8,65]})};},previewRegionFlow:async()=>{composed++;assert.fail('Boundary preparation must use page output');},previewRegionPage:async(text,r)=>{assert.equal(text,source);assert.deepEqual(r,window);return{pdf,pageSpan:{first:1,last:1},timing:{}};},useRegion(){},prepareNextRegionEdit(){},stop(){}};
  const basis={source,compilerSource:source,pdf,bundle:{id:'base'},options:{root},project:{jobName:'main'},returnCompiler:()=>true};
  const lane=new LocalPreview(async()=>true,async()=>{published++;return true;},()=>{},()=>{},()=>{},async()=>{proved++;return accepted;});lane.lecture=true;lane.continuous=true;lane.basis=basis;lane.cursor={file:root,at:range.to-1};lane.warmCompiler=compiler;lane.boundaryWindow={file:root,baseId:'base',range:window};
  try{await lane.arm();assert.equal(prepared,1);assert.equal(proved,1);assert.equal(composed,0);assert.equal(published,0);assert.equal(lane.ready,accepted);if(accepted){assert.equal(lane.slot.compiler,compiler);assert.equal(lane.slot.boundaryWindow,true);assert.equal(lane.slot.pageReady,true);assert.equal(lane.splitPageParagraph(lane.slot,source,range.from+1),false);}}
  finally{lane.stop();}
 }
});
