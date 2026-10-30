const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceCorrespondence,recoveryNavigation,recoveryLocations}=require('../dist/recovery-navigation'),{forwardPosition,backward,liveFlowPosition}=require('../dist/navigation-query'),{encodeNavigation,decodeNavigation}=require('../dist/navigation-codec');
const root='main.tex',row=(line,y)=>[root,line,1,10,y,80,8],glyph=(line,y)=>[root,line,0,1,10,y,4,8,65,1];
test('Recovery preserves every unchanged line between multiple repairs, with the original source identity',()=>{
 const source='Alpha\n\\broken\nMiddle\n\\oops\nTail',compiled='Alpha\n       \nMiddle\n     \nTail',nav={schema:1,sources:{[root]:'compiled',chapter:'chapter-hash'},regions:[1,2,3,4,5].map(i=>row(i,i*20)).concat([['chapter',2,2,10,10,50,8]]),characters:[1,2,3,4,5].map(i=>glyph(i,i*20))};
 const result=recoveryNavigation(nav,root,source,compiled,'original');assert.deepEqual(result.regions.filter(r=>r[0]===root).map(r=>r[1]),[1,3,5]);assert.deepEqual(result.characters.map(g=>g[1]),[1,3,5]);assert.equal(result.sources[root],'original');assert.equal(result.sources.chapter,'chapter-hash');assert.equal(result.regions.at(-1)[0],'chapter');assert.deepEqual(result.recovery.excluded[root],[2,4]);assert.equal(nav.sources[root],'compiled');assert.equal(nav.regions.length,6);assert.deepEqual(decodeNavigation(encodeNavigation(result)),result);
});
test('Repaired lines cannot fall through to nearby healthy source or preview targets',()=>{
 const source='Alpha\n\\oops\nTail',compiled='Alpha\n     \nTail',result=recoveryNavigation({schema:1,sources:{},regions:[row(1,10),row(2,20),row(3,30)],characters:[glyph(1,10),glyph(2,20),glyph(3,30)]},root,source,compiled,'original');
 assert.equal(forwardPosition(result,'MAIN.TEX',source,source.indexOf('\\oops')),undefined);assert.equal(backward(result,1,15,23),undefined);assert.equal(backward(result,1,15,12)[1],1);assert.equal(forwardPosition(result,root,source,source.indexOf('Tail'))[1],3);
});
test('Length-changing repairs preserve UTF-16 source positions only on byte-for-byte unchanged lines',()=>{
 const source='Bad_thing\nπ 😀 Tail',compiled='Bad\\_thing\nπ 😀 Tail',at=compiled.indexOf('😀'),map=sourceCorrespondence(source,compiled),position=map.position(at,at+2);assert.deepEqual(position,{at:source.indexOf('😀'),end:source.indexOf('😀')+2});assert.equal(map.position(0,3),undefined);assert.equal(map.position(at+.5,at+2),undefined);assert.equal(map.position(at,compiled.length+1),undefined);
 const projected=recoveryLocations([{at:0,end:3,x:10,y:10,width:4,height:8},{at,end:at+2,x:10,y:30,width:4,height:8}],source,compiled);assert.equal(projected.locations.length,1);assert.equal(source.slice(projected.locations[0].at,projected.locations[0].end),'😀');assert.deepEqual(projected.blocked,[{x:10,y:10,width:4,height:8}]);
});
test('Added or removed lines retain only unambiguous matching prefix and suffix lines',()=>{
 const map=sourceCorrespondence('First\nBroken\nLast','First\nInserted\nChanged\nLast');assert.equal(map.lines.get(1),1);assert.equal(map.lines.get(4),3);assert.equal(map.lines.get(2),undefined);assert.deepEqual(map.excluded,[2]);assert.deepEqual(map.position(23,27),{at:13,end:17});
});
test('Local repaired pixels cannot select a nearby healthy glyph and never bypass stale-frame checks',()=>{
 const frame={root,file:root,baseId:'base',sourceHash:'hash',editId:'edit',text:'hello world',from:0,to:11},locations=[{at:0,end:1,x:10,y:10,width:5,height:8}],blocked=[{x:10,y:20,width:5,height:8}];
 assert.equal(liveFlowPosition(frame,frame,locations,12,22,blocked),undefined);assert.equal(liveFlowPosition(frame,frame,locations,12,12,blocked),0);assert.equal(liveFlowPosition(frame,{...frame,editId:'stale'},locations,12,12,blocked),undefined);
});
test('A recovered map cannot turn a native SyncTeX map into an unverified resident map',()=>{
 assert.equal(recoveryNavigation({schema:1,sources:{},regions:[],nativeInputs:{[root]:'captured-input'}},root,'A','B','original'),undefined);
});

test('Repair advice suggests only a unique nearby command and keeps package guidance',()=>{
 const {diagnosticAdvice}=require('../dist/diagnostics');assert.match(diagnosticAdvice('Preview skipped undefined command \\intt.'),/Did you mean \\int\?/);assert.ok(!diagnosticAdvice('Preview skipped undefined command \\inty.').includes('Did you mean'));assert.match(diagnosticAdvice('Undefined control sequence.'),/preamble and support/);assert.match(diagnosticAdvice('Preview temporarily balanced unfinished math or an environment in this paragraph.'),/delimiters/);
});
