const {test}=require('node:test'),assert=require('node:assert/strict');
const {LocalPreview,paragraphAt}=require('../dist/local-preview');
const source='Before.\n\nTarget text.\n\\FollowingDrawing\n\nAfter.\n\n',root='split-fixture.tex',at=source.indexOf('Target')+7,range=paragraphAt(source,at),split=source.replace('\n\\FollowingDrawing','\n\n\\FollowingDrawing');
const make=()=>{const lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{});lane.lecture=true;lane.continuous=true;return lane;};
test('Only a newly separated first paragraph requests page-context reproof',()=>{
 const lane=make(),slot={pageMode:true,range,basis:{source,bundle:{}}};
 assert.equal(lane.splitPageParagraph(slot,split,at),true);
 assert.equal(lane.splitPageParagraph(slot,source.replace('Target','Target new'),at),false,'Ordinary typing must not create idle full builds');
 assert.equal(lane.splitPageParagraph(slot,source.replace('Target','T'),at-5),false,'Deletion alone does not split the paragraph');
 assert.equal(lane.splitPageParagraph(slot,split,split.indexOf('FollowingDrawing')),false,'The drawing paragraph cannot claim the earlier text boundary');
 for(const extra of [{pageMode:false},{input:{}},{basis:{source,bundle:{recovered:true}}}])assert.equal(lane.splitPageParagraph({...slot,...extra},split,at),false);
 lane.lecture=false;assert.equal(lane.splitPageParagraph(slot,split,at),false);lane.lecture=true;lane.continuous=false;assert.equal(lane.splitPageParagraph(slot,split,at),false);lane.stop();
});
test('A canonical split retires the old page context and re-proves with its verified worker',()=>{
 for(const text of [split,source.replace('Target','Target new')]){
  const lane=make();let stopped=0,scheduled=0,replaced=0;
  const compiler={stop(){stopped++;}},fresh={stop(){}},basis={source,compilerSource:source,bundle:{id:'old'},options:{root},project:{resourceKey:'inputs',environmentKey:'environment'}};
  const slot={basis,sourceText:source,file:root,range,ready:true,pageMode:true,edited:true,latestSource:text,compiler,abort:new AbortController()};
  lane.basis=basis;lane.slot=slot;lane.cursor={file:root,at};lane.schedule=()=>{scheduled++;};lane.rememberVisit=()=>{};
  lane.setBasis({...basis,source:text,compilerSource:text,bundle:{id:'new'},replaceCompiler(old){assert.equal(old,compiler);replaced++;return fresh;}});
  if(text===split){assert.equal(replaced,1);assert.equal(stopped,1);assert.equal(lane.ready,false,'An unproved narrower context must not be ready');assert.equal(lane.warmCompiler,fresh);assert.equal(scheduled,1);}
  else{assert.equal(replaced,0);assert.equal(stopped,0);assert.equal(lane.slot,slot,'Normal typing keeps its warm context');assert.equal(scheduled,0);}
  lane.stop();
 }
});
