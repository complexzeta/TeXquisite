const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident'),{validatePdf,runProcess,hash}=require('../dist/core');
(async()=>{
 const directory=path.resolve(process.argv[2]),phase=process.argv[3];assert.ok(['baseline','optimized'].includes(phase));await fs.mkdir(directory,{recursive:true});
 const input=path.join(directory,'input.json');let saved;
 try{saved=JSON.parse(await fs.readFile(input,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;const s=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Persistent TeX/session.json'),'utf8'));saved={source:s.docs.find(d=>d.path===s.root).text,root:s.root,supportFolders:[path.dirname(s.root),...(s.supportFolders??[])]};await fs.writeFile(input,JSON.stringify(saved));}
 const compiler=new ResidentCompiler(),signal=new AbortController().signal;
 try{
  // The normal app's existing compatibility transform affects this build copy
  // only; the frozen draft and the user's source remain unmodified.
  const source=/\\usepackage(?:\[[^\]]*\])?\{tkz-euclide\}/.test(saved.source)?saved.source.replace(/^[\t ]*\\usetkzobj\{all\}[\t ]*(?:%[^\r\n]*)?\r?$/m,'% Compatibility: obsolete tkz object loader omitted.'):saved.source,logs=[];
  const pdf=await compiler.compile(source,signal,120000,s=>logs.push(s),{characterMapping:true,supportFolders:saved.supportFolders});assert.ok(pdf?.length>100);
  const pages=await validatePdf(pdf);await fs.writeFile(path.join(directory,phase+'.pdf'),pdf);await fs.writeFile(path.join(directory,phase+'.navigation.jsonl'),compiler.navigation);await fs.writeFile(path.join(directory,phase+'.log'),logs.join(''));
  await runProcess('pdftoppm',['-png','-r','100',phase+'.pdf',phase],directory,60000,signal,()=>{});
  await runProcess('pdftotext',['-layout',phase+'.pdf',phase+'.txt'],directory,30000,signal,()=>{});
  const images=(await fs.readdir(directory)).filter(n=>new RegExp('^'+phase+'-\\d+\\.png$').test(n)).sort();assert.equal(images.length,pages);
  const pixels=[];for(const name of images)pixels.push(hash(await fs.readFile(path.join(directory,name))));
  const result={passed:true,phase,pages,sourceHash:hash(saved.source),compilerSourceHash:hash(source),navigationHash:hash(compiler.navigation),textHash:hash(await fs.readFile(path.join(directory,phase+'.txt'))),pageHashes:pixels,timing:compiler.lastTiming};
  if(phase==='optimized'){const baseline=JSON.parse(await fs.readFile(path.join(directory,'baseline.json'),'utf8'));for(const key of ['pages','sourceHash','compilerSourceHash','navigationHash','textHash','pageHashes'])assert.deepEqual(result[key],baseline[key],key+' must match the original engine');}
  await fs.writeFile(path.join(directory,phase+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,phase,pages,sourceHash:result.sourceHash,allPagePixels:phase==='optimized',exactNavigation:phase==='optimized'}));
 }finally{compiler.stop();}
})().catch(error=>{console.error(error);process.exitCode=1});
