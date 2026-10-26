const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{ResidentCompiler}=require('../dist/resident'),{validatePdf,runProcess}=require('../dist/core');
(async()=>{
 assert.ok(process.argv[2]&&process.argv[3],'Pass an output directory and an isolated .tex fixture');
 const directory=path.resolve(process.argv[2]);await fs.mkdir(directory,{recursive:true});const source=await fs.readFile(process.argv[3],'utf8'),from=source.indexOf('\\begin{tikzpicture}'),to=source.indexOf('\n\n',from)+2,range={from,to},project={characterMapping:true,jobName:'main'},signal=new AbortController().signal,compiler=new ResidentCompiler(),full=new ResidentCompiler(),samples=[];assert.ok(from>0&&to>from&&source.includes('NodeMark')&&source.includes('(4,2)'),'Expected the dense benchmark fixture');await fs.writeFile(path.join(directory,'input.tex'),source);
 try{
  await compiler.prepareRegion(source,range,signal,60000,()=>{},project);samples.push({stage:'prepare',...compiler.lastTiming});
  for(const [label,text]of [['baseline',source],['node',source.replace('NodeMark','NodeMarker')],['coordinate',source.replace('(4,2)','(4,3)')]]){
   const end=to+text.length-source.length,output=await compiler.previewRegionPage(text,{from,to:end},1,signal,15000,()=>{},project,true);await validatePdf(output.pdf);samples.push({stage:label,...output.timing});await fs.writeFile(path.join(directory,label+'.pdf'),output.pdf);
   const reference=await full.compile(text,signal,60000,()=>{},project);assert.ok(reference);await fs.writeFile(path.join(directory,label+'-full.pdf'),reference);
   for(const suffix of ['', '-full'])await runProcess('pdftoppm',['-r','100','-singlefile',path.join(directory,label+suffix+'.pdf'),path.join(directory,label+suffix)],directory,10000,signal,()=>{});
   assert.deepEqual(await fs.readFile(path.join(directory,label+'.ppm')),await fs.readFile(path.join(directory,label+'-full.ppm')),'Affected page must match full TeX pixels: '+label);
  }
  await fs.writeFile(path.join(directory,'results.json'),JSON.stringify({passed:true,samples},null,2));console.log(JSON.stringify({passed:true,directory,samples:samples.map(s=>({stage:s.stage,totalMs:s.totalMs,typesetMs:s.typesetMs}))}));
 }finally{compiler.stop();full.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
