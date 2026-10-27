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