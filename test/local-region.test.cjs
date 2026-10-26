const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident');
const {validatePdf,runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;

function document(pages=8){
 const prefix='\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\newcommand{\\MyRoot}[1]{\\sqrt{#1}}\n\\begin{document}\nEarlier material.\\par\n\\newpage\n\\def\\BodyWord{Retained context}\n';
 const region='\\BodyWord: this paragraph has $\\MyRoot{\\pi}+\\frac{a}{b}$ and text.\n\n';
 const suffix='\\newpage\n\\typeout{LOCAL_SUFFIX_WAS_EXECUTED}\n'+Array.from({length:pages},(_,i)=>'Unchanged following page '+i+'.\\par\n'+(i+1<pages?'\\newpage\n':'')).join('')+'\\end{document}\n';
 return {prefix,region,suffix,source:prefix+region+suffix,range:{from:prefix.length,to:prefix.length+region.length}};
}

test('Local region restores actual body context, excludes the suffix, and matches full TeX pages',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','local-region-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const doc=document(),project={characterMapping:true},logs=[];
 await local.prepareRegion(doc.source,doc.range,signal(),60000,()=>{},project);
 assert.ok(local.lastTiming.checkpointOffset>local.lastTiming.preambleOffset,'Must restore body state rather than rerun the prefix');
 for(const [index,region]of [doc.region.replace('and text','and changed text'),doc.region.replace('and text','and '+('longer text '.repeat(45))),doc.region.replace('\\pi','x^{2}+1'),doc.region.trimEnd()+'\n\\begin{align*}a&=\\MyRoot{\\pi}\\\\b&=x^{2}+1\\end{align*}\n\n'].entries()){
  const source=doc.prefix+region+doc.suffix,range={from:doc.prefix.length,to:doc.prefix.length+region.length};logs.length=0;
  const preview=await local.previewRegion(source,range,signal(),30000,s=>logs.push(s),project);
  assert.equal(preview.scope,'region-prototype');assert.equal(preview.documentComplete,false);
  assert.equal(await validatePdf(preview.pdf),2);
  assert.ok(!logs.join('').includes('LOCAL_SUFFIX_WAS_EXECUTED'),'Suffix must not execute');
  assert.equal(preview.timing.documentComplete,false);assert.equal(preview.timing.syntheticEnd,true);
  assert.ok(preview.timing.reprocessedSourceBytes<Buffer.byteLength(region)+160);
  assert.equal(preview.timing.excludedSuffixBytes,Buffer.byteLength(doc.suffix));
  const complete=await full.compile(source,signal(),60000,()=>{},project);assert.equal(await validatePdf(complete),10);
  for(const [name,pdf]of [['local',preview.pdf],['full',complete]]){
   const stem=index+'-'+name;await fs.writeFile(path.join(directory,stem+'.pdf'),pdf);
   await runProcess('pdftoppm',['-r','72','-f','1','-l','2',stem+'.pdf',stem],directory,30000,signal(),()=>{});
  }
  const names=await fs.readdir(directory);
  for(const page of [1,2]){
   const find=kind=>names.find(name=>new RegExp('^'+index+'-'+kind+'-0*'+page+'\\.ppm$').test(name));
   assert.equal(hash(await fs.readFile(path.join(directory,find('local')))),hash(await fs.readFile(path.join(directory,find('full')))),'Local/full page '+page+' pixels must match');
  }
 }
 // A partial failed edit must not damage the saved TeX context.
 const bad=doc.region.replace('and text','and \\UndefinedLocalProbe');
 await assert.rejects(local.previewRegion(doc.prefix+bad+doc.suffix,{from:doc.range.from,to:doc.prefix.length+bad.length},signal(),30000,()=>{},project),/Local region build failed/);
 assert.equal(await validatePdf((await local.previewRegion(doc.source,doc.range,signal(),30000,()=>{},project)).pdf),2);
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({scope:'region-prototype',pixelComparisons:8,timing:local.lastTiming},null,2));
});

