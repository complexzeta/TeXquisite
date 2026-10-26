import * as fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import {parseDiagnostic,parseWarnings,BuildDiagnostic,DiagnosticInput} from './diagnostics';
import {SourceMirror,SnapshotLimitError,resourceIdentity} from './snapshot';
import {discoverProject,missingProjectInput} from './project-discovery';
import {runWithPreviewCompatibility} from './postscript-compat';
import {WarmCompiler} from './warm';
import {ResidentCompiler,ResidentSourceError,splitResidentArticle,ResidentContext} from './resident';
import {makeNavigation,Navigation,sourceIdentities} from './navigation';

export const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const legacyTkzLoader=/^[\t ]*\\usetkzobj\{all\}[\t ]*(?:%[^\r\n]*)?\r?$/m;
const hasEuclide=(source:string)=>/\\usepackage(?:\[[^\]]*\])?\{tkz-euclide\}/.test(source);
const withoutLegacyTkz=(source:string)=>hasEuclide(source)?source.replace(legacyTkzLoader,'% Compatibility: obsolete tkz object loader omitted.'):source;
export interface Bundle {
  schema: 1; id: string; revision: number; root: string; engine: string;
  completed: string; pdfHash: string; pages: number; synctex: boolean;
  sourceHash?:string;
  navigationHash?:string;
}
export async function validatePdf(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes, {ignoreEncryption:false, throwOnInvalidObject:true});
  if (pdf.getPageCount() < 1) throw new Error('The build produced no displayable pages.');
  return pdf.getPageCount();
}
async function durable(file: string, data: string | Uint8Array) {
  const h = await fs.open(file, 'wx');
  try { await h.writeFile(data); await h.sync(); } finally { await h.close(); }
}
export class ArtifactStore {
  private static pins=new Map<string,number>();
  private static staged=new Set<string>();
  static protectedPaths(){return [...ArtifactStore.pins.keys()].map(file=>path.dirname(file)).concat([...ArtifactStore.staged]);}
  releaseStage(bundle:Bundle){ArtifactStore.staged.delete(path.dirname(this.pdf(bundle)));}
  constructor(readonly directory: string) {}
  pdf(bundle: Bundle) { return path.join(this.directory, 'bundles', bundle.id, 'document.pdf'); }
  pin(bundle:Bundle){const key=this.pdf(bundle);ArtifactStore.pins.set(key,(ArtifactStore.pins.get(key)??0)+1);return()=>{const count=(ArtifactStore.pins.get(key)??1)-1;if(count)ArtifactStore.pins.set(key,count);else ArtifactStore.pins.delete(key);};}
  async prune(){
    const dir=path.join(this.directory,'commits');
    const records=(await fs.readdir(dir)).filter(x=>/^\d{16}-.*\.json$/.test(x)).sort().reverse();
    for(const name of records.slice(8)){
      const record=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
      if(!/^[\da-f-]{36}$/.test(record.id)||ArtifactStore.pins.has(this.pdf({id:record.id} as Bundle)))continue;
      await fs.rm(path.join(dir,name));await fs.rm(path.join(this.directory,'bundles',record.id),{recursive:true,force:true});
    }
  }
  async initialize() {
    await fs.mkdir(path.join(this.directory,'bundles'), {recursive:true});
    await fs.mkdir(path.join(this.directory,'commits'), {recursive:true});
  }
  async navigation(bundle:Bundle):Promise<Navigation|undefined>{
    if(!bundle.navigationHash)return;
    try{const bytes=await fs.readFile(path.join(path.dirname(this.pdf(bundle)),'navigation.json'));if(hash(bytes)===bundle.navigationHash)return JSON.parse(bytes.toString('utf8'));}catch{}
  }
  async stage(pdf: Uint8Array, details: Pick<Bundle,'revision'|'root'|'engine'|'sourceHash'>, synctex?: Uint8Array,prepare?:(bundle:Bundle,pdf:Uint8Array,navigation?:Navigation)=>Promise<void>,navigation?:Navigation): Promise<Bundle> {
    const pages = await validatePdf(pdf);
    await this.initialize();
    const mapping=navigation?JSON.stringify(navigation):undefined;
    const bundle: Bundle = {schema:1, id:randomUUID(), ...details, completed:new Date().toISOString(), pdfHash:hash(pdf), pages, synctex:!!synctex,...(mapping?{navigationHash:hash(mapping)}:{})};
    const dir = path.dirname(this.pdf(bundle));
    await fs.mkdir(dir);
    ArtifactStore.staged.add(dir);
    // Rendering may run alongside durable staging, but publication still waits
    // for every write, successful rendering, and the final commit record.
    const outcomes=await Promise.allSettled([
      durable(this.pdf(bundle),pdf),durable(path.join(dir,'bundle.json'),JSON.stringify(bundle)),
      ...(synctex?[durable(path.join(dir,'document.synctex.gz'),synctex)]:[]),
      ...(mapping?[durable(path.join(dir,'navigation.json'),mapping)]:[]),
      ...(prepare?[prepare(bundle,pdf,navigation)]:[])
    ]);
    const failure=outcomes.find(result=>result.status==='rejected');
    if(failure?.status==='rejected'){this.releaseStage(bundle);throw failure.reason;}
    return bundle;
  }
  async commit(bundle: Bundle, check: () => void = () => {}) {
    // Append-only commit records: a crash before rename leaves only an ignored .tmp.
    // Recovery tries complete records in order; never infers acceptance from bundle presence.
    const dir = path.join(this.directory,'commits');
    const names = (await fs.readdir(dir)).filter(x => /^\d{16}-.*\.json$/.test(x)).sort();
    const seq = names.length ? Number(names.at(-1)!.slice(0,16))+1 : 1;
    const name = String(seq).padStart(16,'0')+'-'+bundle.id;
    const temp = path.join(dir,name+'.tmp');
    await durable(temp, JSON.stringify({schema:1, id:bundle.id, pdfHash:bundle.pdfHash}));
    check();
    // Tiny synchronous rename makes the final invalidation check and publication indivisible
    // with respect to extension-host callbacks. Large file I/O remains asynchronous.
    renameSync(temp, path.join(dir,name+'.json'));
    this.releaseStage(bundle);
  }
  async history(): Promise<Bundle[]> {
    await this.initialize();
    const records = (await fs.readdir(path.join(this.directory,'commits'))).filter(x => /^\d{16}-.*\.json$/.test(x)).sort().reverse();
    const result: Bundle[] = [];
    for (const record of records) {
      try {
        const pointer = JSON.parse(await fs.readFile(path.join(this.directory,'commits',record),'utf8'));
        if (pointer.schema !== 1 || !/^[\da-f-]{36}$/.test(pointer.id)) continue;
        const bundle = JSON.parse(await fs.readFile(path.join(this.directory,'bundles',pointer.id,'bundle.json'),'utf8')) as Bundle;
        if (bundle.id !== pointer.id || bundle.schema !== 1 || result.some(x=>x.id===bundle.id)) continue;
        const bytes = await fs.readFile(this.pdf(bundle));
        if (hash(bytes) !== pointer.pdfHash || bundle.pdfHash !== pointer.pdfHash) continue;
        await validatePdf(bytes);
        result.push(bundle);
        if (result.length === 2) break;
      } catch { /* Incomplete/corrupt latest publication: recover the preceding complete one. */ }
    }
    return result;
  }
  async export(bundle: Bundle, destination: string) {
    const bytes = await fs.readFile(this.pdf(bundle));
    if (hash(bytes) !== bundle.pdfHash) throw new Error('Stored PDF failed its integrity check.');
    const temporary = destination+'.'+randomUUID()+'.tmp';
    try { await durable(temporary,bytes); await fs.rename(temporary,destination); }
    finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
  }
}

