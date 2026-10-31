const {test}=require('node:test'),assert=require('node:assert/strict');
const {NeutralBlocks}=require('../dist/neutral-blocks');
test('Neutral block projection retains every other edit and maps offsets',()=>{
 const source='Alpha words.\n\nBeta words.\n\nGamma words.\n\n',a={from:0,to:source.indexOf('Beta')},b={from:source.indexOf('Beta'),to:source.indexOf('Gamma')};
 let blocks=new NeutralBlocks(source);blocks=blocks.proposed(a,'Alpha expanded words.\n\n');
 const at=blocks.actual(b);assert.equal(at.from,b.from+9);const editor=blocks.source().slice(0,at.from)+'Beta changed words.\n\n'+blocks.source().slice(at.to),p=blocks.project(editor,b);assert.ok(p);assert.match(p.source,/Alpha words.*Beta changed/s);assert.doesNotMatch(p.source,/Alpha expanded/);
 blocks=blocks.proposed(b,p.text);assert.equal(blocks.source(),editor);assert.equal(blocks.basePosition(blocks.actual(b).from+2),b.from+2);assert.equal(blocks.project(editor+'outside',b),undefined);
 assert.equal(blocks.editStart(editor),undefined);assert.equal(blocks.editStart(editor.replace('Beta changed','Beta newly changed')),editor.indexOf('changed'));
 assert.equal(blocks.project(editor,{from:1,to:b.to}),undefined,'Overlapping blocks cannot reuse independent contexts');
 const restored=blocks.proposed(a,source.slice(a.from,a.to));assert.equal(restored.dirty.length,1);assert.match(restored.source(),/Alpha words.*Beta changed/s);
});
test('Neutral overlay is bounded and rejects invalid or incomplete substitutions',()=>{
 const source='One.\n\nTwo.\n\nThree.\n\nFour.\n\n';let blocks=new NeutralBlocks(source,2);
 for(const marker of ['One.','Two.']){const from=source.indexOf(marker),to=source.indexOf('\n\n',from)+2;blocks=blocks.proposed({from,to},marker+' extra\n\n');}
 const from=source.indexOf('Three.');assert.equal(blocks.project(blocks.source(),{from,to:from+8}),undefined);assert.equal(blocks.project(blocks.source(),{from:-1,to:4}),undefined);assert.equal(blocks.project('incomplete', {from:0,to:6}),undefined);
});
