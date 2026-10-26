const {test}=require('node:test'),assert=require('node:assert/strict'),{encodeNavigation,decodeNavigation}=require('../dist/navigation-codec');
test('Compact preview transport preserves source identities, text/math geometry and native navigation',()=>{
 const file='C:/project with spaces/chapter.tex',nav={schema:1,sources:{[file]:'hash'},regions:[[file,2,1,10,20,30,8]],characters:[[file,2,3,1,11,20,5,8,120,1]],mathCharacters:[[file,2,8,1,30,20,5,8,25,3]],nativeInputs:{[file]:'C:/cache/in/chapter.tex'}};assert.deepEqual(decodeNavigation(encodeNavigation(nav)),nav);assert.equal(decodeNavigation(nav),nav);assert.equal(decodeNavigation(undefined),undefined);
 const big={...nav,characters:Array.from({length:1000},()=>nav.characters[0])};assert.ok(encodeNavigation(big).length<JSON.stringify(big).length*.65);
 assert.throws(()=>decodeNavigation('{"schema":1,"files":[],"regions":[[0,1,1,0,0,1,1]]}'),/source index/);assert.throws(()=>decodeNavigation('{"schema":2,"files":[]}'),/navigation/);
});