test('Local regions reject changed prefix, suffix, settings and resources; ordinary compile remains complete',{timeout:90000},async t=>{
 const local=new ResidentCompiler();t.after(()=>local.stop());const doc=document(1),project={characterMapping:true,resources:[['unused.tex',Buffer.from('Original')]],resourceKey:'original'};
 const prepare=()=>local.prepareRegion(doc.source,doc.range,signal(),60000,()=>{},project);
 await prepare();
 await assert.rejects(local.previewRegion(doc.source.replace('Earlier','Changed'),doc.range,signal(),30000,()=>{},project),/outside the prepared region/);
 await assert.rejects(local.previewRegion(doc.source.replace('following page','later page'),doc.range,signal(),30000,()=>{},project),/outside the prepared region/);
 await assert.rejects(local.previewRegion(doc.source,doc.range,signal(),30000,()=>{},{...project,characterMapping:false}),/Changed project inputs/);
 await assert.rejects(local.previewRegion(doc.source,doc.range,signal(),30000,()=>{},{...project,resources:[['unused.tex',Buffer.from('Changed')]],resourceKey:'changed'}),/Changed project inputs/);
 await prepare();
 assert.equal(await validatePdf(await local.compile(doc.source,signal(),60000,()=>{},project)),3,'Normal compile must never return a truncated PDF');
 await assert.rejects(local.previewRegion(doc.source,doc.range,signal(),30000,()=>{},project),/Prepare the local region/);
 await assert.rejects(local.previewRegion(doc.source,{from:doc.range.from,to:doc.range.to-1},signal(),30000,()=>{},project),/complete paragraph/);
});

test('Local region invalidates dynamically read preamble dependencies',{timeout:90000},async t=>{
 const directory=path.resolve('.test-output','local-dependency-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const helper=path.join(directory,'local-helper.tex');await fs.writeFile(helper,'\\def\\DependencyWord{Original}\n');
 const local=new ResidentCompiler();t.after(()=>local.stop());let doc=document(1);
 const prefix=doc.prefix.replace('\\begin{document}','\\input{local-helper.tex}\n\\begin{document}'),source=prefix+doc.region+doc.suffix,range={from:prefix.length,to:prefix.length+doc.region.length},project={supportFolders:[directory]};
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);
 await fs.writeFile(helper,'\\def\\DependencyWord{Changed}\n');
 await assert.rejects(local.previewRegion(source,range,signal(),30000,()=>{},project),/dependency changed/);
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal(local.lastTiming.reusedBaseline,false);
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal(local.lastTiming.reusedBaseline,true);
});

test('A newly created local override invalidates the prepared context',{timeout:90000},async t=>{
 const directory=path.resolve('.test-output','local-missing-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler();t.after(()=>local.stop());const doc=document(1);
 const prefix=doc.prefix.replace('\\begin{document}','\\IfFileExists{new-local-helper.tex}{\\input{new-local-helper.tex}}{}\n\\begin{document}'),source=prefix+doc.region+doc.suffix,range={from:prefix.length,to:prefix.length+doc.region.length},project={supportFolders:[directory]};
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);
 await fs.writeFile(path.join(directory,'new-local-helper.tex'),'\\def\\NewOverride{Now present}\n');
 await assert.rejects(local.previewRegion(source,range,signal(),30000,()=>{},project),/dependency directory changed/);
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal(local.lastTiming.reusedBaseline,false);
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);assert.equal(local.lastTiming.reusedBaseline,true);
});

test('Partial page finishing can change vertical layout and must remain explicitly provisional',{timeout:90000},async t=>{
 const directory=path.resolve('.test-output','local-layout-boundary-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\begin{document}\nTop material.\\par\n\\vfill\n',region='Targetword.\n\n',suffix='Remaining material below the target.\\par\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length};
 await local.prepareRegion(source,range,signal(),60000,()=>{});
 const partial=await local.previewRegion(source,range,signal(),30000,()=>{}),complete=await full.compile(source,signal(),60000,()=>{});
 const positions=[];
 for(const [name,pdf]of [['local',partial.pdf],['full',complete]]){
  await fs.writeFile(path.join(directory,name+'.pdf'),pdf);
  await runProcess('pdftotext',['-bbox',name+'.pdf',name+'.html'],directory,30000,signal(),()=>{});
  const html=await fs.readFile(path.join(directory,name+'.html'),'utf8'),word=html.match(/<word[^>]+yMin="([^"]+)"[^>]*>Targetword\.<\/word>/);assert.ok(word);positions.push(Number(word[1]));
 }
 assert.notEqual(positions[0],positions[1],'Early end-of-document may change glue above the edited region');
 assert.equal(partial.documentComplete,false);assert.equal(partial.scope,'region-prototype');
});
