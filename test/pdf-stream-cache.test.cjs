const {test}=require('node:test'),assert=require('node:assert/strict'),{inflateSync,deflateSync}=require('node:zlib');
const {PdfStreamCache}=require('../dist/pdf-stream-cache');

test('PDF stream reuse owns restored heap bytes and respects compression levels and bounded eviction',()=>{
 const cache=new PdfStreamCache(4096,2),heap=Buffer.from('Original font stream '.repeat(20)),original=Buffer.from(heap);
 const first=cache.compress(heap,9);heap.fill(65);
 assert.deepEqual(inflateSync(first),original);assert.deepEqual(inflateSync(cache.compress(heap,9)),heap);
 const before=cache.hits;assert.equal(cache.compress(original,9),first);assert.equal(cache.hits,before+1);
 assert.deepEqual(cache.compress(original,1),deflateSync(original,{level:1}));
 const misses=cache.misses;cache.compress(heap,9);assert.equal(cache.misses,misses+1,'Least recently used stream must have been evicted');
 for(let i=0;i<30;i++)cache.compress(Buffer.from(String(i).repeat(100)),6);
 assert.ok(cache.retainedBytes<=4096);cache.resetTiming();assert.equal(cache.hits,0);assert.equal(cache.misses,0);
 const tiny=new PdfStreamCache(1,1);tiny.compress(original,9);tiny.compress(original,9);assert.equal(tiny.retainedBytes,0);assert.equal(tiny.hits,0);
});