export interface BuildOptions { focus?:{line:number;column:number}; root: string; engine: string; executable: string; timeoutMs: number; sourceRevision?:number; sourceText?:string; characterMapping?:boolean; sourceFiles?:Record<string,string>; supportFolders?:string[]; editId?:string; automatic?:boolean; }
export interface DisplayTiming {editId?:string;backend:string;requestToCommitMs:number;}
export interface LocalBasis {bundle:Bundle;options:BuildOptions;source:string;compilerSource:string;project:ResidentContext;pdf:Uint8Array;takeCompiler?:()=>ResidentCompiler|undefined;replaceCompiler?:(previous:ResidentCompiler)=>ResidentCompiler|undefined;returnCompiler?:(compiler:ResidentCompiler)=>boolean;}
export interface Viewer { prepare(bundle: Bundle,pdf?:Uint8Array,navigation?:Navigation): Promise<void>; commit(bundle: Bundle,timing?:DisplayTiming): void; discard(bundle: Bundle): void; diagnostic?(issue:BuildDiagnostic):void; problems?(issues:BuildDiagnostic[],editId?:string):void; localBasis?(basis:LocalBasis):void; }
export class BuildController {
  private static protectedDirectories=new Set<string>();
  private static auxiliaryUsers=new Map<string,number>();
  static protectedPaths(){return [...BuildController.protectedDirectories,...BuildController.auxiliaryUsers.keys()];}
  private retired=false;
  current?: Bundle;
  private active?: AbortController;
  private pending?: BuildOptions;
  private pendingAt=0;
  private retryingNativeFor?:string;
  private sourceIdentity(options:BuildOptions){return JSON.stringify([options.sourceText,options.sourceFiles,options.characterMapping]);}
  private generation = 0;
  private revision = 0;
  private loop?: Promise<void>;
  private readonly cacheSession = randomUUID().slice(0,8);
  private readonly resetCaches = new Set<string>();
  private readonly mirrors = new Map<string,SourceMirror>();
  private readonly dynamicImports = new Map<string,string[]>();
  private readonly discoveryRetries=new Set<string>();
  private readonly warm:WarmCompiler;
  private resident=new ResidentCompiler();
  private localCompilerTransferred=false;
  private transferredCompiler?:ResidentCompiler;
  private residentTask?:{source:string;resourceKey?:string;characterMapping?:boolean;abort:AbortController;promise:Promise<Buffer|undefined>;prefetched?:{options:BuildOptions;requestedAt:number}};
  private residentContext?:ResidentContext;
  private canPrefetch=false;
  private residentSources?:Record<string,string>;
  private startResident(source:string,timeoutMs:number,project:ResidentContext={}){
    const abort=new AbortController();
    const promise=this.resident.compile(source,abort.signal,timeoutMs,this.log,project);
    void promise.catch(()=>{});
    return this.residentTask={source,resourceKey:project.resourceKey,characterMapping:!!project.characterMapping,abort,promise};
  }
  private prefetchPending(){
    const options=this.pending,context=this.residentContext;
    if(!this.canPrefetch||this.residentTask||!context||options?.sourceText===undefined||options.engine!=='pdflatex'||options.executable!=='latexmk'||!splitResidentArticle(options.sourceText))return;
    if(!!options.characterMapping!==!!context.characterMapping)return;
    if(context.environmentKey&&context.environmentKey!==hash(JSON.stringify([path.resolve(options.root),options.supportFolders])))return;
    let project=context;
    if(JSON.stringify(options.sourceFiles)!==JSON.stringify(this.residentSources)){
      // Reuse the last captured resource membership for speculative execution,
      // replacing known open buffers with this request's exact bytes. The next
      // full mirror capture validates this content key before publication.
      const files=options.sourceFiles??{},origins=context.origins??{};
      const mapped=new Set(Object.values(origins));
      if(Object.keys(files).some(file=>!mapped.has(file)))return;
      const resources=(context.resources??[]).map(([name,bytes]):[string,Uint8Array]=>[name,Object.hasOwn(files,origins[name])?Buffer.from(files[origins[name]]):bytes]);
      project={...context,resources,resourceKey:hash(JSON.stringify([path.resolve(options.root),resourceIdentity(resources),options.supportFolders]))};
    }
    project={...project,focus:options.focus};
    this.startResident(this.legacyTkzCompatible?withoutLegacyTkz(options.sourceText):options.sourceText,options.timeoutMs,project);
    this.residentTask!.prefetched={options:{...options},requestedAt:this.pendingAt};
  }
  private pruneTimer?:NodeJS.Timeout;
  private pruneTask?:Promise<void>;
  private publications=0;
  private legacyTkzCompatible=false;
  private schedulePrune(){
    clearTimeout(this.pruneTimer);
    const prune=()=>{if(!this.pruneTask)this.pruneTask=this.store.prune().catch(e=>this.log('History cleanup deferred: '+e+'\n')).finally(()=>{this.pruneTask=undefined;});};
    if(++this.publications%32===0)prune();
    else{this.pruneTimer=setTimeout(prune,2000);this.pruneTimer.unref();}
  }
  get busy() { return !!this.loop; }
  constructor(readonly store: ArtifactStore, readonly viewer: Viewer, readonly status: (s:string)=>void, readonly log:(s:string)=>void) {const auxiliary=path.join(store.directory,'auxiliary');BuildController.auxiliaryUsers.set(auxiliary,(BuildController.auxiliaryUsers.get(auxiliary)??0)+1);const warm=path.join(store.directory,'warm',this.cacheSession);this.warm=new WarmCompiler(warm);BuildController.protectedDirectories.add(warm);BuildController.protectedDirectories.add(path.join(store.directory,'cache',this.cacheSession));}
  async restore() { this.current = (await this.store.history())[0]; this.revision = this.current?.revision ?? 0; return this.current; }
  request(options: BuildOptions): Promise<void> {
    if(this.retired)return Promise.reject(new Error('Project closed.'));
    this.pendingAt=performance.now();
    this.pending = {...options,sourceFiles:options.sourceFiles?{...options.sourceFiles}:undefined};
    // A capability retry for an obsolete draft must not hold newer input behind
    // a native process. Do not interrupt required external-processor builds.
    if(this.retryingNativeFor!==undefined&&options.automatic&&options.sourceText!==undefined&&this.sourceIdentity(options)!==this.retryingNativeFor)this.active?.abort();
    // TeX can process the next captured revision while PDFium renders and the
    // store commits the preceding one. Publication itself remains serialized.
    if(this.loop)this.prefetchPending();
    if (!this.loop) this.loop = this.drain().finally(()=>{this.loop=undefined;});
    return this.loop;
  }
  cancel() { this.generation++; this.pending=undefined; this.active?.abort();this.residentTask?.abort.abort();this.residentTask=undefined;this.canPrefetch=false;this.warm.stop();this.resident.stop();clearTimeout(this.pruneTimer); }
  async dispose(){if(this.retired)return;this.retired=true;this.cancel();await this.loop?.catch(()=>{});await this.warm.stop();await this.pruneTask;BuildController.protectedDirectories.delete(path.join(this.store.directory,'cache',this.cacheSession));BuildController.protectedDirectories.delete(path.join(this.store.directory,'warm',this.cacheSession));const auxiliary=path.join(this.store.directory,'auxiliary'),users=(BuildController.auxiliaryUsers.get(auxiliary)??1)-1;if(users)BuildController.auxiliaryUsers.set(auxiliary,users);else BuildController.auxiliaryUsers.delete(auxiliary);}
  private async drain() {
    while (this.pending) {
      const prefetched=this.residentTask?.prefetched;
      // Work already compiling is an intermediate revision, not another queued
      // draft. Publish it once before consuming the newest pending revision,
      // rather than wasting it and serially compiling a replacement.
      if(prefetched&&(prefetched.options.sourceText!==this.pending.sourceText||JSON.stringify(prefetched.options.sourceFiles)!==JSON.stringify(this.pending.sourceFiles)||!!prefetched.options.characterMapping!==!!this.pending.characterMapping)&&prefetched.options.root===this.pending.root&&prefetched.options.engine===this.pending.engine&&prefetched.options.executable===this.pending.executable&&JSON.stringify(prefetched.options.supportFolders)===JSON.stringify(this.pending.supportFolders)){
        await this.build(prefetched.options,prefetched.requestedAt);continue;
      }
      const options = this.pending,requestedAt=this.pendingAt; this.pending=undefined;
      await this.build(options,requestedAt);
    }
  }
  private async build(options: BuildOptions,requestedAt:number) {
    this.canPrefetch=false;
    const began=performance.now();
    const abort = new AbortController(); this.active=abort;
    const generation=this.generation, revision=++this.revision;
    const check=()=>{if(abort.signal.aborted || generation!==this.generation) throw new Error('Build cancelled.');};
    // Reuse auxiliary state across edits, but never display this mutable output.
    // A controller-specific directory prevents a cancelled, closing project from
    // sharing files with a newly opened controller while its process exits.
    const profile=hash(JSON.stringify([path.resolve(options.root),options.engine,options.executable])).slice(0,8);
    const job=path.join(this.store.directory,'cache',this.cacheSession,profile);
    const input=path.join(job,'in'),output=path.join(job,'out');
    let bundle: Bundle | undefined;
    let diagnosticInputs:DiagnosticInput[]=[],diagnosticTexts=new Map<string,Uint8Array|string>(),nativeAttempted=false,compilerFinished=false,nativeTranscript='';
    const nativeLog=(text:string)=>{nativeTranscript=(nativeTranscript+text).slice(-2_000_000);this.log(text);};
    try {
      this.status('Updating preview. Showing the previous successful version.');
      if(this.resetCaches.delete(job))await fs.rm(output,{recursive:true,force:true});
      let mirror=this.mirrors.get(job);if(!mirror){mirror=new SourceMirror();this.mirrors.set(job,mirror);}
      for(const name of this.dynamicImports.get(job)??[])await fs.rm(path.join(input,name),{force:true});this.dynamicImports.delete(job);
      const source=options.sourceText??await fs.readFile(options.root,'utf8');
      const residentEligible=options.engine==='pdflatex'&&options.executable==='latexmk'&&!!splitResidentArticle(source);
      check();
      const engineFlag: Record<string,string> = {pdflatex:'-pdf',xelatex:'-xelatex',lualatex:'-lualatex',latex:'-pdfps'};
      if (!engineFlag[options.engine]) throw new Error('Unsupported engine.');
      const base=path.basename(options.root,'.tex');
      let compilerSource=this.legacyTkzCompatible?withoutLegacyTkz(source):source;
      let mirrored=false;
      let project:ResidentContext={focus:options.focus,characterMapping:!!options.characterMapping,jobName:base,supportFolders:options.supportFolders,environmentKey:hash(JSON.stringify([path.resolve(options.root),options.supportFolders])),resourceKey:hash(path.resolve(options.root))};
      let captured;
      try{captured=await mirror.capture(options.root,input,options.supportFolders,compilerSource,options.sourceFiles);}
      catch(error){
        if(!(error instanceof SnapshotLimitError)&&(!error||typeof error!=='object'||(error as {code?:string}).code!=='SNAPSHOT_DISCOVERY_REQUIRED'))throw error;
        if(mirror.selective&&!String(error instanceof Error?error.message:error).includes('New project inputs'))throw error;
        this.status('Discovering project inputs. Showing the previous successful version.');
        const discovery=await discoverProject({...options,sourceText:compilerSource},path.dirname(input),abort.signal,runProcess,this.log);check();mirror.select(discovery.names,discovery);
        captured=await mirror.capture(options.root,input,options.supportFolders,compilerSource,options.sourceFiles);
      }
      mirrored=true;
      // Large-folder inputs are frozen in the discovered snapshot. The compiler
      // must not bypass it by reading that original folder as a live support root.
      if(mirror.selective)project.supportFolders=options.supportFolders?.filter(folder=>{const root=path.dirname(path.resolve(options.root)),a=path.relative(root,path.resolve(folder)),b=path.relative(path.resolve(folder),root);const within=(relative:string)=>!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);return !within(a)&&!within(b);});
      const capturedAt=performance.now();
      diagnosticInputs=[{file:options.root,aliases:[options.root,path.basename(options.root),'./'+path.basename(options.root),'/work/'+path.basename(options.root),path.join(input,path.basename(options.root))]},...captured.resources.filter(([name])=>/\.(tex|sty|cls|ltx|def|cfg|clo|bib|bst|txt)$/i.test(name)).map(([name]):DiagnosticInput=>({file:captured.origins[name],aliases:[name,'./'+name,'/work/'+name,'/project-resources/'+name,path.join(input,name)]}))];
      diagnosticTexts=new Map([[options.root,source],...captured.resources.map(([name,bytes]):[string,Uint8Array|string]=>[captured.origins[name],bytes])]);
      project={...project,...captured,resourceKey:hash(JSON.stringify([path.resolve(options.root),captured.resourceKey,options.supportFolders])),auxiliaryCache:path.join(this.store.directory,'auxiliary',profile,'resident.json')};
      this.residentContext=project;this.residentSources=options.sourceFiles;
      // Missing output forces latexmk to run without throwing away its dependency
      // database, references, bibliography or other reusable auxiliary files.
      const args=['-norc',engineFlag[options.engine],'-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-no-shell-escape','-outdir='+output,'./'+path.basename(options.root)];
      this.log('\n'+JSON.stringify({executable:options.executable,args,cwd:input})+'\n');
      let pdf:Buffer|undefined;
      let navigation:Navigation|undefined;
      let capabilityRetry=false;
      let backend='Native compilation.',warningLog='';
      if(residentEligible){
        let task=this.residentTask;
        if(task&&(task.source!==compilerSource||task.resourceKey!==project.resourceKey||task.characterMapping!==!!project.characterMapping)){await task.promise.catch(()=>{});if(this.residentTask===task)this.residentTask=undefined;task=undefined;check();}
        task??=this.startResident(compilerSource,options.timeoutMs,project);
        try{pdf=await task.promise;}
        catch(error){
          check();const message=String(error);
          if(options.automatic&&error instanceof ResidentSourceError){this.log('Draft TeX error; retaining the resident checkpoint without a native retry.\n');throw error;}
          capabilityRetry=true;
          if(/I can't find file [`']tkz-obj-[^\r\n]+\.tex/.test(message)&&legacyTkzLoader.test(source)&&hasEuclide(source)){
            this.log('Compatibility: modern tkz-euclide loads its objects automatically; the editor source remains unchanged.\n');
            compilerSource=withoutLegacyTkz(source);
            try{pdf=await this.resident.compile(compilerSource,abort.signal,options.timeoutMs,this.log,project);capabilityRetry=false;if(pdf)this.legacyTkzCompatible=true;}
            catch(retry){check();this.log('Resident capability check failed; checking the native engine. '+String(retry)+'\n');}
          }else this.log('Resident capability check failed; checking the native engine. '+message+'\n');
        }finally{if(this.residentTask===task)this.residentTask=undefined;}
        if(pdf){
          warningLog=this.resident.diagnosticLog;
          try{navigation=makeNavigation(this.resident.navigation,options.root,source,project.resources??[],captured.origins);}catch(e){this.log('Source navigation unavailable: '+String(e)+'\n');}
          backend=this.resident.lastTiming?.preambleRebuilt?'Preamble initialized.':'Preamble cached.';this.warm.stop();this.log('Completed the document from a resident TeX checkpoint.\n');
        }
      }
      if(!pdf){
        if(capabilityRetry){
          this.retryingNativeFor=this.sourceIdentity(options);
          if(this.pending?.automatic&&this.pending.sourceText!==undefined&&this.sourceIdentity(this.pending)!==this.retryingNativeFor)abort.abort();
          check();
        }
        await fs.mkdir(output,{recursive:true});if(!mirrored)await mirror.capture(options.root,input,options.supportFolders,compilerSource,options.sourceFiles);
        else await fs.writeFile(path.join(input,path.basename(options.root)),compilerSource);
        const originalResources=new Set(project.resources?.map(([name])=>name)??[]),imported:string[]=[];
        for(const [name,bytes]of residentEligible?this.resident.fallbackResources:[]){
          if(name===path.basename(options.root)||originalResources.has(name)||path.isAbsolute(name)||name.includes('\\')||name.includes(':')||name.split('/').includes('..'))continue;
          const file=path.join(input,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);imported.push(name);
        }
        if(imported.length)this.dynamicImports.set(job,imported);
        // A root revision captured from the editor remains immutable even if a
        // newer edit reaches disk while this fallback build is being prepared.
        await fs.rm(path.join(output,base+'.pdf'),{force:true});
        await fs.rm(path.join(output,base+'.synctex.gz'),{force:true});
      }
      if(!pdf&&options.engine==='pdflatex'&&options.executable==='latexmk'){
        pdf=await this.warm.compile(source,'pdflatex',base,abort.signal,options.timeoutMs,this.log);
        if(pdf){warningLog=this.warm.diagnosticLog;this.log('Completed the whole article using a preloaded TeX process.\n');}
      }
      if(!pdf){
        nativeAttempted=true;
        try{await runWithPreviewCompatibility(runProcess,options.executable,args,input,options.timeoutMs,abort.signal,nativeLog);}
        catch(error){
          const transcript=await fs.readFile(path.join(output,base+'.log'),'utf8').catch(()=>'');
          // Modern tkz-euclide already loads its objects. Older documents may
          // explicitly request the retired all-objects loader. Retry only its
          // specific missing-object failure; keep source bytes and line numbers.
          if(!/I can't find file [`']tkz-obj-[^\r\n]+\.tex/.test(transcript)||!legacyTkzLoader.test(source)||!hasEuclide(source))throw error;
          check();
          this.log('Compatibility: modern tkz-euclide loads its objects automatically. Retrying without the obsolete \\usetkzobj{all} line in the build copy; editor source is unchanged.\n');
          await fs.writeFile(path.join(input,path.basename(options.root)),withoutLegacyTkz(source));mirror.reset();
          await runWithPreviewCompatibility(runProcess,options.executable,args,input,options.timeoutMs,abort.signal,nativeLog);
          this.legacyTkzCompatible=true;
        }
      }
      if(nativeAttempted)warningLog=await fs.readFile(path.join(output,base+".log"),"utf8").catch(()=>"");
      const warnings=parseWarnings(warningLog,diagnosticInputs,nativeTranscript).map((parsed,index):BuildDiagnostic=>{const text=parsed.file?diagnosticTexts.get(parsed.file):undefined;return {...parsed,id:this.cacheSession+"-"+revision+"-warning-"+index,root:options.root,editId:options.editId,...(text!==undefined?{sourceHash:hash(typeof text==="string"?text.replace(/\r\n/g,"\n"):Buffer.from(text).toString("utf8").replace(/\r\n/g,"\n"))}:{})};});
      compilerFinished=true;
      if(mirror.selective&&!mirror.discoveryComplete)throw Error('Project input discovery did not complete. Check the discovery log; the previous preview has been retained.');
      this.canPrefetch=true;
      this.prefetchPending();
      const compiledAt=performance.now();
      check();
      const sync=pdf?undefined:await fs.readFile(path.join(output,base+'.synctex.gz')).catch(()=>undefined);
      if(sync){const sources=sourceIdentities(options.root,source,project.resources??[],captured.origins),nativeInputs:Record<string,string>={};for(const [name,file]of Object.entries(captured.origins))if(sources[file])nativeInputs[file]=path.join(input,name);navigation={schema:1,sources,regions:[],nativeInputs};}
      pdf??=await fs.readFile(path.join(output,base+'.pdf'));
      const validatedAt=Date.now();
      let viewerMs=0;
      bundle=await this.store.stage(pdf,{revision,root:options.root,engine:options.engine,sourceHash:hash(source)},sync,async(candidate,bytes,map)=>{
        bundle=candidate;check();const began=performance.now();await this.viewer.prepare(candidate,bytes,map);viewerMs=performance.now()-began;
      },navigation);
      const stagedAt=performance.now();
      const storedAt=Date.now();
      check();
      this.log(`Timing: parallel store/render ${storedAt-validatedAt} ms; viewer ${Math.round(viewerMs)} ms.\n`);
      check();
      await this.store.commit(bundle,check);
      const committedAt=performance.now();
      this.current=bundle;
      this.viewer.commit(bundle,{editId:options.editId,backend,requestToCommitMs:committedAt-requestedAt});
      this.viewer.problems?.(warnings,options.editId);
      if(backend.startsWith('Preamble'))try{this.viewer.localBasis?.({bundle,options,source,compilerSource,project,pdf,takeCompiler:()=>{
        // Transfer ownership only after publication and only while idle. Future
        // full verification gets its own worker; local edits cannot race it.
        // A failed local page proof may stop its transferred worker. That
        // retired owner must not block every later publication from offering
        // its newly converged compiler. A live owner still transfers once.
        if(this.localCompilerTransferred&&this.transferredCompiler?.initialized||this.current!==bundle||this.residentTask||this.resident.busy||abort.signal.aborted||generation!==this.generation)return;
        const compiler=this.resident;this.resident=new ResidentCompiler();this.localCompilerTransferred=true;this.transferredCompiler=compiler;return compiler;
      },replaceCompiler:previous=>{
        // Explicitly replace the idle local owner with this newly converged
        // publication. Preserve the ordinary one-time transfer guard.
        if(this.transferredCompiler!==previous||previous.busy||!previous.initialized||this.current!==bundle||this.retired||this.residentTask||this.resident.busy||!this.resident.initialized||abort.signal.aborted||generation!==this.generation)return;
        const compiler=this.resident;this.resident=new ResidentCompiler();this.transferredCompiler=compiler;this.localCompilerTransferred=true;previous.stop();return compiler;
      },returnCompiler:compiler=>{
        // An unsupported block must not strand the only warm engine locally.
        // Reclaim it only before a replacement worker has begun any request.
        if(this.transferredCompiler!==compiler||this.current!==bundle||generation!==this.generation||this.retired||this.residentTask||this.resident.initialized||this.resident.busy||compiler.busy||!compiler.initialized)return false;
        this.resident=compiler;this.transferredCompiler=undefined;this.localCompilerTransferred=false;return true;
      }});}catch(error){this.log('Local preview preparation deferred: '+String(error)+'\n');}
      if(process.env.PERSISTENT_TEX_PROFILE)this.log('Profile build '+JSON.stringify({revision,queueMs:began-requestedAt,captureMs:capturedAt-began,compileMs:compiledAt-capturedAt,stageAndRenderMs:stagedAt-compiledAt,viewerMs,commitMs:committedAt-stagedAt,totalMs:committedAt-began})+'\n');
      this.log(`Accepted ${bundle.pages} pages ${Math.ceil(committedAt-requestedAt)} ms after the build request; ${Math.ceil(began-requestedAt)} ms queued, ${Math.ceil(committedAt-began)} ms processing.\n`);
      // This is request-to-publication timing. The renderer measures the full
      // input-to-display interval on its own clock, including IPC and painting.
      this.status(`Preview updated. ${Math.ceil(committedAt-requestedAt)} ms from build request to publication. ${backend}${this.pending?' Newer edits are queued.':''}`);
      this.schedulePrune();
    } catch(error) {
      if(bundle) this.viewer.discard(bundle);
      const message=error instanceof Error ? error.message : String(error);
      this.log(message+'\n');
      // A failed process may poison auxiliary files. Reset only for the next
      // explicitly requested/changed revision; never spin on a broken source.
      if(!bundle)this.resetCaches.add(job);
      if(!abort.signal.aborted&&generation===this.generation){
        const transcript=!compilerFinished&&nativeAttempted?await fs.readFile(path.join(output,path.basename(options.root,'.tex')+'.log'),'utf8').catch(()=>''):'';
        const mirror=this.mirrors.get(job),identity=JSON.stringify([options.root,this.sourceIdentity(options)]);
        if(mirror?.selective&&missingProjectInput(transcript+'\n'+nativeTranscript+'\n'+message)&&!this.discoveryRetries.has(identity)){
          this.discoveryRetries.add(identity);if(this.discoveryRetries.size>16)this.discoveryRetries.delete(this.discoveryRetries.values().next().value!);mirror.requireDiscovery();
          if(!this.pending){this.pending=options;this.pendingAt=requestedAt;}this.status('Discovering newly requested project inputs. Showing the previous successful version.');return;
        }
        const parsed=parseDiagnostic((transcript+(!compilerFinished?'\n'+nativeTranscript:'')).trim()||message,diagnosticInputs),text=parsed.file?diagnosticTexts.get(parsed.file):undefined;
        const issue:BuildDiagnostic={...parsed,id:this.cacheSession+'-'+revision,root:options.root,editId:options.editId,...(text!==undefined?{sourceHash:hash(typeof text==='string'?text.replace(/\r\n/g,'\n'):Buffer.from(text).toString('utf8').replace(/\r\n/g,'\n'))}:{})};
        this.viewer.diagnostic?.(issue);
        this.viewer.problems?.([issue],options.editId);
        this.status(`Build failed: ${issue.message} ${this.current?'Showing the last successful version.':'No successful preview yet.'}`);
      }else this.status('Build cancelled. '+(this.current?'Showing the last successful version.':'No successful preview yet.'));
    } finally {
      this.retryingNativeFor=undefined;
      this.active=undefined;
      if(bundle){this.store.releaseStage(bundle);if(this.current?.id!==bundle.id)await fs.rm(path.dirname(this.store.pdf(bundle)),{recursive:true,force:true}).catch(()=>{});}
    }
  }
}

