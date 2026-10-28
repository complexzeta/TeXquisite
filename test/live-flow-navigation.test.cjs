const {test}=require('node:test'),assert=require('node:assert/strict'),{liveFlowPosition}=require('../dist/navigation-query');
const frame={root:'main.tex',file:'chapter.tex',baseId:'basis',sourceHash:'source',editId:'edit',text:'0123456789abcdef',from:4,to:12},current={...frame},glyphs=[{at:5,end:7,x:10,y:20,width:8,height:10}];
test('Live inverse navigation requires the exact displayed root, file, source and frame',()=>{
 assert.equal(liveFlowPosition(frame,current,glyphs,11,22),5);
 for(const key of ['root','file','baseId','sourceHash','editId','text'])assert.equal(liveFlowPosition(frame,{...current,[key]:'different'},glyphs,11,22),undefined,key);
 for(const key of ['root','file','baseId','sourceHash','editId'])assert.equal(liveFlowPosition({...frame,[key]:''},current,glyphs,11,22),undefined,key);
});
test('Live inverse navigation uses proved source intervals and bounded finite glyph geometry',()=>{
 assert.equal(liveFlowPosition(frame,current,glyphs,17,22),7);
 for(const point of [[100,100],[NaN,20],[12,Infinity]])assert.equal(liveFlowPosition(frame,current,glyphs,...point),undefined);
 for(const change of [{at:3},{end:13},{end:5},{at:5.5},{x:NaN},{width:0},{height:-1}])assert.equal(liveFlowPosition(frame,current,[{...glyphs[0],...change}],11,22),undefined);
 for(const change of [{from:-1},{from:12},{to:17},{to:4}])assert.equal(liveFlowPosition({...frame,...change},current,glyphs,11,22),undefined);
 assert.equal(liveFlowPosition(frame,current,[],11,22),undefined);
});
