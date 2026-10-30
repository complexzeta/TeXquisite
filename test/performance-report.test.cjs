const {test}=require('node:test'),assert=require('node:assert/strict'),{performanceReport}=require('../dist/performance-report');
const snapshot={version:'0.112.0',mode:'lecture',continuous:true,automatic:true,visible:false,localReady:true,localBusy:false,fastAvailable:true,fastPreparable:true,freeMiB:800,totalMiB:16000,latestEditId:'latest',standby:'memory',retained:false};
test('Performance report separates interactive frames from later full verification and omits private trace data',()=>{
 const secret='SENSITIVE_SOURCE_AND_PATH',events=[{event:'edit-route',editId:'latest',time:900,route:'local-ready',source:secret,file:secret},{event:'local-displayed',editId:'latest',elapsedMs:40.2,layout:'flow',message:secret},{event:'full-displayed',editId:'latest',elapsedMs:700,root:secret},{event:'local-log',message:secret}];
 const r=performanceReport(snapshot,events,1000);assert.equal(r.latencyMs.local.medianMs,41);assert.equal(r.latencyMs.full.maxMs,700);assert.equal(r.latestEdit.frameAcknowledged,true);assert.equal(r.latestEdit.pendingAgeMs,null);assert.equal(r.routes.localReady,1);const text=JSON.stringify(r);assert.ok(!text.includes(secret));assert.ok(!text.includes('latest"'));assert.equal(r.preview.standby,'memory');
});
test('Pending age is reported only for an observed current edit, never an obsolete frame',()=>{
 const r=performanceReport(snapshot,[{event:'edit-route',editId:'latest',time:800,route:'local-warming'},{event:'local-displayed',editId:'old',elapsedMs:10}],1000);assert.equal(r.latestEdit.pendingAgeMs,200);assert.equal(r.latestEdit.frameAcknowledged,false);assert.equal(r.routes.localWarming,1);assert.equal(performanceReport(snapshot,[],1000).latestEdit.pendingAgeMs,null);
});
test('Malformed values and unknown fields cannot become report content',()=>{
 const r=performanceReport({...snapshot,freeMiB:NaN,standby:'SENSITIVE'},[{event:'local-displayed',elapsedMs:-1},{event:'local-displayed',elapsedMs:Infinity},{event:'full-displayed',elapsedMs:NaN},{event:'local-displayed',elapsedMs:5,layout:'SENSITIVE'},{event:'edit-route',route:'SENSITIVE'}]);assert.equal(r.recentFrames.length,1);assert.equal(r.recentFrames[0].layout,undefined);assert.equal(r.preview.standby,null);assert.equal(r.memory.freeMiB,null);assert.ok(!JSON.stringify(r).includes('SENSITIVE'));
});
test('The report window stays bounded and summarizes an intentionally small sample',()=>{
 const events=Array.from({length:1000},(_,i)=>({event:'local-displayed',elapsedMs:i,source:'unused'})),r=performanceReport(snapshot,events);assert.equal(r.recentFrames.length,20);assert.equal(r.latencyMs.local.count,20);assert.equal(r.latencyMs.local.maxMs,999);assert.equal(r.latencyMs.local.medianMs,990);
});
