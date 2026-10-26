const {test}=require('node:test'),assert=require('node:assert/strict');
const {BaselineCache}=require('../dist/baseline-cache');
function fixture(maxPages=3,maxBytes=64){
 const loads=[],closed=[],rendered=[],disposed=[];
 const cache=new BaselineCache(bytes=>{const doc={id:loads.length,bytes};loads.push(doc);return {promise:Promise.resolve(doc),destroy:async()=>{closed.push(doc.id);}};},f=>f.bytes,f=>disposed.push(f.key),maxPages,maxBytes);
 const render=async(doc,page)=>{const key=doc.id+':'+page;rendered.push(key);return {key,bytes:16};};
 return {cache,loads,closed,rendered,disposed,render};
}
test('Accepted pages are reused, and held images survive document or zoom invalidation',async()=>{
 const f=fixture(),lease=f.cache.acquire('root:bundle:zoom1',new Uint8Array([1]),f.render),a=await lease.page(1),b=await lease.page(1);
 assert.equal(a.value,b.value);assert.equal(f.rendered.length,1);b.release();lease.release();
 const next=f.cache.acquire('root:bundle:zoom2',new Uint8Array([1]),f.render),c=await next.page(1);assert.notEqual(c.value,a.value);assert.deepEqual(f.closed,[],'Old PDF must remain alive while its page is borrowed');
 a.release();a.release();assert.deepEqual(f.closed,[0]);assert.deepEqual(f.disposed,['0:1']);c.release();next.release();f.cache.clear();assert.deepEqual(f.closed,[0,1]);
});
test('Raster cache evicts unheld pages by memory and page budgets without disposing a held proof',async()=>{
 const f=fixture(2,32),lease=f.cache.acquire('root:bundle:zoom1',new Uint8Array([1]),f.render),held=await lease.page(1);
 for(const page of [2,3,4]){const frame=await lease.page(page);frame.release();}
 assert.ok(!f.disposed.includes('0:1'));assert.ok(f.disposed.includes('0:2'));assert.ok(f.disposed.includes('0:3'));
 const again=await lease.page(1);assert.equal(again.value,held.value);again.release();held.release();lease.release();f.cache.clear();assert.equal(new Set(f.disposed).size,4);assert.deepEqual(f.closed,[0]);
});
test('Continuous view retains its proven PDF independently of a released page or a newer full build',async()=>{
 const f=fixture(),lease=f.cache.acquire('old',new Uint8Array([1]),f.render),page=await lease.page(1);lease.release();
 const retained=lease.retain();f.cache.clear();page.release();assert.deepEqual(f.closed,[]);assert.equal((await retained.document).id,0);
 const next=f.cache.acquire('new',new Uint8Array([2]),f.render);await next.document;next.release();f.cache.clear();assert.deepEqual(f.closed,[1]);
 retained.release();retained.release();assert.deepEqual(f.closed,[1,0]);assert.throws(()=>lease.retain(),/closed/);
});
test('Invalidation during an asynchronous render defers cleanup; failed renders can retry',async()=>{
 const f=fixture();let resolve;const waiting=new Promise(r=>resolve=r),lease=f.cache.acquire('old',new Uint8Array([1]),async()=>waiting),pending=lease.page(1);
 f.cache.clear();lease.release();assert.deepEqual(f.closed,[]);resolve({key:'pending',bytes:16});const frame=await pending;assert.deepEqual(f.closed,[]);frame.release();assert.deepEqual(f.closed,[0]);assert.deepEqual(f.disposed,['pending']);
 let calls=0;const retry=f.cache.acquire('next',new Uint8Array([2]),async()=>{if(++calls===1)throw new Error('failed render');return {key:'repaired',bytes:16};});
 await assert.rejects(retry.page(1),/failed render/);const repaired=await retry.page(1);assert.equal(repaired.value.key,'repaired');repaired.release();retry.release();f.cache.clear();
});
