import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {resourceIdentity} from './snapshot';
import {NeutralBlocks,neutralId} from './neutral-blocks';
import type {IncludedInput} from './included-source';
import {PDFDocument} from 'pdf-lib';
import {ResidentCompiler,ResidentSourceError,ResidentSupersededError,RegionRange,RegionFragment,PageSpan} from './resident';
import type {LocalBasis} from './core';
import {RegionCompositor,ParagraphAnchor,paragraphPages,cursorPosition,flowCaretY,flowLocations} from './region-compositor';
import {previewRepair,previewRegionRepair} from './preview-recovery';
import {recoveryLocations,carryRecoveryDiagnostics} from './recovery-navigation';
import type {BuildDiagnostic} from './diagnostics';
type CalibrationGlyph={x:number;y:number;width:number;height:number;outline?:boolean};
export type LocalVerification=boolean|{dx:number;dy:number;calibratedGlyphs?:CalibrationGlyph[]};
export interface LocalCalibration {x:number;y:number;anchors:ParagraphAnchor[];calibratedGlyphs?:CalibrationGlyph[];inkBleedBp?:number;}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function plainTextChange(before:string,after:string){
  if(before===after)return false;
  let from=0,endBefore=before.length,endAfter=after.length;
  while(from<endBefore&&from<endAfter&&before[from]===after[from])from++;
  while(endBefore>from&&endAfter>from&&before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}
  const ordinary=/^[\p{L}\p{N}\p{M}\t .,:;!?'’\-]*$/u;
  if(!ordinary.test(before.slice(from,endBefore))||!ordinary.test(after.slice(from,endAfter)))return false;
  const prefix=before.slice(0,from);let depth=0;
  for(let i=0;i<prefix.length;i++){if(prefix[i]==='\\'&&'\\{}'.includes(prefix[i+1]??'')){i++;continue;}if(prefix[i]==='{')depth++;else if(prefix[i]==='}')depth--;}
  if(depth!==0)return false;
  // Keep command names and unbraced arguments on the full-build path.
  const slash=prefix.lastIndexOf('\\');return slash<0||/[}\n$]/.test(prefix.slice(slash));
}
// Reuse only an engine-confirmed literal undefined-command skip. Ordinary
// typing before the token may move its offset; command or preceding definition
// edits reconsider it. Never reuse structural or compound substitutions.
export function carryUndefinedRepair(previous:string,repaired:string,current:string){
  if(previous.length!==repaired.length)return;
  let from=0,to=previous.length;
  while(from<to&&previous[from]===repaired[from])from++;
  while(to>from&&previous[to-1]===repaired[to-1])to--;
  const command=previous.slice(from,to);
  if(!/^\\[A-Za-z@]+$/.test(command)||repaired.slice(from,to)!==' '.repeat(to-from)||/[A-Za-z@]/.test(previous[to]??''))return;
  // An unchanged prefix through the rejected token retains its proven
  // undefined meaning, including plain words after an unbraced command.
  if(previous!==current&&!current.startsWith(previous.slice(0,to))&&!plainTextChange(previous,current))return;
  let start=0,end=previous.length,endCurrent=current.length;
  while(start<end&&start<endCurrent&&previous[start]===current[start])start++;
  while(end>start&&endCurrent>start&&previous[end-1]===current[endCurrent-1]){end--;endCurrent--;}
  if(start<to&&end>from)return;
  const at=from+(end<=from?current.length-previous.length:0);
  if(current.slice(at,at+command.length)!==command||/[A-Za-z@]/.test(current[at+command.length]??''))return;
  return {source:current.slice(0,at)+' '.repeat(command.length)+current.slice(at+command.length),message:'Preview skipped undefined command '+command+'.',line:current.slice(0,at).split('\n').length};
}
export function paragraphAt(source:string,at:number):RegionRange|undefined{
  if(at<0||at>source.length)return;
  // Treat a run of blank lines as one terminator. A caret within that run
  // still belongs to the preceding paragraph, rather than accidentally
  // preparing both it and the following paragraph.
  const separators=[...source.matchAll(/\n(?:[\t ]*\n)+/g)],left=separators.filter(m=>m.index!+m[0].length<=at).at(-1),right=separators.find(m=>m.index!+m[0].length>at);
  const from=left?left.index!+left[0].length:0,to=right?right.index!+right[0].length:source.length;
  const text=source.slice(from,to);
  if(!right||!text.trim()||text.length>12000)return;
  return {from,to};
}
export function flowWindowAt(source:string,at:number):RegionRange|undefined{
  const current=paragraphAt(source,at);if(!current)return;
  let pictureDepth=0;
  for(const m of source.slice(0,current.from).matchAll(/\\(begin|end)\{tikzpicture\}/g))pictureDepth=m[1]==='begin'?pictureDepth+1:Math.max(0,pictureDepth-1);
  if(pictureDepth)return current;
  const next=paragraphAt(source,current.to);
  // Small forward windows amortize preparation across nearby paragraphs. This
  // is just a candidate range: ordinary compiler/raster proof still authorizes
  // it, and preparation retries the current paragraph if the window fails.
  // TikZ's nested paragraphs/output need real page proof. Do not repeatedly
  // typeset a drawing merely to discover that an expanded text window fails.
  if(/\\begin\{tikzpicture\}/.test(source.slice(current.from,next?.to??current.to)))return current;
  return next&&next.from===current.to&&next.to-current.from<=768?{from:current.from,to:next.to}:current;
}
const lineOffset=(source:string,line:number)=>{let at=0;while(line-->0){at=source.indexOf('\n',at);if(at<0)return -1;at++;}return at;};
type Request={source:string;fullSource?:string;editId:string;at:number;recovery?:{message:string;line:number};};
export interface LocalCandidate {recovery?:{message:string;line:number};reusedRecovery?:boolean;sourceMatchesDraft?:boolean;sourceHealthy?:boolean;recoveryCleared?:boolean;recoveredBasis?:boolean;unchangedRecovery?:BuildDiagnostic[];reprepareParagraph?:boolean;inkBleedBp?:number;}
export interface LocalCandidate {pageLocations?:{page:number;locations:ReturnType<typeof flowLocations>;blocked?:{x:number;y:number;width:number;height:number}[]}[];retainedFlow?:boolean;retainedSource?:string;}
type DiskInput={file:string;mtime:number;ctime:number;ino:number;size:number;};
type Slot={diagnosticSource?:string;pageProbe?:{source:string;range:RegionRange;output:Awaited<ReturnType<ResidentCompiler['previewRegionPage']>>};neutralLast?:boolean;cancelWork?:()=>void;epoch?:number;cancelled?:boolean;regionKey?:string;edited?:boolean;latestSource?:string;file?:string;input?:IncludedInput;sourceText?:string;otherResources?:string;basis:LocalBasis;range:RegionRange;liveEnd:number;compiledRange:RegionRange;compiler:ResidentCompiler;compositor?:RegionCompositor;ready:boolean;abort:AbortController;diskInputs:DiskInput[];pageMode?:boolean;pageReady?:boolean;pageCostMs?:number;proofPage?:number;sourcePages?:PageSpan;baselineSpan?:PageSpan;continuation?:string;verifyPageRange?:()=>Promise<void>;};
export interface LocalCandidate {neutralBlock?:{id:string;prior:string[];ranges:{id:string;from:number;to:number;baseFrom:number;baseTo:number}[];locations:ReturnType<typeof flowLocations>;caretY?:number};sourceFile?:string;root:string;baseId:string;editId:string;sourceHash:string;pdf:Uint8Array;page:number;timing:unknown;fragmentPdf?:Uint8Array;fragment?:RegionFragment;inkTopSp?:number;flowOutput?:{blocked?:{x:number;y:number;width:number;height:number}[];stateChanged?:boolean;locations?:ReturnType<typeof flowLocations>;baseRangeTo?:number;caretY?:number;rect:{x:number;y:number;width:number;height:number};leading:number;baselineLeading:number;fragmentRect:{x:number;y:number;width:number;height:number}};rangeFrom:number;rangeTo:number;footprint?:{x:number;y:number;width:number;height:number};pageOutput?:boolean;pageSpan?:PageSpan;sourcePages?:PageSpan;proofPage?:number;cursorPage?:number;cursorPosition?:ReturnType<typeof cursorPosition>;baselineSpan?:PageSpan;continuation?:string;}
async function selectPages(pdf:Uint8Array,span:PageSpan){
  const partial=await PDFDocument.load(pdf,{throwOnInvalidObject:true}),selected=await PDFDocument.create();
  // Stable container metadata allows exact-byte reuse of a previously checked
  // unchanged page range; the PDF content and resources remain untouched.
  selected.setCreationDate(new Date(0));selected.setModificationDate(new Date(0));
  if(!Number.isSafeInteger(span.first)||!Number.isSafeInteger(span.last)||span.first<1||span.last<span.first||span.last-span.first>=3||partial.getPageCount()!==span.last)throw new Error('Invalid bounded page range.');
  const pages=await selected.copyPages(partial,Array.from({length:span.last-span.first+1},(_,i)=>span.first-1+i));for(const page of pages)selected.addPage(page);
  return selected.save({useObjectStreams:false,objectsPerTick:1000});
}
export class LocalPreview{
  get retainedBlocks(){return !!this.neutral?.ids.length;}
  get hasLocalChanges(){return this.retainedBlocks||!!this.slot?.edited||!!this.pending||this.running;}
  private neutral?:NeutralBlocks;
  private editorSource?:string;
  private editorCursor?:{file:string;at:number};
  private readonly neutralEnabled=process.env.PERSISTENT_TEX_MULTI_BLOCK==='1';
  private readonly retainedFlowEnabled=process.env.PERSISTENT_TEX_RETAINED_FLOW==='1'&&this.neutralEnabled;
  get ready(){return !!this.slot?.ready;}
  get preparationStatus(){const b=this.basis;return {basis:!!b,recovered:!!b?.bundle.recovered,sourceCharacters:b?.source.length,compilerCharacters:b?.compilerSource.length,originalCharacters:b?.originalSource?.length,cursorAt:this.cursor?.at,cursorInRoot:!!b&&this.cursor?.file===b.options.root,verifyingWithOwner:this.verifyingWithOwner,warm:!!this.warmCompiler?.initialized,slot:!!this.slot};}
  get preparedRange(){const s=this.slot;if(!s)return;const range=this.neutral?.actual(s.range)??{from:s.range.from,to:s.liveEnd};return {file:s.file??s.basis.options.root,sourceHash:hash(s.sourceText??s.basis.source),...range};}
  get busy(){return !!this.pending||this.running||!!this.slot&&!this.slot.ready;}
  private continuous=false;
  private lecture=false;
  setLecture(enabled:boolean){if(this.lecture===enabled)return;this.lecture=enabled;if(!enabled)this.neutral=undefined;else if(this.neutralEnabled&&this.continuous&&this.basis&&(!this.retainedFlowEnabled||this.basis.source.length<=2*1024*1024)&&this.editorSource===this.basis.source)this.neutral=new NeutralBlocks(this.basis.source);this.refresh();}
  setContinuous(enabled:boolean){if(this.continuous===enabled)return;this.continuous=enabled;if(!enabled)this.neutral=undefined;this.parked=[];this.idleAttempts.clear();this.disarm(true);this.schedule();}
  refresh(){this.parked=[];this.idleAttempts.clear();this.disarm(true);this.schedule();}
  private basis?:LocalBasis;
  private slot?:Slot;
  private warmCompiler?:ResidentCompiler;
  private publishedCompiler?:ResidentCompiler;
  private compositionBase?:{id:string;pdf:Promise<PDFDocument>};
  private cursor?:{file:string;at:number};
  private epoch=0;
  private pending?:Request;
  private running=false;
  private verifyingWithOwner=false;
  private canPrefetch=false;
  private prefetched?:{request:Request;slot:Slot;epoch:number;promise:ReturnType<LocalPreview['recoverOutput']>};
  private timer?:NodeJS.Timeout;
  private preparation:Promise<void>=Promise.resolve();
  private inflight?:Promise<unknown>;
  // Bound to the prepared compiler and exact confirmed source pair. Plain text
  // may change on either side; definitions and command corrections re-run TeX.
  private recoveryHints=new WeakMap<Slot,{source:string;repaired:string}>();
  private parked:Slot[]=[];
  // Hints only: every revision needs new compiler and raster proofs. Store
  // bounded paragraph text, never an old heap, PDF or source-wide snapshot.
  private visits:{root:string;file:string;text:string;offset:number}[]=[];
  private rememberVisit(cursor=this.cursor){
    const basis=this.basis;if(!cursor||!basis)return;
    const slot=this.slot,selected=this.sourceFor(basis,cursor.file);
    const source=slot?.file===cursor.file?slot.latestSource??slot.sourceText??selected?.text:selected?.text;
    if(source===undefined)return;const at=Math.min(cursor.at,source.length),range=paragraphAt(source,at);if(!range)return;
    const text=source.slice(range.from,range.to),old=slot?.file===cursor.file?(slot.sourceText??slot.basis.source).slice(slot.range.from,slot.range.to):undefined;
    this.visits=this.visits.filter(v=>v.root===basis.options.root&&!(v.file===cursor.file&&(v.text===text||v.text===old)));
    this.visits.unshift({root:basis.options.root,file:cursor.file,text,offset:at-range.from});this.visits.length=Math.min(this.visits.length,3);
  }
  private recentTargets(basis:LocalBasis){
    return this.visits.flatMap(v=>{
      if(v.root!==basis.options.root)return [];const source=this.sourceFor(basis,v.file)?.text;if(source===undefined)return [];
      const from=source.indexOf(v.text);
      // Repeated/deleted/modified text is an ambiguous hint. Do not guess an
      // offset after a preceding edit, and never treat this match as proof.
      if(from<0||source.indexOf(v.text,from+1)>=0)return [];
      const range=paragraphAt(source,from);if(!range||range.from!==from||source.slice(range.from,range.to)!==v.text)return [];
      return [{file:v.file,at:from+Math.min(v.offset,v.text.length-1),recent:true}];
    });
  }
  private idleTimer?:NodeJS.Timeout;
  private speculation?:Promise<void>;
  private backgroundSlot?:Slot;
  private idleAttempts=new Set<string>();
  private cancelIdle(){clearTimeout(this.idleTimer);if(this.backgroundSlot){this.backgroundSlot.cancelled=true;this.backgroundSlot.cancelWork?.();}}
  private rememberSlot(slot:Slot){
    if(!slot.ready||slot.edited&&!(this.neutral&&slot.neutralLast)||!slot.regionKey||slot.basis.bundle.id!==this.basis?.bundle.id||!slot.compiler.hasRegion(slot.regionKey))return;
    this.parked=this.parked.filter(value=>value.regionKey!==slot.regionKey&&value.compiler===slot.compiler&&value.basis.bundle.id===slot.basis.bundle.id);
    this.parked.push(slot);while(this.parked.length>3)this.parked.shift();
  }
  private adoptVerified(slot:Slot,basis:LocalBasis){
    if(slot.basis.bundle.id===basis.bundle.id||slot.edited&&slot.latestSource!==this.sourceFor(basis,slot.file??basis.options.root)?.text)return false;
    const fresh=basis.replaceCompiler?.(slot.compiler)??basis.takeCompiler?.();if(!fresh||fresh===slot.compiler)return false;
    this.disarm();this.warmCompiler=fresh;this.publishedCompiler=fresh;this.log('Local preparation adopted the verified revision.\n');return true;
  }
  private scheduleIdle(){
    clearTimeout(this.idleTimer);
    if(process.env.PERSISTENT_TEX_DISABLE_NEIGHBOR_PREPARE==='1')return;
    this.idleTimer=setTimeout(()=>{
      const slot=this.slot,basis=this.basis;
      if(!slot?.ready||!basis)return;
      if(this.running||this.pending||this.speculation||slot.compiler.busy){this.scheduleIdle();return;}
      if(basis.bundle.id!==slot.basis.bundle.id){
        // Full verification already prepared this exact revision in its own
        // resident worker. Adopt it through the controller ownership guard,
        // retire the old local worker and re-prove the new baseline while idle.
        if(this.adoptVerified(slot,basis))this.schedule();return;
      }
      if(slot.edited&&!(this.neutral&&slot.neutralLast))return;
      const file=slot.file??basis.options.root,points=[slot.range.to,Math.max(0,slot.range.from-1)];
      const targets=[...(process.env.PERSISTENT_TEX_DISABLE_RECENT_PREPARE==='1'?[]:this.recentTargets(basis)),...points.map(at=>({file,at,recent:false}))];
      for(const target of targets){const source=this.sourceFor(basis,target.file)?.text;if(source===undefined)continue;
        const {at}=target,range=paragraphAt(source,at);if(!range||target.file===file&&range.from>=slot.range.from&&range.from<slot.range.to)continue;
        if(!target.recent&&(Math.abs(range.from-slot.range.from)>16000||/\\begin\{tikzpicture\}/.test(source.slice(range.from,range.to))))continue;
        const key=JSON.stringify([basis.bundle.id,target.file,range.from]);
        if(this.idleAttempts.has(key)||this.parked.some(value=>value.file===target.file&&at>=value.range.from&&at<value.range.to&&!!value.regionKey&&value.compiler.hasRegion(value.regionKey)))continue;
        this.idleAttempts.add(key);while(this.idleAttempts.size>8)this.idleAttempts.delete(this.idleAttempts.values().next().value!);
        const work=this.arm(false,target);this.speculation=work;
        void work.finally(()=>{if(this.speculation===work)this.speculation=undefined;this.scheduleIdle();}).catch(()=>{});break;
      }
    },this.slot?.basis.bundle.id!==this.basis?.bundle.id?150:500);this.idleTimer.unref();
  }
  constructor(private verify:(basis:LocalBasis,pdf:Uint8Array,page:number,fragmentPdf:Uint8Array,fragment:RegionFragment,footprint:{x:number;y:number;width:number;height:number},calibration:LocalCalibration)=>Promise<LocalVerification>,private publish:(candidate:LocalCandidate)=>Promise<boolean>,private fallback:(editId:string)=>void,private state:(state:string)=>void,private log:(message:string)=>void,private verifyPages?:(basis:LocalBasis,pdf:Uint8Array,span:PageSpan,continuation?:string)=>Promise<boolean>,private placement?:(basis:LocalBasis,page:number,fragmentPdf:Uint8Array,fragment:RegionFragment,calibration:LocalCalibration)=>Promise<LocalVerification>){}
  stop(){this.neutral=undefined;this.editorSource=undefined;this.editorCursor=undefined;this.visits=[];this.disarm();this.verifyingWithOwner=false;this.publishedCompiler=undefined;this.basis=undefined;this.compositionBase=undefined;}
  prepareFullVerification(){
    this.cancelIdle();
    const slot=this.slot,compiler=slot?.compiler??this.warmCompiler;
    if(this.running||this.pending||this.speculation||compiler?.busy||slot&&!slot.ready)return false;
    if(!compiler||!this.basis?.returnCompiler?.(compiler))return true;
    // The controller now owns this idle worker. Keep new requests on its full
    // queue until publication offers the converged worker back; creating a
    // speculative local worker here would repeat the cold initialization.
    this.rememberVisit();this.disarm(true);this.warmCompiler=undefined;this.verifyingWithOwner=true;
    if(this.publishedCompiler===compiler)this.publishedCompiler=undefined;
    this.log('Idle verification reclaimed the warm local compiler.\n');return true;
  }
  prepareNextEdit(root:string,baseId:string){const slot=this.slot;if(slot?.ready&&slot.basis.options.root===root&&slot.basis.bundle.id===baseId&&!this.pending&&!this.prefetched)slot.compiler.prepareNextRegionEdit();}
  private sourceFor(basis:LocalBasis,file:string){
    if(file===basis.options.root)return {text:basis.source,input:undefined as IncludedInput|undefined};
    if(!file.toLowerCase().endsWith('.tex'))return;
    const same=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
    const matches=(basis.project.resources??[]).filter(([name])=>basis.project.origins?.[name]&&same(basis.project.origins[name],file));
    if(matches.length!==1)return;
    const [name,bytes]=matches[0];let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/g,'\n');}catch{return;}
    return {text,input:{file:name,text}};
  }
  private sameContext(slot:Slot,basis:LocalBasis){
    if(slot.basis.options.root!==basis.options.root||slot.basis.project.environmentKey!==basis.project.environmentKey)return false;
    if(!!slot.basis.bundle.recovered!==!!basis.bundle.recovered)return false;
    if(!slot.input)return slot.basis.project.resourceKey===basis.project.resourceKey;
    return slot.basis.compilerSource===basis.compilerSource&&slot.otherResources===resourceIdentity((basis.project.resources??[]).filter(([name])=>name!==slot.input!.file));
  }
  private splitPageParagraph(slot:Slot,source:string,at:number){
    if(!this.lecture||!this.continuous||!slot.pageMode||slot.input||slot.basis.bundle.recovered)return false;
    const baseline=slot.sourceText??slot.basis.source,prior=paragraphAt(baseline,slot.range.from),current=paragraphAt(source,at);
    // Ordinary typing shifts the old terminator by the source length delta.
    // A new, earlier terminator separates this text from formerly attached
    // material. Re-prove that smaller paragraph against a fresh full baseline;
    // never crop an old page proof or assume the following drawing is unchanged.
    return !!prior&&!!current&&prior.from===slot.range.from&&current.from===prior.from&&current.to<prior.to+source.length-baseline.length;
  }
  setBasis(basis:LocalBasis){
    if(this.compositionBase?.id!==basis.bundle.id)this.compositionBase=undefined;
    const prior=this.basis;
    const retainedContext=!basis.bundle.recovered&&this.neutralEnabled&&this.lecture&&this.continuous&&(!this.retainedFlowEnabled||basis.source.length<=2*1024*1024);
    // A canonical publication retires renderer block history even when undo
    // returned to the same immutable PDF ID, or continuous mode was reenabled.
    const replaced=prior?.bundle.id!==basis.bundle.id||!!this.neutral?.ids.length||retainedContext&&!this.neutral||this.neutralEnabled&&!!prior&&(prior.source!==basis.source||prior.compilerSource!==basis.compilerSource||prior.options.root!==basis.options.root||prior.project.resourceKey!==basis.project.resourceKey||prior.project.environmentKey!==basis.project.environmentKey);
    if(replaced){this.neutral=retainedContext?new NeutralBlocks(basis.source):undefined;this.editorSource=basis.source;}
    if(prior?.bundle.id!==basis.bundle.id&&this.slot)this.rememberVisit();
    if(prior&&(prior.options.root!==basis.options.root||prior.project.environmentKey!==basis.project.environmentKey))this.visits=[];
    this.cancelIdle();if(replaced){this.parked=[];this.idleAttempts.clear();}
    this.basis=basis;
    // This publication is the ownership offer we were waiting for. A cursor
    // in a repaired/unpreparable paragraph may return before borrowing the
    // compiler; it must not leave every later cursor move waiting forever.
    // Actual transfer still passes takeCompiler/claimAutomatic ownership guards.
    this.verifyingWithOwner=false;
    const s=this.slot;
    const next=s&&this.sourceFor(basis,s.file??s.basis.options.root),reprepare=!!s&&!!next&&this.cursor?.file===(s.file??s.basis.options.root)&&this.splitPageParagraph(s,next.text,this.cursor.at);
    // A full recovered publication supplies fresh diagnostic identities. Keep
    // its worker warm, but re-prove the region against that publication rather
    // than carrying an older error snapshot through an explicit recheck.
    if(s&&!basis.bundle.recovered&&!reprepare&&!(this.neutralEnabled&&replaced)&&this.sameContext(s,basis)){if(next&&this.regionText(s,s.input?next.text:basis.originalSource??next.text)!==undefined){this.scheduleIdle();return;}}
    const compatible=!!prior&&prior.options.root===basis.options.root&&prior.project.resourceKey===basis.project.resourceKey&&prior.project.environmentKey===basis.project.environmentKey;
    if(reprepare&&this.adoptVerified(s!,basis)){this.schedule();return;}
    this.disarm(compatible);
    this.schedule();
  }
  move(file:string,at:number,editing=false){
    if(this.neutral&&file!==this.basis?.options.root){if(this.neutral.dirty.length)this.releaseForFull();else this.neutral=undefined;}
    this.editorCursor={file,at};if(this.neutral&&file===this.basis?.options.root)at=this.neutral.basePosition(at);
    const previous=this.cursor;this.cursor={file,at};if(editing||this.verifyingWithOwner)return;const s=this.slot;
    if(s&&file===(s.file??s.basis.options.root)&&at>=s.range.from&&at<(this.neutral?s.range.to:s.liveEnd))return;
    this.rememberVisit(previous);
    // An edited paragraph's old full baseline cannot prepare another block.
    // Return its idle worker before speculative preparation makes it busy;
    // the next full update can reuse its preamble instead of cold-starting.
    if(s?.edited&&!this.running&&!this.pending&&!this.speculation&&!s.compiler.busy&&!(this.neutral&&s.neutralLast&&this.editorSource===this.neutral.source())){if(this.basis&&this.adoptVerified(s,this.basis)){this.schedule();return;}this.releaseForFull();return;}
    if(s&&!this.running&&!this.pending&&(!s.compiler.busy||!!this.speculation))this.rememberSlot(s);
    this.disarm(!!this.basis&&!!this.sourceFor(this.basis,file));
    this.parked=this.parked.filter(value=>value.compiler===this.warmCompiler&&value.basis.bundle.id===this.basis?.bundle.id&&!!value.regionKey&&value.compiler.hasRegion(value.regionKey));
    const cached=this.parked.find(value=>(value.file??value.basis.options.root)===file&&at>=value.range.from&&at<value.range.to);
    if(cached){this.parked=this.parked.filter(value=>value!==cached);cached.epoch=this.epoch;cached.cancelled=false;this.slot=cached;this.warmCompiler=undefined;cached.compiler.useRegion(cached.regionKey);this.state('ready');this.log('Local prepared-region cache hit.\n');if(!cached.compiler.busy)cached.compiler.prepareNextRegionEdit();this.scheduleIdle();return;}
    this.schedule();
  }
  resumeAutomatic(file:string,source:string,editId:string){
    const basis=this.basis,cursor=this.cursor;
    const original=basis?.originalSource??basis?.source;
    if(!this.continuous||this.slot||this.running||this.pending||this.inflight||this.speculation||!basis?.claimAutomatic||!cursor||cursor.file!==file||file!==basis.options.root||basis.source!==basis.compilerSource||source===original)return false;
    const current=flowWindowAt(source,cursor.at),range=current&&flowWindowAt(original!,current.from),begin=original!.indexOf('\\begin{document}');
    if(!range||!current||range.from!==current.from||begin<0||range.from<begin+'\\begin{document}'.length)return false;
    const text=this.regionText({basis,range,sourceText:basis.source},source);
    if(text===undefined||!plainTextChange(original!.slice(range.from,range.to),text))return false;
    const compiler=basis.claimAutomatic(editId,source,this.warmCompiler?.initialized?this.warmCompiler:undefined);if(!compiler)return false;
    this.warmCompiler=compiler;this.publishedCompiler=compiler;this.verifyingWithOwner=false;this.pending={source,editId,at:cursor.at};this.schedule();
    this.log('Queued automatic edit handed to local preparation.\n');return true;
  }
  private disarm(keepWarm=false){
    this.cancelIdle();
    this.epoch++;clearTimeout(this.timer);this.pending=undefined;this.prefetched=undefined;this.canPrefetch=false;
    const slot=this.slot;
    if(slot){
      // A cursor move retires the old proof immediately. Its compiler RPC is
      // still awaited at the request boundary, but an obsolete renderer/raster
      // response must not hold up preparation at the new cursor.
      slot.cancelWork?.();
      // Cursor moves hand off the same worker after obsolete preparation has
      // returned. Aborting its RPC would destroy its converged baseline.
      if(keepWarm){if(this.warmCompiler!==slot.compiler)this.warmCompiler?.stop();this.warmCompiler=slot.compiler;}
      else{slot.abort.abort();slot.compiler.stop();}
    }
    if(!keepWarm){this.parked=[];this.idleAttempts.clear();this.warmCompiler?.stop();this.warmCompiler=undefined;this.preparation=Promise.resolve();}
    this.slot=undefined;this.state(keepWarm&&this.parked.length?'moving':'off');
  }
  private schedule(){
    clearTimeout(this.timer);if(!this.basis||!this.cursor||!this.sourceFor(this.basis,this.cursor.file))return;
    const epoch=this.epoch;
    this.timer=setTimeout(()=>{this.preparation=this.preparation.catch(()=>{}).then(async()=>{await this.inflight?.catch(()=>{});await this.speculation?.catch(()=>{});if(epoch===this.epoch)await this.arm();});},16);this.timer.unref();
  }
  private async arm(single=false,target?:{file:string;at:number;recent?:boolean}):Promise<void>{
    const background=!!target,basis=this.basis,cursor=target??this.cursor;if(!basis||!cursor)return;
    const selected=this.sourceFor(basis,cursor.file);if(!selected)return;const sourceText=selected.text,input=selected.input;
    const paragraph=paragraphAt(sourceText,cursor.at),range=this.continuous&&!single&&!this.neutral&&process.env.PERSISTENT_TEX_DISABLE_FLOW_WINDOW!=='1'?flowWindowAt(sourceText,cursor.at):paragraph;if(!range||!paragraph)return;
    const expanded=range.to!==paragraph.to;
    const before=sourceText.slice(0,range.from).split('\n').length-1,after=sourceText.slice(0,range.to).split('\n').length-1;
    const compiledRange=input?{...range}:{from:lineOffset(basis.compilerSource,before),to:lineOffset(basis.compilerSource,after)};
    if(compiledRange.from<0||compiledRange.to<0||(input?sourceText:basis.source).slice(range.from,range.to)!==(input?sourceText:basis.compilerSource).slice(compiledRange.from,compiledRange.to)){this.log('Local paragraph intersects a compilation-only repair: '+JSON.stringify({range,compiledRange,expanded})+'\n');const pending=this.pending?.editId;this.pending=undefined;if(pending)this.fallback(pending);return;}
    const borrowed=background||this.warmCompiler?undefined:basis.takeCompiler?.();
    // An intermediate publication may still have newer full work queued.
    // Wait for its next ownership offer instead of cold-starting a local lane.
    if(!borrowed&&(this.verifyingWithOwner||!background&&!this.warmCompiler&&!!basis.takeCompiler)){
      if(!background)this.log('Local compiler ownership is not yet available.\n');
      this.verifyingWithOwner=true;const pending=this.pending?.editId;this.pending=undefined;
      if(pending)this.fallback(pending);return;
    }
    if(borrowed){this.publishedCompiler=borrowed;this.verifyingWithOwner=false;}
    const started=performance.now(),epoch=background?this.epoch:++this.epoch,slot:Slot={epoch,basis,file:cursor.file,input,sourceText,otherResources:input?resourceIdentity((basis.project.resources??[]).filter(([name])=>name!==input.file)):undefined,range,liveEnd:range.to,compiledRange,compiler:(background?this.slot?.compiler:undefined)??this.warmCompiler??borrowed??new ResidentCompiler(),ready:false,abort:new AbortController(),diskInputs:[]};if(background)this.backgroundSlot=slot;else{this.warmCompiler=undefined;this.slot=slot;if(this.pending)slot.liveEnd=this.pending.source.length-(sourceText.length-range.to);this.state('warming');}
    const compilerInitiallyWarm=slot.compiler.initialized;
    const valid=()=>slot.epoch===this.epoch&&!slot.cancelled;
    const cancelled=new Promise<false>(resolve=>{slot.cancelWork=()=>resolve(false);});
    try{
      // Captured open buffers are authoritative. Other project resources must
      // still match disk before preparing, and retain their file identity while
      // the lane is reused. The root editor buffer is intentionally excluded.
      const origins=basis.project.origins??{},open=basis.options.sourceFiles??{};
      slot.diskInputs=await Promise.all((basis.project.resources??[]).filter(([name])=>origins[name]&&!Object.hasOwn(open,origins[name])&&name!==input?.file).map(async([name,bytes])=>{
        const file=origins[name],[stat,data]=await Promise.all([fs.stat(file),fs.readFile(file)]);
        if(createHash('sha256').update(data).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw new Error('A project input changed before local preparation.');
        return {file,mtime:stat.mtimeMs,ctime:stat.ctimeMs,ino:stat.ino,size:stat.size};
      }));
      if(!valid())return;
      if(background)slot.compiler.protectRegion(this.slot?.regionKey);
      const project={...basis.project,characterMapping:true};
      const prepared=await slot.compiler.prepareRegion(basis.compilerSource,compiledRange,slot.abort.signal,120000,()=>{},project,this.continuous?compiledRange.from+cursor.at-range.from:undefined,input,background,this.continuous&&!input&&sourceText===basis.compilerSource);
      slot.regionKey=prepared.regionKey;
      const preparation=slot.compiler.lastTiming;
      if(!valid())return;
      if(prepared.familyRange){
        Object.assign(range,prepared.familyRange);Object.assign(compiledRange,prepared.familyRange);
        slot.liveEnd=(this.pending?.source.length??sourceText.length)-(sourceText.length-range.to);
        slot.pageMode=true;
      }
      const anchoredPages:number[]=[];
      const recordedPage=preparation?.baselinePage,pictureBlock=/\\begin\{tikzpicture\}/.test(sourceText.slice(range.from,range.to));
      if(pictureBlock||recordedPage!==undefined)for(const line of prepared.navigation.split('\n')){
        if(!line)continue;const row=JSON.parse(line),g=row.glyph??row.mathGlyph;
        if(g&&g[0].split(/[\\/]/).at(-1)?.toLowerCase()===(input?path.posix.basename(input.file):(project.jobName??'main')+'.tex').toLowerCase()&&g[1]>=before+1&&g[1]<=after)anchoredPages.push(g[3]);
      }
      if(recordedPage!==undefined&&Number.isSafeInteger(recordedPage)&&recordedPage>=1){
        slot.sourcePages={first:recordedPage,last:recordedPage};
        // Preserve cheap text composition where it already works. Expensive
        // drawings and blocks with no glyph anchors use their recorded page.
        slot.pageMode=!!prepared.familyRange||pictureBlock||(preparation?.baselinePageCostMs??0)>200||!anchoredPages.length;
      }else if(anchoredPages.length){slot.pageMode=true;slot.sourcePages={first:Math.min(...anchoredPages),last:Math.max(...anchoredPages)};}
      let original:Awaited<ReturnType<ResidentCompiler['previewRegionNodes']>>|undefined;
      try{if(!slot.pageMode)original=await (this.continuous?slot.compiler.previewRegionFlow(basis.compilerSource,compiledRange,slot.abort.signal,30000,()=>{},project,true,input,this.lecture):slot.compiler.previewRegionNodes(basis.compilerSource,compiledRange,slot.abort.signal,30000,()=>{},project,input));}
      catch(error){if(background||expanded||!this.verifyPages||slot.abort.signal.aborted)throw error;slot.pageMode=true;}
      const nodesAt=performance.now();
      if(!valid())return;
      if(original)slot.sourcePages=paragraphPages(prepared.navigation,original);
      else if(!slot.sourcePages){
        // A paragraph with display material or multiple TeX paragraphs can
        // still use actual page-builder output. Locate its baseline pages
        // from full-build source anchors and prove the complete page pixels.
        const firstLine=before+1,lastLine=after,pages:number[]=[];
        for(const line of prepared.navigation.split('\n')){if(!line)continue;const row=JSON.parse(line),g=row.glyph??row.mathGlyph;if(g&&g[0].split(/[\\/]/).at(-1)?.toLowerCase()===(input?path.posix.basename(input.file):(project.jobName??'main')+'.tex').toLowerCase()&&g[1]>=firstLine&&g[1]<=lastLine)pages.push(g[3]);}
        // A drawing generated by a macro can have no root-source glyphs.
        // The native checkpoint records the first unshipped page; this is
        // only a bounded render starting point. Full baseline page pixels
        // below must still match before any local edit can be published.
        if(!pages.length){const page=preparation?.checkpointPage;if(page===undefined||!Number.isSafeInteger(page)||page<1)throw new Error('Region has no exact source page anchors.');pages.push(page);}
        slot.sourcePages={first:Math.min(...pages),last:Math.max(...pages)};
      }
      try{
        const cached=this.compositionBase??={id:basis.bundle.id,pdf:PDFDocument.load(basis.pdf,{throwOnInvalidObject:true})};
        if(original)slot.compositor=await RegionCompositor.create(await cached.pdf,prepared.navigation,original);
      }catch(error){if(background||expanded||!this.verifyPages)throw error;this.log('Paragraph composition unavailable: '+String(error)+'\n');slot.pageMode=true;}
      if(!valid())return;
      const placedAt=performance.now();
      // This RPC uses the compiler while paragraph composition/raster proof
      // runs independently in the main/renderer processes. Await both before
      // handing off the worker or authorizing an edit.
      // Recently visited drawings may use only the cheap full-build witness
      // during speculation; unsupported page work waits for a real cursor move.
      if(background&&target?.recent&&!slot.compositor&&preparation?.baselineCheckpointAvailable!==true)throw new Error('Recent region has no full-build page witness.');
      let pageElapsed=0,pageBaselineFromWitness=false;
      const verifyPageRange=async()=>{if(this.verifyPages){const started=performance.now();try{
        const queued=this.pending;
        if(!background&&this.continuous&&!slot.compositor&&!this.neutral&&!input&&!prepared.familyRange&&!pictureBlock&&(preparation?.baselinePageCostMs??0)<=200&&basis.compilerSource===sourceText&&queued&&sourceText.length-queued.source.length>=256&&slot.sourcePages!.last>slot.sourcePages!.first&&plainTextChange(sourceText,queued.source)&&this.regionText(slot,queued.source)!==undefined&&process.env.PERSISTENT_TEX_DISABLE_CONTRACTION_PROBE!=='1'){
          const range={from:compiledRange.from,to:compiledRange.to+queued.source.length-sourceText.length};
          try{
            const output=await slot.compiler.previewRegionPage(queued.source,range,slot.sourcePages!.first,slot.abort.signal,1000,()=>{},project,true);
            if(!valid())return;
            if(!output.timing?.continuation&&output.pageSpan.last<slot.sourcePages!.last){
              const editId=this.pending?.editId??queued.editId;this.log('Contracted page band needs full verification; skipped old-band proof.\n');this.releaseForFull();this.fallback(editId);return;
            }
            // This is only computed output. The original baseline still needs
            // its complete raster proof before this response may be displayed.
            slot.pageProbe={source:queued.source,range,output};
          }catch(error){if(!valid()||slot.abort.signal.aborted)throw error;this.log('Contraction probe unavailable; retaining normal page verification.\n');}
        }
        const attempts=background?[true]:preparation?.baselinePageCostMs!==undefined?[true,false]:[false];
        for(const baselineProof of attempts){try{
          const proofStarted=performance.now(),baseline=await slot.compiler.previewRegionPage(basis.compilerSource,compiledRange,slot.sourcePages!.first,slot.abort.signal,30000,()=>{},project,this.continuous,input,baselineProof),nativeDone=performance.now(),pdf=await selectPages(baseline.pdf,baseline.pageSpan),selectedAt=performance.now();
          slot.pageCostMs=Math.max(baseline.timing?.roundTripMs??baseline.timing?.totalMs??0,baseline.timing?.baselinePageCostMs??0);
          if(!valid())return;
          const verified=await Promise.race([this.verifyPages!(basis,pdf,baseline.pageSpan,baseline.timing?.continuation),cancelled]);this.log('Page baseline proof: '+JSON.stringify({nativeMs:nativeDone-proofStarted,selectMs:selectedAt-nativeDone,viewerMs:performance.now()-selectedAt,pages:baseline.pageSpan,...(baseline.timing?{timing:baseline.timing}:{})})+'\n');
          if(!verified)throw new Error('Affected-page baseline did not match accepted pages.');
          if(!valid())return;
          slot.pageReady=true;slot.proofPage=baseline.pageSpan.first;slot.baselineSpan={...baseline.pageSpan};slot.continuation=baseline.timing?.continuation;pageBaselineFromWitness=!!baseline.timing?.baselineCheckpointReused;break;
        }catch(error){if(background||!baselineProof||!valid()||slot.abort.signal.aborted)throw error;this.log('Post-picture baseline unavailable; retrying original checkpoint: '+String(error)+'\n');}}
      }catch(error){if(!slot.compositor)throw error;if(valid())this.log('Page reflow unavailable for this paragraph: '+String(error)+'\n');}finally{pageElapsed=performance.now()-started;}}};
      slot.verifyPageRange=verifyPageRange;
      const pageWork=background&&!target?.recent||this.continuous&&slot.compositor?Promise.resolve():verifyPageRange();
      // A parallel rejection must be observed even while raster proof awaits.
      void pageWork.catch(()=>{});
      let paragraphElapsed=0,paragraphComposeMs=0,paragraphRasterWaitMs=0,preflightMs=0,preflightApplied=false,rasterAttempts=0,calibratedGlyphs:CalibrationGlyph[]|undefined;
      try{if(slot.compositor){
        const origin={x:slot.compositor.x,y:slot.compositor.y};
        // A retained focused checkpoint commonly already matches the accepted
        // raster. Estimate placement only after replaying a different prefix.
        if(this.placement&&this.continuous&&!background&&(preparation?.anchorSourceBytes??0)>0&&process.env.PERSISTENT_TEX_DISABLE_PLACEMENT_PREFLIGHT!=='1'){
          const c=slot.compositor,at=performance.now();
          const correction=await Promise.race([this.placement(basis,c.page,original!.pdf,original!.fragment,{x:c.x,y:c.y,anchors:c.anchors}).catch(()=>false as const),cancelled]);
          preflightMs=performance.now()-at;if(!valid())return;
          // Placement is only a proposal. The complete raster, ink and tile
          // proof below must still authorize this exact composed output.
          if(typeof correction==='object'){c.adjust(correction.dx,correction.dy);calibratedGlyphs=correction.calibratedGlyphs;preflightApplied=true;}
        }
        const verify=async()=>{rasterAttempts++;const c=slot.compositor!,started=performance.now(),check=await c.compose(original!),composedAt=performance.now();paragraphComposeMs+=composedAt-started;try{return await this.verify(basis,check.pdf,check.page,original!.pdf,original!.fragment,check.footprint,{x:c.x,y:c.y,anchors:c.anchors,calibratedGlyphs,inkBleedBp:c.inkBleedBp});}finally{paragraphRasterWaitMs+=performance.now()-composedAt;}};
        const checkPlacement=async()=>{
          let result=await Promise.race([verify(),cancelled]);if(!valid())return false;
          if(typeof result==='object'){
            // Preflight and retry together retain the original translation cap.
            if(Math.abs(slot.compositor!.x-origin.x+result.dx)>.01||Math.abs(slot.compositor!.y-origin.y+result.dy)>.01)return false;
            slot.compositor!.adjust(result.dx,result.dy);calibratedGlyphs=result.calibratedGlyphs;result=await Promise.race([verify(),cancelled]);
          }
          return result;
        };
        let verified=await checkPlacement().catch(error=>{if(!preflightApplied)throw error;return false;});if(!valid())return;
        if(verified!==true&&preflightApplied){
          // A proposal must not discard an already-correct original baseline.
          // Restore it before narrowing the region or starting broader work.
          slot.compositor.adjust(origin.x-slot.compositor.x,origin.y-slot.compositor.y);calibratedGlyphs=undefined;
          verified=await checkPlacement();if(!valid())return;
        }
        if(verified!==true&&this.lecture&&this.continuous&&!background){
          // A neighboring diagram can touch the generous ink margin. Narrow
          // only after repeating BOTH the complete fragment ink-fit check and
          // the unchanged baseline raster proof at the proposed crop. A future
          // edit that exceeds it still fails the live ink check and falls back.
          for(const bleed of [.75,.5,.25]){
            slot.compositor.inkBleedBp=bleed;verified=await checkPlacement();if(!valid())return;
            if(verified===true){this.log('Local ink margin proved at '+bleed+' bp.\n');break;}
          }
        }
        if(verified!==true){
          if(background||expanded&&(!this.continuous||process.env.PERSISTENT_TEX_DISABLE_WINDOW_PAGE_FALLBACK==='1'))throw new Error('Adjacent-paragraph baseline needs a narrower region.');
          if(!this.verifyPages)throw new Error('The composed baseline did not match the accepted page.');
          if(expanded)this.log('Adjacent-paragraph raster mismatch uses verified page output before narrowing.\n');
          slot.compositor=undefined;slot.pageMode=true;await pageWork;
          if(this.continuous)await verifyPageRange();
        }
      }}finally{paragraphElapsed=performance.now()-placedAt;await pageWork;}
      if(!slot.compositor&&!slot.pageReady)throw new Error('This paragraph requires verified page-range output.');
      if(!valid())return;slot.ready=true;if(!background)this.state('ready');this.log('Local preparation: '+JSON.stringify({readyMs:performance.now()-started,rangeFrom:range.from,rangeTo:range.to,adjacentParagraph:expanded,compilerFromPublishedBuild:slot.compiler===this.publishedCompiler,compilerInitiallyWarm,pageBaselineFromWitness,placementMs:placedAt-nodesAt,preflightMs,preflightApplied,rasterAttempts,paragraphComposeMs,paragraphRasterWaitMs,paragraphVerificationMs:paragraphElapsed,pageVerificationMs:pageElapsed,parallelVerification:true,...preparation})+'\n');
      if(background){this.rememberSlot(slot);this.log(target?.recent?'Local recent region prepared.\n':'Local neighbor prepared.\n');}
      else{if(!this.pending&&!this.running){slot.compiler.useRegion(slot.regionKey);slot.compiler.prepareNextRegionEdit();this.scheduleIdle();}
      if(this.pending&&!this.running)void this.drain();}
    }catch(error){if(background){if(valid()&&expanded)await this.arm(true,target);else if(valid())this.log('Neighbor preparation skipped: '+String(error)+'\n');return;}if(valid()){
      if(expanded&&!slot.abort.signal.aborted){const pending=this.pending;this.log('Adjacent-paragraph preparation narrowed: '+String(error)+'\n');this.disarm(true);this.pending=pending;await this.arm(true);return;}
      const pending=this.pending?.editId;this.log('Local preview unavailable for this paragraph: '+String(error)+'\n');this.disarm(true);if(this.warmCompiler===slot.compiler&&slot.basis.returnCompiler?.(slot.compiler)){this.warmCompiler=undefined;this.verifyingWithOwner=!!pending;if(this.publishedCompiler===slot.compiler)this.publishedCompiler=undefined;this.log('Local preparation returned the warm compiler for full updates.\n');}if(pending)this.fallback(pending);}}finally{if(background&&this.backgroundSlot===slot){this.backgroundSlot=undefined;slot.compiler.protectRegion();const active=this.slot;if(active?.ready){active.compiler.useRegion(active.regionKey);if(!active.compiler.busy)active.compiler.prepareNextRegionEdit();}}}
  }
  private regionText(slot:Pick<Slot,'basis'|'range'|'sourceText'>&{input?:IncludedInput},source:string){
    // A repaired compiler baseline is not the editor's baseline. Outside the
    // active region, compare against the exact original draft, including its
    // reported error; keep using compiled bytes for typesetting and proofs.
    const original=(!slot.input?slot.basis.originalSource:undefined)??slot.sourceText??slot.basis.source,prefix=original.slice(0,slot.range.from),suffix=original.slice(slot.range.to);
    if(!source.startsWith(prefix)||!source.endsWith(suffix)||source.length<prefix.length+suffix.length)return;
    const text=source.slice(prefix.length,source.length-suffix.length);
    if(!/\n[\t ]*\n$/.test(text))return;
    return text;
  }
  private releaseForFull(){
    this.neutral=undefined;
    this.parked=[];this.disarm(true);
    const compiler=this.warmCompiler;
    if(compiler&&this.basis?.returnCompiler?.(compiler)){
      this.warmCompiler=undefined;this.verifyingWithOwner=true;if(this.publishedCompiler===compiler)this.publishedCompiler=undefined;
      this.log('Local edit returned the idle warm compiler for full updates.\n');
    }
  }
  request(file:string,source:string,editId:string){
    const fullSource=source;this.editorSource=source;
    if(this.neutral&&file===this.basis?.options.root){
      let range=this.slot?.range??(this.cursor&&paragraphAt(this.neutral.base,this.cursor.at)),projected=range&&this.neutral.project(source,range);
      if(!projected){
        // A newly inserted word can put the caret past the ORIGINAL paragraph
        // end while a cursor move is still warming. Anchor at the actual edit,
        // and prove the complete substitution before switching checkpoints.
        const start=this.neutral.editStart(source),changed=start===undefined?undefined:paragraphAt(this.neutral.base,this.neutral.basePosition(start));
        const next=changed&&this.neutral.project(source,changed);
        if(next){const ledger=this.neutral,cursor=this.editorCursor;this.editorSource=ledger.source();this.move(file,start!,false);this.editorCursor=cursor;this.editorSource=fullSource;if(this.neutral!==ledger)return false;range=changed;projected=next;}
      }
      if(!projected){this.log('Retained projection rejected: '+JSON.stringify({range,cursor:this.cursor,slot:!!this.slot,sourceLength:source.length,expectedLength:this.neutral.source().length})+'\n');this.releaseForFull();return false;}source=projected.source;
    }
    if(this.verifyingWithOwner)return false;
    this.cancelIdle();
    const slot=this.slot;
    if(slot&&(file!==(slot.file??slot.basis.options.root)||this.regionText(slot,source)===undefined)){const other=file!==(slot.file??slot.basis.options.root);this.releaseForFull();if(other)this.basis=undefined;return false;}
    if(!slot){
      const basis=this.basis,cursor=this.cursor;
      if(!basis||!cursor||cursor.file!==file){this.releaseForFull();if(cursor&&cursor.file!==file)this.basis=undefined;return false;}
      const selected=this.sourceFor(basis,file);if(!selected){this.releaseForFull();return false;}
      const range=this.continuous&&!this.neutral?flowWindowAt(selected.text,cursor.at):paragraphAt(selected.text,cursor.at);
      if(!range||this.regionText({basis,range,sourceText:selected.text,input:selected.input},source)===undefined){this.releaseForFull();return false;}
      // The first keystroke can beat the scheduled preparation after a cursor
      // move. Queue it against the checked baseline instead of cold-building
      // the whole document while its warm compiler sits here unused.
      const at=this.neutral&&this.editorCursor?range.from+this.editorCursor.at-this.neutral.actual(range).from:cursor.at;
      this.pending={source,fullSource,editId,at};this.schedule();return !!this.neutral||!basis.canBuildAlongside?.();
    }
    slot.latestSource=source;
    if(source!==(slot.sourceText??slot.basis.source)){slot.edited=true;if(!this.neutral)this.parked=[];}
    slot.liveEnd=source.length-((slot.sourceText??slot.basis.source).length-slot.range.to);
    const at=this.neutral&&this.editorCursor?slot.range.from+this.editorCursor.at-this.neutral.actual(slot.range).from:this.cursor?.at??slot.range.from;
    this.pending={source,fullSource,editId,at};if(slot.ready){if(!this.running)void this.drain();else{if(slot.pageMode&&(slot.pageCostMs??0)>200)slot.compiler.supersedeRegionEdit();this.prefetch();}}return !!this.neutral||slot.ready||!slot.basis.canBuildAlongside?.();
  }
  private async output(slot:Slot,request:Request){
    slot.compiler.useRegion(slot.regionKey);
    await Promise.all(slot.diskInputs.map(async prior=>{const stat=await fs.stat(prior.file);if(stat.mtimeMs!==prior.mtime||stat.ctimeMs!==prior.ctime||stat.ino!==prior.ino||stat.size!==prior.size)throw new Error('A project input changed; local preparation must be refreshed.');}));
    const text=this.regionText(slot,request.source);if(text===undefined)throw new Error('Source left the local paragraph.');
    const edited=(slot.input?slot.sourceText!:slot.basis.compilerSource),source=edited.slice(0,slot.compiledRange.from)+text+edited.slice(slot.compiledRange.to),range={from:slot.compiledRange.from,to:slot.compiledRange.from+text.length};
    const project={...slot.basis.project,characterMapping:true},input=slot.input?{...slot.input,text:source}:undefined,rootSource=input?slot.basis.compilerSource:source,sourceName=input?input.file.replace(/\.tex$/i,''):project.jobName??'main';
    // A newly inserted literal drawing cannot use text-only composition.
    // Prove the original complete page before rendering it once in the page
    // lane, rather than executing the drawing just to reject flow output.
    if(!slot.pageMode&&/\\begin\{tikzpicture\}/.test(text)&&process.env.PERSISTENT_TEX_DISABLE_PICTURE_PAGE_HINT!=='1'){
      if(!slot.pageReady)await slot.verifyPageRange?.();
      if(!slot.pageReady)throw new Error('A drawing insertion needs a verified page baseline.');
      slot.pageMode=true;this.log('Drawing insertion uses verified page output.\n');
    }
    if(this.continuous&&slot.compositor&&!slot.pageMode){
      try{
        const output=await slot.compiler.previewRegionFlow(rootSource,range,slot.abort.signal,1000,()=>{},project,true,input,this.lecture),flow=slot.compositor.flow(output,true);
        if(flow){const y=flowCaretY(output.navigation,source,slot.compiledRange.from+request.at-slot.range.from,sourceName,output.fragment.page);
          if(this.neutral&&!request.recovery){
            const unchanged=request.source===(slot.sourceText??slot.basis.source)||plainTextChange(slot.sourceText??slot.basis.source,request.source);
            if(this.retainedFlowEnabled&&unchanged&&!flow.stateChanged&&slot.compositor.retainedCompatible(output))return {kind:'retainedFlow' as const,output,flow:{...flow,baseRangeTo:slot.range.to,locations:flowLocations(output.navigation,source,sourceName,output.fragment.page,range.from,range.to).map(g=>({...g,at:g.at-slot.compiledRange.from+slot.range.from,end:g.end-slot.compiledRange.from+slot.range.from,x:flow.rect.x+g.x-flow.fragmentRect.x,y:flow.leading+g.y-flow.fragmentRect.y})),caretY:y===undefined?undefined:flow.leading+y-flow.fragmentRect.y}};
            if(unchanged&&!flow.stateChanged&&slot.compositor.neutralCompatible(output))return {kind:'neutral' as const,output,locations:flowLocations(output.navigation,source,sourceName,output.fragment.page,range.from,range.to).map(g=>({...g,at:g.at-slot.compiledRange.from+slot.range.from,end:g.end-slot.compiledRange.from+slot.range.from,x:slot.compositor!.x+g.x,y:slot.compositor!.y+g.y-(slot.compositor!.inkTopSp(output)-output.fragment.paddingSp)*72/(72.27*65536)})),caretY:y===undefined?undefined:slot.compositor.y+y-(slot.compositor.inkTopSp(output)-output.fragment.paddingSp)*72/(72.27*65536)};
            this.log('Retained block excluded: '+JSON.stringify(slot.compositor.neutralExclusions(output))+'\n');
            if(this.neutral.dirty.some(b=>b.id!==neutralId(slot.range)))throw new Error('A carried block changed layout or state.');
            this.neutral=undefined;
          }
          return {kind:'flow' as const,output,flow:{...flow,baseRangeTo:slot.range.to,locations:flowLocations(output.navigation,source,sourceName,output.fragment.page,range.from,range.to).map(g=>({...g,at:g.at-slot.compiledRange.from+slot.range.from,end:g.end-slot.compiledRange.from+slot.range.from,x:flow.rect.x+g.x-flow.fragmentRect.x,y:flow.leading+g.y-flow.fragmentRect.y})),caretY:y===undefined?undefined:flow.leading+y-flow.fragmentRect.y}};}
      }catch(error){if(error instanceof ResidentSourceError||slot.abort.signal.aborted)throw error;this.log('Flow preview fallback: '+String(error)+'\n');}
      // Prove the original page band lazily when flow gains
      // an insert. Subsequent edits keep the bounded page lane warm.
      if(this.neutral?.dirty.some(b=>b.id!==neutralId(slot.range)))throw new Error('Carried paragraphs require neutral block output.');
      if(!slot.pageReady)await slot.verifyPageRange?.();
      if(!slot.pageReady)throw new Error('Changed flow needs a verified page baseline.');
      slot.pageMode=true;
    }
    if(!slot.pageMode){
      try{
        const output=await slot.compiler.previewRegionNodes(rootSource,range,slot.abort.signal,1000,()=>{},project,input);
        if(slot.compositor!.compatible(output))return {kind:'paragraph' as const,output};
      }catch(error){if(!slot.pageReady||!/This region requires broader layout:/.test(String(error)))throw error;}
      // A temporary line or state change requires page output for this edit,
      // but does not disable faster paragraph output for all later edits.
    }
    if(!slot.pageReady)throw new Error('This paragraph needs a verified page-range baseline.');
    if(this.neutral?.dirty.some(b=>b.id!==neutralId(slot.range)))throw new Error('Page output cannot overwrite carried blocks.');
    // A page which was proved to take >1 s must not destroy its warm worker
    // on every edit. Retain the short ordinary deadline and a bounded margin
    // over this particular page's measured cost; runaway TeX is still stopped.
    const budget=Math.min(10000,Math.max(1000,Math.ceil((slot.pageCostMs??0)*2+500)));
    const probe=slot.pageProbe;slot.pageProbe=undefined;
    const output=probe&&!input&&probe.source===rootSource&&probe.range.from===range.from&&probe.range.to===range.to?probe.output:await slot.compiler.previewRegionPage(rootSource,range,slot.sourcePages!.first,slot.abort.signal,budget,()=>{},project,this.continuous,input);
    slot.pageCostMs=Math.max(output.timing?.roundTripMs??output.timing?.totalMs??slot.pageCostMs??0,output.timing?.familyCheckpointOffset!==undefined?output.timing?.baselinePageCostMs??0:0);
    if(this.continuous&&(output.pageSpan.first!==slot.baselineSpan?.first||output.pageSpan.last!==slot.baselineSpan?.last)&&(!slot.continuation||output.timing?.continuation!==slot.continuation))throw new Error('The affected page range changed without a verified continuation.');
    if(this.continuous&&slot.continuation&&output.timing?.continuation!==slot.continuation)throw new Error('The page band did not reach its prepared continuation.');
    const position=cursorPosition(output.navigation,source,slot.compiledRange.from+request.at-slot.range.from,sourceName,output.pageSpan);
    // Compatibility preambles can differ from the editor. Map only complete
    // glyph intervals inside byte-for-byte equal source prefixes/suffixes.
    const editor=request.fullSource??request.source;
    let prefix=0,suffix=0;
    while(prefix<Math.min(source.length,editor.length)&&source[prefix]===editor[prefix])prefix++;
    while(suffix<Math.min(source.length,editor.length)-prefix&&source[source.length-1-suffix]===editor[editor.length-1-suffix])suffix++;
    const pageLocations=Array.from({length:output.pageSpan.last-output.pageSpan.first+1},(_,i)=>{
      const page=output.pageSpan.first+i;
      return {page,locations:flowLocations(output.navigation,source,sourceName,page,0,source.length).flatMap(g=>{
        const shift=g.end<=prefix?0:g.at>=source.length-suffix?editor.length-source.length:undefined;
        if(shift===undefined)return [];
        const at=g.at+shift,end=g.end+shift,start=editor.lastIndexOf('\n',at-1)+1,stop=editor.indexOf('\n',at);
        return /^\s*\\(?:begin|end)\s*\{document\}/.test(editor.slice(start,stop<0?editor.length:stop))?[]:[{...g,at,end}];
      })};
    });
    return {kind:'page' as const,output,pageLocations,cursorPage:position?.page,cursorPosition:position};
  }
  private prefetch(){
    if(!this.canPrefetch||this.prefetched||!this.pending||!this.slot?.ready)return;
    const request=this.pending;this.pending=undefined;this.canPrefetch=false;
    const promise=this.runOutput(this.slot,request);void promise.catch(()=>{});
    this.prefetched={request,slot:this.slot,epoch:this.epoch,promise};
  }
  private newestId(fallback:string){return this.pending?.editId??this.prefetched?.request.editId??fallback;}
  private runOutput(slot:Slot,request:Request){
    const promise=this.speculation?this.speculation.catch(()=>{}).then(()=>this.recoverOutput(slot,request)):this.recoverOutput(slot,request);this.inflight=promise;
    void promise.finally(()=>{if(this.inflight===promise)this.inflight=undefined;}).catch(()=>{});return promise;
  }
  private async recoverOutput(slot:Slot,request:Request){
    const deadline=performance.now()+1200;let next=request;
    let confirmedHint:{source:string;repaired:string}|undefined;
    const dirty=this.neutral?.dirty,activeOnly=this.retainedFlowEnabled&&this.neutral?.ids?.length===1&&dirty?.every(b=>b.id===neutralId(slot.range));
    const original=slot.basis.originalSource;
    const hint=this.recoveryHints.get(slot)??(slot.basis.bundle?.recovered&&original!==undefined&&slot.basis.recoveryIssues?.length===1?{source:original,repaired:slot.basis.source}:undefined);
    let reused=false;
    if(hint&&!slot.input&&(!dirty?.length||activeOnly)&&!slot.abort.signal.aborted&&this.regionText(slot,request.source)!==undefined){
      const repair=carryUndefinedRepair(hint.source,hint.repaired,request.source);
      if(repair&&this.regionText(slot,repair.source)!==undefined){
        next={...request,source:repair.source,recovery:{message:repair.message,line:repair.line}};
        confirmedHint={source:request.source,repaired:repair.source};reused=true;this.neutral=undefined;
        this.log('Local recovery reused: '+repair.message+'\n');
      }
    }
    for(let attempt=0;;attempt++){
      try{
        const output=await this.output(slot,next);
        if(confirmedHint)this.recoveryHints.set(slot,confirmedHint);else this.recoveryHints.delete(slot);
        return {...output,recovery:next.recovery,repairedSource:next.recovery?next.source:undefined,reusedRecovery:reused&&output.kind==='flow'};
      }
      catch(error){
        confirmedHint=undefined;reused=false;this.recoveryHints.delete(slot);
        if(error instanceof ResidentSourceError&&this.pending&&this.pending.editId!==request.editId)throw new ResidentSupersededError('A newer draft superseded local recovery.');
        const dirty=this.neutral?.dirty,activeOnly=this.retainedFlowEnabled&&this.neutral?.ids?.length===1&&dirty?.every(b=>b.id===neutralId(slot.range));
        if(!(error instanceof ResidentSourceError)||slot.input||dirty?.length&&!activeOnly||attempt>=2||performance.now()>deadline||slot.abort.signal.aborted)throw error;
        const text=this.regionText(slot,next.source);if(text===undefined)throw error;
        const repair=previewRegionRepair(next.source,String(error),{from:slot.range.from,to:slot.range.from+text.length},request.at)??previewRepair(next.source,String(error));
        // A repair beyond this proved region must use ordinary full recovery.
        // Never mutate the editor source or retain an approximate neutral block.
        if(!repair||this.regionText(slot,repair.source)===undefined)throw error;
        // Only memoize the narrow literal undefined-command repair. Structural
        // balancing depends on following input and is reconsidered on each edit.
        if(!next.recovery&&repair.message.startsWith('Preview skipped undefined command '))confirmedHint={source:next.source,repaired:repair.source};
        this.neutral=undefined;
        next={...request,source:repair.source,recovery:{message:repair.message,line:repair.line}};
        this.log('Local recovery: '+repair.message+'\n');
      }
    }
  }
  private async drain(){
    this.running=true;
    try{while(this.pending||this.prefetched){
      if(!this.prefetched&&!this.slot?.ready)break;
      const task=this.prefetched;this.prefetched=undefined;
      const request=task?.request??this.pending!;if(!task)this.pending=undefined;
      const slot=task?.slot??this.slot,epoch=task?.epoch??this.epoch;if(!slot?.ready)break;this.canPrefetch=false;
      try{
        const result=await(task?.promise??this.runOutput(slot,request));if(epoch!==this.epoch)continue;
        this.canPrefetch=true;this.prefetch();if(!this.prefetched)slot.compiler.prepareNextRegionEdit();
        const text=this.regionText(slot,request.source)!;
        const actual=this.neutral?.actual(slot.range),rangeFrom=actual?.from??slot.range.from;
        const identity={sourceFile:slot.file,recoveredBasis:!!slot.basis.bundle.recovered,root:slot.basis.options.root,baseId:slot.basis.bundle.id,editId:request.editId,sourceHash:hash(request.fullSource??request.source),rangeFrom,rangeTo:rangeFrom+text.length};
        let candidate:LocalCandidate;
        let proposed:NeutralBlocks|undefined;
        if(result.kind==='flow'||result.kind==='retainedFlow'){
          candidate={...identity,pdf:result.output.pdf,page:slot.compositor!.page,timing:result.output.timing,fragment:result.output.fragment,flowOutput:result.flow};
          if(result.kind==='retainedFlow'){
            if(!this.neutral)throw new Error('Retained context expired.');proposed=this.neutral.proposed(slot.range,text);
            if(proposed.source()!==(request.fullSource??request.source))throw new Error('Retained projection does not match the editor.');
            candidate.retainedFlow=true;candidate.retainedSource=this.neutral.ids.length?undefined:slot.basis.source;candidate.neutralBlock={id:neutralId(slot.range),prior:this.neutral.ids,ranges:proposed.ranges,locations:result.flow.locations.map(g=>({...g,at:g.at+rangeFrom-slot.range.from,end:g.end+rangeFrom-slot.range.from})),caretY:result.flow.caretY};
          }
        }else if(result.kind==='paragraph'||result.kind==='neutral'){
          const output=result.output,started=performance.now(),composed=await slot.compositor!.compose(output);
          candidate={...identity,pdf:composed.pdf,page:composed.page,timing:{...output.timing,compositionMs:performance.now()-started},fragmentPdf:output.pdf,fragment:output.fragment,inkTopSp:slot.compositor!.inkTopSp(output),footprint:composed.footprint};
          if(result.kind==='neutral'){
            if(!this.neutral)throw new Error('Neutral context expired.');proposed=this.neutral.proposed(slot.range,text);
            if(proposed.source()!==(request.fullSource??request.source))throw new Error('Neutral projection does not match the editor.');
            candidate.neutralBlock={id:neutralId(slot.range),prior:this.neutral.ids,ranges:proposed.ranges,locations:result.locations.map(g=>({...g,at:g.at+rangeFrom-slot.range.from,end:g.end+rangeFrom-slot.range.from})),caretY:result.caretY};
          }
        }else{
          const output=result.output,span=output.pageSpan,old=slot.sourcePages!;
          slot.sourcePages={first:Math.min(old.first,span.first),last:Math.max(old.last,span.last)};
          candidate={...identity,pageLocations:result.pageLocations,pdf:await selectPages(output.pdf,span),page:span.first,pageSpan:span,sourcePages:slot.sourcePages,proofPage:slot.proofPage,cursorPage:result.cursorPage,cursorPosition:result.cursorPosition,timing:output.timing,pageOutput:true,baselineSpan:slot.baselineSpan,continuation:slot.continuation};
        }
        if(epoch!==this.epoch)continue;
        if(result.recovery){
          candidate.recovery=result.recovery;candidate.reusedRecovery=result.reusedRecovery;delete candidate.neutralBlock;
          if(result.repairedSource!==undefined){
            if(candidate.flowOutput){const projected=recoveryLocations(candidate.flowOutput.locations??[],request.source,result.repairedSource);candidate.flowOutput={...candidate.flowOutput,...projected};}
            if(candidate.pageLocations)candidate.pageLocations=candidate.pageLocations.map(p=>({...p,...recoveryLocations(p.locations,request.source,result.repairedSource!)}));
          }else candidate.pageLocations=undefined;
        }
        // A successful state-preserving region can establish that all root
        // repairs are gone only when the actual compiler input now equals the
        // complete editor draft. A remote skipped command prevents equality.
        if(!slot.input&&!result.recovery&&result.kind==='flow'&&slot.compiledRange){
          const compiled=slot.basis.compilerSource;
          candidate.sourceMatchesDraft=compiled.slice(0,slot.compiledRange.from)+text+compiled.slice(slot.compiledRange.to)===(request.fullSource??request.source);
          candidate.sourceHealthy=candidate.sourceMatchesDraft&&!result.flow.stateChanged;
          if(candidate.sourceMatchesDraft){candidate.recoveryCleared=!!slot.basis.bundle.recovered;candidate.recoveredBasis=false;}
        }
        if(slot.compositor)candidate.inkBleedBp=slot.compositor.inkBleedBp;
        if(result.kind==='page'&&!result.recovery&&this.splitPageParagraph(slot,request.source,request.at))candidate.reprepareParagraph=true;
        const original=slot.basis.originalSource;
        const diagnosticText=original===undefined?undefined:slot.diagnosticSource===undefined?original.slice(slot.range.from,slot.range.to):this.regionText(slot,slot.diagnosticSource);
        if(this.lecture&&!slot.input&&slot.basis.bundle.recovered&&original!==undefined&&slot.basis.recoveryIssues?.length&&(result.kind==='flow'&&!result.flow.stateChanged||(result.kind==='flow'||result.kind==='page')&&diagnosticText!==undefined&&plainTextChange(diagnosticText,text))){
          const firstLine=original.slice(0,slot.range.from).split('\n').length,lastLine=original.slice(0,slot.range.to).split('\n').length;
          const outside=slot.basis.recoveryIssues.filter(issue=>issue.file!==slot.basis.options.root||!issue.line||issue.line<firstLine||issue.line>=lastLine);
          candidate.unchangedRecovery=carryRecoveryDiagnostics(outside,slot.basis.options.root,original,request.source,candidate.sourceHash,request.editId);
        }
        const accepted=await this.publish(candidate);
        if(!accepted)throw new Error('The local page could not be displayed.');
        // Advance only after accepted diagnostic projection. Comparing each
        // ordinary edit with the immutable initial text would include untouched
        // math between two edit locations and unnecessarily force full builds.
        if(candidate.unchangedRecovery?.length)slot.diagnosticSource=request.source;
        if(this.neutralEnabled&&epoch!==this.epoch)continue;
        if(proposed){this.neutral=proposed;slot.neutralLast=true;}else slot.neutralLast=false;
        slot.latestSource??=request.source;slot.edited ||=request.source!==(slot.sourceText??slot.basis.source);
      }catch(error){if(epoch===this.epoch){
        if(error instanceof ResidentSupersededError){this.log('Skipped superseded local typesetting; retaining the prepared context.\n');continue;}
        if(error instanceof ResidentSourceError){
          // Half-typed math/arguments are draft syntax, not a poisoned context.
          // Keep the last displayed frame and restore this checkpoint for the
          // next character. Idle full verification can still report an error.
          this.log('Draft local TeX error; retaining the prepared context.\n');slot.compiler.prepareNextRegionEdit();
          // Lecture mode suppresses ordinary idle verification. A failed draft
          // needs an explicit recovery request, otherwise it stays invisible
          // indefinitely while the UI still says it is updating.
          this.fallback(this.newestId(request.editId));
        }else{
          const newest=this.newestId(request.editId);this.log('Broader layout required: '+String(error)+'\n');
          // A failed layout proof retires the local frame, not a healthy TeX
          // worker. Returning it through the controller's ownership checks
          // avoids cold initialization when a section changes pagination.
          this.releaseForFull();this.fallback(newest);
        }
      }}
    }}finally{this.running=false;this.canPrefetch=false;this.scheduleIdle();}
  }
}
