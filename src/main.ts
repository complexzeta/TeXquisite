import {app,BrowserWindow,dialog,ipcMain,protocol,net,session,Menu,clipboard,nativeImage,nativeTheme} from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {freemem,totalmem} from 'node:os';
import {performanceReport} from './performance-report';
import {themeIconPath,followIconTheme} from './theme-icon';
import {ArtifactStore,BuildController,Bundle,hash} from './core';
import {saveDocument,sourceBytes,SourceConflictError} from './saving';
import {BuildDiagnostic} from './diagnostics';
import {projectFolders,listProjectFiles,projectPath} from './project-navigation';
import {ProjectSearch,SearchResult,searchHash,replacementPlan} from './project-search';
import {Navigation,textHash} from './navigation';
import type {PreviewFocus} from './navigation-query';
import {encodeNavigation} from './navigation-codec';
import {cleanCaches,CacheCleanupResult} from './cache-cleanup';
import {appMenu} from './app-menu';
import {BackupStore} from './backups';
import {graphicxInsertion,documentBodyStart} from './image-paste';
import {panelPreferences,PanelPreferences} from './panel-layout';
import {LocalPreview,LocalVerification} from './local-preview';
import {retainRecoveryProblems} from './recovery-navigation';
import {nativeForward,nativeBackward,cancelNativeNavigation} from './native-navigation';
import {inspectToolchain,toolEnvironment,ToolchainReport} from './toolchain';
import {generateInstalledFormat,fingerprintFiles} from './format-cache';
import {formatFingerprint,FORMAT_FINGERPRINT_POLICY} from './format-fingerprint';
import {probe} from './toolchain';
import {standaloneTex,previewRootForDocument} from './document-root';

