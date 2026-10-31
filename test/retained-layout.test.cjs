const {test}=require('node:test'),assert=require('node:assert/strict');
const {RetainedLayout,retainedStateCompatible}=require('../dist/retained-layout');
test('Height changes require all existing native state witnesses; math is not guessed safe',()=>{
 const a={neutralCharacters:true,neutralWriteFree:true,stateHash:'table',flowStateHash:'flow',widthSp:100,paddingSp:5,heightSp:50,depthSp:2,shape:[],lines:1,page:1};
 assert.equal(retainedStateCompatible(a,{...a,heightSp:1000,depthSp:9,lines:30}),true);
 for(const change of [{neutralCharacters:false},{neutralWriteFree:false},{lectureSideEffects:true},{stateHash:'other'},{stateHash:''},{flowStateHash:'other'},{flowStateHash:undefined},{widthSp:101},{paddingSp:6}]){assert.equal(retainedStateCompatible(a,{...a,...change}),false);assert.equal(retainedStateCompatible({...a,...change},a),false);}
});
test('Resized independent paragraphs shift following material without repagination',()=>{
 const base=new RetainedLayout(1000),a=base.updated({id:'a',from:100,to:200,height:700}),b=a.updated({id:'b',from:300,to:400,height:20});
 assert.equal(base.height,1000);assert.equal(a.height,1600);assert.equal(b.height,1520);
 assert.deepEqual(b.slices.map(s=>[s.id,s.top,s.bottom]),[['a',100,800],['b',900,920]]);
 assert.equal(b.forward(250),850);assert.equal(b.forward(150),undefined);assert.equal(b.forward(650,'a'),750);assert.deepEqual(b.inverse(910),{id:'b',y:10});assert.deepEqual(b.inverse(1000),{y:480});
 const revisit=b.updated({id:'a',from:100,to:200,height:30});assert.equal(revisit.slices[1].top,230);assert.equal(revisit.forward(450),300);assert.equal(b.slices[1].top,900);assert.equal(revisit.removed('a').forward(250),250);
});
test('Every retained or unchanged coordinate round trips after multiple height changes',()=>{
 let layout=new RetainedLayout(600);for(const s of [{id:'c',from:400,to:500,height:55},{id:'a',from:20,to:100,height:140},{id:'b',from:200,to:260,height:10}])layout=layout.updated(s);
 for(let y=0;y<layout.height;y++){const p=layout.inverse(y);assert.equal(layout.forward(p.y,p.id),y);}
 assert.equal(layout.inverse(NaN),undefined);assert.equal(layout.inverse(layout.height),undefined);assert.equal(layout.forward(-1),undefined);assert.equal(layout.forward(10,'missing'),undefined);
});
test('Invalid footprints and excessive block counts are rejected without mutating accepted layout',()=>{
 const layout=new RetainedLayout(100,[],2).updated({id:'a',from:10,to:30,height:15});
 for(const slice of [{id:'a',from:11,to:30,height:15},{id:'b',from:20,to:40,height:15},{id:'b',from:40,to:101,height:15},{id:'b',from:40,to:50,height:0},{id:'b',from:40,to:50,height:NaN},{id:'b',from:40.1,to:50,height:10}])assert.throws(()=>layout.updated(slice));
 assert.throws(()=>layout.updated({id:'b',from:40,to:50,height:10}).updated({id:'c',from:60,to:70,height:10}));assert.equal(layout.height,95);assert.equal(layout.slices.length,1);
});
