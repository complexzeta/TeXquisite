const {test}=require('node:test'),assert=require('node:assert/strict');
const {LocalPreview,paragraphAt,flowWindowAt}=require('../dist/local-preview'),{ResidentCompiler}=require('../dist/resident');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<1000;i++){if(check())return;await delay(10);}throw Error('Timed out waiting for local state');}

test('Forward flow windows include only the next complete paragraph within the size bound',()=>{
 const source='First.\n\n\nSecond.\n\nThird.\n\n';assert.deepEqual(flowWindowAt(source,2),{from:0,to:source.indexOf('Third')});
 assert.deepEqual(flowWindowAt('First.\n\nUnterminated',2),paragraphAt('First.\n\nUnterminated',2));
 const large='x'.repeat(760)+'\n\nSecond.\n\n';assert.deepEqual(flowWindowAt(large,2),paragraphAt(large,2));
 assert.equal(flowWindowAt(source,-1),undefined);
});

async function lane(t,verify=async()=>true,publish=async()=>{}){
 const compiler=new ResidentCompiler(),prefix='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\n',body='Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n\nDelta paragraph.\n\nEpsilon paragraph.\n\n',source=prefix+body+'\\newpage\nTail.\n\\end{document}\n',project={characterMapping:true},range=paragraphAt(source,source.indexOf('Alpha'));
 const base=await compiler.prepareRegion(source,range,new AbortController().signal,60000,()=>{},project);let borrowed=false;const messages=[],frames=[],fallbacks=[];
 const local=new LocalPreview(verify,async c=>{frames.push(c);await publish(c);return true;},id=>fallbacks.push(id),()=>{},m=>messages.push(m));t.after(()=>{local.stop();compiler.stop();});
 local.setContinuous(true);local.setBasis({source,compilerSource:source,pdf:base.pdf,project,bundle:{id:'baseline'},options:{root:'main.tex'},takeCompiler:()=>borrowed?undefined:(borrowed=true,compiler)});local.move('main.tex',source.indexOf('Alpha')+3);await until(()=>local.ready);
 return {local,compiler,messages,frames,fallbacks,source};
}

test('Failed adjacent proof narrows on the same warm worker and accepts the next edit',{timeout:30000},async t=>{
 let first=true,release;const held=new Promise(r=>release=r);const p=await lane(t,async()=>{if(first){first=false;setTimeout(()=>release(),50);await held;return false;}return true;});
 assert.ok(p.messages.some(m=>m.startsWith('Adjacent-paragraph preparation narrowed:')));assert.equal(p.local.slot.range.to,paragraphAt(p.source,p.source.indexOf('Alpha')).to);assert.ok(p.compiler.initialized);
 const worker=p.compiler.worker,text=p.source.replace('Alpha paragraph','Alpha changed paragraph');assert.equal(p.local.request('main.tex',text,'narrow'),true);await until(()=>p.frames.length>0);assert.equal(p.frames[0].sourceHash,require('node:crypto').createHash('sha256').update(text).digest('hex'));assert.equal(p.compiler.worker,worker);assert.deepEqual(p.fallbacks,[]);
});

test('A cursor move during a real worker RPC retains the worker and hands off after completion',{timeout:30000},async t=>{
 const p=await lane(t),worker=p.compiler.worker,post=worker.postMessage.bind(worker);let held=false;
 worker.postMessage=(message,...args)=>{if(!held&&message.region?.action==='flow'){held=true;setTimeout(()=>post(message,...args),200);return;}return post(message,...args);};
 assert.equal(p.local.request('main.tex',p.source,'obsolete'),true);await until(()=>held);p.local.move('main.tex',p.source.indexOf('Delta')+3);await until(()=>p.local.ready);
 assert.equal(p.local.slot.compiler,p.compiler);assert.equal(p.compiler.worker,worker,'Cursor handoff must not destroy the warm compiler');assert.ok(p.messages.filter(m=>m.startsWith('Local preparation: ')).every(m=>JSON.parse(m.split('Local preparation: ')[1]).reusedBaseline));assert.ok(!p.frames.some(f=>f.editId==='obsolete'),'Obsolete RPC must not publish after moving');assert.deepEqual(p.fallbacks,[]);
 const next=p.source.replace('Delta paragraph','Delta changed paragraph');p.local.request('main.tex',next,'current');await until(()=>p.frames.some(f=>f.editId==='current'));assert.equal(p.compiler.worker,worker);
});

