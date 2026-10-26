const {test}=require('node:test'),assert=require('node:assert/strict'),{CheckpointPages}=require('../dist/checkpoint-pages');
const block=value=>{const p=Buffer.alloc(65536);p[2048]=value;return p;};
test('Sample collisions never share different blocks and collision chains stay bounded',()=>{
 const pool=new CheckpointPages(),saved=[];
 for(let i=0;i<8;i++){const live=block(i),copy=pool.intern(live);assert.ok(copy);assert.deepEqual(copy,live);saved.push(copy);live[2048]=255;assert.equal(copy[2048],i,'A snapshot must not alias mutable live memory');}
 for(let i=0;i<8;i++)assert.equal(pool.intern(block(i)),saved[i]);
 assert.equal(pool.intern(block(8)),undefined,'A saturated bucket must use the ordinary fallback');
});
test('Allocation cap still permits exact deduplication after saturation',()=>{
 const pool=new CheckpointPages(2*65536),first=pool.intern(block(1)),second=pool.intern(block(2));assert.ok(first&&second);assert.equal(pool.intern(block(3)),undefined);assert.equal(pool.intern(block(1)),first);assert.equal(pool.intern(block(2)),second);
});
