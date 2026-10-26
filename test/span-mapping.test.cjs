const {test}=require('node:test'),assert=require('node:assert/strict');const {paragraphPages,cursorPage,cursorPosition}=require('../dist/region-compositor');
const row=(column,page,code=120,line=1)=>({glyph:['main.tex',line,column,page,10,10,5,7,code,1]}),raw=rows=>rows.map(r=>JSON.stringify(r)).join('\n');
test('Paragraph page spans require unambiguous anchors; cursor pages use UTF-8 source columns',()=>{
 const navigation=raw([row(0,1),row(2,2)]),original={fragment:{page:3},navigation:raw([row(0,3),row(2,3)])};assert.deepEqual(paragraphPages(navigation,original),{first:1,last:2});assert.throws(()=>paragraphPages(navigation+'\n'+raw([row(0,1)]),original),/ambiguous/);
 assert.equal(cursorPage(navigation,'éx',1,'main',{first:1,last:2}),2);assert.equal(cursorPage(navigation,'éx',0,'main',{first:1,last:2}),1);assert.equal(cursorPage(raw([row(2,1),row(2,2)]),'éx',1,'main',{first:1,last:2}),undefined);assert.equal(cursorPage(navigation,'éx',1,'included',{first:1,last:2}),undefined);
});
test('Affected-page follow positions retain the exact glyph box and reject ambiguous pages',()=>{
 const navigation=raw([row(0,1),{glyph:['main.tex',1,2,2,40,90,6,8,120,1]}]);
 assert.deepEqual(cursorPosition(navigation,'éx',1,'main',{first:1,last:2}),{page:2,x:40,y:90,width:6,height:8});
 assert.equal(cursorPosition(raw([row(2,1),row(2,2)]),'éx',1,'main',{first:1,last:2}),undefined);
});