test('The caret at the next block start prepares that block instead of claiming old readiness',{timeout:30000},async t=>{
 const p=await lane(t),end=p.local.slot.liveEnd,worker=p.compiler.worker;
 p.local.move('main.tex',end);assert.equal(p.local.ready,false);await until(()=>p.local.ready);
 assert.equal(p.local.slot.range.from,end);assert.equal(p.compiler.worker,worker);
});


test('An old publication finishing while the next proof waits cannot consume the queued new edit',{timeout:30000},async t=>{
 let proofs=0,releaseProof,releasePublish,proofWaiting=false,publishWaiting=false;
 const proofGate=new Promise(r=>releaseProof=r),publishGate=new Promise(r=>releasePublish=r);
 const p=await lane(t,async()=>{if(++proofs===2){proofWaiting=true;await proofGate;}return true;},async c=>{if(c.editId==='old'){publishWaiting=true;await publishGate;}});
 p.local.request('main.tex',p.source,'old');await until(()=>publishWaiting);p.local.move('main.tex',p.source.indexOf('Delta')+3);await until(()=>proofWaiting);
 const next=p.source.replace('Delta paragraph','Delta queued paragraph');assert.equal(p.local.request('main.tex',next,'queued'),true);releasePublish();await until(()=>!p.local.running);
 assert.equal(p.local.pending?.editId,'queued','Warming input must survive the old drain finishing');releaseProof();await until(()=>p.frames.some(f=>f.editId==='queued'));assert.deepEqual(p.fallbacks,[]);
});


test('The first keystroke after a cursor move queues before preparation starts',{timeout:30000},async t=>{
 const p=await lane(t),worker=p.compiler.worker,at=p.source.indexOf('Delta')+3;
 p.local.move('main.tex',at);assert.equal(p.local.slot,undefined);
 const next=p.source.slice(0,at)+'z'+p.source.slice(at);p.local.move('main.tex',at+1,true);
 assert.equal(p.local.request('main.tex',next,'immediate'),true);
 await until(()=>p.frames.some(f=>f.editId==='immediate'));
 assert.equal(p.compiler.worker,worker);assert.deepEqual(p.fallbacks,[]);assert.equal(p.local.slot.liveEnd,p.local.slot.range.to+1);
 assert.equal(p.frames.find(f=>f.editId==='immediate').sourceHash,require('node:crypto').createHash('sha256').update(next).digest('hex'));
});

test('Queued preparation rejects edits outside its prospective paragraph and other files',{timeout:30000},async t=>{
 const p=await lane(t),at=p.source.indexOf('Delta')+3;p.local.move('main.tex',at);
 assert.equal(p.local.request('chapter.tex',p.source,'other-file'),false);
 assert.equal(p.local.request('main.tex','% outside\n'+p.source,'outside'),false);
 assert.equal(p.local.pending,undefined);
});


test('An edit needing full verification returns the idle warm engine instead of destroying it',{timeout:30000},async t=>{
 const p=await lane(t),worker=p.compiler.worker;let returned;
 p.local.basis.returnCompiler=compiler=>{returned=compiler;return !compiler.busy;};
 const at=p.source.indexOf('Delta')+3;p.local.move('main.tex',at);
 assert.equal(p.local.request('main.tex',p.source.replace('Alpha','Changed Alpha'),'broader'),false);
 assert.equal(returned,p.compiler);assert.equal(p.compiler.worker,worker);assert.equal(p.local.warmCompiler,undefined);
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(p.local.slot,undefined,'A returned engine must not also be scheduled locally');
});

