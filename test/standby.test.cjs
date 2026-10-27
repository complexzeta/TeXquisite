const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{BuildController,ArtifactStore}=require('../dist/core');
const base=require('../scripts/test-artifacts.cjs').testDirectory('standby-guards');
function controller(t,name){const c=new BuildController(new ArtifactStore(path.join(base,name)),{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},()=>{});t.after(()=>c.dispose());return c;}
test('Editing cancels an unfinished standby without cancelling the local owner',t=>{
 const c=controller(t,'cancel'),abort=new AbortController(),task={source:'old',abort,promise:Promise.resolve(undefined)};let stopped=0;c.resident.stop=()=>{stopped++;};const local={initialized:true};c.transferredCompiler=local;c.residentTask=task;c.priming=task;c.noteActivity();assert.equal(abort.signal.aborted,true);assert.equal(stopped,1);assert.equal(c.residentTask,undefined);assert.equal(c.priming,undefined);assert.equal(c.transferredCompiler,local);
});
test('Editing retains an already warm independent standby',t=>{
 const c=controller(t,'retain');let stopped=0;Object.defineProperty(c.resident,'initialized',{get:()=>true});c.resident.stop=()=>{stopped++;};c.transferredCompiler={initialized:true};assert.equal(c.independentLocalOwner,true);c.noteActivity();assert.equal(stopped,0);assert.equal(c.independentLocalOwner,true);
});
test('Closing the controller retires deferred standby preparation',async t=>{
 const c=controller(t,'retire');c.transferredCompiler={initialized:true};c.prepareStandby({id:'old'},'source',{});assert.ok(c.standbySeed);c.cancel();assert.equal(c.standbySeed,undefined);assert.equal(c.priming,undefined);
});
test('An idle memory deferral retries when memory recovers without requiring an edit',async t=>{
 const c=controller(t,'memory-recovery'),os=require('node:os'),bundle={id:'accepted'};let available=512*1024*1024,ready=false,calls=0;const timers=[];
 t.mock.method(os,'freemem',()=>available);t.mock.method(global,'setTimeout',(run,delay)=>{const timer={run,delay,cancelled:false,unref(){return this;}};timers.push(timer);return timer;});t.mock.method(global,'clearTimeout',timer=>{if(timer)timer.cancelled=true;});
 Object.defineProperty(c.resident,'initialized',{get:()=>ready});c.resident.stop=()=>{ready=false;};c.resident.compile=async()=>{calls++;ready=true;return Buffer.from('ignored standby output');};c.transferredCompiler={initialized:true};c.current=bundle;c.prepareStandby(bundle,'source',{});c.activityAt=performance.now()-2000;const originalActivity=c.activityAt;
 const fire=()=>{const timer=timers.shift();assert.ok(timer&&!timer.cancelled);timer.run();};fire();assert.equal(calls,0);assert.equal(timers.length,1);assert.equal(timers[0].delay,2000);assert.equal(c.standbyReport.state,'memory');fire();assert.equal(calls,0);assert.equal(timers.length,1);
 available=2*1024*1024*1024;fire();await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(c.standbyReport.state,'ready');assert.equal(c.activityAt,originalActivity,'Resource recovery must not invent user activity');assert.deepEqual(c.standbyReport.activity,{edit:0,cursor:0,pause:0});
});

test('Disposal cancels a deferred memory retry before it can start a compiler',async t=>{
 const c=controller(t,'memory-cancel'),os=require('node:os');let calls=0;const timers=[];t.mock.method(os,'freemem',()=>512*1024*1024);t.mock.method(global,'setTimeout',(run,delay)=>{const timer={run,delay,cancelled:false,unref(){return this;}};timers.push(timer);return timer;});t.mock.method(global,'clearTimeout',timer=>{if(timer)timer.cancelled=true;});c.transferredCompiler={initialized:true};c.resident.compile=async()=>{calls++;return undefined;};c.current={id:'accepted'};c.prepareStandby(c.current,'source',{});c.activityAt=performance.now()-2000;timers.shift().run();assert.equal(timers.length,1);c.cancel();assert.equal(timers[0].cancelled,true);assert.equal(calls,0);assert.equal(c.standbySeed,undefined);
});

test('Readiness reports an independent foreground owner even without a priming log',t=>{
 const c=controller(t,'foreground-ready');Object.defineProperty(c.resident,'initialized',{get:()=>true});c.resident.stop=()=>{};c.transferredCompiler={initialized:true};assert.equal(c.standbyReport.state,'ready');assert.equal(c.standbyReport.attempts,0);assert.equal(c.standbyReport.lastOutcome,'none');assert.equal(JSON.stringify(c.standbyReport).includes('source'),false);
});
