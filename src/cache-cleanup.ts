import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
export interface CacheCleanupOptions {maxBytes?:number;maxAgeMs?:number;orphanAgeMs?:number;now?:number;clearInactive?:boolean;protectedPaths?:()=>string[];shouldContinue?:()=>boolean;dryRun?:boolean;}
export interface CacheCleanupResult {freedBytes:number;removed:number;retainedBytes:number;protectedBytes:number;skipped:number;deferred:boolean;}
const sessionName=/^[a-f\d]{8}$/i,projectName=/^[a-f\d]{32}$/i,bundleName=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const within=(parent:string,child:string)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
async function plainDirectory(file:string){try{const stat=await fs.lstat(file);return stat.isDirectory()&&!stat.isSymbolicLink()&&path.resolve(await fs.realpath(file))===path.resolve(file);}catch{return false;}}
async function inventory(file:string):Promise<{bytes:number;modified:number}|undefined>{
 const stat=await fs.lstat(file);if(stat.isSymbolicLink())return;
 if(stat.isFile())return {bytes:stat.size,modified:stat.mtimeMs};if(!stat.isDirectory())return;
 let bytes=0,modified=stat.mtimeMs;for(const name of await fs.readdir(file)){const entry=await inventory(path.join(file,name));if(!entry)return;bytes+=entry.bytes;modified=Math.max(modified,entry.modified);}return {bytes,modified};
}
export async function cleanCaches(directory:string,options:CacheCleanupOptions={}):Promise<CacheCleanupResult>{
 const result:CacheCleanupResult={freedBytes:0,removed:0,retainedBytes:0,protectedBytes:0,skipped:0,deferred:false};
 const projects=path.resolve(directory,'projects');if(!await plainDirectory(projects))return result;
 const now=options.now??Date.now(),maxBytes=options.maxBytes??512*1024*1024,maxAge=options.maxAgeMs??7*86400000,orphanAge=options.orphanAgeMs??86400000;
 const candidates:{file:string;owner:string;bytes:number;modified:number;orphan:boolean;protected:boolean}[]=[];
 const protectedNow=(file:string)=>options.protectedPaths?.().some(p=>within(file,path.resolve(p))||within(path.resolve(p),file))??false;
 const proceed=()=>{if(options.shouldContinue?.()===false){result.deferred=true;return false;}return true;};
 for(const name of await fs.readdir(projects)){
  if(!proceed())return result;if(!projectName.test(name))continue;const project=path.join(projects,name);if(!await plainDirectory(project)){result.skipped++;continue;}
  const references=new Set<string>(),nativeInputs:string[]=[];let uncertain=false;
  const commits=path.join(project,'commits'),bundles=path.join(project,'bundles');
  if(!await plainDirectory(commits))uncertain=true;
  if(await plainDirectory(commits))for(const record of await fs.readdir(commits)){
   if(!/^\d{16}-.*\.json$/.test(record))continue;
   try{const pointer=JSON.parse(await fs.readFile(path.join(commits,record),'utf8'));if(pointer.schema!==1||!bundleName.test(pointer.id))throw Error('Unknown commit');references.add(pointer.id);
    const folder=path.join(bundles,pointer.id);if(!await plainDirectory(folder))throw Error('Missing bundle');const bundle=JSON.parse(await fs.readFile(path.join(folder,'bundle.json'),'utf8'));
    if(bundle.schema!==1||bundle.id!==pointer.id||bundle.pdfHash!==pointer.pdfHash)throw Error('Invalid bundle');
    if(bundle.navigationHash){const bytes=await fs.readFile(path.join(folder,'navigation.json'));if(createHash('sha256').update(bytes).digest('hex')!==bundle.navigationHash)throw Error('Invalid navigation hash');const nav=JSON.parse(bytes.toString('utf8'));if(bundle.synctex&&!nav.nativeInputs)throw Error('Missing native inputs');if(nav.nativeInputs)for(const input of Object.values(nav.nativeInputs))if(typeof input==='string')nativeInputs.push(path.resolve(input));else throw Error('Invalid native input');}
    else if(bundle.synctex)throw Error('Unknown native navigation');
   }catch{uncertain=true;}
  }
  // Missing/corrupt publication metadata cannot authorize deleting a cache
  // potentially needed by recovery/navigation. Other projects can still prune.
  for(const kind of ['cache','warm','auxiliary']){
   const parent=path.join(project,kind);if(!await plainDirectory(parent))continue;
   for(const session of await fs.readdir(parent)){if(!proceed())return result;if(!sessionName.test(session))continue;const file=path.join(parent,session);try{
    if(!await plainDirectory(file)){result.skipped++;continue;}const size=await inventory(file);if(!size){result.skipped++;continue;}
    candidates.push({file,owner:parent,...size,orphan:false,protected:uncertain||protectedNow(file)||nativeInputs.some(input=>within(file,input))});
   }catch{result.skipped++;}}
  }
  if(!uncertain&&await plainDirectory(bundles))for(const id of await fs.readdir(bundles)){
   if(!proceed())return result;if(!bundleName.test(id)||references.has(id))continue;const file=path.join(bundles,id);try{
    if(!await plainDirectory(file)){result.skipped++;continue;}const size=await inventory(file);if(!size){result.skipped++;continue;}
    // Only uncommitted candidates older than a day qualify; never recover or
    // delete a draft, source, accepted bundle or session temporary file here.
    if(now-size.modified>=orphanAge)candidates.push({file,owner:bundles,...size,orphan:true,protected:protectedNow(file)});
   }catch{result.skipped++;}
  }
 }
 let total=candidates.filter(c=>!c.orphan).reduce((sum,c)=>sum+c.bytes,0);result.retainedBytes=total;result.protectedBytes=candidates.filter(c=>c.protected).reduce((sum,c)=>sum+c.bytes,0);
 for(const candidate of candidates.sort((a,b)=>a.modified-b.modified)){
  if(!proceed())break;
  if(candidate.protected||protectedNow(candidate.file))continue;
  if(!candidate.orphan&&!options.clearInactive&&now-candidate.modified<maxAge&&total<=maxBytes)continue;
  try{
   // Validate the resolved absolute deletion target immediately before rm.
   const resolved=path.resolve(candidate.file),owner=path.resolve(candidate.owner);
   if(path.dirname(resolved)!==owner||!within(projects,resolved)||!await plainDirectory(owner)||!await plainDirectory(resolved)||protectedNow(resolved))continue;
   if(!options.dryRun)await fs.rm(resolved,{recursive:true,force:true});
   result.freedBytes+=candidate.bytes;result.removed++;if(!candidate.orphan)total-=candidate.bytes;
  }catch{result.skipped++;}
 }
 result.retainedBytes=total;return result;
}
