const {test}=require('node:test'),assert=require('node:assert/strict'),{PdfWorkQueue}=require('../dist/pdf-work-queue');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const {pdfWorkPriority}=require('../dist/pdf-work-queue');
test('Live page bands overtake proof and lazy page work while active PDFium calls remain atomic',async()=>{
 const turns=[],q=new PdfWorkQueue(run=>turns.push(run)),order=[];let release;
 const active=q.enqueue(pdfWorkPriority('render',{interactive:true}),async()=>{order.push('active');await new Promise(r=>release=r);});turns.shift()();await turn();
 const proof=q.enqueue(pdfWorkPriority('render',{interactive:true}),async()=>order.push('proof'));
 const lazy=q.enqueue(pdfWorkPriority('render',{}),async()=>order.push('lazy'));
 const band=[1,2,3].map(page=>q.enqueue(pdfWorkPriority('render',{live:true}),async()=>order.push(page)));
 assert.deepEqual(order,['active']);release();await active;await turn();for(let i=0;i<5;i++){turns.shift()();await turn();}await Promise.all([proof,lazy,...band]);assert.deepEqual(order,['active',1,2,3,'proof','lazy']);
});
test('An arriving edit overtakes queued proof work, but never overlaps an active PDFium operation',async()=>{
 const turns=[],queue=new PdfWorkQueue(run=>turns.push(run)),order=[];let release;
 const first=queue.enqueue(1,async()=>{order.push('proof-start');await new Promise(r=>release=r);order.push('proof-end');});
 const second=queue.enqueue(1,async()=>order.push('next-proof'));turns.shift()();await turn();
 const edit=queue.enqueue(0,async()=>order.push('edit'));assert.deepEqual(order,['proof-start']);assert.equal(turns.length,0,'Never start another operation while PDFium is active');
 release();await first;await turn();turns.shift()();await edit;await turn();assert.deepEqual(order,['proof-start','proof-end','edit']);turns.shift()();await second;
 assert.deepEqual(order,['proof-start','proof-end','edit','next-proof']);
});
test('A burst is collected before execution; peers retain FIFO order and a rejected job cannot stall cleanup',async()=>{
 const turns=[],queue=new PdfWorkQueue(run=>turns.push(run)),order=[];
 const a=queue.enqueue(1,async()=>order.push('load'));
 const b=queue.enqueue(1,async()=>{order.push('broken-proof');throw Error('Invalid PDF');});const rejected=assert.rejects(b,/Invalid PDF/);
 const c=queue.enqueue(1,async()=>order.push('close'));
 const edit=queue.enqueue(0,async()=>order.push('edit'));
 assert.deepEqual(order,[],'Give the worker event loop a turn before choosing a queued request');
 for(let i=0;i<4;i++){turns.shift()();await turn();}
 await Promise.all([a,rejected,c,edit]);assert.deepEqual(order,['edit','load','broken-proof','close']);
});
