// Preserve raw comparison results; separately explain recognized dynamic headers.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const directory=path.resolve(process.argv[2]||''),campaign=JSON.parse(await fs.readFile(path.join(directory,'results.json'),'utf8')),results=[];
 for(const item of campaign.results){
  const result={name:item.name,originalUnchanged:item.originalUnchanged,pages:item.runs.map(r=>({backend:r.backend,pages:r.pages,success:r.success})),rawEquivalent:!!item.equivalent};assert.equal(result.originalUnchanged,true);
  if(item.runs.length===2&&item.runs.every(r=>r.success)){
   const texts=await Promise.all(['app','native'].map(backend=>fs.readFile(path.join(directory,path.basename(item.name,'.tex'),backend+'.txt'),'utf8')));
   // Only a clock immediately preceding this publisher's instruction header.
   // Do not normalize arbitrary numbers, dates, bibliography text or equations.
   const normalize=s=>s.replace(/\s+/g,' ').trim().replace(/\b\d{1,2}:\d{2}(?= WSPC\/INSTRUCTION FILE)/g,'<publisher-build-time>');
   result.publisherClockOccurrences=texts.map(s=>(s.replace(/\s+/g,' ').match(/\b\d{1,2}:\d{2}(?= WSPC\/INSTRUCTION FILE)/g)||[]).length);
   result.textEquivalentExceptPublisherClock=normalize(texts[0])===normalize(texts[1]);
   result.accepted=result.pages[0].pages===result.pages[1].pages&&result.textEquivalentExceptPublisherClock;
  }else result.accepted=false;
  results.push(result);
 }
 const report={directory,results,accepted:results.filter(r=>r.accepted).length,total:results.length,unresolved:results.filter(r=>!r.accepted).map(r=>r.name),limits:'Extracted text and page counts do not prove pixel equivalence. Original raw comparisons are retained.'};
 await fs.writeFile(path.join(directory,'audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
