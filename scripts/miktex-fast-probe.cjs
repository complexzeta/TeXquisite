// Feasibility experiment ONLY: writes an ls-R adapter inside the disposable
// runner's MiKTeX tree. No production worker, TeX Live path or user tree changes.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {fingerprintFiles}=require('../dist/format-cache'),{formatFingerprint,FORMAT_FINGERPRINT_POLICY}=require('../dist/format-fingerprint');
const {lookup}=require('./miktex-lookup-probe.cjs');
const digest=b=>createHash('sha256').update(b).digest('hex');
(async()=>{
 assert.equal(process.env.CI,'true');const root=process.env.TEXQUISITE_TEST_MIKTEX_ROOT,bin=process.env.TEXQUISITE_TEST_TEX_BIN,repo=process.env.TEXQUISITE_TEST_MIKTEX_REPOSITORY;assert.ok(root&&bin);assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve(process.env.RUNNER_TEMP).toLowerCase()+path.sep));
 const directory=require('./test-artifacts.cjs').testDirectory('miktex-fast-probe'),result={completed:false,productionCodeChanged:false,fastPossible:false,stage:'resources',files:[],samples:[]},logs=[];
 const env={...process.env};for(const key of Object.keys(env))if(/^(?:TEX|BIB|BST)/i.test(key)||key.toLowerCase()==='path')delete env[key];env.PATH=[bin,process.env.TEXQUISITE_TEST_PERL_BIN,path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.dirname(process.execPath)].join(path.delimiter);
 const run=(exe,args,allow=false)=>{const r=cp.spawnSync(path.join(bin,exe+'.exe'),args,{cwd:directory,env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});logs.push((r.stdout??'')+(r.stderr??''));if(!allow&&r.status!==0)throw Error(exe+' failed: '+(r.stderr??'').slice(-1500));return r;};
 const prior={...process.env};for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
 let compiler;const indexFile=path.join(root,'ls-R');assert.ok(!fs.existsSync(indexFile),'Never overwrite an existing distribution index');
 try{
  const info=run('miktex',['packages','info','--template','{isInstalled}','tex-ini-files']);if(!/^(true|yes|1)$/i.test(info.stdout.trim()))run('miktex',['packages','install','--repository',repo,'tex-ini-files']);run('initexmf',['--update-fndb']);
  const resourceStarted=Date.now();
  const files={},fingerprints={};for(const name of fingerprintFiles){const found=run('kpsewhich',[name],true).stdout.trim();result.files.push({name,found:!!found});if(!found)throw Error('Required initialization input is absent: '+name);files[name]=found;fingerprints[name]=formatFingerprint(name,fs.readFileSync(found),FORMAT_FINGERPRINT_POLICY);}files['pdftex.map']=run('kpsewhich',['pdftex.map']).stdout.trim();
  result.resourceMs=Date.now()-resourceStarted;
  // Compare the optimized lookup against the previous single-file protocol
  // on real MiKTeX, including fonts, Unicode data and a genuinely missing file.
  const compareStarted=Date.now(),names=[...fingerprintFiles,'UnicodeData.txt','cmr10.tfm','texquisite-probe-intentionally-absent.tex'];
  const native=args=>run('kpsewhich',args,true),isFile=file=>fs.statSync(file).isFile();
  const expected=names.map(name=>{for(const args of [[name],['--format=tex',name]]){const r=native(args);if(r.status===0&&r.stdout.trim())return r.stdout.trim();assert.equal(r.status,1);assert.equal(r.stdout.trim(),'');}return '';});
  const markers=['latex.ltx','hyphen.cfg'].map(name=>({name,file:files[name]}));assert.deepEqual(lookup(names,native,isFile,markers),expected);result.lookupEquivalent=true;result.lookupComparisonMs=Date.now()-compareStarted;
  const indexStarted=Date.now(),before=Object.fromEntries(Object.entries(files).map(([n,p])=>[n,digest(fs.readFileSync(p))])),lines=['% Disposable MiKTeX fast-preview index experiment'];let entries=0;
  const walk=relative=>{const folder=path.join(root,relative),items=fs.readdirSync(folder,{withFileTypes:true});lines.push('./'+relative.replaceAll('\\','/')+':');for(const e of items.filter(e=>e.isFile())){lines.push(e.name);entries++;}lines.push('');for(const e of items.filter(e=>e.isDirectory()&&!e.isSymbolicLink()))walk(path.join(relative,e.name));};
  for(const name of ['tex','fonts','web2c'])if(fs.existsSync(path.join(root,name)))walk(name);fs.writeFileSync(indexFile,lines.join('\n'),{flag:'wx'});result.indexEntries=entries;result.indexMs=Date.now()-indexStarted;result.stage='format';
  // Experiment in disposable compiled copies only. MiKTeX lookup behavior is
  // not Kpathsea's batch/exit-code contract. Never relax the production guards.
  const compiled=path.join(directory,'experimental-dist');fs.cpSync(path.resolve('dist'),compiled,{recursive:true});fs.cpSync(path.resolve('engine/resident'),path.join(directory,'engine/resident'),{recursive:true});
  env.TEXQUISITE_MIKTEX_PROBE_TRACE=process.env.TEXQUISITE_MIKTEX_PROBE_TRACE=path.join(directory,'lookup.jsonl');
  env.TEXQUISITE_MIKTEX_PROBE_ADAPTER=process.env.TEXQUISITE_MIKTEX_PROBE_ADAPTER=path.resolve('scripts/miktex-lookup-probe.cjs');
  env.TEXQUISITE_MIKTEX_PROBE_MARKERS=process.env.TEXQUISITE_MIKTEX_PROBE_MARKERS=JSON.stringify(markers);
  env.TEXQUISITE_MIKTEX_PROBE_PHASE=process.env.TEXQUISITE_MIKTEX_PROBE_PHASE='format';
  const shim=`(()=>{const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{lookup}=require(process.env.TEXQUISITE_MIKTEX_PROBE_ADAPTER);const original=cp.execFileSync;
cp.execFileSync=function(exe,args,options){
 if(path.basename(String(exe)).toLowerCase()!=='kpsewhich.exe'||!Array.isArray(args)||args.some(n=>!n||n.startsWith('-')||/[\\\\/\\0:\\r\\n]/.test(n)))return original.apply(this,arguments);
 const files=lookup(args,query=>{const started=Date.now(),r=cp.spawnSync(exe,query,{...options,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,timeout:10000});fs.appendFileSync(process.env.TEXQUISITE_MIKTEX_PROBE_TRACE,JSON.stringify({phase:process.env.TEXQUISITE_MIKTEX_PROBE_PHASE,names:query.filter(n=>!n.startsWith('-')).length,tex:query[0]==='--format=tex',ms:Date.now()-started,status:r.status})+'\\n');return r;},file=>fs.statSync(file).isFile(),JSON.parse(process.env.TEXQUISITE_MIKTEX_PROBE_MARKERS));
 const found=files.filter(Boolean),missing=args.filter((_,i)=>!files[i]);
 if(missing.length){const error=Error('MiKTeX lookup: absent inputs '+missing.join(', '));error.status=missing.length%256;error.stdout=found.join('\\n');error.stderr='';throw error;}return found.join('\\n');
};})();\n`;
  for(const name of ['format-cache.js','format-worker.js','resident-worker.js']){const file=path.join(compiled,name);fs.writeFileSync(file,shim+fs.readFileSync(file,'utf8'));}
  const {generateInstalledFormat,preparedFormat}=require(path.join(compiled,'format-cache.js')),{ResidentCompiler}=require(path.join(compiled,'resident.js'));result.experimentalLookupAdapter=true;
  const assets=path.resolve('engine/resident'),started=Date.now(),manifest=await generateInstalledFormat({assets,cache:path.join(directory,'formats'),installation:bin,root,files,fingerprints,env,timeoutMs:180000});result.preparationMs=Date.now()-started;result.preparedFormat=true;result.stage='resident';
  env.TEXQUISITE_MIKTEX_PROBE_PHASE=process.env.TEXQUISITE_MIKTEX_PROBE_PHASE='reuse';const reuseStarted=Date.now(),priorManifest=fs.readFileSync(manifest,'utf8');assert.equal(await generateInstalledFormat({assets,cache:path.join(directory,'formats'),installation:bin,root,files,fingerprints,env}),manifest);assert.equal(fs.readFileSync(manifest,'utf8'),priorManifest);result.cacheReuseMs=Date.now()-reuseStarted;result.cacheReusedWithoutRebuild=true;
  // Keep the real format guards active: changed bytes and a missing-input
  // claim contradicted by native lookup must both refuse reuse.
  env.TEXQUISITE_MIKTEX_PROBE_PHASE=process.env.TEXQUISITE_MIKTEX_PROBE_PHASE='guards';
  const saved=fs.readFileSync(manifest,'utf8'),record=JSON.parse(saved),heap=path.join(path.dirname(manifest),'pdflatex.fmt'),bytes=fs.readFileSync(heap),altered=Buffer.from(bytes);altered[altered.length-1]^=1;
  try{fs.writeFileSync(heap,altered);assert.equal(preparedFormat(manifest,assets,bin,env),undefined);}finally{fs.writeFileSync(heap,bytes);}result.corruptFormatRefused=true;
  try{fs.writeFileSync(manifest,JSON.stringify({...record,missing:[...record.missing,'article.cls']}));assert.equal(preparedFormat(manifest,assets,bin,env),undefined);}finally{fs.writeFileSync(manifest,saved);}result.contradictedMissingRefused=true;
  env.TEXQUISITE_MIKTEX_PROBE_PHASE=process.env.TEXQUISITE_MIKTEX_PROBE_PHASE='resident';
  const resources={root,files,formatManifest:manifest};compiler=new ResidentCompiler(resources);let source='\\documentclass{article}\n\\usepackage{amsmath,tikz}\n\\begin{document}\n\nTargetSentinel ordinary text with $\\sqrt{\\pi}+\\frac12$. More ordinary words.\n\nTailSentinel unchanged.\n\\end{document}\n';
  const residentStarted=Date.now(),document=await compiler.compile(source,new AbortController().signal,120000,s=>logs.push(s),{characterMapping:true});assert.ok(document?.length);result.residentInitializationMs=Date.now()-residentStarted;result.residentDocument=true;
  let from=source.indexOf('TargetSentinel'),to=source.indexOf('\n\n',from)+2;const localStarted=Date.now();await compiler.prepareRegion(source,{from,to},new AbortController().signal,30000,s=>logs.push(s),{characterMapping:true},from+8);result.localPreparationMs=Date.now()-localStarted;
  for(const word of [' first',' second',' third']){const at=source.indexOf('TargetSentinel')+'TargetSentinel'.length,next=source.slice(0,at)+word+source.slice(at),began=Date.now(),output=await compiler.previewRegionFlow(next,{from,to:to+word.length},new AbortController().signal,30000,s=>logs.push(s),{characterMapping:true},true,undefined,true);assert.ok(output?.pdf?.length);result.samples.push({ms:Date.now()-began,compiler:compiler.lastTiming});source=next;to+=word.length;}
  for(const [name,file]of Object.entries(files))assert.equal(digest(fs.readFileSync(file)),before[name]);result.inputsUnchanged=true;result.fastPossible=true;result.stage='complete';
 }catch(error){result.error=String(error);}finally{compiler?.stop();if(fs.existsSync(indexFile))fs.unlinkSync(indexFile);const trace=path.join(directory,'lookup.jsonl');if(fs.existsSync(trace)){const records=fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));result.lookupPhases=Object.fromEntries([...new Set(records.map(r=>r.phase))].map(phase=>{const group=records.filter(r=>r.phase===phase);return [phase,{processes:group.length,queries:group.reduce((n,r)=>n+r.names,0),nativeMs:group.reduce((n,r)=>n+r.ms,0),texFallbacks:group.filter(r=>r.tex).length}];}));}for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);result.completed=true;fs.writeFileSync(path.join(directory,'failure.log'),logs.join('').slice(-200000));fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
