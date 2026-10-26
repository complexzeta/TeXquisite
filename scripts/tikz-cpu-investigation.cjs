// Disposable CPU/wall-time diagnosis. No changes to the app or user sources.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
async function measure({runtime,directory,edits=4}){
 const {ResidentCompiler}=require(runtime),{paragraphAt}=require(path.resolve('dist/local-preview')),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')),item=manifest.cases.find(c=>c.name==='hex-11x11'),source=await fs.readFile(item.root,'utf8'),signal=()=>new AbortController().signal;
 const project={characterMapping:true,jobName:'main',resources:await Promise.all(['cgt.sty','cgt-board.sty','cgtsym.tfm','cgtsym.map','CGT.pfb','a_olxnuu.enc'].map(async n=>[n,new Uint8Array(await fs.readFile(path.join(path.dirname(item.root),n)))]))},c=new ResidentCompiler(),samples=[];
 try{
  await c.compile(source,signal(),180000,()=>{},project);const range=paragraphAt(source,item.at);await c.prepareRegion(source,range,signal(),180000,()=>{},project,range.from,undefined,false,true);const page=c.lastTiming.checkpointPage;assert(Number.isSafeInteger(page));assert.equal(typeof c.worker.cpuUsage,'function');
  for(let i=0;i<edits;i++){
   const next=source.slice(0,item.at)+item.values[i%2]+source.slice(item.at+1),before=await c.worker.cpuUsage(),began=performance.now(),out=await c.previewRegionPage(next,range,page,signal(),180000,()=>{},project,true),wallMs=performance.now()-began,after=await c.worker.cpuUsage();assert(out.pdf.length);
   samples.push({i,wallMs,threadCpuMs:(after.user+after.system-before.user-before.system)/1000,userCpuMs:(after.user-before.user)/1000,systemCpuMs:(after.system-before.system)/1000,freeMemoryMiB:os.freemem()/1048576,timing:out.timing});
  }
  return {runtime,versions:process.versions,execArgv:process.execArgv,samples};
 }finally{c.stop();}
}
module.exports={measure};
if(require.main===module)(async()=>{
 const {_electron:electron}=require('playwright'),directory=path.resolve(process.argv[2]),tag=process.argv[3],harness=path.resolve('.test-output/latency-078-electron-harness.cjs'),results=[];assert(tag);
 await fs.writeFile(harness,"globalThis.measureTeXLatency=require("+JSON.stringify(__filename)+").measure;require('electron').app.whenReady().then(()=>{});\n");
 for(const kind of ['development','packaged','packaged','development']){
  const app=await electron.launch({args:[harness],env:{...process.env,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
  try{const runtime=kind==='development'?path.resolve('dist/resident.js'):path.resolve('release/win-unpacked/resources/app.asar/dist/resident.js'),r=await app.evaluate(async(_electron,options)=>globalThis.measureTeXLatency(options),{runtime,directory});r.kind=kind;results.push(r);console.log(JSON.stringify({kind,samples:r.samples.map(s=>({wallMs:s.wallMs,cpuMs:s.threadCpuMs,typesetMs:s.timing.typesetMs,entries:s.timing.tikzMathEntries}))}));}finally{await app.close();}
 }
 const {createHash}=require('node:crypto'),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));for(const item of manifest.originals)assert.equal(createHash('sha256').update(await fs.readFile(item.file)).digest('hex'),item.sha256,item.file);
 await fs.writeFile(path.join(directory,tag+'.json'),JSON.stringify({passed:true,originalsUnchanged:true,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
