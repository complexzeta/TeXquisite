const {test}=require('node:test'),assert=require('node:assert/strict'),{BuildController}=require('../dist/core');
test('New local input cancels obsolete automatic verification but preserves explicit builds',()=>{
 for(const automatic of [true,false]){const c=Object.create(BuildController.prototype);let cancelled=0;c.activeDraft={automatic,editId:'old'};c.active={abort(){cancelled++;}};c.pending={automatic,editId:'old'};c.supersedeAutomaticForLocalEdit('new');assert.equal(cancelled,automatic?1:0);assert.equal(c.pending===undefined,automatic);assert.equal(!!c.activeDraft.supersededLocally,automatic);}
});
test('An automatic request for the same local revision is not cancelled',()=>{const c=Object.create(BuildController.prototype);let cancelled=0;c.activeDraft={automatic:true,editId:'same'};c.active={abort(){cancelled++;}};c.supersedeAutomaticForLocalEdit('same');assert.equal(cancelled,0);});

test('Continuous automatic requests finish the active draft and build the newest queued draft',async()=>{
 const controller=Object.create(BuildController.prototype);
 const published=[];
 let releaseFirst;
 const firstPass=new Promise(resolve=>{releaseFirst=resolve;});
 controller.prefetchPending=()=>{};
 controller.build=async options=>{
  const abort=new AbortController();
  controller.active=abort;
  controller.activeDraft={identity:controller.sourceIdentity(options),editId:options.editId,automatic:true,compiling:true,startedAt:performance.now()-1100};
  if(options.editId==='a')await firstPass;
  if(!abort.signal.aborted)published.push(options.sourceText);
 };
 const edit=text=>controller.request({root:'main.tex',automatic:true,editId:text,sourceText:text});
 const done=edit('a');
 edit('ab');
 await new Promise(resolve=>setTimeout(resolve,10));
 edit('abc');
 releaseFirst();
 await done;
 assert.deepEqual(published,['a','abc']);
});
