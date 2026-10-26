import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {formatFingerprint,FORMAT_FINGERPRINT_POLICY} from './format-fingerprint';
export const fingerprintFiles=['latex.ltx','expl3.ltx','ltluatex.tex','pdftexconfig.tex','language.dat','hyphen.cfg'];
export interface PreparedFormat {schema:1;installation:string;engine:string;fingerprintPolicy:string;fingerprints:Record<string,string>;dependencies:{name:string;file:string;hash:string;rawHash:string}[];missing:string[];formatHash:string;created:string;selfTest:true;}
const digest=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export const engineIdentity=(assets:string)=>digest(Buffer.concat(['pdftex.js','pdftex.wasm'].map(n=>fs.readFileSync(path.join(assets,n)))));
const installationKey=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
export const formatKey=(assets:string,installation:string,fingerprints:Record<string,string>)=>digest(JSON.stringify({engine:engineIdentity(assets),installation:installationKey(installation),policy:FORMAT_FINGERPRINT_POLICY,fingerprints:Object.fromEntries(Object.entries(fingerprints).sort(([a],[b])=>a.localeCompare(b)))}));
export function preparedFormat(manifestPath:string,assets:string,installation?:string,env:NodeJS.ProcessEnv=process.env,query?:(names:string[])=>string):(PreparedFormat&{formatBytes:Buffer})|undefined{
 try{
  const m=JSON.parse(fs.readFileSync(manifestPath,'utf8')) as PreparedFormat;
  if(m.schema!==1||m.selfTest!==true||m.fingerprintPolicy!==FORMAT_FINGERPRINT_POLICY||m.engine!==engineIdentity(assets)||installation&&installationKey(m.installation)!==installationKey(installation)||!Array.isArray(m.dependencies)||m.dependencies.length>1000||!Array.isArray(m.missing)||m.missing.length>256||m.missing.some(n=>typeof n!=='string'||!n||n.startsWith('-')||/[\\/\0:\r\n]/.test(n))||m.missing.join(' ').length>8000)return;
  const formatBytes=fs.readFileSync(path.join(path.dirname(manifestPath),'pdflatex.fmt'));if(formatBytes.length<1024||formatBytes.length>64*1024*1024||m.formatHash!==digest(formatBytes))return;
  for(const d of m.dependencies)if(!path.isAbsolute(d.file)||digest(fs.readFileSync(d.file))!==d.rawHash||formatFingerprint(d.name,fs.readFileSync(d.file),m.fingerprintPolicy)!==d.hash)return;
  for(const name of fingerprintFiles)if(!m.dependencies.some(d=>d.name===name&&d.hash===m.fingerprints[name]))return;
  // Existing bytes alone are insufficient: a newly added user-tree override
  // can change native lookup precedence while the old file still exists.
  const kpse=path.join(m.installation,process.platform==='win32'?'kpsewhich.exe':'kpsewhich');
  for(let at=0;at<m.dependencies.length;at+=80){const group=m.dependencies.slice(at,at+80);if(group.some(d=>typeof d.name!=='string'||!d.name||d.name.startsWith('-')||/[\\/\0:\r\n]/.test(d.name)))return;
   const found=(query?query(group.map(d=>d.name)):execFileSync(kpse,group.map(d=>d.name),{encoding:'utf8',windowsHide:true,timeout:10000,env})).trim().split(/\r?\n/);if(found.length!==group.length)return;
   for(let i=0;i<group.length;i++)if(digest(fs.readFileSync(found[i]))!==group[i].rawHash)return;
  }
  if(m.missing.length){let found='';try{found=query?query(m.missing):execFileSync(kpse,m.missing,{encoding:'utf8',windowsHide:true,timeout:10000,env});}catch(error){const e=error as {status?:number;stdout?:string;stderr?:string};if(e.status!==m.missing.length%256||String(e.stderr??'').trim())return;found=String(e.stdout??'');}if(found.trim())return;}
  return Object.assign(m,{formatBytes});
 }catch{return;}
}
export async function generateInstalledFormat(options:{keep?:string[];assets:string;cache:string;installation:string;root:string;files:Record<string,string>;fingerprints:Record<string,string>;env:NodeJS.ProcessEnv;timeoutMs?:number}){
 const engine=engineIdentity(options.assets),key=formatKey(options.assets,options.installation,options.fingerprints),directory=path.join(options.cache,key);
 fs.mkdirSync(options.cache,{recursive:true});if(fs.lstatSync(options.cache).isSymbolicLink())throw Error('Fast-format storage must be an ordinary app cache directory.');
 fs.mkdirSync(directory,{recursive:true});if(fs.lstatSync(directory).isSymbolicLink())throw Error('Fast-format storage must be an ordinary app cache directory.');
 const existing=preparedFormat(path.join(directory,'manifest.json'),options.assets,options.installation,options.env);if(existing)return path.join(directory,'manifest.json');
 // The worker owns only in-memory TeX files. Parent timeout can terminate even
 // synchronous runaway TeX; no editor documents or native TeX formats change.
 const result=await new Promise<{engine:string;format:Uint8Array;dependencies:PreparedFormat['dependencies'];missing:string[]}>((resolve,reject)=>{
  const worker=new Worker(path.join(__dirname,'format-worker.js'),{workerData:options,env:options.env});
  const timer=setTimeout(()=>{void worker.terminate();reject(Error('Fast-format preparation timed out. Native compilation remains available.'));},options.timeoutMs??120000);
  const finish=()=>{clearTimeout(timer);void worker.terminate();};
  worker.once('message',r=>{finish();r.error?reject(Error(r.error)):resolve(r);});worker.once('error',e=>{finish();reject(e);});worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(Error('Fast-format preparation stopped.'));}});
 });
 if(result.format.byteLength<1024||result.format.byteLength>64*1024*1024)throw Error('Invalid prepared format size.');
 if(result.engine!==engine||engineIdentity(options.assets)!==engine)throw Error('The compiler changed during format preparation. Try again after updating.');
 const manifest:PreparedFormat={schema:1,installation:path.resolve(options.installation),engine,fingerprintPolicy:FORMAT_FINGERPRINT_POLICY,fingerprints:options.fingerprints,dependencies:result.dependencies,missing:result.missing,formatHash:digest(result.format),created:new Date().toISOString(),selfTest:true};
 for(const d of manifest.dependencies)if(digest(fs.readFileSync(d.file))!==d.rawHash)throw Error('A TeX input changed during preparation; check the installation again.');
 fs.writeFileSync(path.join(directory,'pdflatex.fmt'),result.format);
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
 if(!preparedFormat(path.join(directory,'manifest.json'),options.assets,options.installation,options.env))throw Error('Prepared format did not pass its integrity checks.');
 // At most three inactive preparations. The currently selected cache is kept;
 // loaded workers already own their format bytes and never execute disk heaps.
 const entries=fs.readdirSync(options.cache,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9]{64}$/.test(e.name)).map(e=>({name:e.name,time:fs.statSync(path.join(options.cache,e.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
 const protectedNames=new Set([key,...(options.keep??[]).filter(p=>path.dirname(path.dirname(path.resolve(p)))===path.resolve(options.cache)).map(p=>path.basename(path.dirname(p)))]);
 for(const e of entries.filter(e=>!protectedNames.has(e.name)).slice(Math.max(0,3-protectedNames.size))){const target=path.resolve(options.cache,e.name);if(path.dirname(target)!==path.resolve(options.cache))throw Error('Invalid format cache path.');try{fs.rmSync(target,{recursive:true,force:true});}catch{/* An external reader can defer removal; never fail a valid preparation. */}}
 return path.join(directory,'manifest.json');
}