export async function runProcess(exe:string,args:string[],cwd:string,timeoutMs:number,signal:AbortSignal,log:(s:string)=>void,environment:NodeJS.ProcessEnv={}): Promise<void> {
  if(signal.aborted) throw new Error('Build cancelled.');
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,detached:process.platform!=='win32',env:{...process.env,...environment,LC_ALL:'C',LANG:'C'}});
    let reason: string | undefined, kill: Promise<void> | undefined;
    const stop=(why:string)=>{
      if(reason) return; reason=why;
      if(!child.pid) return;
      if(process.platform==='win32') {
        kill=new Promise(done=>{
          const killer=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,shell:false});
          killer.once('error',()=>{child.kill();done();}); killer.once('close',code=>{if(code!==0)child.kill('SIGKILL');done();});
        });
      } else {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}}
    };
    const cancel=()=>stop('Build cancelled.');
    signal.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(()=>stop('Build timed out.'),timeoutMs);
    const cleanup=()=>{clearTimeout(timeout);signal.removeEventListener('abort',cancel);};
    child.stdout.on('data',d=>log(d.toString())); child.stderr.on('data',d=>log(d.toString()));
    child.once('error',e=>{cleanup();reject(new Error(`Cannot start ${exe}: ${e.message}`));});
    child.once('close',async code=>{cleanup();await kill;if(reason)reject(new Error(reason));else if(code!==0)reject(new Error(`Build failed (exit ${code}). See build log.`));else resolve();});
  });
}