test('Visited verified paragraphs activate immediately without repeated preparation',{timeout:30000},async t=>{
 const p=await lane(t),alpha=p.local.slot,worker=p.compiler.worker;p.local.move('main.tex',p.source.indexOf('Delta')+3);await until(()=>p.local.ready);const count=p.messages.filter(m=>m.startsWith('Local preparation: ')).length;
 p.local.move('main.tex',p.source.indexOf('Alpha')+3);assert.equal(p.local.ready,true);assert.equal(p.local.slot,alpha);assert.equal(p.messages.filter(m=>m.startsWith('Local preparation: ')).length,count);assert.equal(p.compiler.worker,worker);
 const next=p.source.replace('Alpha paragraph','Alpha cached paragraph');p.local.request('main.tex',next,'cached');await until(()=>p.frames.some(f=>f.editId==='cached'));assert.deepEqual(p.fallbacks,[]);
});
test('Idle neighbor preparation stays bounded and a move uses its proved slot',{timeout:30000},async t=>{
 const p=await lane(t),worker=p.compiler.worker;await until(()=>p.messages.includes('Local neighbor prepared.\n'));const cached=p.local.parked.find(s=>s.range.from===p.source.indexOf('Gamma'));assert.ok(cached);assert.ok(p.local.parked.length<=3);
 p.local.move('main.tex',p.source.indexOf('Gamma')+3);assert.equal(p.local.ready,true);assert.equal(p.local.slot,cached);const next=p.source.replace('Gamma paragraph','Gamma neighbor paragraph');p.local.request('main.tex',next,'neighbor');await until(()=>p.frames.some(f=>f.editId==='neighbor'));assert.equal(p.compiler.worker,worker);assert.deepEqual(p.fallbacks,[]);
});
test('Typing interrupts a held neighbor proof without publishing or losing the active region',{timeout:30000},async t=>{
 let proofs=0,release,held=false;const gate=new Promise(r=>release=r),p=await lane(t,async()=>{if(++proofs===2){held=true;await gate;}return true;});await until(()=>held);const active=p.local.slot;
 const next=p.source.replace('Alpha paragraph','Alpha interrupted paragraph');assert.equal(p.local.request('main.tex',next,'typing'),true);await until(()=>p.frames.some(f=>f.editId==='typing'));release();assert.equal(p.local.slot,active);assert.deepEqual(p.fallbacks,[]);assert.equal(p.local.parked.length,0);
});
test('Refresh and a new verified basis invalidate parked raster proofs',{timeout:30000},async t=>{
 const p=await lane(t);p.local.move('main.tex',p.source.indexOf('Delta')+3);await until(()=>p.local.ready);assert.ok(p.local.parked.length);p.local.refresh();assert.equal(p.local.parked.length,0);await until(()=>p.local.ready);p.local.move('main.tex',p.source.indexOf('Alpha')+3);await until(()=>p.local.ready);assert.ok(p.local.parked.length);p.local.setBasis({...p.local.basis,bundle:{id:'next-baseline'}});assert.equal(p.local.parked.length,0);
});

// These handoff checks initialize two independent engines. Their setup deadline
// is separate from the warm edit-to-preview measurements in lecture-mode-test.
test('Idle rebasing adopts only the new verified compiler and retires the obsolete local worker',{timeout:60000},async t=>{
 const p=await lane(t),fresh=new ResidentCompiler();t.after(()=>fresh.stop());const next=p.source.replace('Alpha paragraph','Alpha verified paragraph'),base=await fresh.prepareRegion(next,paragraphAt(next,next.indexOf('Alpha')),new AbortController().signal,30000,()=>{},{characterMapping:true});let taken=false;
 p.local.setBasis({...p.local.basis,source:next,compilerSource:next,pdf:base.pdf,bundle:{id:'verified-revision'},takeCompiler:()=>taken?undefined:(taken=true,fresh)});await until(()=>p.local.ready&&p.local.slot.compiler===fresh);
 assert.equal(p.compiler.initialized,false);assert.equal(p.local.slot.basis.bundle.id,'verified-revision');assert.ok(p.messages.includes('Local preparation adopted the verified revision.\n'));assert.deepEqual(p.fallbacks,[]);
});

