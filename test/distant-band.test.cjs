const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');const signal=()=>new AbortController().signal;
test('A distant band boundary narrows to real affected pages with exact pixels and navigation',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','distant-band-'+randomUUID());await fs.mkdir(directory,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\setlength{\\textheight}{120pt}\n\\AtEndDocument{\\typeout{FORBIDDEN_LOCAL_END_HOOK}}\n\\begin{document}\n\nBefore.\n\n',region='Target paragraph with a note\\footnote{Footnote text.}.\n\n',suffix=Array.from({length:50},(_,i)=>'Following paragraph '+i+'. '+('More ordinary text. '.repeat(12))+'\n\n').join('')+'\\end{document}\n',source=prefix+region+suffix,project={characterMapping:true};
 await local.prepareRegion(source,{from:prefix.length,to:prefix.length+region.length},signal(),60000,()=>{},project);
 for(const [name,body]of [['baseline',region],['edited',region.replace('Target','Changed target')]]){
  const changed=prefix+body+suffix,logs=[],output=await local.previewRegionPage(changed,{from:prefix.length,to:prefix.length+body.length},1,signal(),30000,s=>logs.push(s),project,true);
  assert.equal(output.timing.boundedPageOnly,true);assert.equal(output.timing.continuation,undefined);assert.ok(output.pageSpan.last<=3);assert.ok(output.timing.excludedSuffixBytes>5000);assert.ok(!logs.join('').includes('FORBIDDEN_LOCAL_END_HOOK'));assert.equal(output.documentComplete,false);
  const complete=await full.compile(changed,signal(),60000,()=>{},project);
  const rows=raw=>raw.split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(r=>r.glyph||r.mathGlyph).filter(r=>{const g=r.glyph??r.mathGlyph;return g[3]>=output.pageSpan.first&&g[3]<=output.pageSpan.last;});assert.deepEqual(rows(output.navigation),rows(full.navigation));
  for(const [kind,pdf]of [['local',output.pdf],['full',complete]]){await fs.writeFile(path.join(directory,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','96','-f','1','-l',String(output.pageSpan.last),name+'-'+kind+'.pdf',name+'-'+kind],directory,30000,signal(),()=>{});}
  for(let page=1;page<=output.pageSpan.last;page++){const read=async kind=>{for(const number of [String(page),String(page).padStart(2,'0')])try{return await fs.readFile(path.join(directory,name+'-'+kind+'-'+number+'.png'));}catch{}throw Error('Missing page');};assert.equal(hash(await read('local')),hash(await read('full')));}
 }
 const huge='Target '+('Many wrapping words. '.repeat(500))+'\n\n';await assert.rejects(local.previewRegionPage(prefix+huge+suffix,{from:prefix.length,to:prefix.length+huge.length},1,signal(),30000,()=>{},project,true),/\(106\)/,'The three-page cap must still reject an actually oversized edited block');
 assert.ok((await local.previewRegionPage(source,{from:prefix.length,to:prefix.length+region.length},1,signal(),30000,()=>{},project,true)).pdf.length>100);
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({passed:true,exactPixels:true,exactNavigation:true,threePageLimit:true,recovery:true}));
});
