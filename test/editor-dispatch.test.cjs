const {test}=require('node:test'),assert=require('node:assert/strict'),{queueEditorEdit}=require('../dist/editor-dispatch');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('A fast edit and reversal both reach the backend while the first RPC is delayed',async()=>{
 const sent=new Map([['main','A']]),pending=new Map(),gate=deferred(),calls=[];
 const first=queueEditorEdit('main','B',sent,pending,Promise.resolve(),async()=>{calls.push('B');await gate.promise;});
 const second=queueEditorEdit('main','A',sent,pending,first,async()=>{calls.push('A');});
 await Promise.resolve();gate.resolve();await second;assert.deepEqual(calls,['B','A']);assert.equal(sent.get('main'),'A');assert.equal(pending.size,0);
});
test('An older acknowledgement cannot discard a newer queued revision or send its duplicate twice',async()=>{
 const sent=new Map([['main','A']]),pending=new Map(),gate=deferred(),calls=[];
 const first=queueEditorEdit('main','B',sent,pending,Promise.resolve(),async()=>{calls.push('B');});
 const second=queueEditorEdit('main','C',sent,pending,first,async()=>{calls.push('C');await gate.promise;});
 await first;assert.equal(pending.get('main').text,'C');const duplicate=queueEditorEdit('main','C',sent,pending,second,async()=>{calls.push('duplicate');});assert.equal(duplicate,second);gate.resolve();await duplicate;assert.deepEqual(calls,['B','C']);
});
test('A failed edit can be retried even when it restores the formerly acknowledged text',async()=>{
 const sent=new Map([['main','A']]),pending=new Map();const failed=queueEditorEdit('main','B',sent,pending,Promise.resolve(),async()=>{throw Error('interrupted');});await assert.rejects(failed,/interrupted/);let retried=false;
 await queueEditorEdit('main','A',sent,pending,failed,async()=>{retried=true;});assert.equal(retried,true);assert.equal(sent.get('main'),'A');
});
