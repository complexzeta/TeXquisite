import type {IncludedInput} from './included-source';
import {emptyDocumentPreview} from './empty-document';
import {Worker} from 'node:worker_threads';
import * as path from 'node:path';
export function splitResidentArticle(source:string){
  source=source.replace(/\r\n/g,'\n');
  if(/\\PersistentTeXCheckpoint\b/.test(source))return;
  // The engine reaches a begin-document hook itself. Preambles can construct
  // class names, input packages, or invoke document start through macros.
  return {preamble:'',body:emptyDocumentPreview(source)};
}
export interface ResidentContext {focus?:{line:number;column:number};characterMapping?:boolean;origins?:Record<string,string>;resources?:[string,Uint8Array][];resourceKey?:string;environmentKey?:string;jobName?:string;supportFolders?:string[];auxiliaryCache?:string;}
export class ResidentSourceError extends Error{}
export class ResidentSupersededError extends Error{}
export interface RegionRange {from:number;to:number;}
export interface PageSpan {first:number;last:number;}
type RegionRequest={lecture?:boolean;pictureFamily?:boolean;baselineProof?:boolean;retain?:string;idle?:boolean;prepared?:string;input?:IncludedInput;action:'prepare'|'render'|'nodes'|'flow'|'page'|'band';start:number;end:number;page?:number;provisional?:boolean;focus?:number};
export interface RegionFragment {neutralCharacters?:boolean;neutralWriteFree?:boolean;lectureSideEffects?:boolean;shape:number[][];lines:number;widthSp:number;heightSp:number;depthSp:number;paddingSp:number;page:number;stateHash:string;flowStateHash?:string;}
type Result={regionKey?:string;regionKeys?:string[];scope?:'region-prepared'|'region-prototype'|'region-fragment'|'region-page';pageSpan?:PageSpan;fragment?:RegionFragment;pdf?:Uint8Array;navigation?:string;log?:string;diagnosticLog?:string;error?:string;sourceError?:boolean;unavailable?:string;timing?:unknown;reason?:string;resources?:[string,Uint8Array][]};
export type ResidentTiming={auxiliaryCheckpointReused?:boolean;bodyCheckpointRebuilt?:boolean;baselineCheckpointAvailable?:boolean;drawingCaptures?:number;drawingCaptureMs?:number;editedDrawingPrefixCaptured?:boolean;editedDrawingPrefixReused?:boolean;drawingPrefixReused?:boolean;expensivePrefixReused?:boolean;prefixCaptures?:number;prefixCaptureMs?:number;expensivePrefixEntries?:number;expensivePrefixBytes?:number;tikzMathIntermediateHits?:number;tikzMathIntermediateLearned?:number;tikzMathIntermediateEntries?:number;tikzMathProvisionalHits?:number;editedFamilyCaptured?:boolean;editedFamilyCaptureMs?:number;editedFamilyReused?:boolean;editedFamilyCheckpointOffset?:number;localContinuationReused?:boolean;localPrefixReused?:boolean;continuationCaptured?:boolean;continuationCaptureMs?:number;continuationPrefixBytes?:number;continuationPrefixRetained?:boolean;continuationReusedBytes?:number;fullWitnessReused?:boolean;pictureFamilyFrom?:number;pictureFamilyTo?:number;pictureFamilyCount?:number;pageWitnessCount?:number;familyCheckpointOffset?:number;checkpointPage?:number;baselinePage?:number;baselinePageCostMs?:number;pageWitnessCaptured?:boolean;witnessCaptureMs?:number;witnessCaptureReused?:number;baselineCheckpointReused?:boolean;baselineCheckpointOffset?:number;regionCacheHit?:boolean;regionCacheEntries?:number;regionCacheBytes?:number;totalMs?:number;roundTripMs?:number;restoreMs?:number;typesetMs?:number;checkpointOffset?:number;sourceFile?:string;inputCheckpoint?:boolean;preambleOffset?:number;documentSourceBytes?:number;reprocessedSourceBytes?:number;excludedSuffixBytes?:number;syntheticEnd?:boolean;documentComplete?:boolean;continuation?:string;boundedPageOnly?:boolean;finalPageFlush?:boolean;preambleRebuilt?:boolean;passes?:number;diskAuxiliaryReused?:boolean;diskAuxiliaryRejected?:boolean;nativeFontMs?:number;nativeFonts?:number;fontBodyHits?:number;fontBodyMisses?:number;fontBodyBytes?:number;fontProgramHits?:number;fontProgramMisses?:number;fontProgramBytes?:number;fontMemoryCapacity?:number;fontMemoryUsed?:number;fontEncodingHits?:number;fontEncodingMisses?:number;fontEncodingBytes?:number;nativeZipMs?:number;nativeZipStreams?:number;reusedBaseline?:boolean;prefixProbeMs?:number;prefixProbeAttempts?:number;prefixProbeStoppedAtFocus?:boolean;prefixCheckpointOffset?:number;prefixReused?:boolean;skippedPrefixBytes?:number;paragraphCheckpointOffset?:number;prefixReloadMs?:number;anchorSourceBytes?:number;anchorExcludedSuffixBytes?:number;preRestored?:boolean;previousRestoreMs?:number;preRestoreIdleMs?:number;restoreDetail?:{heapMs:number;filesMs:number;streamsMs:number;heapBytes:number;copiedBytes:number};previousRestoreDetail?:ResidentTiming['restoreDetail']};
export class ResidentCompiler{
  constructor(private readonly selectedResources?:{root:string;files:Record<string,string>;formatManifest?:string}){}
  fallbackResources:[string,Uint8Array][]=[];
  lastTiming?:ResidentTiming;
  diagnosticLog="";
  navigation='';
  private protectedRegion?:string;
  protectRegion(key?:string){this.protectedRegion=key;}
  private regionKey?:string;
  private regionKeys=new Set<string>();
  hasRegion(key:string){return this.regionKey===key||this.regionKeys.has(key);}
  useRegion(key?:string){this.regionKey=key;}
  private fragment?:RegionFragment;
  private pageSpan?:PageSpan;
  private worker?:Worker;
  private sequence=0;
  private unavailable?:string;
  private sentResourceKey?:string;
  private pending?:{reject:(e:Error)=>void};
  private localEditRunning=false;
  private readonly supersession=new Int32Array(new SharedArrayBuffer(4));
  supersedeRegionEdit(){if(this.pending&&this.localEditRunning){Atomics.store(this.supersession,0,1);return true;}return false;}
  get busy(){return !!this.pending;}
  get initialized(){return !!this.worker;}
  prepareNextRegionEdit(){if(!this.pending)this.worker?.postMessage({warm:true,prepared:this.regionKey});}
  stop(){this.protectedRegion=undefined;this.regionKeys.clear();this.regionKey=undefined;const worker=this.worker;this.worker=undefined;this.sentResourceKey=undefined;this.fallbackResources=[];this.pending?.reject(new Error('Build cancelled.'));this.pending=undefined;void worker?.terminate();}
  async compile(source:string,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={}):Promise<Buffer|undefined>{
    return this.execute(source,signal,timeoutMs,log,project);
  }
  // Scoped local-output APIs. Their partial PDFs are deliberately not returned
  // by compile and must never enter whole-document publication.
  async prepareRegion(source:string,range:RegionRange,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},focus?:number,input?:IncludedInput,idle=false,pictureFamily=false){
    const request=this.regionRequest(input?.text??source,range,'prepare');request.input=input;request.idle=idle;request.pictureFamily=pictureFamily;
    if(focus!==undefined&&Number.isInteger(focus)&&focus>=range.from&&focus<range.to)request.focus=Buffer.byteLength((input?.text??source).slice(0,focus).replace(/\r\n/g,'\n'));
    const pdf=await this.execute(source,signal,timeoutMs,log,project,request);
    if(this.lastTiming?.checkpointOffset===undefined)throw new Error('Local region engine unavailable.');
    const from=this.lastTiming?.pictureFamilyFrom,to=this.lastTiming?.pictureFamilyTo;
    const familyRange=Number.isSafeInteger(from)&&Number.isSafeInteger(to)?{from:Buffer.from(source).subarray(0,from).toString('utf8').length,to:Buffer.from(source).subarray(0,to).toString('utf8').length}:undefined;
    return {pdf,navigation:this.navigation,regionKey:this.regionKey,familyRange};
  }
  async previewRegion(source:string,range:RegionRange,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},input?:IncludedInput){
    const pdf=await this.execute(source,signal,timeoutMs,log,project,{...this.regionRequest(input?.text??source,range,'render'),input});
    if(!pdf)throw new Error('Local region engine unavailable.');
    return {scope:'region-prototype' as const,documentComplete:false as const,pdf,timing:this.lastTiming};
  }
  async previewRegionNodes(source:string,range:RegionRange,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},input?:IncludedInput){
    const pdf=await this.execute(source,signal,timeoutMs,log,project,{...this.regionRequest(input?.text??source,range,'nodes'),input});
    if(!pdf||!this.fragment)throw new Error('Local paragraph output unavailable.');
    return {scope:'region-fragment' as const,documentComplete:false as const,pdf,fragment:this.fragment,navigation:this.navigation,timing:this.lastTiming};
  }
  async previewRegionFlow(source:string,range:RegionRange,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},provisional=false,input?:IncludedInput,lecture=false){
    const pdf=await this.execute(source,signal,timeoutMs,log,project,{...this.regionRequest(input?.text??source,range,'flow'),provisional,input,lecture});
    if(!pdf||!this.fragment)throw new Error('Continuous block output unavailable.');
    return {scope:'region-fragment' as const,documentComplete:false as const,pdf,fragment:this.fragment,navigation:this.navigation,timing:this.lastTiming};
  }
  async previewRegionPage(source:string,range:RegionRange,page:number,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},continuous=false,input?:IncludedInput,baselineProof=false){
    if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid affected page.');
    const pdf=await this.execute(source,signal,timeoutMs,log,project,{...this.regionRequest(input?.text??source,range,continuous?'band':'page'),page,input,baselineProof});
    if(!pdf||!this.pageSpan)throw new Error('Local page output unavailable.');
    return {scope:'region-page' as const,documentComplete:false as const,pdf,page:this.pageSpan.first,pageSpan:this.pageSpan,navigation:this.navigation,timing:this.lastTiming};
  }
  private regionRequest(source:string,range:RegionRange,action:RegionRequest['action']):RegionRequest{
    const {from,to}=range;
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from||to>source.length)throw new Error('Invalid local region range.');
    for(const offset of [from,to])if((source[offset-1]==='\r'&&source[offset]==='\n')||(/[\uD800-\uDBFF]/.test(source[offset-1]??'')&&/[\uDC00-\uDFFF]/.test(source[offset]??'')))throw new Error('Local region boundary splits a source character.');
    // Normalize exactly as splitResidentArticle does, then use engine byte offsets.
    const prefix=source.slice(0,from).replace(/\r\n/g,'\n'),region=source.slice(from,to).replace(/\r\n/g,'\n');
    if(!/\n[\t ]*\n$/.test(region))throw new Error('Local prototype requires a complete paragraph ending in a blank line.');
    return {action,start:Buffer.byteLength(prefix),end:Buffer.byteLength(prefix+region)};
  }
  private async execute(source:string,signal:AbortSignal,timeoutMs:number,log:(s:string)=>void,project:ResidentContext={},region?:RegionRequest):Promise<Buffer|undefined>{
    if(this.pending)throw new Error('Resident compiler already has an active request.');
    this.fallbackResources=[];
    this.lastTiming=undefined;
    this.navigation='';
    this.fragment=undefined;
    this.pageSpan=undefined;
    const split=splitResidentArticle(source);if(!split||this.unavailable)return;
    if(signal.aborted)throw new Error('Build cancelled.');
    const worker=this.worker??=new Worker(path.join(__dirname,'resident-worker.js'),{workerData:{supersession:this.supersession.buffer},...(this.selectedResources?{env:{...process.env,TEXQUISITE_TEX_RESOURCES:JSON.stringify(this.selectedResources)}}:{})});
    Atomics.store(this.supersession,0,0);this.localEditRunning=!!region&&region.action!=='prepare';
    const id=++this.sequence,requestedAt=performance.now();
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.off('message',message);worker.off('error',failed);worker.off('exit',exited);this.pending=undefined;this.localEditRunning=false;};
      const fail=(e:Error)=>{cleanup();reject(e);};
      const cancel=()=>{fail(new Error('Build cancelled.'));this.stop();};
      const timer=setTimeout(()=>{fail(new Error('Build timed out.'));this.stop();},timeoutMs);
      const failed=(e:Error)=>{fail(e);this.stop();};
      const exited=()=>{fail(new Error('Resident compiler stopped.'));if(this.worker===worker)this.worker=undefined;};
      const message=(response:Result&{id:number;superseded?:boolean})=>{
        if(response.id!==id)return;cleanup();
        if(response.superseded){reject(new ResidentSupersededError('A newer local edit superseded this calculation.'));return;}
        if(response.scope&&!region){reject(new Error('Partial region output cannot be published as a full document.'));return;}
        if(response.regionKey)this.regionKey=response.regionKey;if(response.regionKeys)this.regionKeys=new Set(response.regionKeys);if(!region){this.regionKey=undefined;this.regionKeys.clear();}
        this.fallbackResources=response.resources??[];
        this.lastTiming=response.timing?{...response.timing as ResidentTiming,roundTripMs:performance.now()-requestedAt}:undefined;
        this.navigation=response.navigation??'';
        this.diagnosticLog=response.diagnosticLog??'';
        this.fragment=response.fragment;
        this.pageSpan=response.pageSpan;
        if(response.log)log(response.log);
        if(this.lastTiming)log('Timing: resident '+JSON.stringify(this.lastTiming)+'\n');
        if(response.reason)log('Resident fallback: '+response.reason+'\n');
        if(response.unavailable){this.unavailable=response.unavailable;log('Resident compiler unavailable: '+response.unavailable+'\n');this.stop();resolve(undefined);}
        else if(response.error)reject(response.sourceError?new ResidentSourceError(response.error):new Error(response.error));
        else resolve(response.pdf?Buffer.from(response.pdf):undefined);
      };
      this.pending={reject:fail};worker.on('message',message);worker.once('error',failed);worker.once('exit',exited);
      const resourceKey=project.resourceKey??'',resources=this.sentResourceKey===resourceKey?undefined:project.resources??[];this.sentResourceKey=resourceKey;
      let focus:number|undefined;const point=project.focus;if(!region&&point&&Number.isSafeInteger(point.line)&&point.line>=1&&Number.isSafeInteger(point.column)&&point.column>=0){const lines=split.body.split('\n');if(point.line<=lines.length&&point.column<=lines[point.line-1].length)focus=Buffer.byteLength(lines.slice(0,point.line-1).map(line=>line+'\n').join('')+lines[point.line-1].slice(0,point.column));}
      signal.addEventListener('abort',cancel,{once:true});worker.postMessage({id,...split,focus,resources,resourceKey,characterMapping:!!project.characterMapping,environmentKey:project.environmentKey??'',jobName:project.jobName??'main',supportFolders:project.supportFolders??[],auxiliaryCache:project.auxiliaryCache,region:region?{...region,retain:this.protectedRegion,prepared:region.action==='prepare'?undefined:this.regionKey}:undefined});
    });
  }
}
