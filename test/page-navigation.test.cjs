const {test}=require('node:test'),assert=require('node:assert/strict'),{unchangedPageLocations}=require('../dist/navigation-query');
test('Unchanged page maps shift source offsets but exclude replaced pages, edited text and generated footers',()=>{
 const before='Intro écho\nChanged body\nTail words\n\\end{document}',after=before.replace('Changed body','Changed extended body');
 const nav={regions:[],sources:{},characters:[['main',1,8,1,10,10,4,10,0,1],['main',2,0,2,10,10,4,10,0,1],['main',3,0,3,10,10,4,10,0,1],['main',4,0,4,10,10,4,10,0,1],['other',1,0,1,10,10,4,10,0,1]]};
 const pages=unchangedPageLocations(nav,'main',before,after,{first:2,last:2});
 assert.deepEqual(pages.map(p=>p.page),[1,3]);assert.equal(pages[0].locations[0].at,before.indexOf('c'));assert.equal(pages[1].locations[0].at,after.indexOf('Tail'));
 assert.deepEqual(unchangedPageLocations({...nav,characters:[['main',1,7,1,10,10,4,10,0,1]]},'main',before,after,{first:2,last:2}),[],'A byte column inside UTF-8 is rejected');
});
