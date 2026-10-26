// Research benchmark: worker round-trip and backend time, NOT edit-to-canvas time.
// Run after npm test, without simultaneous builds/tests or packaging.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident');
const signal=()=>new AbortController().signal;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
(async()=>{
 const directory=path.resolve('.test-output','local-scaling-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const results=[];
 for(const followingPages of [1,20,100]){
  const prefix='\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\newcommand{\\Root}[1]{\\sqrt{#1}}\n\\begin{document}\nPrevious page.\\par\n\\newpage\n\\def\\ContextWord{Actual body context}\n';
  const region='\\ContextWord: local editing $\\Root{\\pi}+\\frac{a}{b}$. Probe 0.\n\n';
  const suffix='\\newpage\n'+Array.from({length:followingPages},(_,i)=>'Unchanged page '+i+'.\\par\n'+('Unchanged mathematics $x^{2}+\\frac{1}{n}=\\sqrt{y}$.\\par\n'.repeat(10))+(i+1<followingPages?'\\newpage\n':'')).join('')+'\\end{document}\n';
  const source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},context={characterMapping:true};
  const local=new ResidentCompiler(),full=new ResidentCompiler(),samples=[];
  try{
   await local.prepareRegion(source,range,signal(),120000,()=>{},context);
   await full.compile(source,signal(),120000,()=>{},context);
   for(let i=0;i<8;i++){
    const nextRegion=region.replace('Probe 0','Probe '+(i+1)),next=prefix+nextRegion+suffix,nextRange={from:prefix.length,to:prefix.length+nextRegion.length};
    const start=performance.now(),preview=await local.previewRegion(next,nextRange,signal(),60000,()=>{},context),localWallMs=performance.now()-start;
    const fullStart=performance.now(),pdf=await full.compile(next,signal(),120000,()=>{},context),fullWallMs=performance.now()-fullStart;
    samples.push({warmup:i<2,localWallMs,fullWallMs,local:preview.timing,full:full.lastTiming});
    if(i===7){await fs.writeFile(path.join(directory,followingPages+'-local.pdf'),preview.pdf);await fs.writeFile(path.join(directory,followingPages+'-full.pdf'),pdf);}
   }
   const measured=samples.filter(r=>!r.warmup),summary={followingPages,sourceBytes:Buffer.byteLength(source),localWallMedianMs:median(measured.map(r=>r.localWallMs)),fullWallMedianMs:median(measured.map(r=>r.fullWallMs)),localBackendMedianMs:median(measured.map(r=>r.local.totalMs)),fullBackendMedianMs:median(measured.map(r=>r.full.totalMs)),reprocessedSourceBytes:measured.at(-1).local.reprocessedSourceBytes,excludedSuffixBytes:measured.at(-1).local.excludedSuffixBytes};
   results.push({summary,samples});console.log(JSON.stringify(summary));
  }finally{local.stop();full.stop();}
 }
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({measurement:'Worker/compiler only; not edit-to-canvas. Two warmups excluded; six measured edits per size.',results},null,2));
 console.log(JSON.stringify({directory}));
})().catch(error=>{console.error(error);process.exitCode=1;});
