const {test}=require('node:test'),assert=require('node:assert/strict'),{BuildController}=require('../dist/core');
test('New local input cancels obsolete automatic verification but preserves explicit builds',()=>{
 for(const automatic of [true,false]){const c=Object.create(BuildController.prototype);let cancelled=0;c.activeDraft={automatic,editId:'old'};c.active={abort(){cancelled++;}};c.pending={automatic,editId:'old'};c.supersedeAutomaticForLocalEdit('new');assert.equal(cancelled,automatic?1:0);assert.equal(c.pending===undefined,automatic);assert.equal(!!c.activeDraft.supersededLocally,automatic);}
});
test('An automatic request for the same local revision is not cancelled',()=>{const c=Object.create(BuildController.prototype);let cancelled=0;c.activeDraft={automatic:true,editId:'same'};c.active={abort(){cancelled++;}};c.supersedeAutomaticForLocalEdit('same');assert.equal(cancelled,0);});
