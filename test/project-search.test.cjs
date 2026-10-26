const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');const {findMatches,scanProject,replacementPlan,ProjectSearch,searchHash}=require('../dist/project-search');
const options={query:'target',replacement:'new',regex:false,caseSensitive:true};
test('Literal and regex replacements preserve TeX backslashes, captures and Unicode zero-length offsets',()=>{
 assert.equal(findMatches('\\foo $1','file',{...options,query:'\\foo',replacement:'\\bar $1'})[0].after,'\\bar $1');
 assert.deepEqual(findMatches('one22 two33','file',{...options,regex:true,query:'(?<word>\\w+?)(\\d+)',replacement:'$<word>:$2:$$:$&'}).map(m=>m.after),['one:22:$:one22','two:33:$:two33']);
 assert.deepEqual(findMatches('𝛑x','file',{...options,regex:true,query:'(?=.)',replacement:'!'}).map(m=>m.from),[0,2]);assert.equal(findMatches('Target target','file',{...options,caseSensitive:false}).length,2);
 assert.equal(findMatches('target\ntarget','file',{...options,regex:true,query:'^target$'}).length,2);
});
test('Search uses drafts, skips generated/binary/linked files, flags truncation, and rejects stale replacements',async()=>{
 const root=path.resolve('.test-output','search-unit-'+randomUUID());await fs.mkdir(root,{recursive:true});const file=path.join(root,'main.tex'),bib=path.join(root,'refs.bib');await fs.writeFile(file,'target\r\n');await fs.writeFile(bib,'target target');await fs.writeFile(path.join(root,'main.aux'),'target');await fs.writeFile(path.join(root,'picture.png'),'target');
 const outside=path.resolve('.test-output','search-outside-'+randomUUID());await fs.mkdir(outside);await fs.writeFile(path.join(outside,'outside.tex'),'target');await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
 const docs=[{path:process.platform==='win32'?file.toUpperCase():file,text:'target draft\n',diskHash:searchHash('target\r\n'),dirty:true,eol:'\r\n'}],result=await scanProject([root],docs,options);assert.equal(result.matches.length,3);assert.ok(result.files.find(f=>f.file===docs[0].path).text.includes('draft'));const selected=result.matches.filter(m=>m.file===docs[0].path).map(m=>m.id),plan=await replacementPlan(result,selected,docs,[root]);assert.equal(plan[0].after,'new draft\n');assert.equal(await fs.readFile(file,'utf8'),'target\r\n');
 docs[0].text+='edit';await assert.rejects(replacementPlan(result,selected,docs,[root]),/stale/);docs[0].text='target draft\n';await fs.writeFile(file,'External target');await assert.rejects(replacementPlan(result,selected,docs,[root]),/stale/);assert.equal(await fs.readFile(file,'utf8'),'External target');
 await fs.writeFile(file,'target '.repeat(1005));const limited=await scanProject([root],[],options);assert.equal(limited.matches.length,1000);assert.equal(limited.limited,true);
});
test('A pathological regular expression is cancelled off the application thread and subsequent searches work',{timeout:15000},async()=>{
 const root=path.resolve('.test-output','search-timeout-'+randomUUID());await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'main.tex'),'a'.repeat(40000)+'!');const worker=new ProjectSearch(500);await assert.rejects(worker.run([root],[],{...options,regex:true,query:'^(a+)+$'}),/too long/);const safe=await new ProjectSearch().run([root],[],{...options,query:'!'});assert.equal(safe.matches.length,1);
});
