import {CheckpointPages} from './checkpoint-pages';
import {TikzMathCache,buildTikzMathPlan} from './tikz-math-cache';
import {includedEntry,IncludedInput} from './included-source';
import {parentPort,workerData} from 'node:worker_threads';
import * as fs from 'node:fs';
import {residentConvergence} from './resident-convergence';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {formatFingerprint} from './format-fingerprint';
import {preparedFormat} from './format-cache';
import {deflateSync} from 'node:zlib';
const supersession=workerData?.supersession?new Int32Array(workerData.supersession):undefined;
let localEditRunning=false;
const localSuperseded=()=>localEditRunning&&!!supersession&&Atomics.load(supersession,0)!==0;
import {FontBodyCache} from './font-body-cache';
import {PdfStreamCache} from './pdf-stream-cache';
const assets=path.resolve(__dirname,'../engine/resident');
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
let context:any,FS:any,Module:any,preamble='',initial:any,bodyState:any,previousBody=Buffer.alloc(0),boundaries:number[]=[],auxiliary=new Map<string,Uint8Array>(),projectResources:[string,Uint8Array][]=[];
let mathCache:TikzMathCache|undefined,initialMathEnabled=false,initialMathActive=false,initialMathEntries=0;
let mathPlans=0;
let supportFolders:string[]=[],nativeZipMs=0,nativeZipStreams=0;
let startupLookups={distribution:0,support:0,supportChecks:0};
const compressPreview=(bytes:Uint8Array,level:number)=>{const started=performance.now();try{return deflateSync(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),{level});}finally{nativeZipMs+=performance.now()-started;nativeZipStreams++;}};
let fastFlowCapture=false,fastFlowEqual=false;
let prefixProbeSource:Buffer|undefined;
const streamCache=new PdfStreamCache();
const fontBodyCache=new FontBodyCache();
const fontProgramCache=new FontBodyCache();
const fontEncodingCache=new FontBodyCache(2*1024*1024,64);
let pendingFontKey:Buffer|undefined,pendingFontBody:Buffer|undefined;
let nativeFontMs=0,nativeFonts=0,fontStarted=0;
let sealStarted=0,digestStarted=0,digestFinished=0;
let regionStateHash:string|undefined,regionStateHashMs=0,regionStateBytes=0;
let priorRegionState:{bytes:Buffer;hash:string}|undefined,regionStateHashReused=false;
let currentJob='main',environmentKey='',characterMapping=false;
let priorResources=new Map<string,Uint8Array>();
let preambleInputs=new Set<string>(),trackingPreamble=false;
function trackInput(file:unknown){
  if(!trackingPreamble||typeof file!=='string')return;
  const absolute=path.posix.resolve(FS.cwd(),file);
  if(absolute.startsWith('/work/'))preambleInputs.add(absolute.slice(6));
  else if(absolute.startsWith('/project-resources/'))preambleInputs.add(absolute.slice(19));
}

