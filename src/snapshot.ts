import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
const excluded=new Set(['.git','node_modules','.research','.test-output','release','dist','build']);
const generated=/\.(aux|log|fls|fdb_latexmk|synctex(?:\.gz)?|toc|out|lof|lot|blg|bcf|run\.xml|nav|snm|vrb|tmp)$/i;
export class SnapshotLimitError extends Error{readonly code='SNAPSHOT_DISCOVERY_REQUIRED';}
export const snapshotSignature=(stat:Awaited<ReturnType<typeof fs.lstat>>)=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
export const snapshotPathKey=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
export async function snapshotDirectorySignature(folder:string){const stat=await fs.lstat(folder);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('The project directory changed.');const entries=(await fs.readdir(folder,{withFileTypes:true})).filter(entry=>!entry.name.startsWith('.')&&!excluded.has(entry.name)&&!generated.test(entry.name)).map(entry=>[entry.name,entry.isDirectory()?'directory':entry.isSymbolicLink()?'link':'file']).sort((a,b)=>a[0].localeCompare(b[0]));return createHash('sha256').update(JSON.stringify([stat.dev,stat.ino,entries])).digest('hex');}
export interface DiscoveredInputs {names:string[];expected:Record<string,string>;directories:Record<string,string>;complete:boolean;}
// A stable source mirror is updated only between compiler runs. Autosave can
// continue writing originals without forcing latexmk to chase a moving target.
export function resourceIdentity(resources:[string,Uint8Array][]){
  return createHash('sha256').update(JSON.stringify(resources.map(([name,bytes])=>[path.normalize(name),createHash('sha256').update(bytes).digest('hex')]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
}
export class SourceMirror {
  constructor(private readonly folderBudget=256*1024*1024){}
  private hashes=new Map<string,string>();
  private inputCache=new Map<string,{signature:string;bytes:Buffer}>();
  private selection?:Set<string>;
  private rediscover=false;
  private discovery?:DiscoveredInputs;
  private discoveredIdentity?:string;
  get selective(){return this.selection!==undefined;}
  get discoveryComplete(){return this.discovery?.complete!==false;}
  select(names:string[],discovery?:DiscoveredInputs){
    if(names.some(name=>path.isAbsolute(name)||name.includes(':')||name.split(/[\\/]/).some(part=>part==='..'||part.startsWith('.')||excluded.has(part))))throw Error('Discovered project input is outside the allowed snapshot.');
    this.selection=new Set(names.map(name=>path.normalize(name)));this.rediscover=false;this.discovery=discovery;this.discoveredIdentity=undefined;
  }
  requireDiscovery(){this.rediscover=true;}
  async capture(root:string,destination:string,supportFolders:string[]=[],rootText?:string,sourceFiles:Record<string,string>={}) {
    if(this.rediscover)throw new SnapshotLimitError('New project inputs need discovery.');
    if(this.discovery)for(const [folder,signature]of Object.entries(this.discovery.directories)){const actual=await snapshotDirectorySignature(folder).catch(()=>undefined);if(actual!==signature){this.rediscover=true;throw new SnapshotLimitError('New project inputs need discovery.');}}
    const source=path.dirname(root),rootName=path.basename(root),files=new Map<string,Buffer>(),seen=new Set<string>();let total=0;
    const origins:Record<string,string>={};
    const normalizeName=(name:string)=>process.platform==='win32'?name.toLowerCase():name;
    const buffers=new Map(Object.entries(sourceFiles).map(([file,text])=>[snapshotPathKey(file),text]));
    const signature=snapshotSignature;
    const readStable=async(file:string)=>{
      seen.add(file);
      const buffer=buffers.get(snapshotPathKey(file));if(buffer!==undefined)return Buffer.from(buffer);
      for(let attempt=0;attempt<3;attempt++){
        const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink())return;
        const expected=this.discovery?.expected[snapshotPathKey(file)];if(expected&&signature(before)!==expected){this.rediscover=true;throw new SnapshotLimitError('New project inputs need discovery.');}
        if(this.selection){const real=await fs.realpath(file);let allowed=false;for(const folder of [source,...supportFolders]){try{const relative=path.relative(await fs.realpath(folder),real);if(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))allowed=true;}catch{}}if(!allowed)throw Error('A selected project resource leaves the allowed folders.');}
        if(before.size+total>256*1024*1024)throw new SnapshotLimitError('Project snapshot exceeds 256 MB.');
        const key=signature(before),prior=this.inputCache.get(file);if(prior?.signature===key)return prior.bytes;
        const bytes=await fs.readFile(file),after=await fs.lstat(file);
        if(signature(after)===key){this.inputCache.set(file,{signature:key,bytes});return bytes;}
      }
      throw new Error('A project file kept changing while being captured. Waiting for the next edit.');
    };
    const candidates:{name:string;file:string}[]=[];let candidateBytes=0;
    const visit=async(relative:string)=>{
      for(const entry of await fs.readdir(path.join(source,relative),{withFileTypes:true})){
        if(excluded.has(entry.name)||entry.name.startsWith('.'))continue;
        const name=path.join(relative,entry.name),file=path.join(source,name);
        if(entry.isSymbolicLink())throw new Error('Linked project resources need an explicit snapshot mapping; copy the resource into the project folder.');
        if(entry.isDirectory()){await visit(name);continue;}
        if(!entry.isFile()||generated.test(name)||name===path.basename(root,'.tex')+'.pdf')continue;
        if(rootText!==undefined&&relative===''&&normalizeName(entry.name)===normalizeName(rootName))continue;
        const stat=await fs.lstat(file);candidateBytes+=stat.size;candidates.push({name,file});
        if(candidateBytes>this.folderBudget||candidates.length>10000)throw new SnapshotLimitError('The project folder needs dependency discovery.');
      }
    };
    if(this.selection){
      for(const name of this.selection){if(normalizeName(name)===normalizeName(rootName))continue;const file=path.join(source,name);
        try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Linked project resources need an explicit snapshot mapping.');candidates.push({name,file});}
        catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
      }
    }else await visit('');
    for(const {name,file}of candidates){
        const bytes=await readStable(file);if(!bytes)throw new Error('A project resource changed to a link or non-file while being captured.');
        total+=bytes.length;files.set(name,bytes);
        origins[name.split(path.sep).join('/')]=file;
        if(files.size>10000)throw new Error('Project contains too many files for the source snapshot.');
    }
    // Open buffers are immutable request-time inputs, including unsaved/new files.
    for(const [file,text]of Object.entries(sourceFiles)){
      const relative=path.relative(source,file);
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
      if(relative.split(path.sep).some(part=>part.startsWith('.')||excluded.has(part)))continue;
      const bytes=Buffer.from(text);total+=bytes.length-(files.get(relative)?.length??0);
      if(total>256*1024*1024)throw new Error('Project snapshot exceeds 256 MB.');
      files.set(relative,bytes);origins[relative.split(path.sep).join('/')]=file;
    }
    // Macro-built support names are not statically discoverable. Include open
    // buffers from selected support folders using the same project-first order.
    for(const folder of supportFolders)for(const [file,text]of Object.entries(sourceFiles)){
      const relative=path.relative(folder,file);
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||files.has(relative))continue;
      if(relative.split(path.sep).some(part=>part.startsWith('.')||excluded.has(part)))continue;
      const bytes=Buffer.from(text);total+=bytes.length;
      if(total>256*1024*1024||files.size>=10000)throw new Error('Open source buffers exceed the project snapshot limit.');
      files.set(relative,bytes);origins[relative.split(path.sep).join('/')]=file;
    }
    // Text pasted into an existing document does not carry its neighbouring
    // files. Explicit support folders supply only missing referenced resources,
    // rather than mirroring a potentially huge shared TeX collection.
    const queue=[...files.keys()],visited=new Set<string>();
    if(rootText!==undefined){const bytes=Buffer.from(rootText);total+=bytes.length;if(total>256*1024*1024)throw new Error('Project snapshot exceeds 256 MB.');files.set(rootName,bytes);queue.push(rootName);origins[rootName]=root;}
    const lookupFolders=this.selection?[...new Set([source,...supportFolders])]:supportFolders;
    const supportEntries=new Map<string,Set<string>>(),fontFiles:[string,string][]=[];
    for(const folder of lookupFolders){
      const entries=await fs.readdir(folder,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error.code==='ENOTDIR')return [];throw error;});
      supportEntries.set(folder,new Set(entries.map(entry=>normalizeName(entry.name))));
      for(const entry of entries)if(entry.isFile()&&/\.(tfm|vf|pfb|enc|map)$/i.test(entry.name))fontFiles.push([folder,entry.name]);
    }
    const safeRelative=(name:string)=>!path.isAbsolute(name)&&!name.includes(':')&&!name.split(/[\\/]/).includes('..');
    const addResource=async(name:string,extensions:string[],parent:string)=>{
      if(!safeRelative(name)||/[\\#$]/.test(name))return;
      const targets=extensions.map(extension=>path.normalize(path.join(path.dirname(parent),path.extname(name)?name:name+extension)));
      if(targets.some(target=>normalizeName(target)===normalizeName(rootName)&&files.has(rootName)))return;
      if(targets.some(target=>files.has(target)))return;
      for(const folder of lookupFolders)for(const target of targets){
        if(!safeRelative(target))continue;
        if(!supportEntries.get(folder)?.has(normalizeName(target.split(path.sep)[0]))&&!Object.hasOwn(sourceFiles,path.join(folder,target)))continue;
        let content:Buffer;
        try{const bytes=await readStable(path.join(folder,target));if(!bytes)continue;content=bytes;
        }catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))continue;throw error;}
        total+=content.length;files.set(target,content);queue.push(target);
        origins[target.split(path.sep).join('/')]=path.join(folder,target);
        if(files.size>10000)throw new Error('Project contains too many support files.');
        return;
      }
    };
    if(this.selection)for(const name of this.selection)await addResource(name,[''],rootName);
    // Font names can be constructed by TeX macros. Local metrics are tiny and
    // are not reliably discoverable from static input commands.
    for(const [,name]of fontFiles)await addResource(name,[''],'main.tex');
    while(queue.length){
      const name=queue.shift()!;if(visited.has(name)||! /\.(tex|sty|cls|def|cfg|clo)$/i.test(name))continue;visited.add(name);
      const text=files.get(name)!.toString('utf8').replace(/(?<!\\)%[^\r\n]*/g,'');
      for(const match of text.matchAll(/\\(usepackage|RequirePackage(?:WithOptions)?|documentclass|LoadClass(?:WithOptions)?)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g))for(const resource of match[2].split(','))await addResource(resource.trim(),[/^(?:documentclass|LoadClass)/.test(match[1])?'.cls':'.sty'],name);
      for(const match of text.matchAll(/\\(?:input|include|subfile)\s*(?:\{([^}]+)\}|([\w./-]+))/g))await addResource((match[1]??match[2]).trim(),['.tex',''],name);
      for(const match of text.matchAll(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))await addResource(match[1].trim(),['.pdf','.png','.jpg','.jpeg','.eps'],name);
      for(const match of text.matchAll(/\\(?:bibliography|addbibresource)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g))for(const resource of match[1].split(','))await addResource(resource.trim(),['.bib'],name);
      for(const match of text.matchAll(/\\bibliographystyle\s*\{([^}]+)\}/g))await addResource(match[1].trim(),['.bst'],name);
    }
    const next=new Map<string,string>();
    const identity=resourceIdentity([...files].map(([name,bytes])=>[name,bytes]));
    if(this.discoveredIdentity&&identity!==this.discoveredIdentity){this.rediscover=true;throw new SnapshotLimitError('New project inputs need discovery.');}
    for(const [name,bytes]of files){
      const digest=createHash('sha256').update(bytes).digest('hex');next.set(name,digest);
      if(this.hashes.get(name)===digest)continue;
      const file=path.join(destination,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
    }
    for(const name of this.hashes.keys())if(!next.has(name))await fs.rm(path.join(destination,name),{force:true});
    this.hashes=next;
    if(this.discovery)this.discoveredIdentity=identity;
    for(const file of this.inputCache.keys())if(!seen.has(file))this.inputCache.delete(file);
    const resources:[string,Uint8Array][]=[...files].filter(([name])=>name!==rootName).map(([name,bytes])=>[name.split(path.sep).join('/'),bytes]);
    const resourceKey=resourceIdentity(resources);
    return {resources,resourceKey,origins};
  }
  reset(){this.hashes.clear();}
}
