const {test}=require('node:test'),assert=require('node:assert/strict');
const {flowLocations,cursorPosition,paragraphPages}=require('../dist/region-compositor');
const transcript=(tag,x=10)=>JSON.stringify({glyph:[tag+'.tex',1,0,1,x,20,6,10,65,1]})+'\n';
const locations=(raw,tag)=>flowLocations(raw,'A\n',tag,1,0,2);

test('Repeated navigation reuses complete transcripts without carrying positions across revisions',()=>{
 const tag='exact-cache-revision',a=transcript(tag),b=transcript(tag,80),parse=JSON.parse;let reads=0;
 JSON.parse=(...args)=>{reads++;return parse(...args);};
 try{
  assert.equal(locations(a,tag)[0].x,10);const afterFirst=reads;
  const rows=locations(a,tag);rows[0].x=999;
  assert.equal(cursorPosition(a,'A\n',0,tag,{first:1,last:1}).x,10);
  assert.equal(reads,afterFirst,'An unchanged transcript should not be reparsed');
  assert.equal(locations(b,tag)[0].x,80);assert.ok(reads>afterFirst);
  assert.equal(locations(a,tag)[0].x,10);
  assert.deepEqual(flowLocations(a,'A\n',tag,2,0,2),[],'Page filtering must remain exact');
  assert.deepEqual(locations(a,'another-file'),[],'Source identity must remain exact');
 }finally{JSON.parse=parse;}
});

test('Navigation cache evicts old transcripts and bypasses oversized inputs',()=>{
 const tag='bounded-cache-entry',a=transcript(tag),parse=JSON.parse;let reads=0;
 JSON.parse=(...args)=>{reads++;return parse(...args);};
 try{
  locations(a,tag);
  for(let i=0;i<5;i++)locations(transcript(tag+'-'+i),tag+'-'+i);
  const before=reads;assert.equal(locations(a,tag)[0].x,10);assert.ok(reads>before,'Evicted data must be parsed again');
  const large=transcript(tag)+'\n'+JSON.stringify({note:'x'.repeat(2000001)});
  locations(large,tag);const first=reads;locations(large,tag);assert.ok(reads>first,'Oversized data must not be retained');
  const padded=i=>transcript(tag+'-budget-'+i)+'\n'+JSON.stringify({note:'x'.repeat(1400000)}),budgetA=padded(0);
  locations(budgetA,tag+'-budget-0');locations(padded(1),tag+'-budget-1');locations(padded(2),tag+'-budget-2');
  const budgetReads=reads;locations(budgetA,tag+'-budget-0');assert.ok(reads>budgetReads,'Combined text budget must evict entries before the count limit');
  assert.throws(()=>locations(a+'invalid-json',tag));assert.equal(locations(a,tag)[0].x,10,'A failed parse cannot poison a valid entry');
 }finally{JSON.parse=parse;}
});

test('Cached anchor indexes retain ambiguity and exact transcript checks',()=>{
 const tag='anchor-cache',row=[tag+'.tex',1,0,2,10,20,6,10,65,1],raw=JSON.stringify({glyph:row})+'\n';
 const original={fragment:{page:1},navigation:JSON.stringify({glyph:[...row.slice(0,3),1,...row.slice(4)]})+'\n'};
 for(let i=0;i<3;i++)assert.deepEqual(paragraphPages(raw,original),{first:2,last:2});
 const duplicate=raw+JSON.stringify({glyph:[...row.slice(0,3),3,...row.slice(4)]})+'\n';
 for(let i=0;i<2;i++)assert.throws(()=>paragraphPages(duplicate,original),/ambiguous/);
 assert.deepEqual(paragraphPages(raw,original),{first:2,last:2});
 assert.throws(()=>paragraphPages(transcript('different-anchor'),original),/ambiguous/);
});
