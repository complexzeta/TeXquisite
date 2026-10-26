const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {runProcess,validatePdf}=require('../dist/core');
(async()=>{
 const directory=path.resolve('.test-output','benchmark-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const root=path.resolve('fixtures/article/main.tex'),samples=[];
 for(let i=0;i<3;i++){
  const output=path.join(directory,String(i));await fs.mkdir(output);
  const start=performance.now();await runProcess('latexmk',['-norc','-pdf','-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-no-shell-escape','-outdir='+output,'main.tex'],path.dirname(root),120000,new AbortController().signal,()=>{});
  const compiled=performance.now();const bytes=await fs.readFile(path.join(output,'main.pdf'));const pages=await validatePdf(bytes);
  samples.push({run:i+1,buildMs:Math.round(compiled-start),readAndValidationMs:Math.round(performance.now()-compiled),pages,bytes:bytes.length,cache:'fresh output directory; OS caches may be warm'});
 }
 const report={cpu:os.cpus()[0].model,ramGB:os.totalmem()/2**30,windows:os.release(),node:process.version,engine:'pdfLaTeX, TeX Live 2025; latexmk 4.87',samples};
 await fs.writeFile('.test-output/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