interface Doc {path:string;text:string;diskHash:string;dirty:boolean;eol:string;}
interface State {previewMode?:'lecture'|'document';documentRoots?:Record<string,string>;texBin?:string;toolchainSeen?:boolean;projectSidebar?:boolean;docs:Doc[];active:string;root:string;engine:string;latexmk:string;onSave:boolean;backups?:boolean;liveVersion?:number;supportFolders?:string[];zoom?:number|'fit-width';statusBar?:boolean;panelLayout?:PanelPreferences;autoClose?:boolean;followPreview?:boolean;previewEditing?:boolean;continuousPreview?:boolean;lastCursor?:{file:string;at:number};}
const testData=process.env.PERSISTENT_TEX_TEST_DATA;
// Retain the established profile location across the TeXquisite rename.
app.setPath('userData',testData?path.resolve(testData):path.join(app.getPath('appData'),'Persistent TeX'));
app.setName('TeXquisite');
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
protocol.registerSchemesAsPrivileged([{scheme:'texapp',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let window:BrowserWindow, state:State={docs:[],active:'',root:'',engine:'pdflatex',latexmk:'latexmk',onSave:true,liveVersion:2};
let controller:BuildController|undefined, displayed:Bundle|undefined, status='Open a LaTeX document to begin.';
let persistChain=Promise.resolve(), closing=false, rootGeneration=0;
let closeTimer:ReturnType<typeof setTimeout>|undefined,closeInFlight=false;
let sourceWrites:Promise<unknown>=Promise.resolve();
let latestEditId:string|undefined;
const documentEditIds=new Map<string,string>();
let currentDiagnostic:BuildDiagnostic|undefined;
let currentProblems:BuildDiagnostic[]=[];
const initialEnvironment={...process.env};
let toolchain:ToolchainReport|undefined;
let acknowledgedToolchain:string|undefined;
let preparingFormat=false;
function toolchainSignature(report:ToolchainReport){return hash(JSON.stringify({selected:report.selected,ready:report.ready,tools:report.tools,fast:report.fast.reason}));}
async function checkToolchain(selected=state.texBin,engine=state.engine,latexmk=state.latexmk){if(!['pdflatex','xelatex','lualatex','latex'].includes(engine))throw Error('Choose a supported TeX engine.');return inspectToolchain({selected,engine,latexmk,cache:path.join(data(),'formats'),metadata:path.join(app.getAppPath(),'engine/resident/format.json'),env:initialEnvironment});}
function activateToolchain(report:ToolchainReport){toolchain=report;process.env.PATH=toolEnvironment(report.selected,initialEnvironment).PATH;if(report.fast.resources)process.env.TEXQUISITE_TEX_RESOURCES=JSON.stringify(report.fast.resources);else delete process.env.TEXQUISITE_TEX_RESOURCES;}
const projectSearch=new ProjectSearch();let searchPreview:{id:string;generation:number;folders:string[];result:SearchResult}|undefined;
const conflicts=new Set<string>();
const movedDocuments=new Map<string,Doc>();
function serializeSave<T>(action:()=>Promise<T>):Promise<T>{
  const next=sourceWrites.catch(()=>{}).then(action);sourceWrites=next;return next;
}
const waiting=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
const data=()=>app.getPath('userData');
let backupStore:BackupStore|undefined,backupFailed=false,backupStatus='Backups are saved every five minutes when source changes.';
const backups=()=>backupStore??=new BackupStore(path.join(data(),'backups'));
async function runBackup(manual=false){
  if(!manual&&state.backups===false)return;
  try{
    const result=await backups().capture(state.root||state.active,state.docs);
    if(result.saved||manual||backupFailed){backupFailed=false;backupStatus=result.saved?'Backup saved at '+new Date().toLocaleTimeString()+'.':result.id?'Source unchanged since the last backup.':'Open a source file to back it up.';send({type:'backupStatus',text:backupStatus,error:false});}
    return result;
  }catch(error){backupFailed=true;backupStatus='Backup failed: '+(error instanceof Error?error.message:String(error));send({type:'backupStatus',text:backupStatus,error:true});appendLog(backupStatus+'\n');if(manual)throw error;}
}
const previewTrace:Record<string,unknown>[]=[];
let previewFallback:{time:number;kind:string;reason?:string}|undefined;
let previewBackend:string|undefined;
let previewTraceTimer:ReturnType<typeof setTimeout>|undefined;
function tracePreview(event:Record<string,unknown>){
  previewTrace.push({time:Date.now(),...event});if(previewTrace.length>64)previewTrace.shift();clearTimeout(previewTraceTimer);
  // Small local diagnostics contain routing/timing metadata, never source text.
  // Flush after typing pauses, rather than adding a disk write to each edit.
  previewTraceTimer=setTimeout(()=>{const text=JSON.stringify({version:app.getVersion(),backend:previewBackend,fallback:previewFallback,events:previewTrace});void fs.writeFile(path.join(data(),'preview-diagnostics.json'),text).catch(()=>{});},250);previewTraceTimer.unref();
}
let lastActivity=Date.now(),lastCleanup=0,cleanupRequested=false,cleanupRunning:Promise<CacheCleanupResult>|undefined;
const cleanupIdle=()=>!closing&&!controller?.busy&&Date.now()-lastActivity>=5000;
function cleanupCaches(manual=false){
  if(cleanupRunning)return cleanupRunning;
  cleanupRunning=cleanCaches(data(),{clearInactive:manual,protectedPaths:()=>[...BuildController.protectedPaths(),...ArtifactStore.protectedPaths(),...state.docs.map(d=>d.path),...(state.supportFolders??[])],shouldContinue:cleanupIdle}).finally(()=>{cleanupRunning=undefined;});
  return cleanupRunning;
}
const send=(message:unknown)=>{if(window&&!window.isDestroyed())window.webContents.send('event',message);};
let fullVerification:NodeJS.Timeout|undefined;
// A short pause between words is still active editing. Reclaiming the local
// worker after 750 ms repeatedly discarded its proved paragraph and made the
// next ordinary character wait for a full build and another raster proof.
// Only background whole-document verification waits; local edits and saving
// continue immediately, and unsupported edits still request a zero-delay build.
function scheduleFullVerification(editId:string,delay=2500,required=delay===0){
  clearTimeout(fullVerification);
  fullVerification=undefined;
  // Retain the interactive compiler in lecture mode. Unsupported edits still
  // need a full build; preserve that distinction when retrying a busy worker.
  if(state.previewMode==='lecture'&&!required)return;
  fullVerification=setTimeout(()=>{
    fullVerification=undefined;if(!state.onSave||editId!==latestEditId||state.previewMode==='lecture'&&!required)return;
    // Automatic verification must not compete with a queued/unfinished local
    // frame. Explicit builds bypass this idle scheduler.
    if(!(required&&controller?.independentLocalOwner)&&(localPreview.busy||!localPreview.prepareFullVerification())){scheduleFullVerification(editId,50,required);return;}
    void build(undefined,true).catch(e=>setStatus(String(e)));
  },delay);fullVerification.unref();
}
const localWaiting=new Map<string,{resolve:(ok:LocalVerification)=>void;timer:NodeJS.Timeout}>();
function localMessage(message:Record<string,unknown>){return new Promise<LocalVerification>(resolve=>{const token=randomUUID(),timer=setTimeout(()=>{localWaiting.delete(token);resolve(false);},15000);localWaiting.set(token,{resolve,timer});send({...message,token});});}
const localPreview=new LocalPreview(
  (basis,pdf,page,fragmentPdf,fragment,footprint,calibration)=>localMessage({type:'localVerify',root:basis.options.root,baseId:basis.bundle.id,basePdf:new Uint8Array(basis.pdf),pdf:new Uint8Array(pdf),page,fragmentPdf:new Uint8Array(fragmentPdf),fragment,footprint,calibration}),
  candidate=>localMessage({type:'localPage',...candidate,visible:window.isVisible()&&!window.isMinimized(),pdf:new Uint8Array(candidate.pdf),fragmentPdf:candidate.fragmentPdf?new Uint8Array(candidate.fragmentPdf):undefined}).then(result=>{
    const accepted=result===true;
    // Expensive local calculations can outlast the original idle deadline.
    // Start a fresh idle interval after display instead of immediately launching
    // a cold full worker while the user types or moves to the next block.
    if(accepted&&state.onSave&&candidate.root===state.root&&candidate.editId===latestEditId){
      if(candidate.recovery){
        const issue:BuildDiagnostic={id:'local-recovery-'+candidate.editId,root:candidate.root,editId:candidate.editId,file:candidate.sourceFile??candidate.root,line:candidate.recovery.line,kind:'tex',severity:'error',sourceHash:candidate.sourceHash,message:candidate.recovery.message+' Saved source is unchanged.'};
        currentDiagnostic=issue;currentProblems=[issue];send({type:'diagnostic',issue});send({type:'problems',root:candidate.root,editId:candidate.editId,issues:[issue]});scheduleFullVerification(candidate.editId,650,true);
      }else{
        // A healthy local paragraph cannot clear an error elsewhere.
        // Recheck once after typing pauses; only a full publication clears it.
        const retained=state.previewMode==='lecture'&&candidate.unchangedRecovery?retainRecoveryProblems(candidate.unchangedRecovery,currentProblems,currentDiagnostic):undefined;
        if(retained){
          clearTimeout(fullVerification);fullVerification=undefined;
          currentProblems=retained.problems;currentDiagnostic=retained.diagnostic;
          send({type:'diagnostic',issue:currentDiagnostic});send({type:'problems',root:candidate.root,editId:candidate.editId,issues:currentProblems});
          tracePreview({event:'recovery-retained',editId:candidate.editId,count:candidate.unchangedRecovery!.length});
        }else if(currentDiagnostic||candidate.recoveredBasis)scheduleFullVerification(candidate.editId,650,true);
        else scheduleFullVerification(candidate.editId);
      }
    }
    return accepted;
  }),
  editId=>{if(state.onSave&&editId===latestEditId)scheduleFullVerification(editId,0);},
  value=>{tracePreview({event:'local-state',state:value});send({type:'localState',state:value});},message=>{tracePreview({event:'local-log',message:message.split('\n')[0].slice(0,500)});appendLog(message);},
  (basis,pdf,pageSpan,continuation)=>localMessage({type:'localVerifyPages',continuation,root:basis.options.root,baseId:basis.bundle.id,basePdf:new Uint8Array(basis.pdf),pdf:new Uint8Array(pdf),pageSpan}).then(result=>result===true),
  (basis,page,fragmentPdf,fragment,calibration)=>localMessage({type:'localPlacement',root:basis.options.root,baseId:basis.bundle.id,basePdf:new Uint8Array(basis.pdf),page,fragmentPdf:new Uint8Array(fragmentPdf),fragment,calibration}));
const setStatus=(text:string)=>{const conflict=conflicts.values().next().value;status=text+(conflict&&!/changed outside|externally changed|changed on disk/i.test(text)?' '+path.basename(conflict)+' changed outside the app; its draft is preserved. Select its tab and use Save copy or Reload disk.':'');send({type:'status',text:status,conflict:conflict?path.basename(conflict):undefined});};
const appendLog=(text:string)=>{
  send({type:'log',text:text.slice(-2_000_000),append:true});
  if(text.startsWith('Resident fallback:')||text.startsWith('Resident compiler unavailable:')){previewFallback={time:Date.now(),kind:text.startsWith('Resident fallback:')?'fallback':'unavailable',reason:text.split('\n')[0].slice(0,300)};tracePreview({event:'compiler-fallback',kind:previewFallback.kind});}
  else if(text.startsWith('Resident capability check failed;')){previewFallback={time:Date.now(),kind:'capability'};tracePreview({event:'compiler-fallback',kind:'capability'});}
  if(text.startsWith('Resident compiler unavailable:')&&toolchain){toolchain.fast={available:false,mismatches:[],reason:text.trim().replace(/^Resident compiler unavailable: /,'Native compilation only: ')};send({type:'toolchainStatus',report:toolchain});}
};
function persist() {
  const captured=JSON.stringify(state);
  persistChain=persistChain.catch(()=>{}).then(async()=>{
    await fs.mkdir(data(),{recursive:true});
    const file=path.join(data(),'session.json'),temp=file+'.'+randomUUID()+'.tmp';
    const handle=await fs.open(temp,'wx');
    try{await handle.writeFile(captured);await handle.sync();}finally{await handle.close();}
    await fs.rename(temp,file);
  });
  return persistChain;
}
const bytes=sourceBytes;
async function writeSource(doc:Doc) {
  try{
    const text=await saveDocument(doc);
    conflicts.delete(doc.path);
    send({type:'saved',path:doc.path,text,dirty:doc.dirty});
  }catch(error){if(error instanceof SourceConflictError)conflicts.add(doc.path);throw error;}
}
async function saveAllAndBuild(force=false,previewRequested=false) {
  const requestedAt=performance.now();
  return serializeSave(async()=>{
    const began=performance.now();
    if(!force&&!state.onSave)return;
    let changed=false;
    const failures:{file:string;error:unknown}[]=[];
    for(const doc of state.docs){
      if(!doc.dirty)continue;
      try{await writeSource(doc);changed=true;}catch(error){failures.push({file:doc.path,error});}
    }
    const projectBlocked=failures.some(failure=>{
      const relative=path.relative(path.dirname(state.root),failure.file);
      return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
    });
    if((changed||force)&&controller&&!previewRequested&&!projectBlocked)void build(undefined,!force).catch(e=>setStatus(String(e)));
    if(changed||failures.length)await persist();
    if(changed&&process.env.PERSISTENT_TEX_PROFILE)appendLog('Profile save '+JSON.stringify({queueMs:began-requestedAt,totalMs:performance.now()-began})+'\n');
    if(failures.length)throw failures[0].error;
  });
}
async function prepare(bundle:Bundle,store:ArtifactStore,preparedPdf?:Uint8Array,navigation?:Navigation,displayFocus?:PreviewFocus) {
  const pdf=preparedPdf??await fs.readFile(store.pdf(bundle));
  navigation??=await store.navigation(bundle);
  if(bundle.root===state.root&&navigation)for(const doc of state.docs)if(navigation.sources[doc.path])rememberDocumentRoot(doc.path,bundle.root);
  return new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting.delete(bundle.id);reject(new Error('PDF viewer did not finish loading.'));},30000);
    waiting.set(bundle.id,{resolve,reject,timer});
    const encodingAt=performance.now(),encoded=encodeNavigation(navigation),encodedAt=performance.now();
    send({type:'prepare',bundle,pdf:new Uint8Array(pdf),navigation:encoded,displayFocus:process.env.PERSISTENT_TEX_DISABLE_DISPLAY_FOCUS==='1'?undefined:displayFocus,...(process.env.PERSISTENT_TEX_PROFILE?{profile:{sentAt:performance.timeOrigin+performance.now(),encodeMs:encodedAt-encodingAt}}:{})});
  });
}
function rememberDocumentRoot(file:string,root=state.root){if(root)(state.documentRoots??={})[file]=root;}
function activePreviewRoot(){
 const doc=state.docs.find(d=>d.path===state.active),remembered=state.documentRoots?.[state.active];
 return previewRootForDocument(state.root,doc,state.docs.some(d=>d.path===remembered)?remembered:undefined);
}
async function selectRoot(root:string,automaticBuild=true) {
  projectSearch.stop();searchPreview=undefined;
  clearTimeout(fullVerification);localPreview.stop();
  void controller?.dispose().catch(error=>appendLog('Previous project cleanup deferred: '+String(error)+'\n')); displayed=undefined;currentDiagnostic=undefined;currentProblems=[];
  const generation=++rootGeneration;
  latestEditId=documentEditIds.get(root);
  state.root=root;previewFallback=undefined;previewBackend=undefined;rememberDocumentRoot(root,root);send({type:'reset',root});send({type:'root',root});
  const store=new ArtifactStore(path.join(data(),'projects',hash(path.resolve(root).toLowerCase()).slice(0,32)));
  const next=new BuildController(store,{
    performance:report=>{if(generation===rootGeneration&&!closing)tracePreview({event:'standby',...report});},
    prepare:async(bundle,pdf,map,focus)=>{if(generation!==rootGeneration)throw new Error('Project changed.');await prepare(bundle,store,pdf,map,focus);},
    problems:(issues,editId)=>{if(generation===rootGeneration&&editId===latestEditId){currentProblems=issues;send({type:"problems",root,editId,issues});}},
    diagnostic:issue=>{if(generation===rootGeneration&&issue.editId===latestEditId){currentDiagnostic=issue;send({type:'diagnostic',issue});}},
    localBasis:basis=>{if(generation===rootGeneration&&state.onSave&&!state.previewEditing&&process.env.PERSISTENT_TEX_DISABLE_LOCAL!=='1'){
      localPreview.setBasis(basis);const doc=state.docs.find(doc=>doc.path===state.root);
      if(process.env.PERSISTENT_TEX_DISABLE_AUTOMATIC_HANDOFF!=='1'&&doc&&latestEditId&&localPreview.resumeAutomatic(doc.path,doc.text,latestEditId))scheduleFullVerification(latestEditId);
    }},
    commit:(bundle,timing)=>{if(generation===rootGeneration){previewBackend=timing?.backend;if(previewBackend?.startsWith('Preamble'))previewFallback=undefined;tracePreview({event:'full-committed',backend:previewBackend});currentDiagnostic=undefined;displayed=bundle;send({type:'commit',id:bundle.id,timing,visible:window.isVisible()&&!window.isMinimized()});}},
    discard:bundle=>send({type:'discard',id:bundle.id})
  },s=>{if(generation===rootGeneration)setStatus(s);},appendLog);
  controller=next;
  const current=await next.restore();
  if(generation!==rootGeneration)return;
  if(current) {
    const history=await store.history();
    for(const bundle of history) {
      try{await prepare(bundle,store);if(generation!==rootGeneration){send({type:'discard',id:bundle.id});return;}displayed=bundle;send({type:'commit',id:bundle.id,...(bundle.recovered?{timing:{recovered:true,backend:'Recovered preview — LaTeX errors need attention.',requestToCommitMs:0}}:{})});setStatus(bundle.recovered?'Restored a recovered preview with temporary LaTeX repairs. Fix the reported errors; source may have changed.':'Restored last successful preview. Source may have changed.');break;}
      catch(e){appendLog(String(e)+'\n');}
    }
  } else setStatus('No successful preview yet. Save your source, then build.');
  await persist();
  if(state.onSave&&automaticBuild){void build(undefined,true).catch(e=>setStatus(String(e)));void saveAllAndBuild(true,true).catch(e=>setStatus(String(e)));}
}
async function openFile(file:string,keepRoot=false,expectedGeneration?:number) {
  file=path.resolve(file);
  movedDocuments.delete(file);
  if(!state.docs.some(d=>d.path===file)) {
    const buffer=await fs.readFile(file);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    if(buffer[0]===0xef&&buffer[1]===0xbb)throw new Error('UTF-8 BOM files are not supported yet. Convert a copy to UTF-8 without BOM.');
    if(expectedGeneration!==undefined&&expectedGeneration!==rootGeneration)throw Error("The project changed while opening this file.");
    state.docs.push({path:file,text:text.replace(/\r\n/g,'\n'),diskHash:hash(buffer),dirty:false,eol:text.includes('\r\n')?'\r\n':'\n'});
  }
  if(expectedGeneration!==undefined&&expectedGeneration!==rootGeneration)throw Error("The project changed while opening this file.");
  state.active=file;
  const opened=state.docs.find(doc=>doc.path===file)!;
  if(!keepRoot&&/\.tex$/i.test(file)&&(!state.root||file!==state.root&&standaloneTex(opened)))await selectRoot(file);
  rememberDocumentRoot(file);
  await persist();void runBackup(); return state;
}
async function saveFile(copy=false) {
  return serializeSave(async()=>{
  const doc=state.docs.find(d=>d.path===state.active);if(!doc)return state;
  if(!copy){
    if(doc.dirty)await writeSource(doc);
    await persist();
    if(controller)void build().catch(e=>setStatus(String(e)));
    return state;
  }
  const originalPath=doc.path;
  let destination=conflicts.has(doc.path)?path.join(path.dirname(doc.path),path.basename(doc.path,'.tex')+'-copy.tex'):doc.path;
  if(copy){const choice=await dialog.showSaveDialog(window,{defaultPath:destination,filters:[{name:'LaTeX source',extensions:['tex']}]});if(choice.canceled||!choice.filePath)return state;destination=choice.filePath;}
  const disk=await fs.readFile(destination).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(state.docs.some(other=>other!==doc&&path.resolve(other.path).toLowerCase()===path.resolve(destination).toLowerCase()))throw new Error('That file is already open. Choose a different name for the copy.');
  if(destination===doc.path&&(!disk||hash(disk)!==doc.diskHash))throw new Error('This file changed outside the app. Your draft is preserved. Use Save Copy to keep it separately, then reopen the external version.');
  const buffer=bytes(doc),temp=destination+'.'+randomUUID()+'.tmp';
  try{
    const handle=await fs.open(temp,'wx');try{await handle.writeFile(buffer);await handle.sync();}finally{await handle.close();}
    const latest=await fs.readFile(destination).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
    if((latest?hash(latest):undefined)!==(disk?hash(disk):undefined))throw new Error('The copy destination changed while saving. Choose another name; your draft is retained.');
    await fs.rename(temp,destination);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  if(destination!==originalPath){
    // Continue editing the safe copy. Leaving the conflicted original open as
    // a dirty buffer would block every later automatic save, including this copy.
    const wasRoot=state.root===originalPath;
    movedDocuments.set(originalPath,doc);conflicts.delete(originalPath);
    doc.path=destination;doc.diskHash=hash(buffer);doc.dirty=hash(bytes(doc))!==doc.diskHash;state.active=destination;
    if(wasRoot||!state.root&&destination.endsWith('.tex'))await selectRoot(destination);
    else await persist();
    if(state.onSave&&doc.dirty)void saveAllAndBuild().catch(e=>setStatus(String(e)));
    return state;
  }
  doc.diskHash=hash(buffer);doc.dirty=hash(bytes(doc))!==doc.diskHash;await persist();
  setStatus('Source saved. Preview may be behind your edits.');
  if(state.onSave) void build();
  return state;
  });
}
async function build(sourceText?:string,automatic=sourceText!==undefined) {
  if(toolchain&&!toolchain.ready)throw Error('TeX installation needs attention. Open Build → Settings: '+toolchain.issues.join(' '));
  clearTimeout(fullVerification);fullVerification=undefined;
  if(!controller||!state.root)throw new Error('Open a root .tex document first.');
  const rootDoc=state.docs.find(doc=>doc.path===state.root);
  const text=sourceText??rootDoc?.text,cursor=state.lastCursor,lines=cursor?.file===state.root&&text!==undefined&&Number.isSafeInteger(cursor.at)&&cursor.at>=0&&cursor.at<=text.length?text.slice(0,cursor.at).split('\n'):undefined;
  const focus=lines?{line:lines.length,column:lines.at(-1)!.length}:undefined;
  await controller.request({focus,root:state.root,engine:state.engine,executable:state.latexmk,timeoutMs:120000,sourceText:text,characterMapping:!!(state.previewEditing||state.continuousPreview||state.followPreview),sourceFiles:Object.fromEntries(state.docs.filter(doc=>doc.path!==state.root).map(doc=>[doc.path,doc.text])),supportFolders:state.supportFolders,editId:latestEditId,automatic});
}
function updateAppMenu(){Menu.setApplicationMenu(appMenu(state,(action,value)=>send({type:'menuAction',action,value})));if(window&&!window.isDestroyed()){window.setAutoHideMenuBar(false);window.setMenuBarVisibility(true);}}
async function handle(method:string,args:unknown[]) {
  switch(method){
    case 'performanceReport':
    case 'copyPerformanceReport': {
      const report=performanceReport({version:app.getVersion(),mode:state.previewMode??'document',continuous:!!state.continuousPreview,automatic:state.onSave,visible:!!window?.isVisible()&&!window.isMinimized(),localReady:localPreview.ready,localBusy:localPreview.busy,fastAvailable:!!toolchain?.fast.available,fastPreparable:!!toolchain?.fast.preparable,freeMiB:freemem()/1048576,totalMiB:totalmem()/1048576,latestEditId,standby:controller?.standbyReport.state,retained:process.env.PERSISTENT_TEX_MULTI_BLOCK==='1'&&process.env.PERSISTENT_TEX_RETAINED_FLOW==='1'},previewTrace);
      if(method==='copyPerformanceReport'){clipboard.writeText(JSON.stringify(report,null,2));setStatus('Performance report copied. Source text and file paths are excluded.');}return report;
    }
    case 'retryPreview': {localPreview.prepareFullVerification();await build(undefined,true);return true;}
    case 'previewPerformance': return {standby:controller?.standbyReport,localReady:localPreview.ready,localBusy:localPreview.busy,localRange:localPreview.preparedRange,...(args[0]===true?{trace:previewTrace.slice()}: {})};
    case 'localRefresh': {
      if(process.env.PERSISTENT_TEX_MULTI_BLOCK==='1'){
        if(localPreview.hasLocalChanges){localPreview.stop();if(controller)void build(undefined,true).catch(e=>setStatus(String(e)));}
        else localPreview.refresh();
      }
      return true;
    }
    case 'localAck': {const entry=localWaiting.get(String(args[0]));if(entry){clearTimeout(entry.timer);localWaiting.delete(String(args[0]));const reply=args[1] as LocalVerification;entry.resolve(reply===true?true:reply&&typeof reply==='object'&&Number.isFinite(reply.dx)&&Number.isFinite(reply.dy)&&Math.abs(reply.dx)<=.01&&Math.abs(reply.dy)<=.01?reply:false);}return true;}
    case 'localCursor': {if(typeof args[0]==='string'&&typeof args[1]==='number'&&Number.isSafeInteger(args[1])&&args[1]>=0&&state.docs.some(doc=>doc.path===args[0])){controller?.noteActivity('cursor');state.lastCursor={file:args[0],at:args[1]};localPreview.move(args[0],args[1]);}return true;}
    case 'localWarm': {if(typeof args[0]==='string'&&typeof args[1]==='string'&&args[0]===state.root&&args[2]===latestEditId){localPreview.prepareNextEdit(args[0],args[1]);if(typeof args[3]==='number'&&Number.isFinite(args[3]))tracePreview({event:'local-displayed',editId:args[2],elapsedMs:args[3],layout:args[4]});}return true;}
    case 'previewTiming': {if(args[0]===latestEditId&&typeof args[1]==='number'&&Number.isFinite(args[1]))tracePreview({event:'full-displayed',editId:args[0],elapsedMs:args[1]});return true;}
    case 'previewMode': {
      const mode=args[0];if(mode!=='lecture'&&mode!=='document')throw Error('Choose Lecture or Document mode.');
      clearTimeout(fullVerification);fullVerification=undefined;state.previewMode=mode;
      localPreview.setLecture(mode==='lecture');
      await persist();tracePreview({event:'preview-mode',mode});
      if(mode==='document'&&state.onSave&&latestEditId&&controller)scheduleFullVerification(latestEditId,0);
      return state;
    }
    case 'cleanCaches': {
      const result=await cleanupCaches(true),mb=(bytes:number)=>(bytes/1048576).toFixed(1);
      const text=result.deferred?'Cleanup deferred until typing and builds pause.':`Freed ${mb(result.freedBytes)} MB from unused caches. ${mb(result.retainedBytes)} MB retained; active projects and preview navigation are protected.`;
      if(result.deferred)cleanupRequested=true;appendLog(text+'\n');return {...result,text};
    }
    case 'previewEditing': clearTimeout(fullVerification);localPreview.stop();state.previewEditing=!!args[0];await persist();if(controller)void build(undefined,true).catch(e=>setStatus(String(e)));return state.previewEditing;
    case 'continuous': clearTimeout(fullVerification);state.continuousPreview=!!args[0];if(state.continuousPreview)state.previewEditing=false;localPreview.setContinuous(state.continuousPreview);await persist();if(controller)void build(undefined,true).catch(e=>setStatus(String(e)));return state.continuousPreview;
    case 'statusBar': state.statusBar=!!args[0];await persist();return state.statusBar;
    case 'zoom': {const value=args[0];if(value!=='fit-width'&&![.8,1,1.25,1.5,2].includes(value as number))throw new Error('Invalid zoom.');state.zoom=value as State['zoom'];await persist();return state.zoom;}
    case 'panels': state.panelLayout=panelPreferences(args[0]);await persist();return state.panelLayout;
    case 'autoClose': state.autoClose=!!args[0];await persist();return state.autoClose;
    case 'follow': state.followPreview=!!args[0];await persist();if(state.followPreview&&state.onSave&&!state.continuousPreview&&!state.previewEditing&&controller)void build(undefined,true).catch(e=>setStatus(String(e)));return state.followPreview;
    case 'nativeNavigation': {
      const [id,direction,values]=args;
      if(!controller||!displayed||displayed.id!==id||!displayed.synctex)throw Error('The preview changed or has no SyncTeX data.');
      const bundle=displayed,store=controller.store,release=store.pin(bundle);
      try{
      const nav=await store.navigation(bundle);if(!nav?.nativeInputs)return;
      const v=values as any;let row;
      if(direction==='forward'&&typeof v?.file==='string'&&Number.isInteger(v.line)&&v.line>0&&Number.isInteger(v.page)){
        const doc=state.docs.find(doc=>doc.path===v.file);if(!doc||textHash(doc.text)!==nav.sources[v.file])return;
        row=await nativeForward(store.pdf(bundle),nav,v.file,v.line,v.page);
      }else if(direction==='backward'&&[v?.page,v?.x,v?.y].every(n=>typeof n==='number'&&Number.isFinite(n))&&Number.isInteger(v.page)&&v.page>0)row=await nativeBackward(store.pdf(bundle),nav,v.page,v.x,v.y);
      if(displayed?.id!==id)throw Error('The preview changed; select the location again.');return row;
      }finally{release();}
    }
    case 'navigateDiagnostic': {
      const issue=currentProblems.find(issue=>issue.id===args[0])??currentDiagnostic;
      if(!issue||args[0]!==issue.id||issue.root!==state.root||!issue.file||!issue.line||!issue.sourceHash||issue.editId!==latestEditId)throw Error('This error belongs to older source. Wait for the next build.');
      const file=issue.file,existing=state.docs.find(doc=>doc.path===file),disk=existing?undefined:await fs.readFile(file),text=existing?.text??new TextDecoder('utf-8',{fatal:true}).decode(disk!);
      if(disk?.[0]===0xef&&disk[1]===0xbb)throw Error('This source uses a UTF-8 BOM. Open a UTF-8 copy without BOM before editing it.');
      if(textHash(text)!==issue.sourceHash||(!currentProblems.includes(issue)&&currentDiagnostic!==issue)||issue.editId!==latestEditId)throw Error('The source changed after this error. Wait for the next build.');
      if(!existing)state.docs.push({path:file,text:text.replace(/\r\n/g,'\n'),diskHash:hash(disk!),dirty:false,eol:text.includes('\r\n')?'\r\n':'\n'});
      return {state:{...state,active:file},line:issue.line};
    }
    case 'navigateSource': {
      const [id,file,lineNumber]=args;
      if(!controller||!displayed||id!==displayed.id||typeof file!=='string'||typeof lineNumber!=='number'||!Number.isInteger(lineNumber)||lineNumber<1)throw Error('The preview changed; select the location again.');
      const navigation=await controller.store.navigation(displayed);
      if(!navigation?.sources[file]||(!navigation.nativeInputs&&!navigation.regions.some(row=>row[0]===file&&row[1]===lineNumber)))throw Error('No source mapping for this position.');
      const existing=state.docs.find(doc=>doc.path===file),disk=existing?undefined:await fs.readFile(file),text=existing?.text??new TextDecoder('utf-8',{fatal:true}).decode(disk!);
      if(disk?.[0]===0xef&&disk[1]===0xbb)throw Error('This source uses a UTF-8 BOM. Open a UTF-8 copy without BOM before editing it.');
      if(textHash(text)!==navigation.sources[file])throw Error('Preview is behind this source file. Wait for an update before navigating.');
      // Open an included file without implicitly selecting it as a new root.
      if(displayed?.id!==id)throw Error('The preview changed; select the location again.');
      if(!existing)state.docs.push({path:file,text:text.replace(/\r\n/g,'\n'),diskHash:hash(disk!),dirty:false,eol:text.includes('\r\n')?'\r\n':'\n'});
      // Activation belongs to the renderer after it accepts this asynchronous
      // response; a superseded click must not change the active source file.
      return {state:{...state,active:file},line:lineNumber};
    }
    case 'initialize': {
      void runBackup();
      localPreview.setContinuous(!!state.continuousPreview);
      localPreview.setLecture(state.previewMode==='lecture');
      const savedRoot=activePreviewRoot();state.root='';
      if(state.lastCursor&&state.docs.some(doc=>doc.path===state.lastCursor!.file)&&Number.isSafeInteger(state.lastCursor.at)&&state.lastCursor.at>=0)localPreview.move(state.lastCursor.file,state.lastCursor.at);
      if(savedRoot)void selectRoot(savedRoot).catch(e=>setStatus(String(e)));
      return {...state,root:savedRoot,toolchain,showToolchainSetup:(!state.toolchainSeen&&!state.docs.length)||!!toolchain&&(!toolchain.ready||!toolchain.fast.available)&&acknowledgedToolchain!==toolchainSignature(toolchain)};
    }
    case 'toolchainCheck': return checkToolchain(typeof args[0]==='string'?args[0]:undefined,typeof args[1]==='string'?args[1]:state.engine,typeof args[2]==='string'?args[2]:state.latexmk);
    case 'toolchainPrepare': {
      if(preparingFormat)throw Error('A fast format is already being prepared.');preparingFormat=true;
      try{
        const checked=await checkToolchain(String(args[0]??''),String(args[1]??state.engine),String(args[2]??state.latexmk));
        if(!checked.fast.preparable||!checked.selected)throw Error('Choose a working TeX Live installation with pdfLaTeX and the default latexmk command.');
        const env=toolEnvironment(checked.selected,initialEnvironment),kpse=checked.tools.find(t=>t.name==='kpsewhich')!.path!,root=await probe(kpse,['-var-value=TEXMFDIST'],env),files:Record<string,string>={},fingerprints:Record<string,string>={};
        for(const name of fingerprintFiles){files[name]=await probe(kpse,[name],env);fingerprints[name]=formatFingerprint(name,await fs.readFile(files[name]),FORMAT_FINGERPRINT_POLICY);}
        await generateInstalledFormat({keep:toolchain?.fast.resources?.formatManifest?[toolchain.fast.resources.formatManifest]:[],assets:path.join(app.getAppPath(),'engine/resident'),cache:path.join(data(),'formats'),installation:checked.selected,root,files,fingerprints,env});
        return checkToolchain(checked.selected,String(args[1]??state.engine),String(args[2]??state.latexmk));
      }finally{preparingFormat=false;}
    }
    case 'toolchainBrowse': {const choice=await dialog.showOpenDialog(window,{title:'Choose a TeX installation or its executable folder',properties:['openDirectory']});return choice.canceled?null:checkToolchain(choice.filePaths[0],typeof args[0]==='string'?args[0]:state.engine,typeof args[1]==='string'?args[1]:state.latexmk);}
    case 'projectSidebar': state.projectSidebar=!!args[0];await persist();return state.projectSidebar;
    case 'projectFolders': return {root:state.root,folders:projectFolders(state.root,state.supportFolders)};
    case 'projectFiles': return listProjectFiles(String(args[0]),projectFolders(state.root,state.supportFolders),String(args[1]??''));
    case 'projectSearch': {
      await sourceWrites.catch(()=>{});const generation=rootGeneration,value=args[0] as {query?:unknown;replacement?:unknown;support?:unknown;regex?:unknown;caseSensitive?:unknown}|undefined;if(!state.root)throw Error('Open a root document first.');
      if(!value||typeof value.query!=='string'||typeof value.replacement!=='string')throw Error('Enter a search and replacement.');
      searchPreview=undefined;const folders=projectFolders(state.root,value.support?state.supportFolders:[]),result=await projectSearch.run(folders,state.docs,{query:value.query,replacement:value.replacement,regex:!!value.regex,caseSensitive:!!value.caseSensitive});
      if(generation!==rootGeneration)throw Error('The project changed. Search again.');const id=randomUUID();searchPreview={id,generation,folders,result};return {id,folders,matches:result.matches,scanned:result.scanned,skipped:result.skipped,limited:result.limited};
    }
    case 'searchLocation': {
      const preview=searchPreview,match=preview?.result.matches.find(m=>m.id===args[1]);if(!preview||preview.id!==args[0]||preview.generation!==rootGeneration||!match)throw Error('Search again to refresh this result.');
      const snapshot=preview.result.files.find(f=>f.file===match.file)!,doc=state.docs.find(d=>d.path===match.file);
      if(doc?doc.text!==snapshot.text:searchHash(await fs.readFile(match.file))!==snapshot.diskHash)throw Error('Source changed. Search again before navigating.');
      const next=await openFile(await projectPath(match.file,preview.folders),true,preview.generation);return {state:next,from:match.from,to:match.to,text:snapshot.text};
    }
    case 'applyProjectReplace': return serializeSave(async()=>{
      const preview=searchPreview;if(!preview||preview.id!==args[0]||preview.generation!==rootGeneration||!Array.isArray(args[1]))throw Error('Search again to refresh the replacement preview.');
      const changes=(await replacementPlan(preview.result,args[1],state.docs,preview.folders)).filter(change=>change.before!==change.after);if(!changes.length)throw Error("The selected replacements do not change the text.");
      // Back up the original buffers, including newly discovered closed files, before changing source.
      const originals=changes.filter(c=>!state.docs.some(d=>d.path===c.file)).map(c=>({path:c.file,text:c.before,diskHash:c.diskHash,dirty:false,eol:c.eol}));
      await backups().capture(state.root,[...state.docs,...originals]);
      await replacementPlan(preview.result,args[1],state.docs,preview.folders);
      if(searchPreview!==preview||preview.generation!==rootGeneration)throw Error('The project or search changed. Search again.');
      for(const change of changes){const doc=state.docs.find(d=>d.path===change.file);if(doc&&doc.text!==change.before)throw Error('Source changed. Search again.');}
      clearTimeout(fullVerification);localPreview.stop();controller?.cancel();const previousEditId=latestEditId,previousIds=new Map(documentEditIds),editId='replace-'+randomUUID();
      state.docs.push(...originals.filter(original=>!state.docs.some(doc=>doc.path===original.path)));for(const change of changes){const doc=state.docs.find(d=>d.path===change.file)!;doc.text=change.after;doc.dirty=hash(bytes(doc))!==doc.diskHash;documentEditIds.set(doc.path,editId);}latestEditId=editId;searchPreview=undefined;
      try{await persist();}catch(error){for(const change of changes){const doc=state.docs.find(d=>d.path===change.file);if(doc?.text===change.after){doc.text=change.before;doc.dirty=hash(bytes(doc))!==doc.diskHash;const prior=previousIds.get(doc.path);if(prior)documentEditIds.set(doc.path,prior);else documentEditIds.delete(doc.path);}}if(latestEditId===editId)latestEditId=previousEditId;if(preview.generation===rootGeneration)searchPreview=preview;throw error;}
      return {state,changes,editId};
    });
    case 'finishProjectReplace': if(args[0]===latestEditId&&state.onSave)void saveAllAndBuild(true).catch(e=>setStatus(String(e)));return true;
    case 'projectOpen': {const generation=rootGeneration,file=await projectPath(String(args[0]),projectFolders(state.root,state.supportFolders));if(generation!==rootGeneration)throw Error('The project changed while opening this file.');return openFile(file,true,generation);}
    case 'open': {
      const choice=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'TeX source and text',extensions:['tex','sty','cls','bib','txt']}]});
      return choice.canceled?state:openFile(choice.filePaths[0]);
    }
    case 'automaticBackups': state.backups=!!args[0];await persist();if(state.backups)void runBackup();return state.backups;
    case 'backupNow': await runBackup(true);return backupStatus;
    case 'listBackups': return {snapshots:await backups().list(),text:backupStatus,enabled:state.backups!==false};
    case 'restoreBackup': {
      const snapshot=await backups().read(String(args[0]),Number(args[1])),original=snapshot.file.path;
      const extension=path.extname(original),stamp=new Date(snapshot.record.created).toISOString().replace(/[:.]/g,'-');
      const choice=await dialog.showSaveDialog(window,{title:'Recover backup as a new file',defaultPath:path.join(path.dirname(original),path.basename(original,extension)+'-recovered-'+stamp+extension)});
      if(choice.canceled||!choice.filePath)return null;
      // Exclusive creation protects both original files and existing recovery copies.
      await fs.writeFile(choice.filePath,snapshot.bytes,{flag:'wx'});
      return openFile(choice.filePath);
    }
    case 'support': {
      const choice=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'Choose the folder containing local TeX support files'});
      if(!choice.canceled){clearTimeout(fullVerification);localPreview.stop();state.supportFolders=[...new Set([...(state.supportFolders??[]),...choice.filePaths.map(file=>path.resolve(file))])];await persist();if(state.onSave&&controller)void build().catch(e=>setStatus(String(e)));}
      return state;
    }
    case 'new': {
      const choice=await dialog.showSaveDialog(window,{defaultPath:'untitled.tex',filters:[{name:'LaTeX source',extensions:['tex']}]});
      if(choice.canceled||!choice.filePath)return state;
      await fs.writeFile(choice.filePath,'\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n\n\\end{document}\n',{flag:'wx'});
      return openFile(choice.filePath);
    }
    case 'reload': {
      clearTimeout(fullVerification);localPreview.stop();
      await sourceWrites.catch(()=>{});
      const doc=state.docs.find(d=>d.path===state.active);if(!doc)return state;
      if(doc.dirty){
        const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Keep draft copy and reload','Cancel'],defaultId:1,cancelId:1,message:'Reload the file from disk?',detail:'Your unsaved text will be retained as a separate draft file in the app recovery folder.'});
        if(choice.response!==0)return state;
        const dir=path.join(data(),'recovery');await fs.mkdir(dir,{recursive:true});
        const draft=path.join(dir,randomUUID()+'-'+path.basename(doc.path));await fs.writeFile(draft,bytes(doc),{flag:'wx'});
        appendLog('Draft preserved at '+draft+'\n');
      }
      const buffer=await fs.readFile(doc.path),text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
      if(buffer[0]===0xef&&buffer[1]===0xbb)throw new Error('UTF-8 BOM files are not supported yet.');
      doc.text=text.replace(/\r\n/g,'\n');doc.eol=text.includes('\r\n')?'\r\n':'\n';doc.diskHash=hash(buffer);doc.dirty=false;conflicts.delete(doc.path);await persist();
      if(state.onSave&&controller)void build().catch(e=>setStatus(String(e)));
      return state;
    }
    case 'fixture': {
      const directory=path.join(data(),'examples');await fs.mkdir(directory,{recursive:true});
      const file=path.join(directory,'main.tex');
      await fs.copyFile(path.join(app.getAppPath(),'fixtures','article','main.tex'),file,1).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
      return openFile(file);
    }
    case 'pasteImage': {
      const [file,expected,payload]=args;
      const doc=state.docs.find(d=>d.path===file),root=state.docs.find(d=>d.path===state.root);
      if(!doc||!root||typeof expected!=='string'||doc.text!==expected)throw new Error('Open a saved TeX document before pasting an image.');
      if(!doc.path.toLowerCase().endsWith('.tex'))throw new Error('Paste images into a TeX source file.');
      const rootFile=root.path,rootText=root.text,packageEdit=graphicxInsertion(rootText);
      const position=args[3];
      if(typeof position!=='number'||!Number.isSafeInteger(position)||position<0||position>expected.length)throw new Error('Invalid image insertion position.');
      if(file===rootFile&&position<documentBodyStart(rootText))throw new Error('Place the cursor inside the document body before pasting an image.');
      let encoded:Uint8Array|undefined;
      if(payload instanceof Uint8Array)encoded=payload;
      else for(const item of await clipboard.read()){
        const type=item.types.find(type=>type==='image/png')??item.types.find(type=>type.startsWith('image/'));
        if(type){const content=await item.getType(type);if('arrayBuffer' in content){encoded=new Uint8Array(await content.arrayBuffer());break;}}
      }
      if(encoded&&encoded.length>64*1024*1024)throw new Error('This image is too large to paste (maximum encoded size: 64 MB).');
      const image=encoded?nativeImage.createFromBuffer(Buffer.from(encoded)):nativeImage.createEmpty();
      if(image.isEmpty())throw new Error('The clipboard does not contain an image.');
      const png=image.toPNG(),size=image.getSize();
      if(png.length>64*1024*1024)throw new Error('This image is too large to paste (maximum PNG size: 64 MB).');
      const thumbnailScale=Math.min(1,160/size.width,120/size.height);
      const name='images/pasted-image-'+new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)+'-'+randomUUID().slice(0,8)+'.png';
      const destination=path.join(path.dirname(rootFile),...name.split('/'));
      const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Insert image','Cancel'],defaultId:0,cancelId:1,title:'Paste image',message:'Save and insert this image?',detail:`${size.width} × ${size.height} pixels\nSave PNG: ${destination}\n\nInsert an \\includegraphics command at your selection.${packageEdit?'\nAdd \\usepackage{graphicx} to the root preamble.':''}`,icon:image.resize({width:Math.max(1,Math.round(size.width*thumbnailScale)),height:Math.max(1,Math.round(size.height*thumbnailScale))})});
      if(choice.response!==0)return null;
      if(state.active!==file||state.root!==rootFile||doc.text!==expected||root.text!==rootText)throw new Error('The document changed while confirming the image. Paste again at the desired location.');
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await fs.writeFile(destination,png,{flag:'wx'});
      return {name,root:rootFile,rootText,packageEdit,width:size.width,height:size.height};
    }
    case 'edit': {
      controller?.noteActivity();
      lastActivity=Date.now();
      const [file,text,editId]=args;if(typeof file!=='string'||typeof text!=='string')throw new Error('Invalid edit.');
      const doc=state.docs.find(d=>d.path===file)??movedDocuments.get(file);if(!doc)throw new Error('File is not open.');
      doc.text=text;doc.dirty=hash(bytes(doc))!==doc.diskHash;
      const documentEditId=typeof editId==='string'?editId:undefined;
      if(documentEditId)documentEditIds.set(doc.path,documentEditId);else documentEditIds.delete(doc.path);
      if(doc.path===state.active&&typeof args[3]==='number'&&Number.isSafeInteger(args[3])){state.lastCursor={file:doc.path,at:args[3]};localPreview.move(doc.path,args[3],true);}
      if(doc.path===state.active&&doc.path!==state.root&&standaloneTex(doc))await selectRoot(doc.path);
      // An edit already queued for a previous tab must still be saved, without
      // replacing the selected project's cursor, revision or pending preview.
      if(doc.path!==state.active&&doc.path!==state.root&&state.documentRoots?.[doc.path]!==state.root){
        if(state.onSave)void saveAllAndBuild(false,true).catch(async error=>{await persist();setStatus(String(error));});else await persist();
        return true;
      }
      latestEditId=documentEditId;
      setStatus(state.onSave?'Saving edits and updating preview…':'Automatic saving and preview paused.');
      if(state.onSave){
        const immediate=!!controller;
        const local=immediate&&!state.previewEditing&&state.engine==='pdflatex'&&state.latexmk==='latexmk'&&typeof editId==='string'&&localPreview.request(doc.path,text,editId);
        tracePreview({event:'edit-route',editId,route:local?(localPreview.ready?'local-ready':'local-warming'):'full',cursor:state.lastCursor?.at,characters:text.length});
        clearTimeout(fullVerification);
        if(local)scheduleFullVerification(editId!);
        else if(immediate){if(latestEditId)scheduleFullVerification(latestEditId,0);else void build(undefined,true).catch(e=>setStatus(String(e)));}
        // Accept the editor revision immediately. Automatic disk saving remains
        // serialized and errors retain the draft, but does not block preview IPC.
        void saveAllAndBuild(false,immediate).catch(async error=>{await persist();setStatus(String(error));});
      }
      else await persist();
      return true;
    }
    case 'active': {
      const file=String(args[0]);if(state.docs.some(d=>d.path===file)){
        state.active=file;
        if(args[1]!==true){const root=activePreviewRoot();if(root&&root!==state.root)await selectRoot(root);}
        rememberDocumentRoot(file);
      }
      await persist();return state;
    }
    case 'save': return saveFile();
    case 'saveCopy': clearTimeout(fullVerification);localPreview.stop();return saveFile(true);
    case 'root': if(state.active.endsWith('.tex')){await selectRoot(state.active);return state;}throw new Error('Select a .tex file to set the root.');
    case 'build': {const root=activePreviewRoot();if(root&&root!==state.root)await selectRoot(root,false);await saveAllAndBuild(true);return true;}
    case 'live': state.onSave=!state.onSave;await persist();if(state.onSave)void saveAllAndBuild(true).catch(e=>setStatus(String(e)));else{clearTimeout(fullVerification);localPreview.stop();controller?.noteActivity('pause');setStatus('Automatic saving and preview paused.');}return state.onSave;
    case 'cancel': clearTimeout(fullVerification);localPreview.stop();controller?.cancel();return true;
    case 'settings': {
      const value=args[0] as Partial<State>;
      if(!['pdflatex','xelatex','lualatex','latex'].includes(String(value.engine))||typeof value.latexmk!=='string'||!value.latexmk.trim())throw new Error('Invalid toolchain settings.');
      const checked=await checkToolchain(typeof value.texBin==='string'?value.texBin:undefined,value.engine!,value.latexmk);
      clearTimeout(fullVerification);localPreview.stop();controller?.cancel();state.engine=value.engine!;state.latexmk=value.latexmk;state.texBin=checked.selected??value.texBin;state.toolchainSeen=true;state.onSave=!!value.onSave;activateToolchain(checked);acknowledgedToolchain=toolchainSignature(checked);await fs.mkdir(data(),{recursive:true});await fs.writeFile(path.join(data(),'toolchain-check.json'),JSON.stringify({acknowledged:acknowledgedToolchain}));await persist();/* A changed installation needs fresh capability caches and workers. */if(state.root&&checked.ready)void selectRoot(state.root).catch(e=>setStatus(String(e)));return {...state,toolchain:checked};
    }
    case 'ack': {
      const [id,error]=args;const pending=waiting.get(String(id));
      if(pending){clearTimeout(pending.timer);waiting.delete(String(id));error?pending.reject(new Error(String(error))):pending.resolve();}return true;
    }
    case 'export': {
      if(!controller)throw new Error('Open a document to export.');
      const owner=controller,root=state.root,before=displayed?.id;
      await sourceWrites;
      const sources=JSON.stringify(state.docs.map(doc=>[doc.path,doc.text]));
      localPreview.prepareFullVerification();await build(undefined,false);
      if(controller!==owner||state.root!==root||!displayed||displayed.id===before||owner.current?.id!==displayed.id||currentDiagnostic||displayed.sourceHash!==hash(state.docs.find(doc=>doc.path===root)?.text??'')||sources!==JSON.stringify(state.docs.map(doc=>[doc.path,doc.text])))throw Error('A current full PDF could not be verified. Resolve build errors or changed source, then export again.');
      const bundle=displayed,store=controller.store;
      const release=store.pin(bundle);
      try{
        const choice=await dialog.showSaveDialog(window,{defaultPath:path.basename(bundle.root,'.tex')+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
        if(!choice.canceled&&choice.filePath){await store.export(bundle,choice.filePath);setStatus('Exported the current verified full PDF.');}return true;
      }finally{release();}
    }
    case 'previous': {
      if(!controller)return false;clearTimeout(fullVerification);localPreview.stop();controller.cancel();
      const store=controller.store,history=await store.history(),previous=history.find(x=>x.id!==displayed?.id);
      if(!previous)throw new Error('No preceding successful preview is available.');
      await prepare(previous,store);displayed=previous;send({type:'commit',id:previous.id,...(previous.recovered?{timing:{recovered:true,backend:'Recovered preview — LaTeX errors need attention.',requestToCommitMs:0}}:{})});setStatus(previous.recovered?'Showing a preceding recovered preview with temporary LaTeX repairs.':'Showing the preceding successful preview.');return true;
    }
    case 'close': return closeWindow();
    default: throw new Error('Unknown command.');
  }
}
async function closeWindow() {
  clearTimeout(closeTimer);closeTimer=undefined;
  if(closing||closeInFlight)return false;
  closeInFlight=true;
  try{
    await sourceWrites.catch(()=>{});
    await persist();
    if(state.docs.some(d=>d.dirty)){
      const response=await dialog.showMessageBox(window,{type:'question',buttons:['Keep drafts and close','Cancel'],defaultId:0,cancelId:1,message:'Unsaved edits will be kept as recoverable drafts.',detail:'The original files will not be overwritten.'});
      if(response.response===1)return false;
    }
    await runBackup();controller?.cancel();closing=true;window.close();return true;
  }finally{closeInFlight=false;}
}
app.whenReady().then(async()=>{
  try{const saved=JSON.parse(await fs.readFile(path.join(data(),'session.json'),'utf8'));if(Array.isArray(saved.docs))state=saved;}catch{}
  state.previewMode=state.previewMode==='lecture'?'lecture':'document';
  // A clean restored buffer has no unsaved edits to protect. Refresh its disk
  // baseline now, rather than raising a conflict when the user next pastes.
  for(const doc of state.docs){
    if(doc.dirty)continue;
    try{
      const disk=await fs.readFile(doc.path);
      if(disk[0]===0xef&&disk[1]===0xbb)continue;
      const text=new TextDecoder('utf-8',{fatal:true}).decode(disk);
      doc.text=text.replace(/\r\n/g,'\n');doc.eol=text.includes('\r\n')?'\r\n':'\n';doc.diskHash=hash(disk);
    }catch{}
  }
  if(state.liveVersion!==2){state.onSave=true;state.liveVersion=2;}
  activateToolchain(await checkToolchain());
  try{acknowledgedToolchain=JSON.parse(await fs.readFile(path.join(data(),'toolchain-check.json'),'utf8')).acknowledged;}catch{}
  protocol.handle('texapp',request=>{
    const url=new URL(request.url);const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
    const base=path.join(app.getAppPath(),'media'),file=path.resolve(base,relative||'index.html');
    if(!file.startsWith(base+path.sep)||url.host!=='local')return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window=new BrowserWindow({autoHideMenuBar:false,width:1440,height:940,minWidth:900,minHeight:600,show:!process.env.PERSISTENT_TEX_TEST_HIDDEN,icon:themeIconPath(nativeTheme,path.join(__dirname,'../media')),title:`TeXquisite ${app.getVersion()} — local paragraph preview`,backgroundColor:'#f5f4f0',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  followIconTheme(window,nativeTheme,path.join(__dirname,'../media'));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('close',event=>{
    if(closing)return;
    event.preventDefault();
    if(closeTimer||closeInFlight)return;
    // Usually the renderer flushes its last edits first. If it has crashed or
    // stopped answering, the native close button still closes the application
    // after preserving every draft already received by the main process.
    closeTimer=setTimeout(()=>void closeWindow().catch(e=>setStatus(String(e))),2500);
    send({type:'close'});
  });
  window.on('closed',()=>{
    clearTimeout(closeTimer);clearTimeout(fullVerification);localPreview.stop();void controller?.dispose();
    for(const pending of localWaiting.values()){clearTimeout(pending.timer);pending.resolve(false);}localWaiting.clear();
    for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(new Error('Window closed.'));}
    waiting.clear();
  });
  ipcMain.handle('desktop',async(event,method,...args)=>{
    if(event.sender!==window.webContents||event.senderFrame?.url!=='texapp://local/index.html')throw new Error('Untrusted sender.');
    try{const result=await handle(method,args);if(['initialize','projectSidebar','automaticBackups','statusBar','zoom','panels','autoClose','follow','previewEditing','continuous','previewMode','live','settings'].includes(method))updateAppMenu();return result;}catch(error){if(!['projectSearch','searchLocation','applyProjectReplace','navigateSource','navigateDiagnostic','nativeNavigation','follow'].includes(method))setStatus(error instanceof Error?error.message:String(error));throw error;}
  });
  updateAppMenu();window.setAutoHideMenuBar(false);window.setMenuBarVisibility(true);
  await window.loadURL('texapp://local/index.html');
  const maintain=()=>{if(cleanupIdle()&&(cleanupRequested||Date.now()-lastCleanup>=900000))void cleanupCaches(cleanupRequested).then(result=>{if(!result.deferred){lastCleanup=Date.now();cleanupRequested=false;}const text=`Cache cleanup freed ${(result.freedBytes/1048576).toFixed(1)} MB; active projects and accepted previews retained.`;send({type:'cacheCleanup',text:result.deferred?'Cleanup deferred until typing and builds pause.':text});if(result.removed)appendLog(text+'\n');}).catch(error=>appendLog('Cache cleanup deferred: '+String(error)+'\n'));};
  const cleanupTimer=setInterval(maintain,15000);cleanupTimer.unref();window.once('closed',()=>clearInterval(cleanupTimer));
  const backupInterval=testData&&process.env.PERSISTENT_TEX_BACKUP_INTERVAL_MS?Math.max(100,Number(process.env.PERSISTENT_TEX_BACKUP_INTERVAL_MS)||300000):300000;
  const backupTimer=setInterval(()=>{void runBackup();},backupInterval);backupTimer.unref();window.once('closed',()=>clearInterval(backupTimer));
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',cancelNativeNavigation);
