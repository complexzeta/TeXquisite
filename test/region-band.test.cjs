const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
for(const final of [false,true])test('Continuous page band '+(final?'flushes final footnotes without document hooks':'changes page count at the same explicit continuation'),{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','region-band-'+randomUUID());await fs.mkdir(directory,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\setlength{\\textheight}{110pt}\n\\AtEndDocument{\\typeout{END_HOOK_FORBIDDEN_LOCALLY}}\n\\begin{document}\n\nBefore.\n\n',region='Target '+('wrapping words '.repeat(28))+'with $\\sqrt{\\pi}$ and a note\\footnote{Footnote text.}.\n\n',tail='Following stable paragraph.\n\n',suffix=tail+(final?'':'\\newpage\n\\typeout{UNREAD_TAIL_FORBIDDEN}\n'+Array.from({length:30},(_,i)=>'Tail '+i+'.\\newpage\n').join(''))+'\\end{document}\n',source=prefix+region+suffix,project={characterMapping:true};
 await local.prepareRegion(source,{from:prefix.length,to:prefix.length+region.length},signal(),60000,()=>{},project);
 let continuation;const spans=[];
 for(const [name,next]of [['baseline',region],['short','Target with note\\footnote{Footnote text.}.\n\n'],['grow','Target '+('wrapping words '.repeat(45))+'with note\\footnote{Footnote text.}.\n\n']]){
  const changed=prefix+next+suffix,logs=[],out=await local.previewRegionPage(changed,{from:prefix.length,to:prefix.length+next.length},1,signal(),30000,s=>logs.push(s),project,true);
  assert.ok(out.timing.continuation);if(continuation)assert.equal(out.timing.continuation,continuation);continuation=out.timing.continuation;spans.push(out.pageSpan.last);
  assert.equal(out.timing.finalPageFlush,final);assert.equal(out.documentComplete,false);assert.equal(out.timing.syntheticEnd,false);assert.ok(!/END_HOOK_FORBIDDEN_LOCALLY|UNREAD_TAIL_FORBIDDEN/.test(logs.join('')));
  if(!final)assert.ok(out.timing.excludedSuffixBytes>500);
  const complete=await full.compile(changed,signal(),60000,()=>{},project);
  for(const [kind,pdf]of [['band',out.pdf],['full',complete]]){await fs.writeFile(path.join(directory,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-png','-f','1','-l',String(out.pageSpan.last),name+'-'+kind+'.pdf',name+'-'+kind],directory,30000,signal(),()=>{});}
  for(let page=1;page<=out.pageSpan.last;page++){const read=async kind=>{for(const number of [String(page),String(page).padStart(2,'0')])try{return await fs.readFile(path.join(directory,name+'-'+kind+'-'+number+'.png'));}catch{}throw Error('Missing rendered page');};assert.equal(hash(await read('band')),hash(await read('full')),'Band must match complete page '+page);}
 }
 assert.ok(Math.min(...spans)<Math.max(...spans),'Fixture must exercise changed page counts');
 const broken=region.replace('Target','\\long\\def\\Grab#1{#1}\\Grab{Target');await assert.rejects(local.previewRegionPage(prefix+broken+suffix,{from:prefix.length,to:prefix.length+broken.length},1,signal(),30000,()=>{},project,true));
 assert.ok((await local.previewRegionPage(source,{from:prefix.length,to:prefix.length+region.length},1,signal(),30000,()=>{},project,true)).pdf.length>100);
});