test('Speculative failures skip page fallback and leave the active lane ready',{timeout:30000},async t=>{
 let proofs=0;const p=await lane(t,async()=>++proofs===1);p.local.verifyPages=async()=>{throw Error('Speculation must not request page output');};await until(()=>p.messages.some(m=>m.startsWith('Neighbor preparation skipped:')));assert.equal(p.local.ready,true);assert.equal(p.local.busy,false);assert.equal(p.local.parked.length,0);const next=p.source.replace('Alpha paragraph','Alpha still ready paragraph');p.local.request('main.tex',next,'after-skip');assert.equal(p.local.busy,true);await until(()=>p.frames.some(f=>f.editId==='after-skip'));assert.deepEqual(p.fallbacks,[]);
});

test('Moving during speculative native work retains the already proved active paragraph',{timeout:30000},async t=>{
 const p=await lane(t),alpha=p.local.slot,worker=p.compiler.worker,post=worker.postMessage.bind(worker);let held=false,release;const gate=new Promise(r=>release=r);
 worker.postMessage=(message,...args)=>{if(!held&&message.region?.idle){held=true;gate.then(()=>post(message,...args));return;}return post(message,...args);};
 await until(()=>held);p.local.move('main.tex',p.source.indexOf('Delta')+3);assert.ok(p.local.parked.includes(alpha),'A speculative request cannot discard a completed active proof');release();await until(()=>p.local.ready);p.local.move('main.tex',p.source.indexOf('Alpha')+3);assert.equal(p.local.ready,true);assert.equal(p.local.slot,alpha);assert.deepEqual(p.fallbacks,[]);
});


test('Recently visited distant paragraphs are re-proved on the verified revision before returning',{timeout:60000},async t=>{
 const p=await lane(t);p.local.move('main.tex',p.source.indexOf('Delta')+3);await until(()=>p.local.ready);p.local.move('main.tex',p.source.indexOf('Alpha')+3);await until(()=>p.local.ready);
 const next=p.source.replace('Alpha paragraph','Alpha revised paragraph');p.local.request('main.tex',next,'revise');await until(()=>p.frames.some(f=>f.editId==='revise'));
 const fresh=new ResidentCompiler();t.after(()=>fresh.stop());const base=await fresh.prepareRegion(next,paragraphAt(next,next.indexOf('Alpha')),new AbortController().signal,30000,()=>{},{characterMapping:true});let taken=false;
 p.local.setBasis({...p.local.basis,source:next,compilerSource:next,pdf:base.pdf,bundle:{id:'revised-with-history'},takeCompiler:()=>taken?undefined:(taken=true,fresh)});
 await until(()=>p.local.parked.some(s=>s.range.from===next.indexOf('Delta')));const cached=p.local.parked.find(s=>s.range.from===next.indexOf('Delta'));
 assert.equal(cached.basis.bundle.id,'revised-with-history');assert.equal(cached.compiler,fresh);assert.ok(p.messages.includes('Local recent region prepared.\n'));assert.ok(p.local.visits.length<=3);assert.ok(p.local.parked.length<=3);
 const before=p.messages.filter(m=>m.startsWith('Local preparation: ')).length;p.local.move('main.tex',next.indexOf('Delta')+3);assert.equal(p.local.ready,true);assert.equal(p.local.slot,cached);assert.equal(p.messages.filter(m=>m.startsWith('Local preparation: ')).length,before);
 const edited=next.replace('Delta paragraph','Delta returned paragraph');assert.equal(p.local.request('main.tex',edited,'return'),true);await until(()=>p.frames.some(f=>f.editId==='return'));assert.equal(p.frames.at(-1).sourceHash,require('crypto').createHash('sha256').update(edited).digest('hex'));assert.deepEqual(p.fallbacks,[]);
});