const dynamicFiles=new Map<string,{mtime:number;ctime:number;ino:number;size:number;hash:string}>();
const dynamicDirectories=new Map<string,{mtime:number;ctime:number;ino:number}>();
// A synchronous engine request sees one directory snapshot. Avoid throwing a
// filesystem exception for every missing package/font in every support folder.
// Clear between RPCs so new local overrides are still observed and validated.
const supportEntries=new Map<string,Set<string>|null>();
const observedMissingDirectories=new Set<string>();
function supportEntryExists(file:string){
  const directory=path.dirname(file);let entries=supportEntries.get(directory);
  if(entries===undefined){
    try{entries=new Set(fs.readdirSync(directory).map(name=>process.platform==='win32'?name.toLowerCase():name));}catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;entries=null;}
    supportEntries.set(directory,entries);
  }
  const name=path.basename(file);return !!entries?.has(process.platform==='win32'?name.toLowerCase():name);
}
function observeMissing(file:string){
  // Creation of a formerly missing local override is a dependency change too.
  // Watch the nearest existing parent, deduplicated across failed lookups.
  let directory=path.dirname(file);
  while(true){try{const stat=fs.statSync(directory);if(stat.isDirectory()){if(!dynamicDirectories.has(directory))dynamicDirectories.set(directory,{mtime:stat.mtimeMs,ctime:stat.ctimeMs,ino:stat.ino});return;}}catch{}
    const parent=path.dirname(directory);if(parent===directory)return;directory=parent;}
}
function directoryChanged(directory:string,prior:{mtime:number;ctime:number;ino:number}){
  try{const stat=fs.statSync(directory);return stat.mtimeMs!==prior.mtime||stat.ctimeMs!==prior.ctime||stat.ino!==prior.ino;}catch{return true;}
}
const dynamicResourceData=new Map<string,Uint8Array>();
class Unavailable extends Error{}
class SourceError extends Error{}
type Checkpoint={pages:Buffer[];length:number;streams:any[];files:Map<string,Uint8Array>;prefix:Buffer;offset:number;page?:number;reusedBytes?:number};
type AuxiliaryCheckpoint={state:Checkpoint;inputs:Set<string>;auxiliary:Map<string,Uint8Array>;mathEnabled:boolean};
let auxiliaryCheckpoint:AuxiliaryCheckpoint|undefined;
// Exact-byte sharing only, never an execution state. Retained for one aux pass.
let auxiliaryPages:{pages:Buffer[]}|undefined;
let auxiliaryCheckpointSupported=process.env.PERSISTENT_TEX_DISABLE_AUX_CHECKPOINT!=='1';
const auxiliaryMarker='TXQ'+randomUUID().replaceAll('-','');
function auxiliaryInputsMatch(saved:AuxiliaryCheckpoint){
 for(const name of new Set([...saved.auxiliary.keys(),...auxiliary.keys()])){
  if(!saved.inputs.has(name))continue;
  const old=saved.auxiliary.get(name),next=auxiliary.get(name);
  if(!old||!next||!Buffer.from(old).equals(Buffer.from(next)))return false;
 }
 return true;
}
// Bounded same-page pairs from the converged full build. The post-picture state is
// only a shortcut for producing its unchanged baseline; edited source must
// resume before the picture, and the ordinary raster proof still authorizes it.
type PageWitness={source:Buffer;start:number;end:number;before:Checkpoint;after:Checkpoint;pageCostMs:number};
let passPageWitnesses:PageWitness[]=[];
// Real execution states after expensive root-input stretches. Source-prefix
// equality includes read-ahead; these never replay a picture out of context.
let expensivePrefixes:{initial:Checkpoint;points:Checkpoint[]}|undefined;
// One unsealed local result, optionally with its existing geometry prefix and
// pre-geometry boundary. All share one 32 MiB incremental allowance. A full
// resume requires the same initial/input context and exact consumed bytes.
let pageContinuation:{prefixOnly?:boolean;prefixBefore?:Checkpoint;prefix?:Checkpoint;checkpoint:Checkpoint;initial:Checkpoint;environment:string;resources:string;boundaries:number[];witnesses:PageWitness[];dependencies:RegionState['dependencies'];directories:RegionState['directories']}|undefined;
// Byte-sharing donor only: it cannot resume execution or supply files/streams.
// A WeakRef avoids retaining an obsolete preamble; only one flat heap survives.
let continuationPages:{initial:WeakRef<Checkpoint>;pages:Buffer[]}|undefined;
let pictureFocus:number|undefined;
function pictureWitnessRanges(source:string,at:number){
  if(source.length>2*1024*1024||process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS==='1')return [];
  // Literal environments only guide capture; TeX still interprets the source,
  // and exact byte/context checks plus a full-page pixel proof authorize reuse.
  const pictures:{from:number;to:number;finish:number}[]=[],stack:number[]=[];
  let scanned=0,scannedBytes=0;
  for(const m of source.matchAll(/\\(begin|end)\{tikzpicture\}/g)){
    const end=m.index!+m[0].length;scannedBytes+=Buffer.byteLength(source.slice(scanned,end));scanned=end;
    if(m[1]==='begin')stack.push(m.index!);
    else if(stack.length){const begin=stack.pop()!;if(!stack.length)pictures.push({from:begin,to:end,finish:scannedBytes});}
  }
  let from=0,byteFrom=0,picture=0;const ranges:{start:number;end:number;finish:number;picture:number}[]=[];
  for(const separator of source.matchAll(/\n(?:[\t ]*\n)+/g)){
    const to=separator.index!+separator[0].length,text=source.slice(from,to),byteTo=byteFrom+Buffer.byteLength(text);
    while(picture<pictures.length&&pictures[picture].to<=from)picture++;
    const enclosing=pictures[picture];
    if(text.length<=12000&&enclosing&&enclosing.from<to&&enclosing.to>from){
      const finish=Math.max(byteTo,enclosing.finish),range={start:byteFrom,end:byteTo,finish};
      if(finish-byteTo<=65536)ranges.push({...range,picture});
    }
    from=to;byteFrom=byteTo;
  }
  const focus=ranges.find(range=>at>=range.start&&at<range.end)??ranges[0];
  if(!focus)return [];
  // Keep one neighboring drawing as well as the focused drawing. Both share
  // the aggregate checkpoint budget below; a cursor move must not require a
  // fresh full build merely because the target block contains no glyphs.
  const nearby=[...new Set(ranges.map(range=>range.picture))].sort((a,b)=>Math.abs(a-focus.picture)-Math.abs(b-focus.picture)).slice(0,2);
  return nearby.flatMap(picture=>ranges.filter(range=>range.picture===picture).sort((a,b)=>Math.abs(a.start-focus.start)-Math.abs(b.start-focus.start)).slice(0,6));
}
function witnessExtraBytes(before:Checkpoint,...after:Checkpoint[]){
  const prior=new Set<Uint8Array>([...before.pages,...before.files.values(),before.prefix]),extra=new Set<Uint8Array>(after.flatMap(c=>[...c.pages,...c.files.values(),c.prefix]));
  let bytes=0;for(const buffer of extra)if(!prior.has(buffer))bytes+=buffer.byteLength;
  return bytes;
}
function witnessWithinBudget(before:Checkpoint,...after:Checkpoint[]){return witnessExtraBytes(before,...after)<=32*1024*1024;}
function witnessBeforeHint(bytes:Buffer,at:number){
  let best=initial.offset;
  // Local edits can shift every old byte offset. Map small unchanged source
  // contexts instead; a mapped offset is only a hint, captured if the new full
  // execution actually reaches a valid checkpoint there.
  for(const offset of boundaries.filter(offset=>offset<=Math.min(previousBody.length,at+8192)).slice(-32)){
    for(const limit of [64,32,16]){
      const length=Math.min(limit,offset);if(!length||length>at)continue;
      const context=previousBody.subarray(offset-length,offset),found=bytes.lastIndexOf(context,at-length);
      if(found>=0)best=Math.max(best,found+length);
    }
  }
  return best;
}
let restoreTiming={heapMs:0,filesMs:0,streamsMs:0,heapBytes:0,copiedBytes:0};
let readyCheckpoint:{checkpoint:Checkpoint;duration:number;detail:typeof restoreTiming;finishedAt:number}|undefined;
const clone=(s:any)=>s?Object.assign(Object.create(Object.getPrototypeOf(s)),s,{...(s.shared?{shared:{...s.shared}}:{}),ungotten:[...(s.ungotten??[])]}):s;
function workFiles(directory='/work',prefix=''):Map<string,Uint8Array>{
  const files=new Map<string,Uint8Array>();
  for(const name of FS.readdir(directory)){
    if(name==='.'||name==='..')continue;const file=directory+'/'+name,relative=prefix+name;
    if(FS.isDir(FS.stat(file).mode)){for(const [nested,bytes]of workFiles(file,relative+'/'))files.set(nested,bytes);}
    else files.set(relative,FS.readFile(file));
  }
  return files;
}
function writeWork(name:string,bytes:Uint8Array|string){
  if(name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').includes('..'))throw new Error('Invalid project resource path.');
  // Immutable input/font files normally survive a warm edit unchanged. Avoid
  // recreating MEMFS nodes and copying their bytes on every restore.
  try{const node=FS.lookupPath('/work/'+name).node,content=node.contents,saved=typeof bytes==='string'?Buffer.from(bytes):Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(content?.buffer&&node.usedBytes===saved.length&&Buffer.from(content.buffer,content.byteOffset,saved.length).equals(saved))return;
  }catch{/* Missing files are recreated below, including unlinked error output. */}
  FS.mkdirTree('/work/'+path.posix.dirname(name));FS.writeFile('/work/'+name,bytes);
}
function restoreWork(files:Map<string,Uint8Array>,directory='/work',prefix=''){
  for(const name of FS.readdir(directory)){
    if(name==='.'||name==='..')continue;const file=directory+'/'+name,relative=prefix+name;
    if(FS.isDir(FS.stat(file).mode)){restoreWork(files,file,relative+'/');if(FS.readdir(file).length===2)FS.rmdir(file);}
    else if(!files.has(relative))FS.unlink(file);
  }
  if(directory==='/work'){FS.mkdirTree('/work/.persistent-tex');for(const [name,bytes]of files)writeWork(name,bytes);}
}
function capture(prefix:Buffer,offset:number,base?:Checkpoint,reuse?:{pages:Buffer[]}):Checkpoint{
  const live=Buffer.from(context.HEAPU8.buffer),pages:Buffer[]=[],intern=new Map<string,Buffer>();
  let reusedBytes=0,copiedBytes=0;
  const fastIntern=(base||reuse)&&process.env.PERSISTENT_TEX_DISABLE_SNAPSHOT_FAST_INTERN!=='1'?new CheckpointPages():undefined;
  for(let start=0;start<live.length;start+=65536){
    const page=live.subarray(start,Math.min(start+65536,live.length)),recent=reuse?.pages[start/65536],prior=base?.pages[start/65536];
    // Consecutive edited-picture results differ far less than either differs
    // from its pre-picture state. Share only byte-identical immutable pages;
    // changed pages still follow the ordinary copy/intern path below.
    if(recent&&page.equals(recent)){pages.push(recent);reusedBytes+=page.length;continue;}
    if(prior&&page.equals(prior)){pages.push(prior);continue;}
    // Nearby captures use a bounded exact-equality pool before SHA interning.
    // Duplicate blocks share one allocation, including sample-key collisions.
    // Cold snapshots retain ordinary interning of the large unused arrays.
    if(fastIntern){const saved=fastIntern.intern(page);if(saved){pages.push(saved);continue;}}
    else if(recent&&process.env.PERSISTENT_TEX_DISABLE_CONTINUATION_DONOR!=='1'&&copiedBytes+page.length<=8*1024*1024){pages.push(Buffer.from(page));copiedBytes+=page.length;continue;}
    // TeX reserves large arrays whose unused pages contain identical data.
    // Share those pages rather than committing hundreds of MB per snapshot.
    const key=digest(page);let saved=intern.get(key);
    if(!saved){saved=Buffer.from(page);intern.set(key,saved);}pages.push(saved);
  }
  return {pages,length:live.length,reusedBytes,streams:FS.streams.map((stream:any)=>stream?{copy:clone(stream),path:stream.path}:stream),files:workFiles(),prefix:Buffer.from(prefix.subarray(0,offset)),offset,page:Module._persistentPageLast?Module._persistentPageLast()+1:undefined};
}
function restore(state:Checkpoint){
  const started=performance.now();let copiedBytes=0;
  context.closeFSStreams();
  // Most of the 149 MB TeX heap is unchanged between keystrokes. Native
  // comparisons skip those pages instead of writing the whole heap back.
  const live=Buffer.from(context.HEAPU8.buffer,context.HEAPU8.byteOffset,state.length);
  for(let index=0;index<state.pages.length;index++){
    const saved=state.pages[index],offset=index*65536;
    if(!saved.equals(live.subarray(offset,offset+saved.length))){live.set(saved,offset);copiedBytes+=saved.length;}
  }
  const heapAt=performance.now();
  restoreWork(state.files);
  const filesAt=performance.now();
  FS.streams=state.streams.map(entry=>{
    if(!entry)return entry;const stream=clone(entry.copy);
    // A fatal TeX error can unlink its partial PDF. Recreated work files have
    // new MEMFS nodes, so saved streams must bind to those nodes, not the old
    // unlinked file that was present when the checkpoint was captured.
    if(entry.path?.startsWith('/work/'))stream.node=FS.lookupPath(entry.path).node;
    return stream;
  });FS.chdir('/work');context.memlog='';mathPlans=0;mathCache?.discardProvisional();
  restoreTiming={heapMs:heapAt-started,filesMs:filesAt-heapAt,streamsMs:performance.now()-filesAt,heapBytes:state.length,copiedBytes};
}
async function initialize(){
  let metadata=JSON.parse(fs.readFileSync(path.join(assets,'format.json'),'utf8'));
  const kpse=(args:string[])=>execFileSync('kpsewhich',args,{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  // These hints are generated from the selected installation at app startup,
  // never from paths baked into the developer's compiler metadata.
  let selected:{root?:string;files?:Record<string,string>;formatManifest?:string}|undefined;try{selected=JSON.parse(process.env.TEXQUISITE_TEX_RESOURCES??'null');}catch{}
  let selectedFormatBytes:Buffer|undefined;
  if(selected?.formatManifest){const cached=preparedFormat(selected.formatManifest,assets);if(!cached)throw new Unavailable('The prepared format or its TeX inputs changed. Prepare fast preview again in Build Settings.');metadata=cached;selectedFormatBytes=cached.formatBytes;}
  let root:string;try{root=selected?.root??kpse(['-var-value=TEXMFDIST']);if(!fs.existsSync(path.join(root,'ls-R')))throw Error('No TeX Live index.');}catch{throw new Unavailable('Fast preview requires a compatible TeX Live installation. Open Build Settings to check the selected installation.');}
  const index=new Map<string,string>();let directory='';
  for(const line of fs.readFileSync(path.join(root,'ls-R'),'utf8').split(/\r?\n/)){
    if(line.startsWith('./')&&line.endsWith(':'))directory=line.slice(2,-1);
    else if(line&&/^(tex|fonts|web2c)\//.test(directory)&&!line.startsWith('%')){
      if(!index.has(line)||directory.startsWith('tex/latex/'))index.set(line,path.join(root,directory,line));
    }
  }
  for(const [name,expected]of Object.entries(metadata.fingerprints)){
    const file=selected?.files?.[name]??kpse([name]);if(!file||formatFingerprint(name,fs.readFileSync(file),metadata.fingerprintPolicy)!==expected)throw new Unavailable('The bundled format does not match installed '+name+'. Using the selected native engine.');
    index.set(name,file);
  }
  for(const name of ['pdftex.map']){const file=selected?.files?.[name]??kpse([name]);if(file)index.set(name,file);}
  mathCache=TikzMathCache.create(assets,index);
  // Synchronous resource requests stay inside this worker and read only indexed
  // TeX assets. No browser request or project source is sent to a server.
  class LocalRequest{
    url='';status=301;headers:Record<string,string>={};response:ArrayBuffer=new ArrayBuffer(0);
    open(_method:string,url:string){this.url=url;}
    getResponseHeader(name:string){return this.headers[name.toLowerCase()]??null;}
    send(){
      startupLookups.distribution++;
      const parts=new URL(this.url).pathname.split('/'),name=decodeURIComponent(parts.at(-1)!),format=parts.at(-2);
      if(!name||name==='.'||name==='..'||/[\\/\0:]/.test(name))return;
      if(name==='swiftlatexpdftex.fmt'&&selectedFormatBytes){const bytes=selectedFormatBytes;this.status=200;this.headers={fileid:name};this.response=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return;}
      const file=(name==='swiftlatexpdftex.fmt'?[path.join(assets,'pdflatex.fmt')]:[index.get(name),index.get(name+(format==='3'?'.tfm':'.tex'))]).find(candidate=>candidate&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
      if(!file||!fs.existsSync(file))return;
      const bytes=fs.readFileSync(file);this.status=200;this.headers={fileid:name};this.response=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
    }
  }
  let ready!:()=>void;const initialized=new Promise<void>(resolve=>ready=resolve);
  context=vm.createContext({console:{log:()=>{},error:()=>{},warn:()=>{}},process,require,module:{exports:{}},__dirname:assets,TextDecoder,TextEncoder,WebAssembly,Buffer,setTimeout,clearTimeout,XMLHttpRequest:LocalRequest,wasmBytes:new Uint8Array(fs.readFileSync(path.join(assets,'pdftex.wasm')))});
  context.self=context;context.postMessage=()=>ready();if(process.env.PERSISTENT_TEX_TIKZ_MATH_TRACE==='1')context.persistentMathGuardTrace=(...values:number[])=>console.error('MATHGUARD',values);
  // Keep successful pure results outside the restored heap. A local edit can
  // use calculations learned by the preceding edit without rebuilding its
  // preamble or replaying unchanged source. The engine validates definitions,
  // literal token categories and angle mode before asking for a value.
  if(process.env.PERSISTENT_TEX_DISABLE_LIVE_MATH_MEMO!=='1')context.persistentMathLookup=(expression:string,mode:number)=>mathCache?.lookup(expression,mode);
  if(process.env.PERSISTENT_TEX_DISABLE_MATH_PLANS!=='1')context.persistentMathPlan=(expression:string,mode:number)=>{let reused=0;const lookup=mathCache&&(Module?._persistentMathGuardVersion?.()??0)>=5&&process.env.PERSISTENT_TEX_DISABLE_INTERMEDIATE_MATH!=='1'?(key:string)=>{const result=mathCache!.intermediate(key,mode);if(result!==undefined)reused++;return result;}:undefined;const plan=buildTikzMathPlan(expression,lookup);if(plan){mathPlans++;if(plan.startsWith('P|')&&plan.includes('r'))mathCache?.usedIntermediate(reused);}return plan;};
  // An isolated comparison found no improvement over the existing Wasm zlib.
  // Keep this experiment opt-in; it does not reduce the amount of TeX work.
  if(process.env.PERSISTENT_TEX_NATIVE_ZLIB==='1'&&!process.env.PERSISTENT_TEX_WASM_ZLIB)context.persistentCompress=compressPreview;
  const code=fs.readFileSync(path.join(assets,'pdftex.js'),'utf8').replace(/var Module\s*=\s*\{\};/,'var Module={wasmBinary:wasmBytes};');
  vm.runInContext(code,context,{filename:'resident-pdftex.js'});await initialized;
  FS=context.FS;Module=context.Module;if(!Module._persistentMathGuardVersion)mathCache=undefined;
  // Emscripten's stdout/stderr dispatchers stay outside heap snapshots. Feed
  // their small chunks directly; never rescan/flatten the growing full log.
  for(const name of ['out','err']){const output=context[name];if(mathCache&&typeof output==='function')context[name]=(line:string)=>{output(line);mathCache?.observeOutput(line+'\n');};}

  const fontBytes=(file:string)=>{
    const node=FS.lookupPath(file).node,content=node.contents,size=node.usedBytes;
    // MEMFS owns the opened font bytes already. This view is used only while
    // constructing an owned exact cache key; it never survives the lookup.
    if(content?.buffer&&Number.isSafeInteger(size)&&size>=0&&size<=content.byteLength){if(size>8*1024*1024)return;return Buffer.from(content.buffer,content.byteOffset,size);}
    if(FS.stat(file).size>8*1024*1024)return;return Buffer.from(FS.readFile(file));
  };
  const installFontCache=(name:string,cache:FontBodyCache)=>{
    let key:Buffer|undefined,body:Buffer|undefined;
    context[name+'Get']=(file:string,...parts:Uint8Array[])=>{
      key=body=undefined;if(name==='persistentFontProgram'&&process.env.PERSISTENT_TEX_COMPLETE_FONT_CACHE==='0')return 0;if(!fastFlowCapture||process.env.PERSISTENT_TEX_DISABLE_FONT_BODY_CACHE==='1')return 0;
      try{const font=fontBytes(file);if(!font)return 0;const buffers=[font,...parts.map(p=>Buffer.from(p.buffer,p.byteOffset,p.byteLength))],sizes=Buffer.alloc(buffers.length*4);buffers.forEach((p,i)=>sizes.writeUInt32LE(p.length,i*4));key=Buffer.concat([sizes,...buffers]);body=cache.get(key);return body?.length??0;}catch{return 0;}
    };
    context[name+'Read']=(heap:Uint8Array,offset:number)=>{if(!body)throw new Error('Missing font cache payload.');heap.set(body,offset);};
    context[name+'Store']=(...parts:Uint8Array[])=>{if(key&&!body)cache.put(key,Buffer.concat(parts.map(p=>Buffer.from(p))));key=body=undefined;};
  };
  installFontCache('persistentFontProgram',fontProgramCache);installFontCache('persistentFontEncoding',fontEncodingCache);installFontCache('persistentFontBody',fontBodyCache);
  context.persistentFontMemoryInitial=()=>process.env.PERSISTENT_TEX_EAGER_FONT_MEMORY==='1'?8000000:100000;
  context.persistentFontProgramEnabled=()=>fastFlowCapture&&process.env.PERSISTENT_TEX_COMPLETE_FONT_CACHE!=='0';
  context.persistentFontOptimizationEnabled=()=>fastFlowCapture&&process.env.PERSISTENT_TEX_DISABLE_FONT_BODY_CACHE!=='1';
  context.persistentFontPhase=(phase:number)=>{if(phase===0)fontStarted=performance.now();else{nativeFontMs+=performance.now()-fontStarted;nativeFonts++;}};
  context.persistentPrefixMatches=(start:number,end:number,buffer:Uint8Array)=>!!prefixProbeSource&&start>=0&&end>=start&&end<=prefixProbeSource.length&&prefixProbeSource.subarray(start,end).equals(Buffer.from(buffer.buffer,buffer.byteOffset,buffer.byteLength));
  context.persistentLocalSuperseded=localSuperseded;
  context.persistentStateDigest=(bytes:Uint8Array)=>{
    const started=performance.now(),live=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(sealStarted)digestStarted=started;
    if(fastFlowCapture&&localRegion){
      const baseline=localRegion.flowTable??={bytes:Buffer.from(live),rawTag:randomUUID(),flowTag:randomUUID()};
      const offset=27160*8+4;
      regionStateHashReused=baseline.bytes.equals(live);
      fastFlowEqual=regionStateHashReused||baseline.bytes.subarray(0,offset).equals(live.subarray(0,offset))&&baseline.bytes.subarray(offset+4).equals(live.subarray(offset+4));
      regionStateHash=regionStateHashReused?baseline.rawTag:randomUUID();regionStateHashMs=performance.now()-started;regionStateBytes=bytes.byteLength;if(sealStarted)digestFinished=performance.now();
      return true;
    }
    // Most text edits leave this table identical. Native byte comparison reads
    // every byte; only exact equality can reuse the prior digest. Own a copy,
    // since restoring/mutating the Wasm heap must not change the saved table.
    regionStateHashReused=!!priorRegionState&&live.equals(priorRegionState.bytes);
    if(!regionStateHashReused)priorRegionState={bytes:Buffer.from(live),hash:digest(live)};
    regionStateHash=priorRegionState!.hash;regionStateHashMs=performance.now()-started;regionStateBytes=bytes.byteLength;
    // Tests can additionally require the legacy file path to prove byte parity.
    if(sealStarted)digestFinished=performance.now();return process.env.PERSISTENT_TEX_VERIFY_STATE_HASH!=='1';
  };
  // Observe real engine lookups, including failed existence checks. Static TeX
  // parsing cannot safely identify arbitrary preambles or macro-built inputs.
  for(const method of ['open','stat','lookupPath']){
    const original=FS[method];FS[method]=function(file:any,...args:any[]){trackInput(file);return original.call(this,file,...args);};
  }
  context.resolveProjectResource=(requested:string,format:number)=>{
    startupLookups.support++;
    const name=requested.replace(/^\.\//,'');
    trackInput(name);trackInput(name+'.tex');trackInput(name+'.sty');trackInput(name+'.cls');
    if(path.posix.isAbsolute(name)||name.includes('\\')||name.includes(':')||name.split('/').includes('..'))return;
    // These belong to this compiler's auxiliary cache. Importing old Beamer
    // navigation or other generated files from a support folder can poison
    // both the resident build and the subsequent native fallback.
    if(/\.(aux|out|toc|lof|lot|bbl|bcf|log|nav|snm|vrb|fls|fdb_latexmk|synctex(?:\.gz)?|run\.xml)$/i.test(name))return;
    const candidates=path.posix.extname(name)?[name]:[name,name+(format===3?'.tfm':'.tex')];
    for(const folder of supportFolders)for(const candidate of candidates){
      const file=path.join(folder,candidate);
      if(!supportEntryExists(file)){const directory=path.dirname(file);if(!observedMissingDirectories.has(directory)){observeMissing(file);observedMissingDirectories.add(directory);}continue;}
      try{
        startupLookups.supportChecks++;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()){observeMissing(file);continue;}
        const relative=path.relative(fs.realpathSync(folder),fs.realpathSync(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
        if(stat.size>64*1024*1024)throw new Unavailable('A dynamically requested support file exceeds 64 MB.');
        const virtual='/project-resources/'+candidate;
        if(!dynamicFiles.has(file)){
          const bytes=fs.readFileSync(file);dynamicFiles.set(file,{mtime:stat.mtimeMs,ctime:stat.ctimeMs,ino:stat.ino,size:stat.size,hash:digest(bytes)});
          dynamicResourceData.set(candidate,bytes);
          FS.mkdirTree(path.posix.dirname(virtual));FS.writeFile(virtual,bytes);
        }
        return virtual;
      }catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;observeMissing(file);}
    }
  };
  vm.runInContext('const distributionLookup=kpse_find_file_impl;kpse_find_file_impl=function(ptr,format,must){const local=resolveProjectResource(UTF8ToString(ptr),format);return local?_allocate(intArrayFromString(local)):distributionLookup(ptr,format,must);};',context);
}
async function compilePass(nextPreamble:string,body:string,resources:[string,Uint8Array][]=[],key='',jobName='main',anchor?:number){
  const previousWitnesses=passPageWitnesses;passPageWitnesses=[];
  const started=performance.now();if(!context)await initialize();const initializedAt=performance.now();
  const bytes=Buffer.from(nextPreamble+body);
  // Pictures may expand from a package command or inline \tikz. The TeX
  // installer checks actual PGF availability and guarded definitions; literal
  // picture syntax in the root source is not evidence of runtime eligibility.
  const mathInstall='\\TxqMathIfVMode\\TxqMathIfnum\\TxqMathGlobalDefs=0 \\TxqMathBeginGroup\\TxqMathEveryEOF{}\\TxqMathEndlineChar=13 \\TxqMathInput \".persistent-tex/math-install.tex\" \\TxqMathEndGroup\\TxqMathFi\\TxqMathFi';
  const earlyEnabled=auxiliaryCheckpointSupported&&bytes.length<=2*1024*1024&&context.HEAPU8.byteLength<=192*1024*1024&&resources.reduce((size,[,data])=>size+data.byteLength,0)<=16*1024*1024;
  const startup=(withMath:boolean)=>earlyEnabled?'\\input{".persistent-tex/bootstrap/'+jobName+'.tex"}\\input{"'+jobName+'.tex"}':(withMath?'\\input{".persistent-tex/bootstrap/'+jobName+'.tex"}':'')+'\\AddToHook{begindocument/end}{\\pdfmapline{+}\\let\\PersistentTeXCheckpoint\\relax'+(withMath?mathInstall:'')+'\\PersistentTeXCheckpoint}\\input{"'+jobName+'.tex"}';
  const mathEnabled=!!mathCache&&bytes.length<=2*1024*1024&&Buffer.byteLength(startup(true))<512;
  const preambleRebuilt=!initial||initialMathEnabled!==mathEnabled||bytes.length<initial.offset||!bytes.subarray(0,initial.offset).equals(initial.prefix);
  let auxiliaryCheckpointReused=false;
  let preambleRestoreMs=0,preambleSetupMs=0,preambleReplayMs=0,preambleCaptureMs=0;
  if(preambleRebuilt){
    const donor=auxiliaryPages;auxiliaryPages=undefined;
    pageContinuation=undefined;continuationPages=undefined;
    initial=bodyState=undefined;boundaries=[];previousBody=Buffer.alloc(0);preamble=nextPreamble;
    auxiliaryCheckpointReused=!!earlyEnabled&&!!auxiliaryCheckpoint&&auxiliaryCheckpoint.mathEnabled===mathEnabled&&bytes.length>=auxiliaryCheckpoint.state.offset&&bytes.subarray(0,auxiliaryCheckpoint.state.offset).equals(auxiliaryCheckpoint.state.prefix)&&auxiliaryInputsMatch(auxiliaryCheckpoint);
    if(auxiliaryCheckpointReused){
      const saved=auxiliaryCheckpoint!;restore(saved.state);preambleInputs=new Set(saved.inputs);
      for(const name of saved.auxiliary.keys())if(!auxiliary.has(name))try{FS.unlink('/work/'+name);}catch{}
    }else{
      auxiliaryCheckpoint=undefined;context.prepareExecutionContext();context.cleanDir('/work');
      FS.mkdirTree('/work/.persistent-tex');preambleInputs=new Set();
    }
    const preambleRestoredAt=performance.now();preambleRestoreMs=preambleRestoredAt-initializedAt;
    for(const [name,bytes]of resources)writeWork(name,bytes);
    for(const name of removedResources)try{FS.unlink('/work/'+name);}catch{}
    for(const [name,bytes]of auxiliary)writeWork(name,bytes);
    writeWork(jobName+'.tex',bytes);
    if(!auxiliaryCheckpointReused){
      const stage=(phase:string)=>'\\let\\PersistentTeXCheckpoint\\relax\\TxqCheckpointImmediate\\TxqCheckpointWrite16{'+auxiliaryMarker+phase+'}\\PersistentTeXCheckpoint';
      const hooks=earlyEnabled?'\n\\let\\TxqCheckpointWrite\\write\\let\\TxqCheckpointImmediate\\immediate\\AddToHook{begindocument/before}[texquisite]{'+stage('A')+'}\\AddToHook{begindocument/end}[texquisite]{\\pdfmapline{+}'+(mathEnabled?mathInstall:'')+stage('B')+'}\n':'';
      if(mathEnabled||earlyEnabled)writeWork('.persistent-tex/bootstrap/'+jobName+'.tex',(mathEnabled?mathCache!.primitives():'')+hooks);
    }
    if(mathEnabled){const version=Module._persistentMathGuardVersion?.()??0;writeWork('.persistent-tex/math-install.tex',mathCache!.install(version>=1,version>=2,version>=3&&process.env.PERSISTENT_TEX_DISABLE_MATH_PLANS!=='1'));}
    initialMathEnabled=mathEnabled;initialMathEntries=mathEnabled?mathCache!.size:0;
    const bootstrap=startup(mathEnabled);
    if(Buffer.byteLength(bootstrap)>=512)throw new Error('The document filename requires the native startup path.');
    if(!auxiliaryCheckpointReused)Module.cwrap('setMainEntry','number',['string'])(bootstrap);Module._persistentEnableCheckpoint(1);
    const advance=(resume:boolean)=>{trackingPreamble=true;try{return resume?Module._persistentResume():Module._compileLaTeX();}finally{trackingPreamble=false;}};
    const preambleSetupAt=performance.now();preambleSetupMs=preambleSetupAt-preambleRestoredAt;
    let result:number=advance(auxiliaryCheckpointReused),stops=0;
    if(earlyEnabled)while(result===100){
      ++stops;
      const before=context.memlog.lastIndexOf(auxiliaryMarker+'A'),after=context.memlog.lastIndexOf(auxiliaryMarker+'B'),kind=Module._persistentCheckpointKind();
      if(kind===0&&after>=0&&after>before)break;
      if(stops>256){auxiliaryCheckpointSupported=false;auxiliaryCheckpoint=undefined;initial=undefined;return compilePass(nextPreamble,body,resources,key,jobName,anchor);}
      if(kind===0&&before>=0&&before>after){
        const stream=FS.streams.find((stream:any)=>stream?.path==='/work/'+jobName+'.tex');
        if(stream&&!auxiliaryCheckpointReused)auxiliaryCheckpoint={inputs:new Set(preambleInputs),auxiliary:new Map(auxiliary),mathEnabled,state:capture(bytes,stream.position)};
      }else if(kind===0){
        // Custom logging/hooks may hide phase markers. Fall back to the former
        // single checkpoint rather than guessing where auxiliary input began.
        auxiliaryCheckpointSupported=false;auxiliaryCheckpoint=undefined;initial=undefined;
        return compilePass(nextPreamble,body,resources,key,jobName,anchor);
      }
      result=advance(true);
    }
    if(result!==100)throw new Error('Build failed or the document bypassed the resident preamble checkpoint.\n'+context.memlog);
    const sourceStream=FS.streams.find((stream:any)=>stream?.path==='/work/'+jobName+'.tex');
    if(!sourceStream)throw new Error('The document closed its source before the preamble checkpoint. A native build is required.');
    initialMathActive=mathEnabled&&(Module._persistentMathGuardCount?.()??0)>0;if(!initialMathActive)initialMathEntries=0;
    const preambleReplayedAt=performance.now();preambleReplayMs=preambleReplayedAt-preambleSetupAt;
    initial=capture(bytes,sourceStream.position,auxiliaryCheckpoint?.state,auxiliaryCheckpointReused?donor:undefined);preambleCaptureMs=performance.now()-preambleReplayedAt;
  }
  const preambleAt=performance.now();
  let unchanged=0;
  while(unchanged<Math.min(bytes.length,previousBody.length)&&bytes[unchanged]===previousBody[unchanged])unchanged++;
  // The full build can use the same ordinary execution checkpoints retained
  // for picture preparation. In particular, a label edit need not repeat the
  // unchanged geometry before it when the user immediately moves elsewhere.
  // These are full-execution snapshots, never sealed speculative page output.
  // Prefix equality includes TeX's input read-ahead. Resource, auxiliary,
  // mapping and preamble invalidation must discard the witnesses first.
  // A cursor may return before the post-picture checkpoint. The earlier real
  // prefix remains eligible only when every byte it consumed still matches.
  const continuation=!preambleRebuilt&&pageContinuation&&pageContinuation.initial===initial&&pictureFocus!==undefined&&(pictureFocus>=pageContinuation.checkpoint.offset||pageContinuation.prefix&&process.env.PERSISTENT_TEX_DISABLE_FULL_PREFIX!=='1')&&pageContinuation.environment===regionEnvironment(environmentKey,jobName)&&pageContinuation.resources===resourceSignature(resources)&&dependenciesValid(pageContinuation)?pageContinuation:undefined;
  const savedPrefixes=!preambleRebuilt&&expensivePrefixes&&expensivePrefixes.initial===initial&&process.env.PERSISTENT_TEX_DISABLE_EXPENSIVE_PREFIX!=='1'?expensivePrefixes.points:[];
  const candidates:Checkpoint[]=[...savedPrefixes,initial,bodyState,continuation&&!continuation.prefixOnly&&pictureFocus!>=continuation.checkpoint.offset?continuation.checkpoint:undefined,process.env.PERSISTENT_TEX_DISABLE_FULL_PREFIX!=='1'?continuation?.prefix:undefined,...(!preambleRebuilt&&process.env.PERSISTENT_TEX_DISABLE_FULL_WITNESS_REUSE!=='1'?previousWitnesses.flatMap(w=>[w.before,w.after]):[])].filter((state):state is Checkpoint=>!!state&&bytes.length>=state.offset&&bytes.subarray(0,state.offset).equals(state.prefix));
  const candidate=candidates.reduce((best,state)=>state.offset>best.offset?state:best,initial);
  const localContinuationReused=!continuation?.prefixOnly&&candidate===continuation?.checkpoint,localPrefixReused=candidate===continuation?.prefix,fullWitnessReused=!localContinuationReused&&!localPrefixReused&&candidate!==initial&&candidate!==bodyState;
  const expensivePrefixReused=savedPrefixes.includes(candidate);
  const priorWitnesses=localContinuationReused||localPrefixReused?[...continuation!.witnesses,...previousWitnesses]:previousWitnesses;
  const target=boundaries.filter(offset=>offset<=(anchor??unchanged)).at(-1)??0;
  // Previous boundaries are hints, not assumed offsets after an edit. If a
  // hinted boundary moved, the immutable starting checkpoint remains valid.
  const withinWitnessBudget=context.HEAPU8.byteLength<=192*1024*1024&&resources.reduce((bytes,[,data])=>bytes+data.byteLength,0)<=16*1024*1024;
  const witnessRanges=withinWitnessBudget?pictureWitnessRanges(nextPreamble+body,pictureFocus??unchanged):[];
  const witnesses=witnessRanges.map(range=>{
    // A warm build may start inside or after an earlier picture. Keep its
    // pre-picture state only when the complete execution prefix and initial
    // checkpoint are unchanged; retain its after-state only if that prefix
    // also matches. Otherwise capture a fresh after-state in this pass.
    const prior=!preambleRebuilt?priorWitnesses.find(w=>w.start===range.start&&w.end===range.end&&w.before.offset<=candidate.offset&&bytes.subarray(0,w.before.offset).equals(w.before.prefix)):undefined;
    const retained=prior&&prior.after.offset<=candidate.offset&&bytes.subarray(0,prior.after.offset).equals(prior.source.subarray(0,prior.after.offset))?prior:undefined;
    // Seed only genuine before-states. The after-state must be captured afresh
    // by this full execution, so later local preparation still has a real pair.
    const prefixBefore=localPrefixReused?[continuation!.prefixBefore,continuation!.prefix].filter((c):c is Checkpoint=>!!c&&c.offset<=range.start&&bytes.subarray(0,c.offset).equals(c.prefix)).sort((a,b)=>b.offset-a.offset)[0]:undefined;
    const hints=new Set<number>([witnessBeforeHint(bytes,range.start)]);
    let end=range.start;for(let i=0;i<4&&end>0;i++){hints.add(end);end=bytes.lastIndexOf(10,end-2)+1;}
    return {range,hints,disabled:false,before:prior?.before??prefixBefore??(candidate.offset<=range.start?candidate:undefined as Checkpoint|undefined),after:retained?.after,attempted:!!retained,startedAt:performance.now(),costMs:prior?.pageCostMs??0};
  });
  let witnessCaptureMs=0,witnessCaptureReused=0,lastWitnessCheckpoint:Checkpoint|undefined;
  const trimWitnesses=()=>{
    const buffers=new Set<Uint8Array>([...initial.pages,...initial.files.values(),initial.prefix,...(bodyState?.pages??[])]);let size=0;
    for(const w of witnesses){
      const added=new Set<Uint8Array>();for(const c of [w.before,w.after])if(c)for(const b of [...c.pages,...c.files.values(),c.prefix])if(!buffers.has(b))added.add(b);
      const extra=[...added].reduce((sum,b)=>sum+b.byteLength,0);
      if(size+extra>64*1024*1024){w.before=w.after=undefined;w.disabled=true;w.hints.clear();continue;}
      size+=extra;for(const b of added)buffers.add(b);
    }
    if(lastWitnessCheckpoint&&!witnesses.some(w=>w.before===lastWitnessCheckpoint||w.after===lastWitnessCheckpoint))lastWitnessCheckpoint=undefined;
  };
  const restoredAt=performance.now();restore(candidate);
  const heapRestoredAt=performance.now();
  // Restored files contain the checkpoint's old inputs. Replace them only after
  // rebinding saved streams; any changed open preamble input forces a rebuild.
  for(const [name,data]of resources)writeWork(name,data);
  for(const name of removedResources)try{FS.unlink('/work/'+name);}catch{}
  writeWork(jobName+'.tex',bytes);
  Module._persistentEnableCharacters(characterMapping?1:0);
  const inputsAt=performance.now();
  // Geometry edits can change byte lengths. Old interior offsets are only
  // hints; keep the unchanged pre-geometry boundaries and the actual prefix.
  const prefixPoints=savedPrefixes.filter(c=>c.offset<=candidate.offset&&bytes.subarray(0,c.offset).equals(c.prefix)),prefixEnabled=withinWitnessBudget&&bytes.length<=2*1024*1024&&process.env.PERSISTENT_TEX_DISABLE_EXPENSIVE_PREFIX!=='1';
  let prefixCaptures=0,prefixCaptureMs=0,prefixResumeAt=performance.now();
  let code=Module._persistentResume(),checkpoints=(localContinuationReused?continuation!.boundaries:localPrefixReused?[...continuation!.boundaries.filter(offset=>offset<=continuation!.prefixBefore!.offset),candidate.offset]:boundaries).filter(offset=>offset<=candidate.offset);
  while(code===100){
    const offset=Module._persistentCheckpointOffset();checkpoints.push(offset);
    // Keep only the preamble and one validated body checkpoint: bounded memory.
    let boundaryCheckpoint:Checkpoint|undefined;
    if(offset===target&&offset>candidate.offset)bodyState=boundaryCheckpoint=capture(bytes,offset,initial);
    const beforeRequests=witnesses.filter(w=>!w.disabled&&w.hints.has(offset)&&offset<=w.range.start);
    if(beforeRequests.length){
      const began=performance.now(),saved=offset===target&&offset>candidate.offset?bodyState:capture(bytes,offset,lastWitnessCheckpoint??initial);
      boundaryCheckpoint=saved;
      witnessCaptureMs+=performance.now()-began;lastWitnessCheckpoint=saved;
      for(const w of beforeRequests){w.before=saved;w.startedAt=performance.now();}
    }
    // TeX may checkpoint just before consuming an explicit break preceding a
    // picture. Retain that bounded two-page pair; baseline proof must include
    // its already shipped leading page as well as the current live page.
    const afterRequests=witnesses.filter(w=>w.before&&!w.attempted&&offset>=w.range.finish&&offset<=w.range.finish+8192&&context.HEAPU8.byteLength<=192*1024*1024&&(w.before.page===Module._persistentPageLast?.()+1||w.before.page===Module._persistentPageLast?.()&&/^\s*\\(?:newpage|clearpage)[\t ]*(?:%[^\n]*)?\n\s*$/.test(bytes.subarray(w.before.offset,w.range.start).toString('utf8'))));
    if(afterRequests.length){
      // No engine execution or filesystem mutation occurs between these two
      // requests. The same complete immutable snapshot can serve both sides
      // of a boundary instead of copying its heap/files/streams twice.
      const shared=process.env.PERSISTENT_TEX_DISABLE_BOUNDARY_SHARING!=='1'?boundaryCheckpoint:undefined;
      const began=performance.now(),after=shared??capture(bytes,offset,lastWitnessCheckpoint??afterRequests[0].before);
      if(shared)witnessCaptureReused++;
      witnessCaptureMs+=performance.now()-began;lastWitnessCheckpoint=after;
      for(const w of afterRequests){w.attempted=true;w.costMs=Math.max(w.costMs,began-w.startedAt);if(witnessWithinBudget(w.before!,after))w.after=after;}
    }
    if(beforeRequests.length||afterRequests.length)trimWitnesses();
    // Only real root-input execution states are eligible. Exact consumed bytes,
    // including read-ahead, must still match when this state is restored.
    if(prefixEnabled&&prefixCaptures<2&&offset>candidate.offset&&performance.now()-prefixResumeAt>=80){
      const began=performance.now(),shared=boundaryCheckpoint??(lastWitnessCheckpoint?.offset===offset?lastWitnessCheckpoint:undefined),saved=shared??capture(bytes,offset,initial);
      prefixCaptures++;prefixCaptureMs+=performance.now()-began;
      const proposed=[...prefixPoints.filter(c=>c.offset!==saved.offset),saved].slice(-2);
      if(witnessWithinBudget(initial,...proposed))prefixPoints.splice(0,prefixPoints.length,...proposed);
    }
    prefixResumeAt=performance.now();
    code=Module._persistentResume();
  }
  const math=mathCache?.collect(context.memlog,code===0);
  const log=(math?.log??context.memlog).replace(new RegExp('^'+auxiliaryMarker+'[AB]\\r?\\n','gm'),'');
  if(code!==0){
    const message='Build failed in the resident TeX engine. See build log.\n'+log;
    // A previously successful checkpoint plus an ordinary TeX diagnostic is a
    // draft error, not evidence that this engine cannot handle the document.
    const draftError=!preambleRebuilt&&previousBody.length>0&&/Undefined control sequence|Missing \$ inserted|Missing [}{] inserted|Missing \\endcsname inserted|Extra }, or forgotten|Argument of [^\r\n]+ has an extra }|Runaway argument|Paragraph ended before|File ended while scanning|Missing \\right/i.test(log);
    throw draftError?new SourceError(message):new Error(message);
  }
  previousBody=Buffer.from(bytes);boundaries=checkpoints;
  expensivePrefixes=prefixEnabled?{initial,points:prefixPoints}:undefined;
  // Exact-source families share their post-picture state. Retain the focused
  // range first, then nearby ranges, within one aggregate 64 MiB extra budget.
  const retained=new Set<Uint8Array>([...initial.pages,...initial.files.values(),initial.prefix,...(bodyState?.pages??[])]);
  let retainedBytes=0;
  for(const w of witnesses){
    const closestBefore=checkpoints.filter(offset=>offset<=w.range.start).at(-1)??initial.offset;
    if(!w.before||!w.after||w.before.offset!==closestBefore&&!(localContinuationReused&&continuation!.witnesses.some(prior=>prior.before===w.before&&prior.after===w.after)))continue;
    const buffers=new Set<Uint8Array>([...w.before.pages,...w.before.files.values(),w.before.prefix,...w.after.pages,...w.after.files.values(),w.after.prefix]);
    let extra=0;for(const buffer of buffers)if(!retained.has(buffer))extra+=buffer.byteLength;
    if(retainedBytes+extra>64*1024*1024)continue;
    for(const buffer of buffers)retained.add(buffer);retainedBytes+=extra;
    passPageWitnesses.push({source:bytes,...w.range,before:w.before,after:w.after,pageCostMs:w.costMs});
  }
  const typesetAt=performance.now();
  const pdf=new Uint8Array(FS.readFile('/work/'+jobName+'.pdf'));
  const snapshots=new Set<Buffer>([...(auxiliaryCheckpoint?.state.pages??[]),...initial.pages,...(bodyState?.pages??[]),...prefixPoints.flatMap(c=>c.pages)]);
  const checkpointBytes=Array.from(snapshots).reduce((size,page)=>size+page.length,0);
  const navigation=FS.analyzePath('/work/.persistent-tex/navigation.jsonl').exists?FS.readFile('/work/.persistent-tex/navigation.jsonl',{encoding:'utf8'}):'';
  return {pdf,navigation,log,timing:{totalMs:performance.now()-started,initializationMs:initializedAt-started,preambleMs:preambleAt-initializedAt,preambleStages:{restoreMs:preambleRestoreMs,setupMs:preambleSetupMs,replayMs:preambleReplayMs,captureMs:preambleCaptureMs},resumeMs:performance.now()-restoredAt,restoreMs:heapRestoredAt-restoredAt,inputsMs:inputsAt-heapRestoredAt,typesetMs:typesetAt-inputsAt,outputMs:performance.now()-typesetAt,checkpointOffset:candidate.offset,preambleOffset:initial.offset,preambleRebuilt:preambleRebuilt&&!auxiliaryCheckpointReused,auxiliaryCheckpointReused,bodyCheckpointRebuilt:preambleRebuilt,expensivePrefixReused,prefixCaptures,prefixCaptureMs,expensivePrefixEntries:prefixPoints.length,expensivePrefixBytes:witnessExtraBytes(initial,...prefixPoints),fullWitnessReused,localContinuationReused,localPrefixReused,checkpointBytes,bytes:pdf.length,tikzMathPlans:mathPlans,tikzMathEntries:initialMathEntries,tikzMathLearned:math?.records,tikzMathHits:math?.hits,tikzMathProvisionalHits:math?.provisionalHits,tikzMathIntermediateHits:math?.intermediateHits,tikzMathIntermediateLearned:math?.intermediateLearned,tikzMathIntermediateEntries:math?.intermediateEntries,pageWitnessCaptured:passPageWitnesses.length>0,pageWitnessCount:passPageWitnesses.length,witnessCaptureMs,witnessCaptureReused}};
}
const auxSignature=(files:Map<string,Uint8Array>)=>digest(Buffer.concat([...files].sort(([a],[b])=>a.localeCompare(b)).flatMap(([name,bytes])=>[Buffer.from(name+'\0'),Buffer.from(bytes)])));
let removedResources:string[]=[];
let auxiliaryCacheFile:string|undefined;
const auxiliaryCacheLimit=4*1024*1024;
function auxiliaryCacheKey(source:string,key:string,environment:string,job:string){return digest(Buffer.from(JSON.stringify([source,key,environment,job])));}
function readAuxiliaryCache(key:string){
  if(!auxiliaryCacheFile)return false;
  try{
    const stat=fs.lstatSync(auxiliaryCacheFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>auxiliaryCacheLimit)return false;
    const saved=JSON.parse(fs.readFileSync(auxiliaryCacheFile,'utf8'));
    if(saved.schema!==1||saved.key!==key||!Array.isArray(saved.files)||!Array.isArray(saved.dependencies)||!Array.isArray(saved.directories))return false;
    if(!dependenciesValid({dependencies:new Map(saved.dependencies),directories:new Map(saved.directories)}))return false;
    const restored=new Map<string,Uint8Array>();
    for(const [name,data]of saved.files){if(typeof name!=='string'||typeof data!=='string'||name.startsWith('/')||/[\\:\0]/.test(name)||name.split('/').some(part=>part==='..'||part==='.')||!/\.(aux|out|toc|lof|lot|bbl|bcf|nav|snm|vrb)$/i.test(name))return false;restored.set(name,Buffer.from(data,'base64'));}
    auxiliary=restored;return restored.size>0;
  }catch{return false;}
}
function saveAuxiliaryCache(key:string){
  if(!auxiliaryCacheFile)return;
  // Ordinary rerun inputs only. Never restore source, fonts, PDFs, engine
  // snapshots or arbitrary work files from a disk cache.
  const files=[...auxiliary].filter(([name])=>/\.(aux|out|toc|lof|lot|bbl|bcf|nav|snm|vrb)$/i.test(name));
  if(!files.length||files.reduce((n,[,bytes])=>n+bytes.byteLength,0)>auxiliaryCacheLimit/2)return;
  const data=JSON.stringify({schema:1,key,files:files.map(([name,bytes])=>[name,Buffer.from(bytes).toString('base64')]),dependencies:[...dynamicFiles],directories:[...dynamicDirectories]});
  if(Buffer.byteLength(data)>auxiliaryCacheLimit)return;
  const temporary=auxiliaryCacheFile+'.'+randomUUID()+'.tmp';
  try{fs.mkdirSync(path.dirname(auxiliaryCacheFile),{recursive:true});try{if(fs.lstatSync(auxiliaryCacheFile).isSymbolicLink())return;}catch{}
    fs.writeFileSync(temporary,data,{flag:'wx'});fs.renameSync(temporary,auxiliaryCacheFile);
  }catch{/* Optional acceleration must never prevent a verified build. */}finally{try{fs.unlinkSync(temporary);}catch{}}
}
async function compile(nextPreamble:string,body:string,resources:[string,Uint8Array][]=[],key='',jobName='main',environment='',checkNegativeDependencies=false){
  preparedBaseline=undefined;
  const started=performance.now(),baselineKey=key,baselineEnvironment=regionEnvironment(environment,jobName);nativeZipMs=0;nativeZipStreams=0;nativeFontMs=0;nativeFonts=0;startupLookups={distribution:0,support:0,supportChecks:0};const passTimings:unknown[]=[];
  if(!jobName||/[\\/\0"\r\n:%#{}]/.test(jobName)){dynamicResourceData.clear();return {reason:'This job filename requires the native engine.'};}
  currentJob=jobName;
  key+='\0'+jobName;environment+='\0'+jobName;
  let dependencyChanged=false;
  // The research region cache needs conservative negative-lookup validation.
  // Do not make unrelated directory changes invalidate normal typing builds.
  if(checkNegativeDependencies)for(const [directory,prior]of dynamicDirectories)if(directoryChanged(directory,prior))dependencyChanged=true;
  for(const [file,prior]of dynamicFiles){
    try{const stat=fs.statSync(file);if(stat.mtimeMs!==prior.mtime||stat.ctimeMs!==prior.ctime||stat.ino!==prior.ino||stat.size!==prior.size){if(digest(fs.readFileSync(file))!==prior.hash)dependencyChanged=true;else{prior.mtime=stat.mtimeMs;prior.ctime=stat.ctimeMs;prior.ino=stat.ino;prior.size=stat.size;}}}
    catch{dependencyChanged=true;}
  }
  const nextResources=new Map(resources);
  const changed=new Set([...priorResources.keys(),...nextResources.keys()].filter(name=>{
    const old=priorResources.get(name),next=nextResources.get(name);
    return !old||!next||!Buffer.from(old).equals(Buffer.from(next));
  }));
  removedResources=[...priorResources.keys()].filter(name=>!nextResources.has(name));
  const preambleChanged=environmentKey!==environment||dependencyChanged||[...changed].some(name=>preambleInputs.has(name));
  if(preambleChanged){
    mathCache?.reset();auxiliary.clear();auxiliaryCheckpoint=undefined;auxiliaryPages=undefined;initial=bodyState=undefined;dynamicFiles.clear();dynamicDirectories.clear();dynamicResourceData.clear();
    if(context){context.closeFSStreams();try{context.cleanDir('/project-resources');}catch{}vm.runInContext('texlive404_cache={};pk404_cache={};',context);}
  }
  // A body checkpoint can already have consumed a changed chapter. Keep only
  // the begin-document checkpoint when any supplied resource changes.
  if(changed.size){expensivePrefixes=undefined;continuationPages=undefined;bodyState=undefined;boundaries=[];passPageWitnesses=[];pageContinuation=undefined;}
  priorResources=nextResources;environmentKey=environment;
  const cacheKey=auxiliaryCacheKey(nextPreamble+body,baselineKey,baselineEnvironment,jobName);
  let diskAuxiliaryReused=!initial&&!auxiliary.size&&readAuxiliaryCache(cacheKey),diskAuxiliaryRejected=false;
  let log='',mathWarmed=false,preambleInitialized=false;
  for(let pass=1;pass<=5;pass++){
    const before=auxSignature(auxiliary);let result:Awaited<ReturnType<typeof compilePass>>;
    try{result=await compilePass(nextPreamble,body,resources,key,jobName);}
    catch(error){
      if(!diskAuxiliaryReused||diskAuxiliaryRejected)throw error;
      // A syntactically valid but obsolete/damaged .aux can itself fail TeX.
      // Retry once without disk state before reporting a document error.
      auxiliary.clear();auxiliaryCheckpoint=undefined;auxiliaryPages=undefined;initial=bodyState=undefined;previousBody=Buffer.alloc(0);boundaries=[];
      diskAuxiliaryReused=false;diskAuxiliaryRejected=true;pass=0;
      log+='Cached auxiliary inputs were rejected; retrying a cold build.\n';continue;
    }
    log+=result.log;passTimings.push(result.timing);preambleInitialized||=result.timing.preambleRebuilt;
    const inputs=new Map(resources);
    auxiliary=new Map([...workFiles()].filter(([name,bytes])=>name!==jobName+'.tex'&&name!==jobName+'.pdf'&&!name.startsWith('.persistent-tex/')&&!/\.(log|fls|fdb_latexmk|synctex(?:\.gz)?)$/i.test(name)&&(!inputs.has(name)||!Buffer.from(bytes).equals(Buffer.from(inputs.get(name)!)))));
    const after=auxSignature(auxiliary);
    const convergence=residentConvergence(before===after,result.log,auxiliary);
    if(convergence==='ready'){
      if(!mathWarmed&&initialMathActive&&initialMathEntries===0&&(mathCache?.size??0)>=16){mathWarmed=true;auxiliaryCheckpoint=undefined;initial=bodyState=undefined;pass--;continue;}
      // Keep exactly this converged document available for local preparation.
      // Its PDF response is transferred, so the immutable baseline owns a copy.
      preparedBaseline={pageWitnesses:passPageWitnesses,source:Buffer.from(body),environment:baselineEnvironment,resources:resourceSignature(resources),key:baselineKey,pdf:new Uint8Array(result.pdf),navigation:result.navigation,initial,boundaries:[...boundaries],dependencies:new Map([...dynamicFiles].map(([file,stat])=>[file,{...stat}])),directories:new Map([...dynamicDirectories].map(([file,stat])=>[file,{...stat}]))};
      saveAuxiliaryCache(cacheKey);
      return {...result,log,diagnosticLog:result.log,timing:{...result.timing,preambleRebuilt:preambleInitialized,totalMs:performance.now()-started,passes:pass,diskAuxiliaryReused,diskAuxiliaryRejected,nativeZipMs,nativeZipStreams,lookupCounts:{...startupLookups},passTimings}};
    }
    // Labels/bookmarks invalidate the post-aux execution state. Its immutable
    // pages can still share exact bytes with the next freshly executed state.
    auxiliaryPages=auxiliaryCheckpoint&&witnessExtraBytes(auxiliaryCheckpoint.state,initial)<=32*1024*1024?{pages:initial.pages}:undefined;
    initial=bodyState=undefined;passPageWitnesses=[];pageContinuation=undefined;continuationPages=undefined;
    if(convergence==='external')return {log,reason:'External bibliography or index processing is required.'};
  }
  return {log,reason:'Auxiliary files did not converge in five resident passes.'};
}
type RegionRequest={lecture?:boolean;pictureFamily?:boolean;baselineProof?:boolean;retain?:string;idle?:boolean;prepared?:string;input?:IncludedInput;action:'prepare'|'render'|'nodes'|'flow'|'page'|'band';start:number;end:number;page?:number;provisional?:boolean;focus?:number};
type RegionState={editedDrawingPrefix?:Checkpoint;drawingPrefixes?:Checkpoint[];editedFamilyCheckpoint?:Checkpoint;familyCheckpoints?:Checkpoint[];baselinePage?:number;baselinePageCostMs?:number;baselinePageCheckpoint?:Checkpoint;anchorOffset:number;key:string;inputFile?:string;rootSource?:Buffer;inputCheckpoint?:boolean;boundedPageOnly?:boolean;checkpoint:Checkpoint;prefixCheckpoint?:Checkpoint;warmCheckpoint?:Checkpoint;source:Buffer;start:number;end:number;environment:string;resources:string;dependencies:Map<string,{mtime:number;ctime:number;ino:number;size:number;hash:string}>;directories:Map<string,{mtime:number;ctime:number;ino:number}>;flowTable?:{bytes:Buffer;rawTag:string;flowTag:string;tokens?:string}};
let localRegion:RegionState|undefined;
const regionCache=new Map<string,RegionState>();
let protectedRegion:string|undefined;
const regionCacheLimit=128*1024*1024;
function regionCacheBytes(){
  const buffers=new Set<Uint8Array>();let strings=0;
  for(const state of regionCache.values()){
    buffers.add(state.source);if(state.rootSource)buffers.add(state.rootSource);
    for(const checkpoint of [...(state.drawingPrefixes??[]),state.editedDrawingPrefix,state.checkpoint,state.prefixCheckpoint,state.baselinePageCheckpoint,state.editedFamilyCheckpoint,...(state.familyCheckpoints??[])])if(checkpoint){for(const page of checkpoint.pages)buffers.add(page);for(const bytes of checkpoint.files.values())buffers.add(bytes);buffers.add(checkpoint.prefix);}
    if(state.flowTable){buffers.add(state.flowTable.bytes);for(const token of state.flowTable.tokens??[])strings+=token.length*2;}
  }
  return [...buffers].reduce((sum,bytes)=>sum+bytes.byteLength,strings);
}
function retainRegion(state:RegionState){
  regionCache.delete(state.key);regionCache.set(state.key,state);
  while(regionCache.size>4||regionCacheBytes()>regionCacheLimit){const oldest=[...regionCache.keys()].find(key=>key!==protectedRegion)??regionCache.keys().next().value;if(!oldest)break;regionCache.delete(oldest);}
}
function selectRegion(key?:string){
  if(!key)return;
  const state=regionCache.get(key)??(localRegion?.key===key?localRegion:undefined);
  if(!state)throw new Error('The prepared region was evicted; prepare it again.');
  localRegion=state;if(regionCache.has(key)){regionCache.delete(key);regionCache.set(key,state);}
}
// One immutable converged document, never one heap or PDF per paragraph.
let preparedBaseline:{pageWitnesses:PageWitness[];source:Buffer;environment:string;resources:string;key:string;pdf:Uint8Array;navigation:string;initial:Checkpoint;boundaries:number[];dependencies:RegionState['dependencies'];directories:RegionState['directories']}|undefined;
function resourceSignature(resources:[string,Uint8Array][]){return auxSignature(new Map(resources));}
const regionEnvironment=(environment:string,job:string)=>JSON.stringify([environment,job,characterMapping,supportFolders]);
function dependenciesValid(state:{dependencies:RegionState['dependencies'];directories:RegionState['directories']}){
  for(const [directory,prior]of state.directories)if(directoryChanged(directory,prior))return false;
  for(const [file,prior]of state.dependencies){try{const stat=fs.statSync(file);if(stat.mtimeMs!==prior.mtime||stat.ctimeMs!==prior.ctime||stat.ino!==prior.ino||stat.size!==prior.size||digest(fs.readFileSync(file))!==prior.hash)return false;}catch{return false;}}
  return true;
}
async function prepareRegion(source:string,request:RegionRequest,resourceKey:string,jobName:string,environment:string){
  const started=performance.now(),previous=localRegion;
  localRegion=undefined;
  const bytes=Buffer.from(source),signature=resourceSignature(projectResources),env=regionEnvironment(environment,jobName);
  let baseline=preparedBaseline;
  const reusedBaseline=!!baseline&&baseline.initial===initial&&baseline.key===resourceKey&&baseline.environment===env&&baseline.resources===signature&&baseline.source.equals(bytes)&&dependenciesValid(baseline);
  if(request.idle&&!reusedBaseline)throw new Error('Idle preparation requires the current converged baseline.');
  if(!reusedBaseline){
    regionCache.clear();
    const result=await compile('',source,projectResources,resourceKey,jobName,environment,true);
    if(!('pdf'in result))throw new Error('Local prototype needs a successful, converged resident build. '+('reason'in result?result.reason:''));
    baseline=preparedBaseline={pageWitnesses:passPageWitnesses,source:bytes,environment:env,resources:signature,key:resourceKey,pdf:new Uint8Array(result.pdf),navigation:result.navigation,initial,boundaries:[...boundaries],dependencies:new Map([...dynamicFiles].map(([file,stat])=>[file,{...stat}])),directories:new Map([...dynamicDirectories].map(([file,stat])=>[file,{...stat}]))};
  }
  if(!baseline)throw new Error('No converged local baseline.');
  if(!request.input&&request.start<initial.offset)throw new Error('The requested region overlaps the begin-document checkpoint input buffer.');
  const input=request.input,targetBytes=Buffer.from(input?.text??source);
  const focusWitness=!input&&request.pictureFamily?baseline.pageWitnesses.find(w=>w.start===request.start&&w.end===request.end):undefined;
  const family=focusWitness?baseline.pageWitnesses.filter(w=>w.after===focusWitness.after&&w.source.equals(bytes)):[];
  const familyStart=family.length>1?Math.min(...family.map(w=>w.start)):request.start,familyEnd=family.length>1?Math.max(...family.map(w=>w.end)):request.end;
  const familyActive=family.length>1&&familyEnd-familyStart<=12000;
  if(familyActive)request={...request,start:familyStart,end:familyEnd};
  const familyTiming=familyActive?{pictureFamilyFrom:request.start,pictureFamilyTo:request.end,pictureFamilyCount:family.length}:{};
  const cached=reusedBaseline?[...regionCache.values()].reverse().find(state=>state.start===request.start&&state.end===request.end&&state.inputFile===input?.file&&state.source.equals(targetBytes)&&(!state.rootSource||state.rootSource.equals(bytes))&&state.environment===env&&state.resources===signature):undefined;
  if(cached){localRegion=cached;retainRegion(cached);return {scope:'region-prepared' as const,regionKey:cached.key,regionKeys:[...regionCache.keys()],pdf:new Uint8Array(baseline.pdf),navigation:baseline.navigation,timing:{...familyTiming,checkpointPage:cached.checkpoint.page,baselinePage:cached.baselinePageCostMs!==undefined?cached.checkpoint.page:undefined,baselinePageCostMs:cached.baselinePageCostMs,anchorSourceBytes:0,anchorExcludedSuffixBytes:bytes.length-cached.anchorOffset,documentSourceBytes:bytes.length,preambleOffset:initial.offset,prefixCheckpointOffset:cached.prefixCheckpoint?.offset,baselineCheckpointAvailable:!!cached.baselinePageCheckpoint,regionCacheHit:true,regionCacheEntries:regionCache.size,regionCacheBytes:regionCacheBytes(),totalMs:performance.now()-started,reusedBaseline:true,sourceFile:input?.file,inputCheckpoint:!!cached.inputCheckpoint,checkpointOffset:cached.checkpoint.offset}};}
  if(input){
    if(!Module._persistentSelectInput)throw new Error('Included checkpoints require the updated engine.');
    const resource=projectResources.find(([name])=>name===input.file);
    if(!resource||Buffer.from(resource[1]).toString('utf8').replace(/\r\n/g,'\n')!==input.text)throw new Error('The included baseline must match its captured project input.');
  }
  const entry=input?includedEntry(source,projectResources,input.file):undefined;
  if(input&&entry===undefined)throw new Error('Included local editing needs a single literal inclusion path.');
  const witness=familyActive?family.reduce((a,b)=>a.start<b.start?a:b):!input?baseline.pageWitnesses.find(w=>w.source.equals(bytes)&&w.start===request.start&&w.end===request.end):undefined;
  // Keep the full-build pair together rather than combining the finished
  // picture with a separately replayed before-picture checkpoint.
  const target=witness?.before.offset??baseline.boundaries.filter(offset=>offset<=(input?Buffer.byteLength(source.slice(0,entry)):request.start)).at(-1)??initial.offset;
  const candidates:Checkpoint[]=[...(expensivePrefixes&&expensivePrefixes.initial===initial&&process.env.PERSISTENT_TEX_DISABLE_EXPENSIVE_PREFIX!=='1'?expensivePrefixes.points:[]),witness?.before,initial,bodyState,...(reusedBaseline&&previous&&!previous.inputFile?[previous.checkpoint]:[]),...[...regionCache.values()].filter(state=>!state.inputFile).map(state=>state.checkpoint)].filter((state):state is Checkpoint=>!!state&&state.offset<=target&&bytes.subarray(0,state.offset).equals(state.prefix));
  const candidate=candidates.sort((a,b)=>b.offset-a.offset)[0];
  if(!candidate)throw new Error('No valid checkpoint before the local region.');
  let checkpoint=candidate;
  if(candidate.offset<target){
    restore(candidate);
    for(const [name,data]of projectResources)writeWork(name,data);
    for(const name of removedResources)try{FS.unlink('/work/'+name);}catch{}
    writeWork(jobName+'.tex',bytes);Module._persistentEnableCharacters(characterMapping?1:0);Module._persistentEnableCheckpoint(1);
    let code=Module._persistentResume();
    while(code===100&&Module._persistentCheckpointKind()===1&&Module._persistentCheckpointOffset()<target)code=Module._persistentResume();
    if(code!==100||Module._persistentCheckpointKind()!==1||Module._persistentCheckpointOffset()!==target)throw new Error('Could not reach the validated paragraph checkpoint.');
    checkpoint=capture(bytes,target,initial);
  }
  bodyState=checkpoint;
  let inputCheckpoint=false;
  if(input&&request.start>0){
    const rootCheckpoint=checkpoint,targetBytes=Buffer.from(input.text);
    restore(rootCheckpoint);writeWork(input.file,targetBytes);
    const select=()=>{if(Module.cwrap('persistentSelectInput','number',['string','number'])(input.file,1)!==0)throw new Error('Included source path exceeds the engine limit.');};
    select();let offset:number|undefined,code=Module._persistentResume();
    while(code===100&&Module._persistentCheckpointKind()===1){const at=Module._persistentCheckpointOffset();if(at>request.start)break;offset=at;if(at===request.start)break;code=Module._persistentResume();}
    // TeX can buffer the next source line before leaving a paragraph. A real
    // earlier input checkpoint is still valid: only its unchanged prefix is
    // skipped. Discover first, then capture once rather than copying each line.
    if(offset!==undefined){
      if(Module._persistentCheckpointOffset()!==offset){restore(rootCheckpoint);writeWork(input.file,targetBytes);select();code=Module._persistentResume();while(code===100&&Module._persistentCheckpointKind()===1&&Module._persistentCheckpointOffset()<offset)code=Module._persistentResume();}
      if(code===100&&Module._persistentCheckpointKind()===1&&Module._persistentCheckpointOffset()===offset){checkpoint=capture(targetBytes,offset,initial);inputCheckpoint=true;}
    }
    if(!inputCheckpoint)restore(rootCheckpoint);
  }
  let prefixCheckpoint:Checkpoint|undefined,prefixProbeAttempts=0,prefixProbeStoppedAtFocus=false;
  const prefixProbeStarted=performance.now();
  if(!familyActive&&!input&&Module._persistentPrefixConfigure&&Number.isSafeInteger(request.focus)&&request.focus!>request.start+32&&request.focus!<request.end&&process.env.PERSISTENT_TEX_DISABLE_PREFIX_CHECKPOINT!=='1'){
    let lower=bytes.lastIndexOf(32,request.focus!-1)+1;
    for(let attempt=0;attempt<2&&lower>request.start+16;attempt++){
      prefixProbeAttempts++;
      let previous=-1;
      try{
        restore(checkpoint);writeWork(jobName+'.tex',bytes);Module._persistentEnableCharacters(characterMapping?1:0);Module._persistentEnableCheckpoint(1);
        const first=bytes.subarray(0,request.start).toString('utf8').split('\n').length,last=bytes.subarray(0,request.end).toString('utf8').split('\n').length;
        Module._persistentFlowConfigure(first,last,request.end);Module._persistentPrefixConfigure(lower,request.focus);prefixProbeSource=bytes;
        const code=Module._persistentResume(),offset=Module._persistentCheckpointOffset();
        if(code===109)prefixProbeStoppedAtFocus=true;
        if(code===100&&Module._persistentCheckpointKind()===4&&offset>checkpoint.offset&&offset<=request.focus!)prefixCheckpoint=capture(bytes,offset,checkpoint);
        else if((code===100||code===109)&&Module._persistentPrefixPrevious)previous=Module._persistentPrefixPrevious();
      }catch{/* Optional prefix reuse must not prevent ordinary preparation. */}finally{prefixProbeSource=undefined;if(!prefixCheckpoint)restore(checkpoint);}
      if(prefixCheckpoint||previous<=request.start+16||previous>=lower)break;
      lower=previous;
    }
  }
  const prefixProbeMs=performance.now()-prefixProbeStarted;
  localRegion={drawingPrefixes:!input&&expensivePrefixes&&expensivePrefixes.initial===initial?expensivePrefixes.points.filter(c=>c.offset>checkpoint.offset&&c.offset<request.end&&bytes.subarray(0,c.offset).equals(c.prefix)):undefined,familyCheckpoints:familyActive?family.map(w=>w.before):undefined,baselinePageCostMs:familyActive?Math.max(...family.map(w=>w.pageCostMs)):witness?.pageCostMs,baselinePageCheckpoint:witness&&checkpoint===witness.before?witness.after:undefined,anchorOffset:target,key:randomUUID(),checkpoint,prefixCheckpoint,inputFile:input?.file,rootSource:input?bytes:undefined,inputCheckpoint,source:input?Buffer.from(input.text):bytes,start:request.start,end:request.end,environment:env,resources:signature,dependencies:baseline.dependencies,directories:baseline.directories};
  retainRegion(localRegion);
  // The returned buffer is transferred to the parent; keep our cache intact.
  return {scope:'region-prepared' as const,regionKey:localRegion.key,regionKeys:[...regionCache.keys()],pdf:new Uint8Array(baseline.pdf),navigation:baseline.navigation,timing:{...familyTiming,checkpointPage:localRegion.checkpoint.page,baselinePage:localRegion.baselinePageCostMs!==undefined?localRegion.checkpoint.page:undefined,baselinePageCostMs:localRegion.baselinePageCostMs,baselineCheckpointAvailable:!!localRegion.baselinePageCheckpoint,regionCacheHit:false,regionCacheEntries:regionCache.size,regionCacheBytes:regionCacheBytes(),sourceFile:input?.file,inputCheckpoint,totalMs:performance.now()-started,reusedBaseline,prefixProbeMs,prefixProbeAttempts,prefixProbeStoppedAtFocus,prefixCheckpointOffset:prefixCheckpoint?.offset,anchorSourceBytes:target-candidate.offset,anchorExcludedSuffixBytes:bytes.length-target,checkpointOffset:checkpoint.offset,preambleOffset:initial.offset,documentSourceBytes:bytes.length}};
}
async function renderRegion(source:string,request:RegionRequest,jobName:string,environment:string){
  nativeZipMs=0;nativeZipStreams=0;nativeFontMs=0;nativeFonts=0;fontBodyCache.resetTiming();fontProgramCache.resetTiming();fontEncodingCache.resetTiming();
  selectRegion(request.prepared);
  const state=localRegion,started=performance.now(),bytes=Buffer.from(request.input?.text??source);
  if(!state)throw new Error('Prepare the local region before rendering it.');
  if(state.inputFile!==request.input?.file||state.rootSource&&!state.rootSource.equals(Buffer.from(source)))throw new Error('The root context or selected input changed.');
  if(request.input&&request.action==='render')throw new Error('Included page reflow requires full verification.');
  if(request.start!==state.start||!bytes.subarray(0,request.start).equals(state.source.subarray(0,state.start))||!bytes.subarray(request.end).equals(state.source.subarray(state.end)))throw new Error('An edit outside the prepared region requires a new full build.');
  if(state.environment!==regionEnvironment(environment,jobName)||state.resources!==resourceSignature(projectResources))throw new Error('Changed project inputs require a new full build.');
  for(const [directory,prior]of state.directories)if(directoryChanged(directory,prior))throw new Error('A local dependency directory changed. Prepare the region again.');
  for(const [file,prior]of state.dependencies){
    let stat:fs.Stats;try{stat=fs.statSync(file);}catch{throw new Error('A local region dependency disappeared. Prepare the region again.');}
    if(stat.mtimeMs!==prior.mtime||stat.ctimeMs!==prior.ctime||stat.ino!==prior.ino||stat.size!==prior.size||digest(fs.readFileSync(file))!==prior.hash)throw new Error('A local region dependency changed. Prepare the region again.');
  }
  // Exact original bytes are mandatory, even if a caller requests this flag
  // for an edited buffer. A changed picture is always actually recalculated.
  const baselineCheckpoint=request.baselineProof&&(request.action==='page'||request.action==='band')&&bytes.equals(state.source)?state.baselinePageCheckpoint:undefined;
  // Prove the complete family window before allowing edits to select a later
  // checkpoint. Otherwise a label checkpoint can prove only page two while
  // an earlier geometry edit still needs to ship the pending page-one break.
  const familyCheckpoint=(request.action==='page'||request.action==='band')&&!(request.baselineProof&&bytes.equals(state.source))?[...(!bytes.equals(state.source)&&process.env.PERSISTENT_TEX_DISABLE_DRAWING_PREFIX!=='1'?[...(state.drawingPrefixes??[]),...(state.editedDrawingPrefix?[state.editedDrawingPrefix]:[])]:[]),...(state.familyCheckpoints??[]),...(process.env.PERSISTENT_TEX_DISABLE_EDITED_FAMILY!=='1'&&state.editedFamilyCheckpoint?[state.editedFamilyCheckpoint]:[])].filter(c=>bytes.length>=c.offset&&bytes.subarray(0,c.offset).equals(c.prefix)).sort((a,b)=>b.offset-a.offset)[0]:undefined;
  let checkpoint=baselineCheckpoint??familyCheckpoint??(request.action==='flow'&&state.prefixCheckpoint&&bytes.subarray(0,state.prefixCheckpoint.offset).equals(state.prefixCheckpoint.prefix)?state.prefixCheckpoint:state.checkpoint);
  let ready=readyCheckpoint?.checkpoint===checkpoint?readyCheckpoint:undefined;
  readyCheckpoint=undefined;
  if(!ready)restore(checkpoint);
  if(request.input){
    writeWork(request.input.file,bytes);
    if(Module.cwrap('persistentSelectInput','number',['string','number'])(request.input.file,0)!==0)throw new Error('Included source path exceeds the engine limit.');
  }
  const reloadStarted=performance.now();
  if(checkpoint===state.prefixCheckpoint){writeWork(jobName+'.tex',bytes);if(Module._persistentPrefixReload()!==0){checkpoint=state.checkpoint;ready=undefined;restore(checkpoint);}}
  state.warmCheckpoint=baselineCheckpoint?state.checkpoint:checkpoint;
  const restoration={drawingPrefixReused:state.editedDrawingPrefix===checkpoint||!!state.drawingPrefixes?.includes(checkpoint),editedDrawingPrefixReused:state.editedDrawingPrefix===checkpoint,editedFamilyReused:!!state.editedFamilyCheckpoint&&checkpoint===state.editedFamilyCheckpoint,editedFamilyCheckpointOffset:state.editedFamilyCheckpoint?.offset,baselinePageCostMs:state.baselinePageCostMs,baselineCheckpointReused:!!baselineCheckpoint,baselineCheckpointOffset:baselineCheckpoint?.offset,preRestored:!!ready,prefixReused:checkpoint===state.prefixCheckpoint,prefixReloadMs:performance.now()-reloadStarted,familyCheckpointOffset:familyCheckpoint?.offset,paragraphCheckpointOffset:state.checkpoint.offset,skippedPrefixBytes:checkpoint.offset-state.checkpoint.offset,previousRestoreMs:ready?.duration,previousRestoreDetail:ready?.detail,preRestoreIdleMs:ready?performance.now()-ready.finishedAt:undefined,restoreDetail:ready?{heapMs:0,filesMs:0,streamsMs:0,heapBytes:0,copiedBytes:0}:restoreTiming};
  const restoredAt=performance.now();
  // Region responses need only newly shipped glyphs. A body checkpoint may
  // carry thousands of mappings from earlier pages; do not serialize and parse
  // that unchanged history again for every character. Restore keeps its copy.
  const canContinue=request.action==='band'&&!request.input&&!request.baselineProof&&!!state.familyCheckpoints?.length&&!bytes.equals(state.source)&&context.HEAPU8.byteLength<=192*1024*1024&&projectResources.reduce((sum,[,data])=>sum+data.byteLength,0)<=16*1024*1024&&process.env.PERSISTENT_TEX_DISABLE_LOCAL_CONTINUATION!=='1'&&!!Module._persistentPageCheckpoint;
  const canCaptureFamily=request.action==='band'&&!request.input&&!request.baselineProof&&(state.familyCheckpoints?.length??0)>1&&context.HEAPU8.byteLength<=192*1024*1024&&projectResources.reduce((sum,[,data])=>sum+data.byteLength,0)<=16*1024*1024&&process.env.PERSISTENT_TEX_DISABLE_EDITED_FAMILY!=='1'&&!!Module._persistentPageCheckpoint;
  const canCaptureDrawing=request.action==='band'&&!canCaptureFamily&&!request.input&&!request.baselineProof&&!bytes.equals(state.source)&&(!!state.drawingPrefixes?.length||/\\begin\{tikzpicture\}/.test(bytes.subarray(request.start,request.end).toString('utf8')))&&context.HEAPU8.byteLength<=192*1024*1024&&projectResources.reduce((n,[,data])=>n+data.byteLength,0)<=16*1024*1024&&process.env.PERSISTENT_TEX_DISABLE_DRAWING_PREFIX!=='1'&&!!Module._persistentPageCheckpoint;
  const navigationPath='/work/.persistent-tex/navigation.jsonl',navigationPrefix=(canContinue||canCaptureFamily||canCaptureDrawing)&&FS.analyzePath(navigationPath).exists?new Uint8Array(FS.readFile(navigationPath)):undefined;
  if(request.action!=='render'){
    const file='/work/.persistent-tex/navigation.jsonl';
    if(FS.analyzePath(file).exists){FS.truncate(file,0);for(const stream of FS.streams)if(stream?.path===file)stream.position=0;}
  }
  if(request.action==='page' ||request.action==='band'){
    if(!Module._persistentPageConfigure||!Module._persistentPagePdf||!Module._persistentPageFirst||!Module._persistentPageLast)throw new Error('Affected-page output requires the updated engine.');
    if(!Number.isSafeInteger(request.page)||request.page!<1)throw new Error('Invalid affected page.');
    // Bound read-ahead to 64 KiB, and fence the literal end-document line.
    // The engine also intercepts enddocument control tokens before expansion.
    let boundary=request.action==='band'&&!request.input&&!state.boundedPageOnly?[...bytes.toString('utf8').matchAll(/^[\t ]*\\(?:newpage|clearpage|end\{document\})[\t ]*(?:%[^\n]*)?(?:\n|$)/gm)].map(m=>({from:Buffer.byteLength(bytes.toString('utf8').slice(0,m.index)),to:Buffer.byteLength(bytes.toString('utf8').slice(0,m.index!+m[0].length)),final:m[0].includes('end{document}')})).find(m=>m.from>=request.end&&m.to<=request.end+65536):undefined;
    const endDocument=bytes.indexOf(Buffer.from('\\end{document}'),request.end);
    const endLine=endDocument<0?bytes.length:bytes.lastIndexOf(10,endDocument)+1;
    let continuationCaptured=false,continuationCaptureMs=0,continuationReusedBytes=0,continuationPrefixBytes=0,continuationPrefixRetained=false,resumeBoundaries:number[]=[];
    let editedFamily:Checkpoint|undefined,editedFamilyCaptureMs=0;
    const familyOffset=canCaptureFamily?pictureWitnessRanges(bytes.toString('utf8'),request.start).filter(r=>r.start>request.start&&r.start<request.end).sort((a,b)=>a.start-b.start)[0]?.start:undefined;
    // Keep one newly executed prefix before the second picture paragraph.
    // Exact source-prefix checks govern reuse; cheap prefixes need no snapshot.
    const captureEditedFamily=(work:Buffer)=>{
      const offset=Module._persistentCheckpointOffset();
      if(editedFamily||localSuperseded()||performance.now()-inputsAt<25||familyOffset===undefined||offset<=checkpoint.offset||offset>familyOffset||bytes.subarray(offset,familyOffset).toString('utf8').trim()!==''||!work.subarray(0,offset).equals(bytes.subarray(0,offset)))return;
      if(Module._persistentPageCheckpoint(2)!==0)return;
      const began=performance.now(),hadNavigation=FS.analyzePath(navigationPath).exists,partial=hadNavigation?new Uint8Array(FS.readFile(navigationPath)):new Uint8Array(),streams=FS.streams.filter((stream:any)=>stream?.path===navigationPath),positions=streams.map((stream:any)=>stream.position);
      try{
        writeWork(jobName+'.tex',bytes);writeWork('.persistent-tex/navigation.jsonl',Buffer.concat([navigationPrefix??new Uint8Array(),partial]));for(const stream of streams)stream.position+=(navigationPrefix?.length??0);
        const saved=capture(bytes,offset,checkpoint,state.editedFamilyCheckpoint);
        if(witnessWithinBudget(state.checkpoint,saved))editedFamily=saved;
      }finally{
        writeWork(jobName+'.tex',work);if(hadNavigation)writeWork('.persistent-tex/navigation.jsonl',partial);else FS.unlink(navigationPath);streams.forEach((stream:any,index:number)=>stream.position=positions[index]);
        if(Module._persistentPageCheckpoint(3)!==0)throw new Error('Could not restore the local page fence after family capture.');
        editedFamilyCaptureMs+=performance.now()-began;
      }
    };
    const captureContinuation=(work:Buffer)=>{
      const offset=Module._persistentCheckpointOffset();
      if(!canContinue||localSuperseded()||continuationCaptured||!boundary||boundary.final||offset<request.end||offset>boundary.to||!work.subarray(0,offset).equals(bytes.subarray(0,offset)))return;
      if(Module._persistentPageCheckpoint(0)!==0)return;
      const began=performance.now(),partial=new Uint8Array(FS.readFile(navigationPath)),streams=FS.streams.filter((stream:any)=>stream?.path===navigationPath),positions=streams.map((stream:any)=>stream.position);
      try{
        // Local transport omits old glyphs. The resumable full state must own
        // their complete sidecar and the real untruncated source instead.
        writeWork(jobName+'.tex',bytes);writeWork('.persistent-tex/navigation.jsonl',Buffer.concat([navigationPrefix??new Uint8Array(),partial]));for(const stream of streams)stream.position+=(navigationPrefix?.length??0);
        const recent=process.env.PERSISTENT_TEX_DISABLE_CONTINUATION_PAGE_REUSE!=='1'?(pageContinuation&&pageContinuation.initial===initial?pageContinuation.checkpoint:process.env.PERSISTENT_TEX_DISABLE_CONTINUATION_DONOR!=='1'&&continuationPages?.initial.deref()===initial?continuationPages:undefined):undefined;
        const saved=capture(bytes,offset,checkpoint,recent);continuationReusedBytes=saved.reusedBytes??0;
        if(!witnessWithinBudget(checkpoint,saved))return;
        continuationPages={initial:new WeakRef(initial),pages:saved.pages};
        const before=[state.checkpoint,...(state.familyCheckpoints??[])].filter(c=>bytes.subarray(0,c.offset).equals(c.prefix));
        const witnesses:PageWitness[]=pictureWitnessRanges(bytes.toString('utf8'),request.start).filter(range=>range.start>=request.start&&range.finish<=offset).flatMap(range=>{
          const start=before.filter(c=>c.offset<=range.start).sort((a,b)=>b.offset-a.offset)[0];
          if(!start||start.page!==saved.page)return [];
          return [{source:bytes,...range,before:start,after:saved,pageCostMs:state.baselinePageCostMs??0}];
        });
        const prefix=process.env.PERSISTENT_TEX_DISABLE_FULL_PREFIX!=='1'?(editedFamily??state.editedFamilyCheckpoint):undefined;
        continuationPrefixBytes=prefix?witnessExtraBytes(state.checkpoint,saved,prefix):0;
        const reusablePrefix=prefix&&bytes.subarray(0,prefix.offset).equals(prefix.prefix)&&continuationPrefixBytes<=32*1024*1024?prefix:undefined;
        continuationPrefixRetained=!!reusablePrefix;
        pageContinuation={prefixBefore:reusablePrefix?state.checkpoint:undefined,prefix:reusablePrefix,checkpoint:saved,initial,environment:regionEnvironment(environmentKey,jobName),resources:resourceSignature(projectResources),boundaries:[...boundaries.filter(at=>at<=checkpoint.offset),...resumeBoundaries],witnesses,dependencies:new Map([...dynamicFiles].map(([file,stat])=>[file,{...stat}])),directories:new Map([...dynamicDirectories].map(([file,stat])=>[file,{...stat}]))};continuationCaptured=true;
      }finally{
        writeWork(jobName+'.tex',work);writeWork('.persistent-tex/navigation.jsonl',partial);streams.forEach((stream:any,index:number)=>stream.position=positions[index]);
        if(Module._persistentPageCheckpoint(1)!==0)throw new Error('Could not restore the local page fence after checkpoint capture.');
        continuationCaptureMs+=performance.now()-began;
      }
    };
    let editedDrawingPrefix:Checkpoint|undefined,drawingCaptures=0,drawingCaptureMs=0,drawingResumeAt=performance.now();
    const captureDrawing=(work:Buffer)=>{
      const now=performance.now(),cost=now-drawingResumeAt;drawingResumeAt=now;
      if(!canCaptureDrawing||drawingCaptures>=2||cost<80||localSuperseded())return;
      const offset=Module._persistentCheckpointOffset();
      if(offset<=checkpoint.offset||offset>=request.end||!work.subarray(0,offset).equals(bytes.subarray(0,offset))||Module._persistentPageCheckpoint(2)!==0)return;
      const began=performance.now(),hadNavigation=FS.analyzePath(navigationPath).exists,partial=hadNavigation?new Uint8Array(FS.readFile(navigationPath)):new Uint8Array(),streams=FS.streams.filter((stream:any)=>stream?.path===navigationPath),positions=streams.map((stream:any)=>stream.position);drawingCaptures++;
      try{
        writeWork(jobName+'.tex',bytes);writeWork('.persistent-tex/navigation.jsonl',Buffer.concat([navigationPrefix??new Uint8Array(),partial]));for(const stream of streams)stream.position+=(navigationPrefix?.length??0);
        const saved=capture(bytes,offset,checkpoint,state.editedDrawingPrefix);
        if(witnessWithinBudget(state.checkpoint,saved))editedDrawingPrefix=saved;
      }finally{
        writeWork(jobName+'.tex',work);if(hadNavigation)writeWork('.persistent-tex/navigation.jsonl',partial);else FS.unlink(navigationPath);streams.forEach((stream:any,i:number)=>stream.position=positions[i]);
        if(Module._persistentPageCheckpoint(3)!==0)throw new Error('Could not restore the drawing page fence.');
        drawingCaptureMs+=performance.now()-began;drawingResumeAt=performance.now();
      }
    };
    const resumePage=()=>{
      const work=boundary?Buffer.concat([bytes.subarray(0,boundary.final?boundary.from:boundary.to),Buffer.from(boundary.final?'\\clearpage\n\n':'\n')]):bytes;
      const limit=request.input?Math.min(bytes.length+1,request.end+65536):boundary?work.length:Math.min(bytes.length,request.end+65536,endLine);
      if(limit<=request.end)throw new Error('The final page requires normal document completion.');
      writeWork(request.input?.file??jobName+'.tex',work);Module._persistentEnableCharacters(characterMapping?1:0);
      // A later family checkpoint has already completed unchanged preceding
      // pages. Start output at its live page; the checked continuation still
      // fences the end of the original page window.
      const firstPage=familyCheckpoint||baselineCheckpoint?Math.max(request.page!,checkpoint.page??request.page!):request.page!;
      if(Module._persistentPageConfigure(boundary?.from??request.end,firstPage,limit)!==0)throw new Error('The affected page is outside the bounded checkpoint span.');Module._persistentEnableCheckpoint(1);
      resumeBoundaries=[];let code=Module._persistentResume();
      while(code===100){resumeBoundaries.push(Module._persistentCheckpointOffset());captureEditedFamily(work);captureContinuation(work);captureDrawing(work);if(Module._persistentCheckpointKind()===3)break;code=Module._persistentResume();}
      return code;
    };
    const inputsAt=performance.now();let code=resumePage();
    // A distant explicit break/end can exceed the three-page band even when
    // the edited paragraph fits one page. Restore and try its natural page
    // boundary; baseline raster and unchanged-span checks still gate reuse.
    if(code===106&&boundary){
      if(continuationCaptured)pageContinuation=undefined;continuationCaptured=false;continuationPrefixBytes=0;continuationPrefixRetained=false;editedFamily=undefined;
      restore(checkpoint);readyCheckpoint=undefined;
      const navigationFile='/work/.persistent-tex/navigation.jsonl';
      if(FS.analyzePath(navigationFile).exists){FS.truncate(navigationFile,0);for(const stream of FS.streams)if(stream?.path===navigationFile)stream.position=0;}
      boundary=undefined;state.boundedPageOnly=true;code=resumePage();
    }
    if(code!==100)throw new SourceError('Affected page could not ship inside its bounded input window ('+code+').\n'+context.memlog);
    const stoppedAt=performance.now(),consumed=request.input?Module._persistentSelectedOffset():Module._persistentCheckpointOffset(),pageSpan={first:baselineCheckpoint?Math.min(Module._persistentPageFirst(),state.checkpoint.page??Module._persistentPageFirst()):Module._persistentPageFirst(),last:Module._persistentPageLast()};
    const sealed=Module._persistentPagePdf();if(sealed!==0)throw new Error('Could not seal the affected page ('+sealed+').\n'+context.memlog);
    if(continuationCaptured&&pageContinuation){
      // Font finalization can discover additional read-only inputs. Keep their
      // identities too, even though the resumable heap precedes finalization.
      pageContinuation.dependencies=new Map([...dynamicFiles].map(([file,stat])=>[file,{...stat}]));pageContinuation.directories=new Map([...dynamicDirectories].map(([file,stat])=>[file,{...stat}]));
    }
    let editedDrawingPrefixCaptured=false;
    if(editedDrawingPrefix&&!localSuperseded()&&![...dynamicFiles.keys()].some(file=>!state.dependencies.has(file))){
      const prior=state.editedDrawingPrefix;state.editedDrawingPrefix=editedDrawingPrefix;
      if(regionCacheBytes()>regionCacheLimit)state.editedDrawingPrefix=prior;else{state.warmCheckpoint=editedDrawingPrefix;editedDrawingPrefixCaptured=true;}
    }
    let editedFamilyCaptured=false;
    if(editedFamily&&![...dynamicFiles.keys()].some(file=>!state.dependencies.has(file))){
      const prior=state.editedFamilyCheckpoint;state.editedFamilyCheckpoint=editedFamily;
      if(regionCacheBytes()>regionCacheLimit)state.editedFamilyCheckpoint=prior;
      else{editedFamilyCaptured=true;state.warmCheckpoint=editedFamily;}
    }
    const pdf=new Uint8Array(FS.readFile('/work/'+jobName+'.pdf')),navigation=FS.readFile('/work/.persistent-tex/navigation.jsonl',{encoding:'utf8'});
    const math=mathCache?.collect(context.memlog,true);
    return {scope:'region-page' as const,pdf,pageSpan,navigation,log:math?.log??context.memlog,timing:{drawingCaptures,drawingCaptureMs,editedDrawingPrefixCaptured,editedFamilyCaptured,editedFamilyCaptureMs,continuationCaptured,continuationCaptureMs,continuationPrefixBytes,continuationPrefixRetained,continuationReusedBytes,tikzMathPlans:mathPlans,tikzMathEntries:initialMathEntries,tikzMathLearned:math?.records,tikzMathHits:math?.hits,tikzMathProvisionalHits:math?.provisionalHits,tikzMathIntermediateHits:math?.intermediateHits,tikzMathIntermediateLearned:math?.intermediateLearned,tikzMathIntermediateEntries:math?.intermediateEntries,totalMs:performance.now()-started,restoreMs:restoredAt-started,...restoration,inputsMs:inputsAt-restoredAt,typesetMs:stoppedAt-inputsAt,outputMs:performance.now()-stoppedAt,nativeZipMs,nativeZipStreams,checkpointOffset:state.checkpoint.offset,preambleOffset:initial.offset,documentSourceBytes:bytes.length,sourceFile:state.inputFile,inputCheckpoint:!!state.inputCheckpoint,reprocessedSourceBytes:Math.max(0,Math.min(consumed,boundary?.final?boundary.from:bytes.length)-(state.inputFile&&!state.inputCheckpoint?0:state.checkpoint.offset)),excludedSuffixBytes:bytes.length-Math.min(consumed,boundary?.final?boundary.from:bytes.length),syntheticEnd:false,continuation:boundary&&consumed>=(boundary.final?boundary.from+10:boundary.to)?digest(bytes.subarray(boundary.to)):undefined,boundedPageOnly:!!state.boundedPageOnly,finalPageFlush:!!boundary?.final&&consumed>=boundary.from+10,documentComplete:false,affectedPage:pageSpan.first,affectedPages:pageSpan.last-pageSpan.first+1}};
  }
  if(request.action==='nodes'||request.action==='flow'){
    fastFlowCapture=request.action==='flow'&&!!request.provisional&&process.env.PERSISTENT_TEX_VERIFY_STATE_HASH!=='1';
    if(!Module._persistentRegionConfigure||!Module._persistentRegionPdf)throw new Error('Live paragraph output requires the updated engine.');
    writeWork(request.input?.file??jobName+'.tex',bytes);Module._persistentEnableCharacters(characterMapping?1:0);
    const first=bytes.subarray(0,request.start).toString('utf8').split('\n').length,last=bytes.subarray(0,request.end).toString('utf8').split('\n').length;
    if(request.action==='flow'){
      const configure=request.lecture?Module._persistentLectureFlowConfigure:Module._persistentFlowConfigure;
      if(!configure)throw new Error('Continuous output requires the updated engine.');
      configure(first,last,request.end);
    }else Module._persistentRegionConfigure(first,last,request.end);Module._persistentEnableCheckpoint(1);
    const inputsAt=performance.now();let code=Module._persistentResume();
    while(code===100&&Module._persistentCheckpointKind()!==2)code=Module._persistentResume();
    if(code!==100)throw new SourceError((code===104?'Local paragraph needs input beyond its boundary.':'Local paragraph did not reach a safe boundary.')+'\n'+context.memlog);
    regionStateHash=undefined;regionStateHashMs=0;regionStateBytes=0;regionStateHashReused=false;
    const stoppedAt=performance.now();sealStarted=stoppedAt;digestStarted=digestFinished=0;streamCache.resetTiming();
    // Acceleration is confined to speculative local output. Full builds/export
    // retain the existing compiler path. A warm worker owns this bounded cache.
    const priorCompress=context.persistentCompress;
    if(request.provisional&&process.env.PERSISTENT_TEX_DISABLE_STREAM_CACHE!=='1')context.persistentCompress=(bytes:Uint8Array,level:number)=>streamCache.compress(bytes,level);
    let sealed:number;try{sealed=Module._persistentRegionPdf();}finally{sealStarted=0;context.persistentCompress=priorCompress;}
    const sealedAt=performance.now(),sealTiming={beforeStateMs:digestStarted?digestStarted-stoppedAt:undefined,stateMs:digestFinished-digestStarted,afterStateMs:digestFinished?sealedAt-digestFinished:undefined,totalMs:sealedAt-stoppedAt,streamCacheHits:streamCache.hits,streamCacheMisses:streamCache.misses,streamCacheMs:streamCache.milliseconds,streamCacheBytes:streamCache.retainedBytes};
    if(sealed===102)throw new Error('This region requires broader layout: unsupported output nodes or an unsafe flow boundary.');
    if(sealed!==0)throw new Error('Could not seal paragraph output.\n'+context.memlog);
    const fragment=JSON.parse(FS.readFile('/work/.persistent-tex/region.json',{encoding:'utf8'}));
    const directStateHash=regionStateHash!==undefined;
    if(process.env.PERSISTENT_TEX_VERIFY_STATE_HASH==='1'&&regionStateHash!==digest(FS.readFile('/work/.persistent-tex/region-eqtb.bin')))throw new Error('Direct TeX state digest differs from its complete file snapshot.');
    fragment.stateHash=regionStateHash??digest(FS.readFile('/work/.persistent-tex/region-eqtb.bin'));
    if(request.action==='flow'){
      if(!Array.isArray(fragment.everypar))throw new Error('Missing continuous state proof.');
      if(fastFlowCapture){
        const baseline=state.flowTable;if(!baseline)throw new Error('Missing flow baseline table.');
        const tokens=JSON.stringify(fragment.everypar);baseline.tokens??=tokens;
        fragment.flowStateHash=fastFlowEqual&&tokens===baseline.tokens?baseline.flowTag:randomUUID();
      }else{
        if(!priorRegionState)throw new Error('Missing continuous state proof.');
        const table=priorRegionState.bytes,offset=27160*8+4;
        fragment.flowStateHash=createHash('sha256').update(table.subarray(0,offset)).update(Buffer.alloc(4)).update(table.subarray(offset+4)).update(JSON.stringify(fragment.everypar)).digest('hex');
      }
      delete fragment.everypar;
    }
    const pdf=new Uint8Array(FS.readFile('/work/'+jobName+'.pdf')),navigation=FS.readFile('/work/.persistent-tex/navigation.jsonl',{encoding:'utf8'});
    return {scope:'region-fragment' as const,pdf,fragment,navigation,log:context.memlog,timing:{totalMs:performance.now()-started,restoreMs:restoredAt-started,...restoration,inputsMs:inputsAt-restoredAt,typesetMs:stoppedAt-inputsAt,outputMs:performance.now()-stoppedAt,sealTiming,nativeZipMs,nativeZipStreams,nativeFontMs,nativeFonts,fontBodyHits:fontBodyCache.hits,fontBodyMisses:fontBodyCache.misses,fontBodyBytes:fontBodyCache.retainedBytes,fontProgramHits:fontProgramCache.hits,fontProgramMisses:fontProgramCache.misses,fontProgramBytes:fontProgramCache.retainedBytes,fontMemoryCapacity:Module._persistentFontMemoryCapacity?.(),fontMemoryUsed:Module._persistentFontMemoryUsed?.(),fontEncodingHits:fontEncodingCache.hits,fontEncodingMisses:fontEncodingCache.misses,fontEncodingBytes:fontEncodingCache.retainedBytes,stateHashMs:regionStateHashMs,stateHashBytes:regionStateBytes,stateHashReused:regionStateHashReused,stateComparison:fastFlowCapture?'baseline-bytes':'sha256',directStateHash,stateHashVerified:process.env.PERSISTENT_TEX_VERIFY_STATE_HASH==='1',checkpointOffset:checkpoint.offset,preambleOffset:initial.offset,documentSourceBytes:bytes.length,sourceFile:state.inputFile,inputCheckpoint:!!state.inputCheckpoint,reprocessedSourceBytes:request.end-(state.inputFile&&!state.inputCheckpoint?0:checkpoint.offset),excludedSuffixBytes:bytes.length-request.end,syntheticEnd:false,documentComplete:false}};
  }
  // This deliberately makes a *partial* document. Finishing a partial page can
  // change its output routine/layout; only parity-tested regions may eventually
  // be used by a compositor. Never expose this as an accepted full-document PDF.
  const truncated=Buffer.concat([bytes.subarray(0,request.end),Buffer.from('\n\\par\\end{document}\n')]);
  writeWork(jobName+'.tex',truncated);
  Module._persistentEnableCheckpoint(0);Module._persistentEnableCharacters(characterMapping?1:0);
  const inputsAt=performance.now(),code=Module._persistentResume(),typesetAt=performance.now();
  if(code!==0)throw new SourceError('Local region build failed.\n'+context.memlog);
  const pdf=new Uint8Array(FS.readFile('/work/'+jobName+'.pdf'));
  return {scope:'region-prototype' as const,pdf,log:context.memlog,timing:{totalMs:performance.now()-started,restoreMs:restoredAt-started,...restoration,inputsMs:inputsAt-restoredAt,typesetMs:typesetAt-inputsAt,outputMs:performance.now()-typesetAt,checkpointOffset:checkpoint.offset,preambleOffset:initial.offset,documentSourceBytes:bytes.length,sourceFile:state.inputFile,inputCheckpoint:!!state.inputCheckpoint,reprocessedSourceBytes:request.end-(state.inputFile&&!state.inputCheckpoint?0:checkpoint.offset),excludedSuffixBytes:bytes.length-request.end,syntheticEnd:true,documentComplete:false}};
}
parentPort!.on('message',async({id,preamble,body,focus,resources,resourceKey,environmentKey:environment,jobName,characterMapping:nextMapping,supportFolders:folders,auxiliaryCache,region,warm,prepared}:{focus?:number;prepared?:string;id:number;preamble:string;body:string;resources?:[string,Uint8Array][];resourceKey:string;environmentKey:string;jobName:string;characterMapping:boolean;supportFolders:string[];auxiliaryCache?:string;region?:RegionRequest;warm?:boolean})=>{
  if(warm){
    try{selectRegion(prepared);}catch{return;}
    // A fire-and-forget request from the idle parent, after a frame was shown.
    // The worker event loop serializes this full restore before the next RPC.
    if(localRegion&&(!readyCheckpoint||![localRegion.checkpoint,localRegion.prefixCheckpoint,localRegion.warmCheckpoint].includes(readyCheckpoint.checkpoint))&&process.env.PERSISTENT_TEX_DISABLE_READY_RESTORE!=='1'){
      try{const checkpoint=localRegion.warmCheckpoint??localRegion.prefixCheckpoint??localRegion.checkpoint,started=performance.now();restore(checkpoint);readyCheckpoint={checkpoint,duration:performance.now()-started,detail:restoreTiming,finishedAt:performance.now()};}
      catch{readyCheckpoint=undefined;/* The next RPC retries a full restore. */}
    }
    return;
  }
  const priorContinuation=pageContinuation;
  try{mathCache?.discardProvisional();protectedRegion=region?.retain;
    pictureFocus=region?.action==='prepare'&&!region.input?region.start:Number.isSafeInteger(focus)&&focus!>=0&&focus!<=Buffer.byteLength(body)?focus:undefined;
    localEditRunning=!!region&&region.action!=='prepare';
    if(!region||region.action==='prepare')readyCheckpoint=undefined;
    fastFlowCapture=false;
    auxiliaryCacheFile=auxiliaryCache;
    supportEntries.clear();
    observedMissingDirectories.clear();
    if(characterMapping!==!!nextMapping){expensivePrefixes=undefined;continuationPages=undefined;bodyState=undefined;boundaries=[];passPageWitnesses=[];pageContinuation=undefined;readyCheckpoint=undefined;}characterMapping=!!nextMapping;supportFolders=folders??[];if(resources)projectResources=resources;
    if(region&&(!Number.isSafeInteger(region.start)||!Number.isSafeInteger(region.end)||region.start<0||region.end<=region.start||region.end>Buffer.byteLength(region.input?.text??body)))throw new Error('Invalid local region byte range.');
    if(!region){localRegion=undefined;regionCache.clear();}
    const result=region?(region.action==='prepare'?await prepareRegion(body,region,resourceKey,jobName,environment):await renderRegion(body,region,jobName,environment)):await compile(preamble,body,projectResources,resourceKey,jobName,environment),pdf='pdf'in result?result.pdf:undefined;if(region&&region.action!=='prepare'&&localRegion)for(const file of dynamicFiles.keys())if(!localRegion.dependencies.has(file))throw new Error('A new local dependency requires a full build.');if(region&&localRegion)retainRegion(localRegion);parentPort!.postMessage({id,...result,regionKeys:[...regionCache.keys()],...(!pdf?{resources:[...dynamicResourceData]}:{})},pdf?[pdf.buffer]:[]);
  }
  catch(error){
    // Preserve only an older successful real prefix, never the interrupted
    // after-state or ready heap. Future full reuse still validates all bytes,
    // dependencies and context. The flat replacement owns no history chain.
    const preserve=localEditRunning&&(localSuperseded()||error instanceof SourceError)&&priorContinuation?.prefix&&priorContinuation.initial===initial&&priorContinuation.environment===regionEnvironment(environmentKey,jobName)&&priorContinuation.resources===resourceSignature(projectResources);
    pageContinuation=preserve?{...priorContinuation!,prefixOnly:true,checkpoint:priorContinuation!.prefix!,witnesses:[]}:undefined;
    readyCheckpoint=undefined;parentPort!.postMessage({id,resources:[...dynamicResourceData],...(localSuperseded()?{superseded:true}:error instanceof Unavailable?{unavailable:error.message}:{error:String(error),sourceError:error instanceof SourceError})});}
  finally{localEditRunning=false;mathCache?.discardProvisional();}
});