test('Recent region hints stay bounded and reject duplicate, changed, deleted and other-project text',()=>{
 const local=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{}),source='First.\n\nSecond.\n\nThird.\n\nFourth.\n\n',basis={source,options:{root:'main.tex'},project:{},bundle:{id:'hints'}};local.basis=basis;
 for(const word of ['First','Second','Third','Fourth'])local.rememberVisit({file:'main.tex',at:source.indexOf(word)+2});assert.equal(local.visits.length,3);assert.equal(local.visits[0].text,'Fourth.\n\n');
 const shifted={...basis,source:'Inserted.\n\n'+source};assert.equal(local.recentTargets(shifted)[0].at,shifted.source.indexOf('Fourth')+2);
 assert.equal(local.recentTargets({...basis,source:source+'Fourth.\n\n'}).length,2);assert.equal(local.recentTargets({...basis,source:source.replace('Fourth.','Modified.')}).length,2);assert.equal(local.recentTargets({...basis,source:source.replace('Fourth.\n\n','')}).length,2);assert.deepEqual(local.recentTargets({...basis,options:{root:'other.tex'}}),[]);local.stop();assert.equal(local.visits.length,0);
});


test('Typing cancels a recent-region proof without losing the active draft',{timeout:30000},async t=>{
 let proofs=0,held=false,release;const gate=new Promise(r=>release=r),p=await lane(t,async()=>{if(++proofs===2){held=true;await gate;}return true;});t.after(()=>release(true));
 p.local.rememberVisit({file:'main.tex',at:p.source.indexOf('Delta')+3});await until(()=>held);const active=p.local.slot,next=p.source.replace('Alpha paragraph','Alpha priority paragraph');assert.equal(p.local.request('main.tex',next,'priority'),true);await until(()=>p.frames.some(f=>f.editId==='priority'));release(true);assert.equal(p.local.slot,active);assert.equal(p.local.parked.length,0);assert.deepEqual(p.fallbacks,[]);
});

test('Full verification remembers the latest edited text before returning its compiler',{timeout:30000},async t=>{
 const p=await lane(t),next=p.source.replace('Alpha paragraph','Alpha newly remembered paragraph');p.local.request('main.tex',next,'remember-latest');await until(()=>p.frames.some(f=>f.editId==='remember-latest'));p.local.basis.returnCompiler=()=>true;assert.equal(p.local.prepareFullVerification(),true);assert.ok(p.local.visits.some(v=>v.text.includes('Alpha newly remembered')));assert.equal(p.local.slot,undefined);
});


test('An intermediate publication without an available compiler routes queued input to its warm full owner',async t=>{
 const fallbacks=[],local=new LocalPreview(async()=>assert.fail('No raster proof without an owner'),async()=>assert.fail('No output without an owner'),id=>fallbacks.push(id),()=>{},()=>{});t.after(()=>local.stop());const source='\\documentclass{article}\n\\begin{document}\n\nTarget paragraph.\n\n\\end{document}\n';local.setContinuous(true);local.setBasis({source,compilerSource:source,pdf:new Uint8Array(),project:{},bundle:{id:'intermediate-owned'},options:{root:'main.tex'},takeCompiler:()=>undefined});local.move('main.tex',source.indexOf('Target')+3);assert.equal(local.request('main.tex',source.replace('Target','Latest'),'queued-owner'),true);await local.arm();assert.equal(local.slot,undefined);assert.equal(local.warmCompiler,undefined);assert.equal(local.verifyingWithOwner,true);assert.equal(local.pending,undefined,'Queued input must not block the full fallback scheduler');assert.deepEqual(fallbacks,['queued-owner']);
});
