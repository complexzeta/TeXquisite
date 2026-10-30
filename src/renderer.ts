import {decodeNavigation} from './navigation-codec';
import {matchLocalPatchRaster,LOCAL_INK_BLEED_BP} from './local-raster';
import {placementCorrection,GlyphLookup} from './local-raster';
import {mathSpans,isMath,nearestMathCaret,mathCaretBox,moveMath,moveMathAcross,changeMath,parseMath,MathFormula,MathSpan,MathAction} from './math-edit';
import {EditorView,basicSetup} from 'codemirror';
import {undo,redo,isolateHistory} from '@codemirror/commands';
import {proseSpans,nearestCaret,caretBox,textChange,ordinaryText,textBoundary,pageProse,visualMoveAcross,ProseLine,PdfCharacter} from './preview-edit';
import {EditorState,Transaction} from '@codemirror/state';
import {lintGutter,setDiagnostics,diagnosticCount} from '@codemirror/lint';
import {StreamLanguage} from '@codemirror/language';
import {stex} from '@codemirror/legacy-modes/mode/stex';
import {installToolbar,toolbarButton,toolbarSelect} from './toolbar';
import {ProjectSidebar} from './project-sidebar';
import {ProjectSearchUI} from './project-search-ui';
import {PanelLayout} from './panel-layout';
import {completeTex,texCompletion,surroundTex} from './tex-completion';
import {imageTex} from './image-paste';
import {loadPdf,renderCheckedPdfRegion,copyPdfRaster} from './pdf-viewer';
import {BaselineCache} from './baseline-cache';
import {ContinuousView} from './continuous-view';
import {RetainedNavigation,RetainedFrame} from './retained-navigation';
import {forwardPosition,backward,sourceLineHasOutput,previewFocusTarget,previewFocusPrefix,PreviewFocus,liveFlowPosition,LiveFlowFrame,unchangedPageLocations} from './navigation-query';
import type {BuildDiagnostic} from './diagnostics';
import {diagnosticAdvice} from './diagnostics';
import {recoveryLineBlocked,recoveryPointBlocked} from './recovery-navigation';
import type {Navigation,Region} from './navigation';
declare global {interface Window {desktop:{call:(method:string,...args:unknown[])=>Promise<any>;on:(callback:(message:any)=>void)=>void};}}
const api=window.desktop;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let model:any={docs:[]}, active='',view:EditorView|undefined;
const states=new Map<string,EditorState>();
installToolbar();
const panelLayout=new PanelLayout(el('workspace'),el('panelDivider'),el<HTMLSelectElement>('panelLayout'),value=>{model.panelLayout=value;toolbarSelect('panelLayout','panels','Panel layout: '+el<HTMLSelectElement>('panelLayout').selectedOptions[0]?.textContent);void api.call('panels',value).catch(report);},()=>view?.requestMeasure());
const lastSent=new Map<string,string>();
const editDetails=new Map<string,{id:string;startedAt:number;text:string;displayed?:boolean}>();
const localInputs=new Map<string,{file:string;text:string;startedAt:number;sequence:number;displayedLatencyMs?:number}>();
let displayedSequence=0;
let latestEdit:{id:string;startedAt:number;displayed?:boolean}|undefined,inputStartedAt=0,editSequence=0;
let applyingProjectReplace=false;
const editSession=Date.now().toString(36);
function markInput(){const stamp=inputStartedAt=performance.now();queueMicrotask(()=>{if(inputStartedAt===stamp)inputStartedAt=0;});}
let previewUpdating=false,previewKnownCurrent=false;
let localCanvas:HTMLCanvasElement|undefined,localStatus='',localRenderToken=0,localProofToken=0;
const localProofs=new Map<string,{canvas:HTMLCanvasElement;page:number;release:()=>void;retain:()=>{document:Promise<any>;release:()=>void}}>();
const baselineCache=new BaselineCache<any,{canvas:HTMLCanvasElement;pixels:Uint8ClampedArray}>(bytes=>loadPdf(bytes,true),frame=>frame.pixels.byteLength+frame.canvas.width*frame.canvas.height*4,frame=>{frame.canvas.width=frame.canvas.height=0;});
function acceptedBaseline(message:any){
  const zoom=scale,ratio=window.devicePixelRatio||1;
  return baselineCache.acquire(JSON.stringify([message.root,message.baseId,zoom,ratio]),message.basePdf,async(pdf:any,page:number)=>{if(current?.id===message.baseId&&current.page===page&&Number(current.canvas.dataset.renderScale)===zoom&&Number(current.canvas.dataset.renderRatio)===ratio){const copy=copyPdfRaster(current.canvas);if(copy)return copy;}return pdf.renderWithPixels(page,zoom,ratio);});
}
const localPageProofs=new Set<string>();
const localPageBaselines=new Map<string,ReturnType<ReturnType<typeof acceptedBaseline>['retain']>&{retain:ReturnType<typeof acceptedBaseline>['retain'];span:{first:number;last:number};continuation?:string}>();
const verifiedPageOutputs=new Set<string>();
let localDocument:{pdf:any;task:ReturnType<typeof loadPdf>;span:{first:number;last:number}}|undefined;
function releaseLocalDocument(){const doc=localDocument;localDocument=undefined;void doc?.task.destroy();}
type FlowLocation={at:number;end:number;x:number;y:number;width:number;height:number};
let livePages:(LiveFlowFrame&{pages:{page:number;canvas?:HTMLCanvasElement;locations:FlowLocation[];blocked?:{x:number;y:number;width:number;height:number}[]}[]})|undefined;
function currentLivePages(){
  const frame=livePages;
  return frame&&model.continuousPreview&&localCanvas&&view&&frame.root===model.root&&frame.file===active&&frame.text===view.state.doc.toString()&&frame.baseId===continuousView.id&&frame.pages.every(p=>!p.canvas||p.canvas.isConnected&&p.canvas.dataset.localSourceHash===frame.sourceHash&&p.canvas.dataset.localEditId===frame.editId)?frame:undefined;
}
let liveFlow:(LiveFlowFrame&{stateChanged?:boolean;baseTo:number;page:number;canvas:HTMLCanvasElement;locations:FlowLocation[];blocked?:{x:number;y:number;width:number;height:number}[]})|undefined;
const continuousBases=new Map<string,{id:string;navigation:Navigation;text?:string;texts?:Record<string,string>}>();
let continuousBasis:{id:string;navigation:Navigation;text?:string;texts?:Record<string,string>}|undefined;
let localPatch:{x:number;y:number;width:number;height:number;page:number}|undefined;
let neutralBaseId='';const neutralPages=new Map<number,HTMLCanvasElement>(),neutralIds=new Set<string>();
let retainedNavigation=new RetainedNavigation();
let retainedExperiment=false,canonicalRequested=false;
function retainedContext(canvas?:HTMLCanvasElement):RetainedFrame|undefined{const frame=retainedNavigation.frame;if(!frame||!view)return;return {root:model.root,file:active,baseId:continuousView.id,sourceHash:canvas?.dataset.localSourceHash??frame.sourceHash,editId:latestEdit?.id??'',text:view.state.doc.toString()};}
function clearNeutralMetadata(){for(const c of new Set([...neutralPages.values(),...continuousView.retainedCanvases()])){delete c.dataset.localSourceHash;delete c.dataset.localEditId;delete c.dataset.localLayout;delete c.dataset.neutralActive;}neutralPages.clear();neutralIds.clear();neutralBaseId='';retainedNavigation=new RetainedNavigation();}
function clearLocalProofs(){for(const proof of localProofs.values())proof.release();localProofs.clear();localPageProofs.clear();for(const held of localPageBaselines.values())held.release();localPageBaselines.clear();}
let compileIssue:BuildDiagnostic|undefined;
let projectProblems:BuildDiagnostic[]=[];
let sourceWarning='';
let logLength=0;
let suppressFollow=false,navigationToken=0,followFrame=0;
let previewApplying=false,previewMapToken=0;
let previewSession:{file:string;line:number;expected:string;from:number;to:number;map:ProseLine;anchor:number;head:number;box:{x:number;y:number;height:number};pending:boolean;lastEvent?:string;preferredX?:number;pdfGlyphs:PdfCharacter[];maps?:ProseLine[];mathMaps?:MathSpan[];math?:MathFormula;mathSlot?:string}|undefined;
const previewInput=el<HTMLTextAreaElement>('previewInput');
function updateMathTools(){el('mathTools').hidden=!model.previewEditing;for(const button of el('mathTools').querySelectorAll<HTMLButtonElement>('button'))button.disabled=!previewSession?.math;}
function endPreview(){previewSession=undefined;updateMathTools();previewMapToken++;el('pages').querySelectorAll('.preview-caret,.preview-selection').forEach(node=>node.remove());if(document.activeElement===previewInput)previewInput.blur();}
function drawPreviewCaret(){
  el('pages').querySelectorAll('.preview-caret,.preview-selection').forEach(node=>node.remove());const session=previewSession;if(!session)return;
  const marker=document.createElement('div');marker.className='preview-caret'+(session.pending?' pending':'');
  marker.style.cssText=`left:${session.box.x*scale}px;top:${session.box.y*scale}px;height:${session.box.height*scale}px`;el('pages').append(marker);
  if(!session.pending&&session.anchor!==session.head){const low=Math.min(session.anchor,session.head),high=Math.max(session.anchor,session.head),base=session.map.from-session.map.glyphs[0][2];
    for(const g of session.map.glyphs){const start=session.math?g[2]:base+g[2],length=g[9]??1,left=Math.max(low,start),right=Math.min(high,start+length);if(right<=left)continue;const span=document.createElement('div');span.className='preview-selection';span.style.cssText=`left:${(g[4]+g[6]*(left-start)/length)*scale}px;top:${g[5]*scale}px;width:${g[6]*(right-left)/length*scale}px;height:${g[7]*scale}px`;el('pages').append(span);}
  }
}
async function refreshPreviewCaret(){
  const session=previewSession,candidate=current,token=++previewMapToken;if(!session||!candidate?.navigation)return;
  if(session.file!==active||view?.state.doc.toString()!==session.expected){endPreview();return;}
  if(!await matchesSource(candidate.navigation,session.file,session.expected)){if(previewSession===session&&current===candidate){session.pending=true;drawPreviewCaret();}return;}
  const glyphs=await candidate.pdf.glyphs(candidate.page);
  if(token!==previewMapToken||previewSession!==session||current!==candidate||view?.state.doc.toString()!==session.expected)return;
  const mapped=session.math?mathSpans(candidate.navigation,session.file,session.line,candidate.page,session.expected,glyphs).find(span=>session.math?.block?span.formula.block?.from===session.math.block.from&&span.formula.block.row===session.math.block.row&&span.formula.block.column===session.math.block.column:span.from===session.from):proseSpans(candidate.navigation,session.file,session.line,candidate.page,session.expected,glyphs).find(span=>session.head>=span.from&&session.head<=span.to&&span.from<=session.from);
  if(session.math&&(!mapped||!isMath(mapped)||!mapped.carets.some(c=>c.at===session.head&&c.slot===session.mathSlot))&&!session.math.leaves.length){session.pending=true;drawPreviewCaret();el('navState').textContent='Empty math · type a symbol or press Esc for source';return;}
  if(!mapped){endPreview();view?.focus();el('navState').textContent='Use the source editor for this text, or click another text span.';return;}
  session.pdfGlyphs=glyphs;session.maps=undefined;session.mathMaps=undefined;session.map=mapped;if(isMath(mapped))session.math=mapped.formula;session.from=mapped.from;session.to=mapped.to;session.box=isMath(mapped)?mathCaretBox(mapped,session.head,session.mathSlot):caretBox(mapped,session.head);session.pending=false;drawPreviewCaret();el('navState').textContent=session.math?'Editing math · Tab moves between parts and cells · Esc returns to source':'Editing plain text · Esc returns to source';
}
function previewChange(input:string,back=false,forward=false,action?:MathAction){
  const session=previewSession;if(!session||!view||session.file!==active||view.state.doc.toString()!==session.expected){endPreview();return;}
  const change=session.math?changeMath(session.expected,session.math,session.mathSlot??'root',session.anchor,session.head,input,back,forward,action):textChange(session.expected,session,session.anchor,session.head,input,back,forward);
  if(!change){el('navState').textContent=session.math?'Use the math buttons or paste supported math; Esc opens the source editor.':'Use the source editor for TeX commands, math, new paragraphs or special characters.';return;}
  if(change.from===change.to&&!change.insert)return;
  const kind=action||session.math&&(input==='^'||input==='_')?'input.math.structure':back?'delete.backward':forward?'delete.forward':'input.type';
  inputStartedAt=performance.now();previewApplying=suppressFollow=true;
  try{view.dispatch({changes:{from:change.from,to:change.to,insert:change.insert},selection:{anchor:'anchor' in change?change.anchor as number:change.head,head:change.head},annotations:[Transaction.userEvent.of(kind),...(session.lastEvent!==kind?[isolateHistory.of('before')]:[])]});}
  finally{previewApplying=suppressFollow=false;}
  session.preferredX=undefined;session.lastEvent=kind;session.expected=view.state.doc.toString();session.to=change.end;session.anchor='anchor' in change?change.anchor as number:change.head;session.head=change.head;if('formula' in change&&'slot' in change){session.math=change.formula as MathFormula;session.mathSlot=change.slot as string;}session.pending=true;previewMapToken++;drawPreviewCaret();previewInput.value='';
  el('navState').textContent='Editing source from the preview · waiting for typesetting';
}
previewInput.addEventListener('blur',()=>endPreview());
previewInput.addEventListener('beforeinput',event=>{
  event.preventDefault();const input=event as InputEvent;
  if(input.isComposing){el('navState').textContent='Use the source editor for composition input.';return;}
  if(input.inputType==='insertText'&&input.data)previewChange(input.data);
  else if(input.inputType==='deleteContentBackward')previewChange('',true);
  else if(input.inputType==='deleteContentForward')previewChange('',false,true);
});
previewInput.addEventListener('paste',event=>{if(imagePasteEvent(event))return;event.preventDefault();previewChange(event.clipboardData?.getData('text/plain')??'');});
previewInput.addEventListener('copy',event=>{const s=previewSession;if(!s||s.anchor===s.head)return;event.preventDefault();event.clipboardData?.setData('text/plain',s.expected.slice(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)));});
previewInput.addEventListener('cut',event=>{const s=previewSession;if(!s||s.anchor===s.head)return;event.preventDefault();event.clipboardData?.setData('text/plain',s.expected.slice(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)));if(s.anchor!==s.head)previewChange('');});
previewInput.addEventListener('keydown',event=>{
  const s=previewSession;if(!s||!view)return;
  if(event.key==='Escape'){event.preventDefault();endPreview();view.focus();return;}
  if(event.key==='Enter'){event.preventDefault();el('navState').textContent='Use the source editor to add a paragraph or TeX structure.';return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();const editor=view;endPreview();(event.shiftKey?redo:undo)(editor);editor.focus();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();const editor=view;endPreview();redo(editor);editor.focus();return;}
  if(s.math){
    const action:MathAction|undefined=(event.ctrlKey||event.metaKey)?event.key==='/'?'frac':event.key.toLowerCase()==='r'?'sqrt':undefined:undefined;
    if(action){event.preventDefault();previewChange('',false,false,action);return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Tab'].includes(event.key)){
      event.preventDefault();if(s.pending){
        if(event.key==='Tab'){const slots=s.math.slots.filter(slot=>slot.id!=='root');if(!slots.length)return;const index=slots.findIndex(slot=>slot.id===s.mathSlot),next=slots[(index+(event.shiftKey?-1:1)+slots.length)%slots.length];s.mathSlot=next.id;s.anchor=s.head=next.from;s.lastEvent=undefined;previewApplying=suppressFollow=true;try{view.dispatch({selection:{anchor:s.head}});}finally{previewApplying=suppressFollow=false;}drawPreviewCaret();return;}
        el('navState').textContent='Waiting for math typesetting · Esc returns to source';return;
      }
      const maps=s.mathMaps??(s.mathMaps=s.math.block?mathSpans(current!.navigation!,s.file,undefined,s.map.page,s.expected,s.pdfGlyphs,s.math.block.from):[s.map as MathSpan]);
      const move=moveMathAcross(maps,s.map as MathSpan,s.head,s.mathSlot??'root',event.key,event.shiftKey&&event.key==='Tab');if(!move)return;
      if(event.shiftKey&&event.key!=='Tab'&&move.span.from!==s.from){el('navState').textContent='Use the source editor to select across equation cells.';return;}
      const target=move.caret;s.lastEvent=undefined;s.map=move.span;s.math=move.span.formula;s.from=move.span.from;s.to=move.span.to;s.line=move.span.line;s.head=target.at;s.mathSlot=target.slot;s.box=target.box;if(!event.shiftKey||event.key==='Tab')s.anchor=s.head;
      previewApplying=suppressFollow=true;try{view.dispatch({selection:{anchor:s.anchor,head:s.head}});}finally{previewApplying=suppressFollow=false;}drawPreviewCaret();return;
    }
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();s.anchor=s.from;s.head=s.to;if(s.math)s.mathSlot='root';if(!s.pending)s.box=s.math?mathCaretBox(s.map as MathSpan,s.head,s.mathSlot):caretBox(s.map,s.head);s.preferredX=undefined;}
  else if(['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();
    if(['Home','End','ArrowUp','ArrowDown'].includes(event.key)){
      if(s.pending){el('navState').textContent='Waiting for typesetting before moving between display lines.';return;}
      const maps=s.maps??(s.maps=pageProse(current!.navigation!,s.file,s.map.page,s.expected,s.pdfGlyphs));
      const move=visualMoveAcross(maps,s.map,s.head,event.key,s.preferredX,s.box);if(!move)return;
      if(event.shiftKey&&(move.span.from!==s.from||move.span.to!==s.to)){el('navState').textContent='Use the source editor to select across text spans or TeX structure.';return;}
      s.map=move.span;s.line=move.span.line;s.from=move.span.from;s.to=move.span.to;
      s.head=move.head;s.box=move.box;s.preferredX=move.x;
    }else{
      s.head=Math.max(s.from,Math.min(s.to,textBoundary(s.expected,s.head,event.key==='ArrowLeft'?-1:1)));s.preferredX=undefined;
      if(!s.pending)s.box=caretBox(s.map,s.head);
    }
    if(!event.shiftKey)s.anchor=s.head;
  }else if(event.key==='Backspace'||event.key==='Delete'){event.preventDefault();previewChange('',event.key==='Backspace',event.key==='Delete');return;}
  else return;
  previewApplying=suppressFollow=true;try{view.dispatch({selection:{anchor:s.anchor,head:s.head}});}finally{previewApplying=suppressFollow=false;}
  drawPreviewCaret();
});
for(const button of el('mathTools').querySelectorAll<HTMLButtonElement>('button')){
 button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{if(previewSession?.math){previewChange('',false,false,button.dataset.math as MathAction);previewInput.focus({preventScroll:true});}});
}
function refreshPreviewStatus(){
  if(localCanvas?.dataset.localRecovered==='true'&&localCanvas.dataset.localEditId===latestEdit?.id){el('previewState').textContent='Recovered local preview · details in Problems';el('status').textContent=localStatus+' Temporary preview repair; saved source is unchanged.'+sourceWarning;previewUpdating=false;return;}
  if(current?.timing?.recovered&&current.timing.editId===latestEdit?.id){el('previewState').textContent='Recovered preview · LaTeX errors need attention';el('status').textContent=current.displayStatus+sourceWarning;previewUpdating=false;return;}
  if(localCanvas?.dataset.localLayout==='flow'&&localCanvas.dataset.localEditId===latestEdit?.id&&current?.timing?.editId===latestEdit?.id){el('previewState').textContent='Continuous scroll · paginated PDF verified';el('status').textContent=localStatus.replace('Paginated PDF verification pending.','Paginated PDF verified.')+sourceWarning;previewUpdating=false;return;}
  if(localCanvas){const newer=localCanvas.dataset.localEditId!==latestEdit?.id,lecture=model.previewMode==='lecture';el('previewState').textContent=(lecture?'Lecture preview · ':'Local paragraph preview · ')+(newer?'newer edits pending':lecture?'full PDF updates on Build or Export':'full document verification pending');el('status').textContent=(lecture?localStatus.replace(/(?:Paginated PDF|Full document) verification pending\./g,'Full PDF updates on Build or Export.'):localStatus)+(newer?' Newer edits pending.':'')+sourceWarning;return;}
  const pending=!previewKnownCurrent||!!latestEdit&&current?.timing?.editId!==latestEdit.id;
  if(pending||!current?.displayReady){
    const elapsed=latestEdit?` (${Math.ceil(performance.now()-latestEdit.startedAt)} ms since latest edit)`:'';
    el('previewState').textContent=(model.onSave?'Preview behind source':'Preview paused — source changed')+elapsed;
    if(previewUpdating)el('status').textContent='Updating preview'+elapsed+'…'+sourceWarning;
  }else{
    el('previewState').textContent=model.continuousPreview?(el('previewState').dataset.localState==='warming'?'PDF ready · preparing continuous editing…':el('previewState').dataset.localState==='ready'?'Continuous scroll ready':'Continuous view · PDF ready'):'Preview up to date';
    if(previewUpdating)el('status').textContent=current.displayStatus+sourceWarning;
    previewUpdating=false;
  }
}
setInterval(()=>{if(previewUpdating)refreshPreviewStatus();},100);
let editScheduled=false;
let editChain=Promise.resolve();
let problemRenderKey='';
function renderProblems(){
 const key=JSON.stringify([projectProblems.map(i=>i.id),projectProblems.some(i=>i.editId!==latestEdit?.id),el<HTMLSelectElement>('problemFilter').value]);if(key===problemRenderKey)return;problemRenderKey=key;
 const issues=projectProblems,errors=issues.filter(i=>i.severity!=='warning').length,warnings=issues.length-errors;
 const summary=`${errors} error${errors===1?'':'s'} · ${warnings} warning${warnings===1?'':'s'}`;
 el('problemSummary').textContent=summary;
 const toggle=el<HTMLButtonElement>('toggleProblems');toggle.title='Project problems: '+summary;toggle.setAttribute('aria-label',toggle.title);toggle.dataset.count=issues.length?String(issues.length):'';toggle.classList.toggle('has-problems',!!issues.length);
 const stale=issues.some(i=>i.editId!==latestEdit?.id);el('problemState').textContent=stale?'Source changed · waiting for preview':issues.some(i=>i.id.startsWith('local-recovery-'))?'Current local preview':issues.length?'Latest full build':'No problems reported by the latest full build';
 const list=el('problemList');list.replaceChildren();const filter=el<HTMLSelectElement>('problemFilter').value;
 for(const issue of issues.filter(i=>filter==='all'||(i.severity??'error')===filter)){
  const row=document.createElement('div');row.className='problem-row';row.setAttribute('role','listitem');row.dataset.severity=issue.severity??'error';
  const label=document.createElement('strong');label.textContent=issue.severity==='warning'?'Warning':'Error';
  const message=document.createElement('span');message.textContent=issue.message;
  const copy=document.createElement('div');copy.className='problem-copy';copy.append(message);const advice=diagnosticAdvice(issue.message);if(advice){const hint=document.createElement('span');hint.className='problem-advice';hint.textContent=advice;copy.append(hint);}row.append(label,copy);
  if(issue.file&&issue.line){const link=document.createElement('button');link.textContent=issue.file.split(/[\\/]/).at(-1)+' · line '+issue.line;link.title=issue.file;link.disabled=issue.editId!==latestEdit?.id;link.onclick=()=>void command(()=>navigateProblem(issue));row.append(link);}
  list.append(row);
 }
 if(!list.childElementCount){const empty=document.createElement('p');empty.textContent=issues.length?'No problems match this filter.':'No problems reported.';list.append(empty);}
}
el('problemFilter').onchange=renderProblems;
el('toggleProblems').onclick=()=>{const panel=el<HTMLDetailsElement>('problems');panel.open=!panel.open;el('toggleProblems').setAttribute('aria-expanded',String(panel.open));};
el('problems').ontoggle=()=>el('toggleProblems').setAttribute('aria-expanded',String(el<HTMLDetailsElement>('problems').open));
let markerGeneration=0,markerKey='';
function syncErrorMarker(){
  const generation=++markerGeneration,editor=view,file=active,issue=compileIssue;
  // A lint transaction cannot run inside CodeMirror's document update listener.
  queueMicrotask(async()=>{
    if(generation!==markerGeneration||!editor||editor!==view||file!==active)return;
    const valid=issue&&issue.editId===latestEdit?.id&&issue.file===file&&issue.line&&issue.sourceHash;
    if(!valid){markerKey='';if(diagnosticCount(editor.state))editor.dispatch(setDiagnostics(editor.state,[]));return;}
    const text=editor.state.doc.toString(),key=issue.id+'|'+file+'|'+issue.sourceHash;
    if(markerKey===key&&diagnosticCount(editor.state))return;
    const bytes=new TextEncoder().encode(text.replace(/\r\n/g,'\n'));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(generation!==markerGeneration||editor!==view||file!==active||compileIssue!==issue||issue.editId!==latestEdit?.id||editor.state.doc.toString()!==text)return;
    markerKey=key;
    if(hash!==issue.sourceHash||issue.line!>editor.state.doc.lines){editor.dispatch(setDiagnostics(editor.state,[]));return;}
    const line=editor.state.doc.line(issue.line!),hint=diagnosticAdvice(issue.message);
    editor.dispatch(setDiagnostics(editor.state,[{from:line.from,to:line.to,severity:'error',message:issue.message+(hint?'\n'+hint:'')} ]));
  });
}
function renderIssue(){
  renderProblems();
  syncErrorMarker();
  // Automatic diagnostics stay in the stable Problems badge/list and gutter.
  // Opening/closing a top banner resized CodeMirror on every error revision.
  renderRecoveryNotice();const panel=el('diagnostics');panel.hidden=true;if(!compileIssue)return;
  const stale=compileIssue.editId!==latestEdit?.id;
  el('diagnosticMessage').textContent=compileIssue.message;
  el('diagnosticHint').textContent=diagnosticAdvice(compileIssue.message)??'';
  el('diagnosticState').textContent=stale?(model.onSave&&previewUpdating?'Checking newer edits…':'Source changed since this error'):(current?'Last good preview retained':'No successful preview yet');
  const link=el<HTMLButtonElement>('diagnosticLocation');
  link.hidden=!compileIssue.file||!compileIssue.line;link.disabled=stale;
  link.textContent=compileIssue.file?`${compileIssue.file.split(/[\\/]/).at(-1)} · line ${compileIssue.line}`:'';
  link.title=compileIssue.file??'';
  panel.dataset.kind=compileIssue.kind;
}
function renderRecoveryNotice(reason?:string){
 const issue=compileIssue?.root===model.root?compileIssue:projectProblems.find(i=>i.root===model.root&&i.severity!=='warning'),recovered=current?.timing?.recovered||localCanvas?.dataset.localRecovered==='true',notice=el('previewNotice');
 notice.hidden=!issue&&!recovered&&!reason;if(notice.hidden)return;
 const stale=!!issue&&issue.editId!==latestEdit?.id,where=issue?.file&&issue.line?` (${issue.file.split(/[\\/]/).at(-1)}, line ${issue.line})`:'';
 el('previewNoticeTitle').textContent=stale?'Checking newer edits':issue?issue.message+where:recovered?'Temporary preview':'Navigation needs attention';
 el('previewNoticeText').textContent=reason??(stale?(model.onSave?'This error belongs to an earlier edit. Rechecking after typing pauses.':'This error belongs to an earlier edit. Automatic checking is paused; choose Retry preview.'):issue?(diagnosticAdvice(issue.message)??'Open Details to inspect the build log, then Retry preview.')+(recovered?' Navigation is limited to unchanged mapped text. Direct PDF editing resumes after the error is fixed.':' The previous preview is retained.'): 'This preview contains temporary repairs. Retry preview to check the current source.');
 const go=el<HTMLButtonElement>('previewNoticeError');go.hidden=!issue?.file||!issue.line;go.disabled=stale;
}
function explainNavigation(reason:string){el('navState').textContent=reason;renderRecoveryNotice(reason);}
el('previewNoticeError').onclick=()=>{const issue=compileIssue??projectProblems.find(i=>i.severity!=='warning');if(issue)void command(()=>navigateProblem(issue));};
el('previewNoticeDetails').onclick=()=>{if(projectProblems.length){el<HTMLDetailsElement>('problems').open=true;el<HTMLSelectElement>('problemFilter').value='all';renderProblems();}else el<HTMLDetailsElement>('logs').open=true;};
el('previewNoticeRetry').onclick=()=>void command(async()=>{const button=el<HTMLButtonElement>('previewNoticeRetry');button.disabled=true;try{await flush();canonicalRequested=true;await api.call('retryPreview');}finally{button.disabled=false;}});
el('diagnosticLog').onclick=()=>{el<HTMLDetailsElement>('logs').open=true;el('logs').querySelector('summary')!.focus();};
el('diagnosticLocation').onclick=()=>{if(compileIssue)void command(()=>navigateProblem(compileIssue!));};
async function navigateProblem(issue:BuildDiagnostic){
  if(issue.editId!==latestEdit?.id)return;
  const priorFile=active,priorText=view?.state.doc.toString(),token=++navigationToken;
  await flush();const result=await api.call('navigateDiagnostic',issue.id);
  if((compileIssue!==issue&&!projectProblems.includes(issue))||token!==navigationToken||active!==priorFile||view?.state.doc.toString()!==priorText)return;
  const follow=model.followPreview;model=result.state;model.followPreview=follow;renderEditor();void api.call('active',active,true).catch(report);
  if(view){const position=view.state.doc.line(Math.min(result.line,view.state.doc.lines)).from;suppressFollow=true;try{view.dispatch({selection:{anchor:position},effects:EditorView.scrollIntoView(position,{y:'center'})});}finally{suppressFollow=false;}view.focus();}
}
const report=(e:unknown)=>{el('status').textContent=String(e).replace(/^Error: Error invoking remote method 'desktop': (?:Error: )?/,'').replace(/^Error: /,'');};
async function flush() {
  if(!view||!active)return;
  const file=active,text=view.state.doc.toString();
  if(lastSent.get(file)===text)return editChain;
  const edit=editDetails.get(file);
  const head=view.state.selection.main.head;
  editChain=editChain.catch(()=>{}).then(()=>api.call('edit',file,text,edit?.text===text?edit.id:undefined,head));
  await editChain;
  lastSent.set(file,text);
}
const surroundBox=document.createElement('form');surroundBox.id='surroundBox';surroundBox.hidden=true;surroundBox.setAttribute('role','dialog');surroundBox.setAttribute('aria-label','Surround selection');
surroundBox.innerHTML='<label for="surroundDelimiter">Surround selection</label><input id="surroundDelimiter" aria-describedby="surroundHint" spellcheck="false" autocomplete="off"><span id="surroundHint">Type a delimiter, such as \\{ or \\langle. Esc cancels.</span>';
document.body.append(surroundBox);
const surroundInput=surroundBox.querySelector('input')!;
let surroundSession:{editor:EditorView;file:string;state:EditorState}|undefined;
function cancelSurround(focus=false){const session=surroundSession;surroundSession=undefined;surroundBox.hidden=true;if(focus&&session&&view===session.editor&&active===session.file)session.editor.focus();}
function acceptSurround(){
 const session=surroundSession;if(!session)return;
 if(view!==session.editor||active!==session.file||!session.editor.state.doc.eq(session.state.doc)||!session.editor.state.selection.eq(session.state.selection)){cancelSurround();return;}
 const transaction=surroundTex(session.editor.state,surroundInput.value,model.autoClose!==false);
 if(!transaction)return false;
 cancelSurround();inputStartedAt=performance.now();session.editor.dispatch({...transaction,annotations:[Transaction.userEvent.of('input.type'),isolateHistory.of('full')]});session.editor.focus();return true;
}
function showSurround(editor:EditorView){
 cancelSurround();surroundSession={editor,file:active,state:editor.state};surroundInput.value='\\';
 el('surroundHint').textContent='Type a delimiter, such as \\{ or \\langle. Esc cancels.';
 const box=editor.coordsAtPos(editor.state.selection.main.head);surroundBox.style.left=Math.max(8,Math.min(window.innerWidth-340,box?.left??40))+'px';surroundBox.style.top=Math.max(8,Math.min(window.innerHeight-120,(box?.bottom??60)+6))+'px';surroundBox.hidden=false;surroundInput.focus();surroundInput.setSelectionRange(1,1);
}
surroundInput.addEventListener('input',()=>{if(!acceptSurround()&&surroundSession)el('surroundHint').textContent='Correct the delimiter here; your selection is unchanged. Esc cancels.';});
surroundBox.addEventListener('submit',event=>{event.preventDefault();if(!acceptSurround())el('surroundHint').textContent='Unknown delimiter. Correct it or press Esc to cancel.';});
surroundInput.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancelSurround(true);}});
surroundInput.addEventListener('blur',()=>{if(surroundSession)cancelSurround();});
function createState(text:string){return EditorState.create({doc:text,extensions:[basicSetup,lintGutter(),StreamLanguage.define(stex),texCompletion(()=>model.autoClose!==false),EditorView.lineWrapping,
  EditorView.domEventHandlers({beforeinput(event,editor){
    markInput();
    const input=event as InputEvent;
    // Ordinary characters can enter the editor state synchronously. Let the
    // editor's native path handle IME, composition, paste and replacement input.
    if(!event.cancelable||input.inputType!=='insertText'||input.isComposing||editor.composing||!input.data)return false;
    event.preventDefault();
    if(input.data==='\\'&&model.autoClose!==false&&!editor.state.selection.main.empty&&editor.state.selection.ranges.length===1){showSurround(editor);return true;}
    editor.dispatch({...completeTex(editor.state,input.data,model.autoClose!==false),annotations:Transaction.userEvent.of('input.type'),scrollIntoView:true});
    return true;
  },pointerup(){if(model.continuousPreview&&!suppressFollow){cancelAnimationFrame(followFrame);followFrame=requestAnimationFrame(()=>void locateSource(true).catch(e=>{el('navState').textContent=String(e);}));}return false;},paste(event){if(imagePasteEvent(event))return true;markInput();return false;},cut(){markInput();return false;}}),EditorView.updateListener.of(update=>{
  if(applyingProjectReplace)return;
  if(update.docChanged||update.selectionSet){if(surroundSession)cancelSurround();navigationToken++;if(!previewApplying&&previewSession)endPreview();}
  if(update.docChanged){
    el('pages').querySelectorAll('.navigation-marker').forEach(marker=>marker.remove());
    const edit={id:editSession+'-'+(++editSequence),startedAt:inputStartedAt||performance.now(),text:update.state.doc.toString()};inputStartedAt=0;
    localInputs.set(edit.id,{file:active,text:edit.text,startedAt:edit.startedAt,sequence:editSequence});if(localInputs.size>128)localInputs.delete(localInputs.keys().next().value!);
    editDetails.set(active,edit);latestEdit=edit;previewKnownCurrent=false;
    previewUpdating=!!model.onSave;renderIssue();
    refreshPreviewStatus();
    const doc=model.docs.find((d:any)=>d.path===active);if(doc){doc.text=update.state.doc.toString();doc.dirty=true;renderTabs();}
    if(!editScheduled){editScheduled=true;queueMicrotask(()=>{editScheduled=false;void flush().catch(report);});}
  }
  if(update.selectionSet&&!update.docChanged&&model.followPreview&&!suppressFollow){cancelAnimationFrame(followFrame);followFrame=requestAnimationFrame(()=>void locateSource(false).catch(e=>{el('navState').textContent=String(e);}));}
  if(update.selectionSet&&!update.docChanged)void api.call('localCursor',active,update.state.selection.main.head).catch(()=>{});
})]});}
new ProjectSearchUI((method,...args)=>api.call(method,...args),async()=>{try{await flush();}catch(e){report(e);}},result=>{
 model=result.state;renderEditor();if(view&&view.state.doc.toString()===result.text){view.dispatch({selection:{anchor:result.from,head:result.to},effects:EditorView.scrollIntoView(result.from,{y:'center'})});view.focus();}
},result=>{
 const startedAt=performance.now();if(view&&active)states.set(active,view.state);applyingProjectReplace=true;
 try{for(const change of result.changes){const prior=states.get(change.file),before=prior&&prior.doc.toString()===change.before?prior:createState(change.before),updated=before.update({changes:change.edits,annotations:[Transaction.userEvent.of('input.replace'),isolateHistory.of('full')]}).state;states.set(change.file,updated);if(change.file===active&&view)view.setState(updated);lastSent.set(change.file,change.after);editDetails.set(change.file,{id:result.editId,text:change.after,startedAt});}
 model=result.state;latestEdit={id:result.editId,startedAt};renderEditor();}finally{applyingProjectReplace=false;}
});
let projectOpenToken=0,projectOpenChain:Promise<unknown>=Promise.resolve();
const projectSidebar=new ProjectSidebar((method,...args)=>api.call(method,...args),file=>{const token=++projectOpenToken,root=model.root;projectOpenChain=projectOpenChain.catch(()=>{}).then(()=>command(async()=>{if(token!==projectOpenToken||model.root!==root)return;try{await flush();}catch(e){report(e);}const next=await api.call("projectOpen",file);if(token!==projectOpenToken||model.root!==root)return;model=next;renderEditor();}));}, (file,text,at)=>{if(active!==file||view?.state.doc.toString()!==text)return;if(view){view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:"center"})});view.focus();}});
el("toggleProject").onclick=()=>void command(async()=>{model.projectSidebar=await api.call("projectSidebar",!model.projectSidebar);projectSidebar.update(model);view?.requestMeasure();});
let tabActivationChain:Promise<unknown>=Promise.resolve(),tabActivationToken=0;
function activateDocumentTab(file:string){
 const token=++tabActivationToken;
 tabActivationChain=tabActivationChain.catch(()=>{}).then(async()=>{
  if(token!==tabActivationToken)return;
  try{await flush();}catch(error){report(error);}
  if(token!==tabActivationToken)return;
  const next=await api.call('active',file);
  if(token!==tabActivationToken)return;
  model=next;renderEditor();
  if(view)void api.call('localCursor',active,view.state.selection.main.head).catch(report);
 });
 void tabActivationChain.catch(report);
}
function renderTabs(){
  projectSidebar.update(model);
  el<HTMLSelectElement>('previewMode').value=model.previewMode==='lecture'?'lecture':'document';
  document.body.dataset.previewMode=model.previewMode==='lecture'?'lecture':'document';
  toolbarSelect('previewMode',model.previewMode==='lecture'?'lecture':'pages',model.previewMode==='lecture'?'Lecture mode: flowing blocks across page boundaries; full PDF updates on Build or Export. Continuous scroll is recommended.':'Document mode: verify the full document after typing pauses.');
  toolbarButton('autoClose','braces',model.autoClose!==false?'Match pairs: on. Match delimiters, wrap selections and synchronize environment names':'Match pairs: off. Enable delimiter matching and linked environment names');el('autoClose').setAttribute('aria-pressed',String(model.autoClose!==false));
  updateMathTools();
  toolbarButton('editPreview','edit',model.previewEditing?'Edit preview: on':'Edit verified text and math in preview');el('editPreview').setAttribute('aria-pressed',String(!!model.previewEditing));
  el<HTMLSelectElement>('layoutMode').value=model.continuousPreview?'continuous':'paged';
  el('prevPage').hidden=el('nextPage').hidden=!!model.continuousPreview;
  el<HTMLButtonElement>('editPreview').disabled=!!model.continuousPreview;
  el('editPreview').title=model.continuousPreview?'Switch to Paged PDF to edit the verified preview':'Edit verified text and supported math';
  toolbarButton('follow','follow',model.followPreview?'Follow typing: on. Keep source cursor visible in PDF':'Follow typing: off. Keep source cursor visible in PDF');el('follow').setAttribute('aria-pressed',String(!!model.followPreview));
  toolbarButton('live',model.onSave?'pause':'live',model.onSave?'Live: on. Pause automatic saving and preview':'Live: off. Resume automatic saving and preview');el('live').setAttribute('aria-pressed',String(!!model.onSave));
  const statusVisible=model.statusBar!==false;el('statusBar').hidden=!statusVisible;document.body.dataset.statusBar=statusVisible?'visible':'hidden';toolbarButton('toggleStatus','status',statusVisible?'Hide status bar':'Show status bar');el('toggleStatus').setAttribute('aria-pressed',String(statusVisible));
  toolbarSelect('panelLayout','panels','Panel layout: '+el<HTMLSelectElement>('panelLayout').selectedOptions[0]?.textContent);toolbarSelect('layoutMode','pages',model.continuousPreview?'Preview layout: Continuous scroll':'Preview layout: Paged PDF');
  el('tabs').replaceChildren();
  for(const doc of model.docs){const button=document.createElement('button');button.textContent=doc.path.split(/[\\/]/).at(-1)+(doc.dirty?' •':'');button.title=doc.path;button.className=doc.path===active?'active':'';button.onclick=()=>activateDocumentTab(doc.path);el('tabs').append(button);}
  el('rootLabel').textContent=model.root?'Root: '+model.root:'No root selected';
}
function renderEditor(){
  cancelSurround();endPreview();
  const next=model.active;
  if(view&&active)states.set(active,view.state);
  const doc=model.docs.find((d:any)=>d.path===next);
  if(doc){
    if(!lastSent.has(doc.path))lastSent.set(doc.path,doc.text);
    active=next;const cached=states.get(active);let state=cached&&cached.doc.toString()===doc.text?cached:createState(doc.text);
    const restored=!cached&&model.lastCursor?.file===active&&Number.isSafeInteger(model.lastCursor.at)?Math.max(0,Math.min(doc.text.length,model.lastCursor.at)):undefined;
    if(restored!==undefined)state=state.update({selection:{anchor:restored}}).state;
    if(view)view.setState(state);else view=new EditorView({state,parent:el('editor')});
    if(restored!==undefined)view.dispatch({effects:EditorView.scrollIntoView(restored,{y:'center'})});
    el('welcome').hidden=true;
  }
  renderTabs();renderIssue();
}
async function command(action:()=>Promise<unknown>){try{await action();}catch(e){report(e);}}
let backupSnapshots:import('./backups').BackupSummary[]=[];
function renderBackupFiles(){
  const snapshot=backupSnapshots.find(s=>s.id===el<HTMLSelectElement>('backupSnapshots').value),select=el<HTMLSelectElement>('backupFiles');select.replaceChildren();
  snapshot?.files.forEach((file,index)=>select.add(new Option(file.path.split(/[\\/]/).at(-1)+(file.dirty?' (draft)':''),String(index))));renderBackupOriginal();
}
function renderBackupOriginal(){const snapshot=backupSnapshots.find(s=>s.id===el<HTMLSelectElement>('backupSnapshots').value);el('backupOriginal').textContent=snapshot?.files[Number(el<HTMLSelectElement>('backupFiles').value)]?.path??'';el<HTMLButtonElement>('restoreBackup').disabled=!snapshot;}
async function refreshBackups(){
  const result=await api.call('listBackups'),select=el<HTMLSelectElement>('backupSnapshots'),prior=select.value;backupSnapshots=result.snapshots;select.replaceChildren();
  for(const snapshot of backupSnapshots)select.add(new Option(new Date(snapshot.created).toLocaleString()+' — '+snapshot.root.split(/[\\/]/).at(-1),snapshot.id));
  if(backupSnapshots.some(s=>s.id===prior))select.value=prior;
  el<HTMLInputElement>('automaticBackups').checked=result.enabled;model.backups=result.enabled;el('backupStatus').textContent=backupSnapshots.length?result.text:'No backups yet. Open a source file or choose Back up now.';renderBackupFiles();
}
async function showBackups(){try{await flush();}catch{}await refreshBackups();if(!el<HTMLDialogElement>('backupsDialog').open)el<HTMLDialogElement>('backupsDialog').showModal();}
async function backupNow(){try{await flush();}catch{}await api.call('backupNow');await refreshBackups();}
el('backupSnapshots').onchange=renderBackupFiles;el('backupFiles').onchange=renderBackupOriginal;
el('reviewBackups').onclick=()=>void command(showBackups);
el('closeBackups').onclick=()=>el<HTMLDialogElement>('backupsDialog').close();
el('backupNow').onclick=()=>void command(backupNow);
el('automaticBackups').onchange=()=>void command(async()=>{model.backups=await api.call('automaticBackups',el<HTMLInputElement>('automaticBackups').checked);});
el('restoreBackup').onclick=()=>void command(async()=>{
  try{await flush();}catch{}const priorFile=active,priorText=view?.state.doc.toString();
  const response=await api.call('restoreBackup',el<HTMLSelectElement>('backupSnapshots').value,Number(el<HTMLSelectElement>('backupFiles').value));if(!response)return;
  if(view&&active===priorFile&&view.state.doc.toString()!==priorText){const doc=response.docs.find((d:any)=>d.path===priorFile);if(doc){doc.text=view.state.doc.toString();doc.dirty=true;lastSent.delete(priorFile);}}
  model=response;renderEditor();el<HTMLDialogElement>('backupsDialog').close();
});
let pastingImage=false;
function imagePasteEvent(event:ClipboardEvent){
 const file=[...(event.clipboardData?.files??[])].find(file=>file.type.startsWith('image/'));
 if(!file&&!event.clipboardData?.types.some(type=>type.startsWith('image/')))return false;
 event.preventDefault();void command(()=>pasteImage(file));return true;
}
async function pasteImage(image?:File){
 if(pastingImage||!view||!active)return;
 pastingImage=true;
 const editor=view,file=active,expected=editor.state.doc.toString(),selection=editor.state.selection.main;
 // A preview paste uses its source selection, even though the native dialog blurs it.
 const from=previewSession?Math.min(previewSession.anchor,previewSession.head):selection.from;
 const to=previewSession?Math.max(previewSession.anchor,previewSession.head):selection.to;
 try{
  await flush();
  const payload=image?new Uint8Array(await image.arrayBuffer()):undefined;
  const result=await api.call('pasteImage',file,expected,payload,from);
  if(!result)return;
  if(view!==editor||active!==file||editor.state.doc.toString()!==expected)throw new Error('The source changed before image insertion. The PNG is saved at '+result.name+'. Paste again at your desired location.');
  const root=model.docs.find((d:any)=>d.path===result.root);
  if(!root||root.text!==result.rootText)throw new Error('The root source changed before image insertion. The PNG is saved at '+result.name+'.');
  const insert=imageTex(result.name),changes=[{from,to,insert}];let head=from+insert.length;
  if(result.packageEdit){
   if(result.root===file){
    if(from<result.packageEdit.from)throw new Error('Place the image inside the document body. The PNG is saved at '+result.name+'.');
    changes.push({...result.packageEdit,to:result.packageEdit.from});head+=result.packageEdit.insert.length;
   }else{
    const prior=states.get(result.root),state=prior&&prior.doc.toString()===root.text?prior:createState(root.text);
    const updated=state.update({changes:result.packageEdit,annotations:[Transaction.userEvent.of('input.paste'),isolateHistory.of('full')]}).state;
    root.text=updated.doc.toString();root.dirty=true;states.set(result.root,updated);
    await api.call('edit',root.path,root.text);lastSent.set(root.path,root.text);
   }
  }
  if(view!==editor||active!==file||editor.state.doc.toString()!==expected)throw new Error('The source changed before image insertion. The PNG is saved at '+result.name+'.');
  endPreview();inputStartedAt=performance.now();
  editor.dispatch({changes,selection:{anchor:head},annotations:[Transaction.userEvent.of('input.paste'),isolateHistory.of('full')],scrollIntoView:true});
  editor.focus();await flush();
 }finally{pastingImage=false;}
}

for(const [button,method] of [['new','new'],['open','open'],['support','support'],['reload','reload'],['example','fixture'],['save','save'],['saveCopy','saveCopy'],['root','root']])el(button).onclick=()=>void command(async()=>{
  await tabActivationChain.catch(()=>{});
  // Recovery commands must remain available when autosave rejects a conflict.
  // The edit request has already delivered the current draft to the main process.
  try{await flush();}catch(e){if(!['reload','saveCopy','open','new'].includes(method))throw e;}
  const priorFile=active,priorText=view?.state.doc.toString();
  const response=await api.call(method);
  if(view&&active===priorFile&&view.state.doc.toString()!==priorText){
    const doc=response.docs.find((d:any)=>d.path===(method==='saveCopy'?response.active:priorFile));
    if(doc&&doc.text!==view.state.doc.toString()){doc.text=view.state.doc.toString();doc.dirty=true;}
  }
  if(method==='saveCopy'&&response.active!==priorFile&&view&&response.docs.find((d:any)=>d.path===response.active)?.text===view.state.doc.toString())states.set(response.active,view.state);
  model=response;renderEditor();
  if(method==='saveCopy'&&model.docs.find((d:any)=>d.path===active)?.dirty){lastSent.delete(active);await flush();}
});
for(const method of ['build','cancel','export','previous'])el(method).onclick=()=>void command(async()=>{if(method!=='cancel')await tabActivationChain.catch(()=>{});await flush();await api.call(method);});
el('live').onclick=()=>void command(async()=>{await flush();model.onSave=await api.call('live');renderTabs();renderIssue();refreshPreviewStatus();});
el('toggleStatus').onclick=()=>void command(async()=>{model.statusBar=model.statusBar===false;renderTabs();await api.call('statusBar',model.statusBar);});
el('toggleLog').onclick=()=>{const log=el<HTMLDetailsElement>('logs');log.open=!log.open;};
el('autoClose').onclick=()=>void command(async()=>{model.autoClose=model.autoClose===false;renderTabs();await api.call('autoClose',model.autoClose);});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();event.stopPropagation();void locateSource(true).catch(e=>{el('navState').textContent=String(e);});}
  if(event.ctrlKey||event.metaKey){const key=event.key.toLowerCase();if(['s','b','o'].includes(key)){event.preventDefault();el(key==='s'?'save':key==='b'?'build':'open').click();}}
},{capture:true});
function renderToolchain(report:any,activeReport=false){
 if(!report)return;
 el('toolchainSummary').textContent=(report.ready?'Ready for compilation':'Installation needs attention')+' · '+report.distribution+'\n'+report.fast.reason;
 el<HTMLButtonElement>('prepareFastFormat').disabled=!report.fast.preparable||report.fast.available;
 el('toolchainDetails').textContent=[...report.tools.map((t:any)=>(t.ok?'OK: ':'Missing/unusable: ')+t.name+' '+(t.path??'')+'\n'+t.detail),...report.packages.map((p:any)=>(p.found?'Found: ':'Missing: ')+p.name),...report.issues].join('\n\n');
 const choices=el('texInstallations');choices.replaceChildren();for(const installation of report.installations){const option=document.createElement('option');option.value=installation.bin;choices.append(option);}
 if(activeReport){const notice=el('toolchainNotice');notice.hidden=report.ready&&report.fast.available;
 el('toolchainNoticeText').textContent=report.ready?report.fast.reason:'TeX tools need attention. Open Build settings to select an installation and check missing tools.';}
}
async function refreshToolchain(detect=false){
 el('formatPreparation').textContent='';
 const input=el<HTMLInputElement>('texBin');if(detect)input.value='';el('toolchainSummary').textContent='Checking installed TeX tools…';
 const report=await api.call('toolchainCheck',input.value,el<HTMLSelectElement>('engine').value,el<HTMLInputElement>('latexmk').value);if(report.selected)input.value=report.selected;renderToolchain(report);
}
el('settings').onclick=()=>{
  el('formatPreparation').textContent='';
  el<HTMLSelectElement>('engine').value=model.engine;el<HTMLInputElement>('latexmk').value=model.latexmk;el<HTMLInputElement>('onSave').checked=model.onSave;
  el<HTMLInputElement>('texBin').value=model.texBin??model.toolchain?.selected??'';renderToolchain(model.toolchain);
  el<HTMLDialogElement>('settingsDialog').showModal();
};
el('cleanCaches').onclick=()=>void command(async()=>{const button=el<HTMLButtonElement>('cleanCaches');button.disabled=true;el('cacheStatus').textContent='Cleaning unused caches…';try{const result=await api.call('cleanCaches');el('cacheStatus').textContent=result.text;}finally{button.disabled=false;}});
el('applySettings').onclick=event=>{event.preventDefault();void command(async()=>{
  model=await api.call('settings',{texBin:el<HTMLInputElement>('texBin').value,engine:el<HTMLSelectElement>('engine').value,latexmk:el<HTMLInputElement>('latexmk').value,onSave:el<HTMLInputElement>('onSave').checked});
  renderToolchain(model.toolchain,true);
  renderTabs();
  el<HTMLDialogElement>('settingsDialog').close();
});};

let current:any,prepared:any,pageNumber=1,scale=1,renderToken=0,loadToken=0;
el('detectTeX').onclick=()=>void command(()=>refreshToolchain(true));
el('checkTeX').onclick=()=>void command(()=>refreshToolchain());
el('prepareFastFormat').onclick=()=>void command(async()=>{
 const button=el<HTMLButtonElement>('prepareFastFormat');button.disabled=true;el('formatPreparation').textContent='Preparing and checking a local fast-preview format. This one-time setup may take a couple of minutes; your document is not changed.';
 try{const report=await api.call('toolchainPrepare',el<HTMLInputElement>('texBin').value,el<HTMLSelectElement>('engine').value,el<HTMLInputElement>('latexmk').value);renderToolchain(report);el('formatPreparation').textContent=report.fast.available?'Prepared. Choose Apply to use this installation.':'Preparation finished, but fast preview is still unavailable. '+report.fast.reason;}
 catch(error){el('formatPreparation').textContent=String(error)+'. Native compilation remains available.';button.disabled=false;}
});
el('browseTeX').onclick=()=>void command(async()=>{const report=await api.call('toolchainBrowse',el<HTMLSelectElement>('engine').value,el<HTMLInputElement>('latexmk').value);if(report){el<HTMLInputElement>('texBin').value=report.selected??report.requested??'';renderToolchain(report);}});
el('toolchainNoticeSettings').onclick=()=>el('settings').click();
const continuousView=new ContinuousView(el('pages'),el('pdfViewport'));
let continuousSetup:Promise<void>=Promise.resolve();
let zoomChoice:number|'fit-width'=1,zoomChange=0,fitTimer=0,fitWidthSeen=0;
function zoomLabel(){toolbarSelect('zoom','zoom',zoomChoice==='fit-width'?`Fit width: ${Math.round(scale*100)}%`:`Preview zoom: ${Math.round(scale*100)}%`);document.body.dataset.previewScale=String(scale);}
async function desiredZoom(pdf:any){
  if(zoomChoice!=='fit-width')return zoomChoice;
  const sizes=await pdf.sizes(),width=Math.max(...sizes.map((size:any)=>Number(size.originalWidth)));
  if(!Number.isFinite(width)||width<=0)throw Error('PDF has no usable page width.');
  const viewport=el('pdfViewport'),style=getComputedStyle(viewport),available=viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  return Math.max(.01,(available-1)/width);
}
function adoptZoom(next:number){
  if(Math.abs(next-scale)<1e-5){zoomLabel();return false;}
  if(retainedExperiment&&localCanvas?.isConnected)canonicalRequested=true;
  const before=scale;localRenderToken++;localProofToken++;clearLocalProofs();baselineCache.clear();verifiedPageOutputs.clear();endPreview();
  scale=next;zoomLabel();
  if(model.continuousPreview)continuousView.rescale(next);
  else{const viewport=el('pdfViewport'),factor=next/before;const top=viewport.scrollTop;el('pages').querySelectorAll<HTMLCanvasElement>('canvas').forEach(canvas=>{canvas.style.width=parseFloat(canvas.style.width)*factor+'px';canvas.style.height=parseFloat(canvas.style.height)*factor+'px';});el('pages').querySelectorAll('.navigation-marker').forEach(marker=>marker.remove());viewport.scrollTop=top*factor;}
  return true;
}
async function applyZoom(){
  const token=++zoomChange,candidate=current;if(!candidate){if(typeof zoomChoice==='number')adoptZoom(zoomChoice);return;}
  const next=await desiredZoom(candidate.pdf);if(token!==zoomChange||candidate!==current)return;
  const changed=adoptZoom(next),rasterCurrent=Number(candidate.canvas.dataset.renderScale)===scale&&Number(candidate.canvas.dataset.renderRatio)===(window.devicePixelRatio||1);if(!changed&&(rasterCurrent||localCanvas?.isConnected))return;
  // Preserve provisional text while new zoom proofs are prepared. Static PDFs
  // can be rerastered immediately without touching TeX or the source buffer.
  if(!localCanvas?.isConnected)await navigate(0);
  void api.call('localRefresh').catch(()=>{});
  if(model.followPreview)await locateSource(false);
}
function scheduleFit(force=false){const width=el('pdfViewport').clientWidth;if(!force&&width===fitWidthSeen)return;fitWidthSeen=width;if(zoomChoice!=='fit-width')return;window.clearTimeout(fitTimer);fitTimer=window.setTimeout(()=>void applyZoom().catch(report),100);}
new ResizeObserver(()=>scheduleFit()).observe(el('pdfViewport'));
let continuousLease:{id:string;task:any}|undefined;
function releaseContinuousLease(){const lease=continuousLease;continuousLease=undefined;void lease?.task.destroy();}
async function matchesSource(nav:Navigation,file:string,text?:string){
  if(!nav.sources[file])return false;
  text??=model.docs.find((d:any)=>d.path===file)?.text;if(text===undefined)return false;
  const bytes=new TextEncoder().encode(text.replace(/\r\n/g,'\n'));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  return digest===nav.sources[file];
}
async function displayFocusLocation(hint:PreviewFocus|undefined,nav:Navigation):Promise<Region|undefined>{
 if(!view||!model.followPreview||!model.continuousPreview||active!==model.root)return;
 const file=active,text=view.state.doc.toString(),at=view.state.selection.main.head,prefix=previewFocusPrefix(hint,file,text,at);
 const row=await previewFocusTarget(hint,nav,file,text,at,async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.replace(/\r\n/g,'\n'))))).map(x=>x.toString(16).padStart(2,'0')).join(''));
 if(view&&file===active&&file===model.root&&prefix!==undefined&&prefix===previewFocusPrefix(hint,file,view.state.doc.toString(),view.state.selection.main.head)&&model.followPreview&&model.continuousPreview)return row;
}
async function cursorLocation(nav:Navigation,page:number,bundleId?:string):Promise<Region|undefined>{
  if(!view)return;const file=active,text=view.state.doc.toString(),head=view.state.selection.main.head,line=view.state.doc.lineAt(head).number;
  if(!sourceLineHasOutput(view.state.doc.lineAt(head).text))return;
  if(!await matchesSource(nav,file,text)||file!==active||text!==view.state.doc.toString()||head!==view.state.selection.main.head)return;
  if(nav.nativeInputs&&bundleId)return api.call('nativeNavigation',bundleId,'forward',{file,line,page});
  return forwardPosition(nav,file,text,head,page);
}
function markLocation(row:Region,highlight=true){
  const canvas=current?.canvas as HTMLCanvasElement|undefined;if(!canvas)return;
  if(model.continuousPreview){const id=current.id;void continuousSetup.then(()=>{if(current?.id!==id||!model.continuousPreview)return;continuousView.mark(row[2],{x:row[3],y:row[4],width:row[5],height:row[6]},false,highlight);el('navState').textContent=`${row[0].split(/[\\/]/).at(-1)} · line ${row[1]}`;});return;}
  const viewport=el('pdfViewport'),pages=el('pages');pages.querySelector('.navigation-marker')?.remove();
  if(highlight){const marker=document.createElement('div');marker.className='navigation-marker';
  marker.style.cssText=`left:${row[3]*scale}px;top:${row[4]*scale}px;width:${Math.max(4,row[5]*scale)}px;height:${Math.max(5,row[6]*scale)}px`;
  pages.append(marker);setTimeout(()=>marker.remove(),1200);}
  const canvasBox=canvas.getBoundingClientRect(),viewportBox=viewport.getBoundingClientRect();
  viewport.scrollTop+=canvasBox.top-viewportBox.top+row[4]*scale-viewport.clientHeight/2;
  const left=canvasBox.left-viewportBox.left+viewport.scrollLeft+row[3]*scale;if(left<viewport.scrollLeft||left>viewport.scrollLeft+viewport.clientWidth-30)viewport.scrollLeft=Math.max(0,left-40);
  el('navState').textContent=`${row[0].split(/[\\/]/).at(-1)} · line ${row[1]}`;
}
async function locateContinuous(explicit:boolean){
  const token=++navigationToken,file=active,text=view!.state.doc.toString(),at=view!.state.selection.main.head;
  await continuousSetup;
  const valid=()=>token===navigationToken&&model.continuousPreview&&active===file&&view?.state.doc.toString()===text&&view.state.selection.main.head===at;
  if(!valid())return;
  const line=view!.state.doc.lineAt(at).number;if(!sourceLineHasOutput(view!.state.doc.line(line).text)){if(explicit)el('navState').textContent='This source line produces no visible output.';return;}const flow=liveFlow?.canvas.isConnected?liveFlow:undefined,basis=continuousBasis;
  const status=(ok:boolean)=>{if(ok)el('navState').textContent=`${file.split(/[\\/]/).at(-1)} · line ${line}`;else if(explicit)explainNavigation('This location has no current mapping. Go to the reported error, or Retry preview.');};
  if(neutralIds.size){const context=retainedContext(),found=context&&retainedNavigation.forward(context,at,continuousView.retainedProjection);if(found&&valid()){const marked=continuousView.mark(found.page,found.glyph,false,explicit);if(marked)pageNumber=found.page;status(marked);}else status(false);return;}
  const pages=currentLivePages();
  if(pages){
    const found=pages.pages.flatMap(p=>p.locations.map(g=>({p,g}))).filter(({g})=>view!.state.doc.lineAt(g.at).number===line).sort((a,b)=>Math.abs(a.g.at-at)-Math.abs(b.g.at-at))[0];
    const marked=!!found&&(found.p.canvas?continuousView.markCanvas(found.p.canvas,found.g,explicit):continuousView.mark(found.p.page,found.g,false,explicit));if(marked)pageNumber=found.p.page;status(marked);return;
  }
  if(flow&&file===flow.file&&text===flow.text&&at>=flow.from&&at<flow.to){
    const glyph=flow.locations.filter(g=>view!.state.doc.lineAt(g.at).number===line).reduce<FlowLocation|undefined>((best,g)=>!best||Math.abs(g.at-at)<Math.abs(best.at-at)?g:best,undefined);
    const found=!!glyph&&continuousView.mark(flow.page,glyph,true,explicit);if(found)pageNumber=flow.page;status(found);return;
  }
  if(flow?.stateChanged&&at>=flow.from){status(false);return;}
  if(!basis){status(false);return;}
  let mappedText=text,mappedAt=at;
  if(flow&&file===flow.file){
    const baselineText=basis.texts?.[file]??(file===model.root?basis.text:undefined);if(text!==flow.text||baselineText===undefined||text.slice(0,flow.from)!==baselineText.slice(0,flow.from)||text.slice(flow.to)!==baselineText.slice(flow.baseTo)){status(false);return;}
    mappedText=baselineText;if(at>=flow.to)mappedAt=flow.baseTo+at-flow.to;
  }else if(!await matchesSource(basis.navigation,file,text)){status(false);return;}
  if(!valid())return;
  const row=basis.navigation.nativeInputs?await cursorLocation(basis.navigation,pageNumber,basis.id):forwardPosition(basis.navigation,file,mappedText,mappedAt,pageNumber);
  if(!valid())return;
  const found=!!row&&continuousView.mark(row[2],{x:row[3],y:row[4],width:row[5],height:row[6]},false,explicit);if(found)pageNumber=row![2];status(found);
}
async function locateSource(explicit:boolean){
  if(model.continuousPreview&&view){if(explicit)endPreview();await locateContinuous(explicit);return;}
  if(localCanvas){if(explicit)explainNavigation('This local preview has no mapping here. Retry preview to build a complete source map.');return;}
  if(!explicit&&previewSession)return;
  if(explicit)endPreview();
  const token=++navigationToken,candidate=current;
  if(!candidate?.navigation){if(explicit)explainNavigation('This preview has no source map. Retry preview, or open Details for the build error.');return;}
  const row=await cursorLocation(candidate.navigation,candidate.page,candidate.id);
  if(token!==navigationToken||candidate.id!==current?.id)return;
  if(!row){if(explicit)explainNavigation('This source location is not mapped in the displayed preview. Go to error or Retry preview.');return;}
  if(row[2]!==candidate.page){
    const canvas=await render(candidate.pdf,row[2]);if(token!==navigationToken||candidate.id!==current?.id){canvas.width=canvas.height=0;return;}
    copyCanvasMetadata(canvas,candidate.canvas);
    renderToken++;current={...current,canvas,page:row[2]};show(current);if(!model.continuousPreview)candidate.canvas.width=candidate.canvas.height=0;
  }
  markLocation(row,explicit);
}
el('editPreview').onclick=()=>void command(async()=>{if(!model.previewEditing&&(current?.navigation?.recovery||current?.timing?.recovered||localCanvas?.dataset.localRecovered==='true')){explainNavigation('Direct PDF editing is paused for this temporary preview. Use the source editor or Go to error, then Retry preview.');return;}navigationToken++;endPreview();const enabled=model.previewEditing=!model.previewEditing;renderTabs();await flush();await api.call('previewEditing',enabled);el('navState').textContent=enabled?'Preparing editable text · click plain text after the preview updates':'Click PDF text to show its source';});
el('locate').onclick=()=>void command(()=>locateSource(true));
el('follow').onclick=()=>void command(async()=>{navigationToken++;const enabled=model.followPreview=!model.followPreview;renderTabs();await api.call('follow',enabled);if(enabled&&model.followPreview)await locateSource(true);});
el('pages').addEventListener('click',event=>void command(async()=>{
  const target=event.target as HTMLElement,canvas=target instanceof HTMLCanvasElement?target:undefined;
  if(model.continuousPreview&&canvas&&neutralIds.size&&view){
    const page=Number(canvas.closest<HTMLElement>('.flow-page')?.dataset.page),context=retainedContext(canvas),point=continuousView.canvasPoint(page,canvas,event.clientX,event.clientY);
    const at=canvas.isConnected&&point&&context&&(!neutralPages.has(page)||canvas.dataset.localEditId===context.editId)?retainedNavigation.inverse(context,page,point.x,point.y,continuousView.retainedProjection):undefined;
    if(at!==undefined){endPreview();navigationToken++;pageNumber=page;suppressFollow=true;try{view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});view.focus();}finally{suppressFollow=false;}el('navState').textContent=`${active.split(/[\\/]/).at(-1)} · line ${view.state.doc.lineAt(at).number}`;return;}
    el('navState').textContent='No current mapped output here; wait for the preview to update.';return;
  }
  if(localCanvas){
    const pages=currentLivePages(),mapped=pages?.pages.find(p=>(p.canvas??continuousView.canvasForPage(p.page))===canvas);
    if(pages&&mapped&&canvas&&view){
      const rect=canvas.getBoundingClientRect(),at=liveFlowPosition(pages,{root:model.root,file:active,baseId:continuousView.id,sourceHash:pages.sourceHash,editId:pages.editId,text:view.state.doc.toString()},mapped.locations,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale,mapped.blocked);
      if(at!==undefined){endPreview();navigationToken++;pageNumber=mapped.page;suppressFollow=true;try{view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});view.focus();}finally{suppressFollow=false;}el('navState').textContent=`${active.split(/[\\/]/).at(-1)} · line ${view.state.doc.lineAt(at).number}`;return;}
    }
    const flow=liveFlow;
    if(model.continuousPreview&&flow&&canvas===flow.canvas&&localCanvas===flow.canvas&&canvas.isConnected&&view){
      const rect=canvas.getBoundingClientRect(),at=liveFlowPosition(flow,{root:model.root,file:active,baseId:continuousView.id,sourceHash:canvas.dataset.localSourceHash,editId:canvas.dataset.localEditId,text:view.state.doc.toString()},flow.locations,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale,flow.blocked);
      if(at!==undefined){
        endPreview();navigationToken++;pageNumber=flow.page;suppressFollow=true;
        try{view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});view.focus();}finally{suppressFollow=false;}
        el('navState').textContent=`${flow.file.split(/[\\/]/).at(-1)} · line ${view.state.doc.lineAt(at).number}`;return;
      }
    }
    explainNavigation('This area has no current source mapping. Retry preview for a complete map; Details explains any reported error.');return;
  }
  if(retainedExperiment&&model.continuousPreview&&continuousView.id!==current?.id)return;
  const flowPage=model.continuousPreview?canvas?.closest<HTMLElement>('.flow-page'):undefined;
  const candidate=current&&flowPage?{...current,canvas,page:Number(flowPage.dataset.page)}:current;
  if(!canvas||model.continuousPreview&&!flowPage)return;if(!candidate?.navigation||canvas!==candidate.canvas){explainNavigation('This preview has no source map. Retry preview, or open Details for the build error.');return;}
  endPreview();const pointToken=++navigationToken,priorFile=active,priorText=view?.state.doc.toString();
  const rect=candidate.canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/scale,y=(event.clientY-rect.top)/scale;
  if(recoveryPointBlocked(candidate.navigation,candidate.page,x,y)){explainNavigation('This text contains a temporary repair. Use Go to error to correct its source, then Retry preview.');return;}
  const row=candidate.navigation.nativeInputs?await api.call('nativeNavigation',candidate.id,'backward',{page:candidate.page,x,y}):backward(candidate.navigation,candidate.page,x,y);
  if(current?.id!==candidate.id||pointToken!==navigationToken)return;if(!row){el('navState').textContent='No source location near this point.';return;}
  try{
    await flush();const result=await api.call('navigateSource',candidate.id,row[0],row[1]);
    let mapped:ProseLine|undefined,position:number|undefined,pageGlyphs:PdfCharacter[]=[],mathSlot:string|undefined;
    if(model.continuousPreview){
      const text=result.state.docs.find((doc:any)=>doc.path===row[0])?.text as string|undefined;
      const glyph=[...(candidate.navigation.characters??[]),...(candidate.navigation.mathCharacters??[])].filter(g=>g[0]===row[0]&&g[1]===row[1]&&g[3]===candidate.page).map(g=>({g,d:Math.max(g[4]-x,0,x-g[4]-g[6])**2+Math.max(g[5]-y,0,y-g[5]-g[7])**2})).sort((a,b)=>a.d-b.d)[0];
      if(text!==undefined&&glyph&&glyph.d<24*24){const lines=text.split('\n'),start=lines.slice(0,row[1]-1).reduce((n,line)=>n+line.length+1,0),line=lines[row[1]-1]??'';position=start+new TextDecoder().decode(new TextEncoder().encode(line).slice(0,glyph.g[2])).length;}
    }
    if(model.previewEditing&&!candidate.navigation.nativeInputs&&!candidate.navigation.recovery){const text=result.state.docs.find((doc:any)=>doc.path===row[0])?.text;const glyphs=pageGlyphs=await candidate.pdf.glyphs(candidate.page);if(text!==undefined)for(const span of proseSpans(candidate.navigation,row[0],row[1],candidate.page,text,glyphs)){const at=nearestCaret(span,x,y);if(at!==undefined){mapped=span;position=at;break;}}}
    if(model.previewEditing&&!mapped&&!candidate.navigation.nativeInputs&&!candidate.navigation.recovery){const text=result.state.docs.find((doc:any)=>doc.path===row[0])?.text;if(text!==undefined)for(const span of mathSpans(candidate.navigation,row[0],row[1],candidate.page,text,pageGlyphs)){const caret=nearestMathCaret(span,x,y);if(caret){mapped=span;position=caret.at;mathSlot=caret.slot;break;}}}
    if(pointToken!==navigationToken||active!==priorFile||view?.state.doc.toString()!==priorText||current?.id!==candidate.id)return;
    const follow=model.followPreview,editing=model.previewEditing;model=result.state;model.followPreview=follow;model.previewEditing=editing;renderEditor();void api.call('active',active,true).catch(e=>{el('navState').textContent=String(e);});
    if(model.continuousPreview)pageNumber=candidate.page;
    if(view){const at=position??view.state.doc.line(Math.min(result.line,view.state.doc.lines)).from;suppressFollow=true;try{view.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'center'})});}finally{suppressFollow=false;}
      if(editing&&mapped&&position!==undefined){
        previewSession={file:active,line:row[1],expected:view.state.doc.toString(),from:mapped.from,to:mapped.to,map:mapped,pdfGlyphs:pageGlyphs,anchor:position,head:position,box:isMath(mapped)?mathCaretBox(mapped,position,mathSlot):caretBox(mapped,position),pending:false,...(isMath(mapped)?{math:mapped.formula,mathSlot}: {})};
        el('pages').querySelector('.navigation-marker')?.remove();previewInput.value='';previewInput.focus({preventScroll:true});drawPreviewCaret();updateMathTools();el('navState').textContent=isMath(mapped)?'Editing math · Tab moves between parts and cells · Esc returns to source':'Editing plain text · Esc returns to source';
      }else{view.focus();markLocation(row);if(editing)el('navState').textContent='Use the source editor for this text.';}
    }
  }catch(e){explainNavigation(String(e).replace(/^.*Error: /,'')+' Use Retry preview if the source has changed.');}
}));
function copyCanvasMetadata(canvas:HTMLCanvasElement,source:HTMLCanvasElement){for(const [key,value] of Object.entries(source.dataset))if(value!==undefined&&!['renderScale','renderRatio','pageWidth','pageHeight','rasterMs','workerMs','renderMs'].includes(key))canvas.dataset[key]=value;}
async function render(pdf:any,page:number,includePixels=false,urgent=false){
  const zoom=scale,ratio=window.devicePixelRatio||1,canvas=await pdf.render(page,zoom,ratio,includePixels,urgent);canvas.dataset.renderScale=String(zoom);canvas.dataset.renderRatio=String(ratio);canvas.dataset.pageWidth=String(parseFloat(canvas.style.width)/zoom);canvas.dataset.pageHeight=String(parseFloat(canvas.style.height)/zoom);return canvas;
}
function show(candidate:any,reconcileBands=false){
  clearNeutralMetadata();
  const rasterScale=Number(candidate.canvas.dataset.renderScale)||scale,rasterRatio=Number(candidate.canvas.dataset.renderRatio)||window.devicePixelRatio||1;
  candidate.canvas.style.width=Number(candidate.canvas.dataset.pageWidth)*scale+'px';candidate.canvas.style.height=Number(candidate.canvas.dataset.pageHeight)*scale+'px';
  if(!model.continuousPreview||continuousLease&&continuousLease.id!==candidate.id)releaseContinuousLease();
  el('pages').classList.toggle('continuous',!!model.continuousPreview);
  liveFlow=undefined;livePages=undefined;
  if(model.continuousPreview){continuousBasis=continuousBases.get(candidate.id);continuousSetup=continuousView.show(candidate.id,candidate.pdf,candidate.canvas,candidate.page,scale,rasterScale*rasterRatio/scale,reconcileBands);}else{continuousBasis=undefined;continuousView.clear();}
  releaseLocalDocument();
  localRenderToken++;if(localCanvas){if(!model.continuousPreview)localCanvas.width=localCanvas.height=0;localCanvas=undefined;localStatus='';localPatch=undefined;}
  const viewport=el('pdfViewport'),old=viewport.scrollTop/Math.max(1,viewport.scrollHeight-viewport.clientHeight),left=viewport.scrollLeft;
  if(!model.continuousPreview){
    el('pages').replaceChildren(candidate.canvas);
    viewport.scrollTop=old*Math.max(1,viewport.scrollHeight-viewport.clientHeight);viewport.scrollLeft=left;
  }
  el('empty').hidden=true;pageNumber=candidate.page;
  el('pageLabel').textContent=model.continuousPreview?'Continuous':`${pageNumber} / ${candidate.pdf.numPages}`;
}
async function navigate(delta:number){
  if(model.continuousPreview&&delta!==0){pageNumber=Math.max(1,Math.min(current?.pdf.numPages??1,pageNumber+delta));continuousView.scroll(pageNumber);el('pageLabel').textContent=`${pageNumber} / ${current?.pdf.numPages??'…'}`;return;}
  if(localDocument&&localCanvas){
    const doc=localDocument,page=pageNumber+delta;
    if(page<doc.span.first||page>doc.span.last){el('navState').textContent='Other pages will be available after full verification.';return;}
    const token=++localRenderToken,previous=localCanvas;
    try{const canvas=await render(doc.pdf,page-doc.span.first+1);if(token!==localRenderToken||localDocument!==doc){canvas.width=canvas.height=0;return;}
      copyCanvasMetadata(canvas,previous);localCanvas=canvas;localPatch={x:0,y:0,width:canvas.width,height:canvas.height,page};pageNumber=page;
      el('pages').replaceChildren(canvas);el('pageLabel').textContent=`${pageNumber} / …`;previous.width=previous.height=0;
    }catch(e){report('Page rendering failed. Previous display retained. '+e);}return;
  }
  if(localCanvas&&delta!==0){el('navState').textContent='Other pages will be available after full verification.';return;}
  if(!current)return;endPreview();navigationToken++;const candidate=current,token=++renderToken;const page=Math.max(1,Math.min(current.pdf.numPages,pageNumber+delta));
  try{const canvas=await render(candidate.pdf,page);if(token!==renderToken){canvas.width=canvas.height=0;return;}copyCanvasMetadata(canvas,candidate.canvas);current={...current,canvas,page};show(current);if(!model.continuousPreview)candidate.canvas.width=candidate.canvas.height=0;}catch(e){report('Page rendering failed. Previous display retained. '+e);}
}
el('prevPage').onclick=()=>void navigate(-1);el('nextPage').onclick=()=>void navigate(1);
el<HTMLSelectElement>('zoom').onchange=()=>{const value=el<HTMLSelectElement>('zoom').value;zoomChoice=value==='fit-width'?value:Number(value);model.zoom=zoomChoice;zoomLabel();void api.call('zoom',zoomChoice).catch(report);void applyZoom().catch(report);};
el<HTMLSelectElement>('layoutMode').onchange=()=>void command(async()=>{await flush();if(retainedExperiment)canonicalRequested=true;model.continuousPreview=await api.call('continuous',el<HTMLSelectElement>('layoutMode').value==='continuous');if(model.continuousPreview){model.previewEditing=false;endPreview();}localRenderToken++;if(current&&!(retainedExperiment&&localCanvas)){const canvas=await render(current.pdf,current.page);copyCanvasMetadata(canvas,current.canvas);current={...current,canvas};show(current);}renderTabs();});
el<HTMLSelectElement>('previewMode').onchange=()=>{const mode=el<HTMLSelectElement>('previewMode').value;void command(async()=>{await flush();if(mode==='document')canonicalRequested=true;model=await api.call('previewMode',mode);renderTabs();refreshPreviewStatus();});};
const proofKey=(message:any)=>[message.baseId,message.proofPage??message.page,scale,window.devicePixelRatio||1].join(':');
// Different regions can start on the same page but have distinct proved page
// spans and continuations. Parking one must not overwrite another's proof.
const pageProofKey=(message:any)=>{const span=message.baselineSpan??message.pageSpan;return JSON.stringify([proofKey(message),span?.first,span?.last,message.continuation??null]);};
function mayShowLocal(message:any){
  const file=message.sourceFile??message.root,input=localInputs.get(message.editId),latest=latestEdit&&localInputs.get(latestEdit.id),text=model.docs.find((doc:any)=>doc.path===file)?.text;
  if(!input||input.file!==file||latest?.file!==file||input.sequence<=displayedSequence||message.root!==model.root||model.previewEditing||!model.onSave||typeof text!=='string')return false;
  if(!message.sourceFile&&current?.canvas.dataset.sourceHash===message.sourceHash&&!message.flowOutput&&!message.neutralBlock)return false;
  if(!model.followPreview&&!message.flowOutput&&!(model.continuousPreview&&(message.pageOutput||message.neutralBlock))){const s=message.pageOutput?message.sourcePages:undefined;if(s?(pageNumber<s.first||pageNumber>s.last):pageNumber!==message.page)return false;}
  const {rangeFrom:from,rangeTo:to}=message;if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>input.text.length)return false;
  const prefix=input.text.slice(0,from),suffix=input.text.slice(to);return text.length>=prefix.length+suffix.length&&text.startsWith(prefix)&&text.endsWith(suffix);
}
function tileCanvas(tile:any){const canvas=document.createElement('canvas');canvas.width=tile.width;canvas.height=tile.height;
  if(tile.image){const target=canvas.getContext('bitmaprenderer');if(target)target.transferFromImageBitmap(tile.image);else{canvas.getContext('2d')!.drawImage(tile.image,0,0);tile.image.close();}}
  else canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tile.data.buffer,tile.data.byteOffset,tile.data.byteLength),tile.width,tile.height),0,0);return canvas;}
async function tileMatchesFull(pdf:any,box:any,full:{width:number;height:number},pixels:Uint8ClampedArray,preparedTile?:any){
  const tile=preparedTile??await pdf.regionPixels(1,box,scale,window.devicePixelRatio||1),data=tile.data;let equal=tile.fullWidth===full.width&&tile.fullHeight===full.height;
  for(let y=0;y<tile.patchHeight&&equal;y++)for(let x=0;x<tile.patchWidth&&equal;x++){const a=((y+tile.sourceY)*tile.width+x+tile.sourceX)*4,b=((y+tile.y)*full.width+x+tile.x)*4;for(let c=0;c<4;c++)if(data[a+c]!==pixels[b+c]){equal=false;break;}}
  return equal;
}
function localInkBounds(message:any){
  const f=message.fragment,factor=72/(72.27*65536),proposed=message.inkBleedBp??message.calibration?.inkBleedBp,bleed=typeof proposed==='number'&&proposed>=.25&&proposed<=LOCAL_INK_BLEED_BP?proposed:LOCAL_INK_BLEED_BP,ratio=scale*(window.devicePixelRatio||1),left=(f.paddingSp*factor-bleed)*ratio;
  // Preserve the original arithmetic before floor/ceil at pixel boundaries.
  return {left,top:((message.inkTopSp??f.paddingSp)*factor-bleed)*ratio,right:((f.paddingSp+f.widthSp)*factor+bleed)*ratio,bottom:((f.paddingSp+f.heightSp+f.depthSp)*factor+bleed)*ratio};
}
async function localInkFits(message:any,providedPdf?:any){
  const task=providedPdf?undefined:loadPdf(message.fragmentPdf,true);
  try{const pdf=providedPdf??await task!.promise;return (await pdf.inkFits(message.fragment.page,localInkBounds(message),scale,window.devicePixelRatio||1)).safe===true;}
  finally{await task?.destroy();}
}
async function localCorrection(message:any,base:any,fragment:any){
  const [fullGlyphs,fragmentGlyphs]=await Promise.all([base.glyphs(message.page),fragment.glyphs(message.fragment.page)]);
  const fullLookup=new GlyphLookup<PdfCharacter>(fullGlyphs),fragmentLookup=new GlyphLookup<PdfCharacter>(fragmentGlyphs);
  const offsets:{x:number;y:number;full:PdfCharacter;fragment:PdfCharacter}[]=[];
  for(const a of message.calibration?.anchors??[]){const full=fullLookup.nearest(a.code,a.full),local=fragmentLookup.nearest(a.code,a.fragment);if(full&&local)offsets.push({x:full[1]-local[1],y:full[2]-local[2],full,fragment:local});}
  const correction=placementCorrection(offsets,message.calibration);if(!correction)return false;
  const x=message.calibration.x+correction.dx,y=message.calibration.y+correction.dy,calibratedGlyphs:{x:number;y:number;width:number;height:number}[]=[];
  for(const g of fragmentGlyphs){
    const full=fullLookup.nearest(g[0],[g[1]+x,g[2]+y,g[3],g[4]]);if(!full)continue;
    if(Math.abs(full[1]-g[1]-x)<=.02&&Math.abs(full[2]-g[2]-y)<=.02&&Math.abs(full[3]-g[3])<=.02&&Math.abs(full[4]-g[4])<=.02)calibratedGlyphs.push({x:full[1],y:full[2],width:full[3],height:full[4]});
  }
  return {...correction,calibratedGlyphs};
}
api.on(async message=>{
  if(message.type==='toolchainStatus'){model.toolchain=message.report;renderToolchain(message.report,true);return;}
  if(message.type==='localState'){if(message.state==='off'||message.state==='moving'){localRenderToken++;localProofToken++;if(message.state==='off')clearLocalProofs();}el('previewState').dataset.localState=message.state;if(model.continuousPreview)refreshPreviewStatus();return;}
  if(message.type==='localPlacement'){
    let reply:Awaited<ReturnType<typeof localCorrection>>=false;
    const proofToken=localProofToken,key=proofKey(message),baseline=acceptedBaseline(message),task=loadPdf(message.fragmentPdf,true),at=performance.now();
    try{
      const [base,fragment]=await Promise.all([baseline.document,task.promise]);
      if(message.root===model.root)reply=await localCorrection(message,base,fragment);
      if(proofToken!==localProofToken||key!==proofKey(message)||message.root!==model.root)reply=false;
    }catch{reply=false;}finally{
      baseline.release();void task.destroy().catch(()=>{});
      console.debug('Local placement preflight',JSON.stringify({applied:typeof reply==='object',elapsedMs:performance.now()-at}));
      await api.call('localAck',message.token,reply);
    }
    return;
  }
  if(message.type==='localVerifyPages'){
    let ok=false;const proofToken=localProofToken,span=message.pageSpan,key=pageProofKey({...message,page:span.first});
    let fingerprint:string;
    try{const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(message.pdf).buffer);fingerprint=JSON.stringify([message.root,key,span.first,span.last,Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')]);}
    catch{await api.call('localAck',message.token,false);return;}
    const currentProof=()=>proofToken===localProofToken&&key===pageProofKey({...message,page:span.first})&&message.root===model.root;
    const retainPageBaseline=(baseline:ReturnType<typeof acceptedBaseline>)=>{if(localPageBaselines.size>=8&&!localPageBaselines.has(key)){const oldest=localPageBaselines.keys().next().value!;localPageBaselines.get(oldest)!.release();localPageBaselines.delete(oldest);localPageProofs.delete(oldest);}localPageBaselines.get(key)?.release();localPageBaselines.set(key,{...baseline.retain(),retain:baseline.retain,span:{...span},continuation:message.continuation});};
    if(verifiedPageOutputs.has(fingerprint)&&currentProof()){const baseline=acceptedBaseline(message);retainPageBaseline(baseline);baseline.release();localPageProofs.add(key);console.debug('Local page range verification',JSON.stringify({ok:true,reused:true,span}));await api.call('localAck',message.token,true);return;}
    const baseline=acceptedBaseline(message),task=loadPdf(message.pdf,true);
    try{const [base,partial]=await Promise.all([baseline.document,task.promise]);
      ok=message.root===model.root&&Number.isSafeInteger(span.first)&&Number.isSafeInteger(span.last)&&span.first>=1&&span.last>=span.first&&span.last-span.first<3&&span.last<=base.numPages&&partial.numPages===span.last-span.first+1;
      const pages:Awaited<ReturnType<typeof baseline.page>>[]=[];
      try{
        for(let page=span.first;ok&&currentProof()&&page<=span.last;page++)pages.push(await baseline.page(page));
        ok=ok&&currentProof()&&pages.length===span.last-span.first+1;
        if(ok){const proof=await partial.verifyPageBand(pages.map(frame=>({width:frame.value.canvas.width,height:frame.value.canvas.height,pixels:frame.value.pixels.slice()})),scale*(window.devicePixelRatio||1));ok=proof.ok;console.debug('Page baseline verification',JSON.stringify(proof));}
      }finally{for(const page of pages)page.release();}
      ok=ok&&currentProof();
      if(ok){retainPageBaseline(baseline);localPageProofs.add(key);if(verifiedPageOutputs.size>=8)verifiedPageOutputs.delete(verifiedPageOutputs.values().next().value!);verifiedPageOutputs.add(fingerprint);}console.debug('Local page range verification',JSON.stringify({ok,reused:false,span,scale,ratio:window.devicePixelRatio}));
    }catch{ok=false;}finally{baseline.release();void task.destroy().catch(()=>{});await api.call('localAck',message.token,ok);}return;
  }
  if(message.type==='localVerify'){
    const proofStarted=performance.now();let loadedAt=proofStarted,readAt=proofStarted,comparedAt=proofStarted,tileAt=proofStarted;
    let ok=false,reply:boolean|{dx:number;dy:number}=false;const proofToken=localProofToken,key=proofKey(message),baseline=acceptedBaseline(message),tasks=[loadPdf(message.pdf,true),loadPdf(message.fragmentPdf,true)];
    let cached:Awaited<ReturnType<typeof baseline.page>>|undefined;
    try{if(message.root===model.root){const [base,composed,fragment]=await Promise.all([baseline.document,...tasks.map(task=>task.promise)]);
      loadedAt=performance.now();
      if(proofToken!==localProofToken||key!==proofKey(message)||message.root!==model.root)return;
      // Submit the independent proof reads together. Otherwise an idle page
      // render can start between each round trip and delay the same proof
      // repeatedly. PDFium still executes each request serially.
      const reads=[baseline.page(message.page).then(frame=>cached=frame),composed.renderPixels(1,scale,window.devicePixelRatio||1),localInkFits(message,fragment),composed.regionPixels(1,message.footprint,scale,window.devicePixelRatio||1)] as const;
      const [frame,composedRaster,ink,tile]=await Promise.all(reads).catch(async error=>{await Promise.allSettled(reads);throw error;});
      readAt=performance.now();
      const a=frame.value.canvas,pa=frame.value.pixels,pb=composedRaster.pixels;
      const factor=scale*(window.devicePixelRatio||1),box=message.footprint,result=matchLocalPatchRaster(pa,pb,a.width,a.height,{x:box.x*factor,y:box.y*factor,width:box.width*factor,height:box.height*factor},(message.calibration?.calibratedGlyphs??[]).map((g:any)=>({x:g.x*factor,y:g.y*factor,width:g.width*factor,height:g.height*factor})));
      ok=ink&&a.width===composedRaster.width&&a.height===composedRaster.height&&result.ok;
      comparedAt=performance.now();
      if(ok)ok=await tileMatchesFull(composed,message.footprint,composedRaster,pb,tile);
      tileAt=performance.now();
      console.debug('Local raster verification',JSON.stringify({ink,...result,scale,ratio:window.devicePixelRatio}));
      ok=ok&&proofToken===localProofToken&&key===proofKey(message)&&message.root===model.root;
      if(ok){
        // Page verification may have completed in parallel. Evict only the
        // oldest paragraph image, without clearing its independent page proof.
        if(localProofs.size>=8&&!localProofs.has(key)){const oldest=localProofs.keys().next().value!;localProofs.get(oldest)!.release();localProofs.delete(oldest);}
        localProofs.get(key)?.release();localProofs.set(key,{canvas:a,page:message.page,release:frame.release,retain:baseline.retain});cached=undefined;
      }
      reply=ok?true:ink&&proofToken===localProofToken&&key===proofKey(message)?await localCorrection(message,base,fragment):false;
      console.debug('Local paragraph proof',JSON.stringify({loadMs:loadedAt-proofStarted,readMs:readAt-loadedAt,compareMs:comparedAt-readAt,tileMs:tileAt-comparedAt,correctionMs:performance.now()-tileAt,totalMs:performance.now()-proofStarted,ok,correction:typeof reply==='object'}));
    }}catch{reply=false;}finally{cached?.release();baseline.release();void Promise.all(tasks.map(task=>task.destroy())).catch(()=>{});await api.call('localAck',message.token,reply);}
    return;
  }
  if(message.type==='localPage'){
    let ok=!message.neutralBlock;const token=++localRenderToken;
    if(!mayShowLocal(message)){await api.call('localAck',message.token,!message.neutralBlock);return;}
    const input=localInputs.get(message.editId)!,inputAt=input.startedAt;
    const receivedAt=performance.now();
    const task=message.flowOutput?undefined:loadPdf(message.pdf,true,true);let keepTask=false,flowImage:ImageBitmap|undefined;
    try{
      if(message.flowOutput){
        if(!message.retainedFlow)clearNeutralMetadata();
        if(!model.continuousPreview)throw Error('Continuous preview was turned off.');
        const proof=localProofs.get(proofKey(message));if(!proof)throw Error('Continuous block needs a verified baseline.');
        const tile=await renderCheckedPdfRegion(message.pdf,message.fragment.page,message.flowOutput.fragmentRect,localInkBounds(message),scale,window.devicePixelRatio||1),tiledAt=performance.now();
        flowImage=tile.image;
        if(tile.safe!==true)throw Error('Continuous block ink exceeds its bounds.');
        await continuousSetup;
        if(token!==localRenderToken||!mayShowLocal(message)){tile.image?.close();return;}
        if(continuousView.id!==message.baseId||!continuousView.matchesScale(scale,window.devicePixelRatio||1)){
          const held=proof.retain(),baseline=await held.document;releaseContinuousLease();continuousLease={id:message.baseId,task:{destroy:async()=>held.release()}};
          const copy=document.createElement('canvas');copy.width=proof.canvas.width;copy.height=proof.canvas.height;copy.style.width=proof.canvas.style.width;copy.style.height=proof.canvas.style.height;copy.getContext('2d')!.drawImage(proof.canvas,0,0);
          continuousBasis=continuousBases.get(message.baseId);
          continuousSetup=continuousView.show(message.baseId,baseline,copy,message.page,scale,window.devicePixelRatio||1);await continuousSetup;
        }
        let retainedBaseline:string|undefined;
        if(message.retainedFlow){
          const block=message.neutralBlock;if(!block||message.recovery||message.flowOutput.stateChanged)throw Error('Retained flow has no independent source proof.');
          if(neutralBaseId!==message.baseId){clearNeutralMetadata();neutralBaseId=message.baseId;}
          if(block.prior.length!==neutralIds.size||block.prior.some((id:string)=>!neutralIds.has(id)))throw Error('Retained display history changed.');
          const basis=continuousBasis;if(!basis||basis.id!==message.baseId)throw Error('Retained source baseline is unavailable.');
          retainedBaseline=basis.texts?.[input.file]??(input.file===model.root?basis.text:undefined);
          if(retainedBaseline===undefined){
            // The accepted build can finish after the editor has advanced.
            // Its first retained update supplies that immutable source once;
            // validate it against the accepted navigation, never today's draft.
            const source=message.retainedSource;if(typeof source!=='string'||source.length>2*1024*1024||!await matchesSource(basis.navigation,input.file,source))throw Error('Retained source baseline does not match its accepted navigation.');
            if(token!==localRenderToken||continuousBasis!==basis||!mayShowLocal(message))return;
            retainedBaseline=source;(basis.texts??={})[input.file]=source;if(input.file===model.root)basis.text=source;
          }else if(message.retainedSource!==undefined&&message.retainedSource!==retainedBaseline)throw Error('Retained source baseline differs from its accepted snapshot.');
          retainedNavigation.updated({root:message.root,file:input.file,baseId:message.baseId,sourceHash:message.sourceHash,editId:message.editId,text:input.text},retainedBaseline,{...block,page:message.page,retainedFlow:true},continuousBasis?.navigation);
        }
        const canvas=message.retainedFlow?continuousView.patchRetained(message.page,proof.canvas,tile,message.flowOutput,message.neutralBlock.id):continuousView.patch(message.page,proof.canvas,tile,message.flowOutput),leadingCorrection=Number(canvas.dataset.flowLeadingCorrection??0);localCanvas=canvas;localPatch=undefined;displayedSequence=input.sequence;
        if(message.retainedFlow){
          const block=message.neutralBlock;retainedNavigation=retainedNavigation.updated({root:message.root,file:input.file,baseId:message.baseId,sourceHash:message.sourceHash,editId:message.editId,text:input.text},retainedBaseline!,{...block,page:message.page,retainedFlow:true,locations:block.locations.map((g:any)=>({...g,y:g.y+leadingCorrection}))},continuousBasis?.navigation);
          neutralPages.set(message.page,canvas);neutralIds.add(block.id);retainedExperiment=true;ok=true;
          for(const c of continuousView.retainedCanvases()){c.dataset.renderScope='local';c.dataset.localLayout='retained-flow';c.dataset.neutralActive=String(c===canvas);c.dataset.localSourceHash=message.sourceHash;c.dataset.localEditId=message.editId;c.dataset.sourceHash=current?.canvas.dataset.sourceHash??'';}
        }
        livePages=undefined;liveFlow={root:message.root,baseId:message.baseId,sourceHash:message.sourceHash,editId:message.editId,file:message.sourceFile??message.root,stateChanged:!!message.flowOutput.stateChanged,text:input.text,from:message.rangeFrom,to:message.rangeTo,baseTo:message.flowOutput.baseRangeTo,page:message.page,canvas,blocked:message.flowOutput.blocked?.map((g:any)=>({...g,y:g.y+leadingCorrection})),locations:(message.flowOutput.locations??[]).map((g:any)=>({...g,y:g.y+leadingCorrection}))};
        if(message.retainedFlow)liveFlow=undefined;
        canvas.dataset.renderScope='local';canvas.dataset.localLayout=message.retainedFlow?'retained-flow':'flow';canvas.dataset.localStateChanged=String(!!message.flowOutput.stateChanged);canvas.dataset.localSourceHash=message.sourceHash;canvas.dataset.localEditId=message.editId;canvas.dataset.sourceHash=current?.canvas.dataset.sourceHash??'';
        canvas.dataset.localRecovered=String(!!message.recovery||!!message.recoveredBasis);
        canvas.dataset.localPipeline=JSON.stringify({compiler:message.timing,receiveMs:receivedAt-inputAt,checkedRegionMs:tiledAt-receivedAt,pdfWorker:{queueMs:tile.queueMs,loadMs:tile.loadMs,rasterMs:tile.rasterMs,checkMs:tile.checkMs,cropMs:tile.cropMs,workerMs:tile.workerMs,rasterPasses:tile.rasterPasses},canvasMs:performance.now()-tiledAt});
        if(model.followPreview&&Number.isFinite(message.flowOutput.caretY))continuousView.reveal(canvas,message.flowOutput.caretY+leadingCorrection);
        const finish=()=>{if(token!==localRenderToken||localCanvas!==canvas)return;const latency=Math.ceil(performance.now()-inputAt);input.displayedLatencyMs??=latency;canvas.dataset.localLatencyMs=String(latency);canvas.dataset.localLatencyEditId=message.editId;canvas.dataset.timingEndpoint=message.visible?'paint opportunity':'canvas (window hidden)';void api.call('localWarm',message.root,message.baseId,message.editId,Math.ceil(performance.now()-inputAt),canvas.dataset.localLayout).catch(()=>{});localStatus=`Continuous block updated in ${latency} ms from edit. Paginated PDF verification pending.`;refreshPreviewStatus();};
        if(message.visible)requestAnimationFrame(()=>requestAnimationFrame(finish));else finish();return;
      }
      if(message.pageOutput){
        if(!localPageProofs.has(pageProofKey(message)))throw Error('Local page range needs verification at this zoom.');
        const pdf=await task!.promise,span=message.pageSpan;
        if(!span||!Number.isSafeInteger(span.first)||!Number.isSafeInteger(span.last)||span.first<1||span.last<span.first||span.last-span.first>=3||pdf.numPages!==span.last-span.first+1)throw Error('Invalid affected-page range.');
        if(model.continuousPreview){
          const proof=localPageBaselines.get(pageProofKey(message));if(!proof)throw Error('Affected pages need a retained baseline.');
          const prefixPages=span.first-proof.span.first;
          if(prefixPages<0||span.first>proof.span.last||prefixPages>0&&!Number.isSafeInteger(message.timing?.familyCheckpointOffset)||(!proof.continuation&&span.last!==proof.span.last)||proof.continuation!==message.continuation)throw Error('Affected page continuation changed. '+JSON.stringify({span,baseline:proof.span,prepared:proof.continuation,continuation:message.continuation,familyCheckpointOffset:message.timing?.familyCheckpointOffset}));
          const canvases:HTMLCanvasElement[]=[];
          try{
            // A checked family checkpoint can skip unchanged leading pages.
            // Restore those exact baseline pixels as well, so an older live
            // band cannot leave stale content or cover the updated suffix.
            const pendingRasters:Promise<HTMLCanvasElement>[]=[];
            if(prefixPages){const baseline=await proof.document;for(let page=proof.span.first;page<span.first;page++)pendingRasters.push(render(baseline,page,false,true));}
            for(let page=1;page<=pdf.numPages;page++)pendingRasters.push(render(pdf,page,false,true));
            // Submit the whole band before yielding. PDFium remains serialized,
            // but queued proof work cannot slip between every live page read.
            const rasters=await Promise.allSettled(pendingRasters);for(const raster of rasters)if(raster.status==='fulfilled')canvases.push(raster.value);
            const failed=rasters.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
            await continuousSetup;
            if(token!==localRenderToken||!mayShowLocal(message))return;
            if(continuousView.id!==message.baseId||!continuousView.matchesScale(scale,window.devicePixelRatio||1)){
              const baseline=await proof.document,copy=await render(baseline,span.first);
              if(token!==localRenderToken||!mayShowLocal(message)){copy.width=copy.height=0;return;}
              // The proof owns this PDF until local invalidation. The view
              // needs its own lease because full verification can retire it.
              const lease=proof.retain();
              releaseContinuousLease();continuousLease={id:message.baseId,task:{destroy:async()=>lease.release()}};
              continuousBasis=continuousBases.get(message.baseId);
              continuousSetup=continuousView.show(message.baseId,await lease.document,copy,span.first,scale,window.devicePixelRatio||1);await continuousSetup;
            }
            if(token!==localRenderToken||!mayShowLocal(message))return;
            if(proof.continuation)continuousView.patchBand(proof.span,canvases);else continuousView.patchPages(proof.span.first,canvases);
            const canvas=canvases[prefixPages],painted=[...canvases];localCanvas=canvas;localPatch=undefined;liveFlow=undefined;displayedSequence=input.sequence;
            livePages=message.pageLocations?{root:message.root,file:message.sourceFile??message.root,baseId:message.baseId,editId:message.editId,sourceHash:message.sourceHash,text:input.text,from:0,to:input.text.length,pages:message.pageLocations.map((p:any)=>({...p,canvas:canvases[p.page-proof.span.first]})).filter((p:any)=>!!p.canvas)}:undefined;
            const baselineText=continuousBasis?.texts?.[input.file]??(input.file===model.root?continuousBasis?.text:undefined);
            if(livePages&&continuousBasis&&baselineText!==undefined)livePages.pages.push(...unchangedPageLocations(continuousBasis.navigation,input.file,baselineText,input.text,{first:span.first,last:proof.span.last}).map(p=>({...p,canvas:p.page>=proof.span.first&&p.page<span.first?canvases[p.page-proof.span.first]:undefined})));
            for(const c of canvases)c.dataset.localRecovered=String(!!message.recovery||!!message.recoveredBasis);
            for(const c of canvases){c.dataset.renderScope='local';c.dataset.localLayout='continuous-pages';c.dataset.localSourceHash=message.sourceHash;c.dataset.localEditId=message.editId;c.dataset.localFirstPage=String(proof.span.first);c.dataset.localLastPage=String(span.last);c.dataset.localPipeline=JSON.stringify({compiler:message.timing,receiveMs:receivedAt-inputAt,loadRenderMs:performance.now()-receivedAt});}
            if(model.followPreview){
              const page=Math.max(span.first,Math.min(span.last,message.cursorPage??span.first)),target=message.cursorPosition;
              continuousView.reveal(canvases[page-proof.span.first],target?.page===page?target.y+target.height:0);
            }
            const finish=()=>{if(token!==localRenderToken||localCanvas!==canvas)return;const latency=Math.ceil(performance.now()-inputAt);input.displayedLatencyMs??=latency;for(const c of painted){c.dataset.localLatencyMs=String(latency);c.dataset.localLatencyEditId=message.editId;}void api.call('localWarm',message.root,message.baseId,message.editId,latency,canvas.dataset.localLayout).catch(()=>{});localStatus=`Affected pages updated in ${latency} ms from edit. Full document verification pending.`;refreshPreviewStatus();};
            if(message.visible)requestAnimationFrame(()=>requestAnimationFrame(finish));else finish();
            canvases.length=0;return;
          }finally{for(const c of canvases)c.width=c.height=0;}
        }
        const preferred=model.followPreview?message.cursorPage??pageNumber:pageNumber,page=Math.max(span.first,Math.min(span.last,preferred)),canvas=await render(pdf,page-span.first+1);
        if(token!==localRenderToken||!mayShowLocal(message)){canvas.width=canvas.height=0;return;}
        releaseLocalDocument();localDocument={pdf,task:task!,span};keepTask=true;
        if(localCanvas)localCanvas.width=localCanvas.height=0;localCanvas=canvas;
        localPatch={x:0,y:0,width:canvas.width,height:canvas.height,page};displayedSequence=input.sequence;
        canvas.dataset.renderScope='local';canvas.dataset.localLayout='page';canvas.dataset.localProofKey=proofKey(message);canvas.dataset.localSourceHash=message.sourceHash;canvas.dataset.localEditId=message.editId;canvas.dataset.sourceHash=current?.canvas.dataset.sourceHash??'';
        canvas.dataset.localFirstPage=String(span.first);canvas.dataset.localLastPage=String(span.last);el('pages').replaceChildren(canvas);el('empty').hidden=true;pageNumber=page;el('pageLabel').textContent=`${pageNumber} / …`;
        canvas.dataset.localRecovered=String(!!message.recovery||!!message.recoveredBasis);
        if(model.followPreview&&message.cursorPosition)continuousView.reveal(canvas,message.cursorPosition.y+message.cursorPosition.height,scale);
        const finish=()=>{if(token!==localRenderToken||localCanvas!==canvas||canvas.dataset.localEditId!==message.editId)return;void api.call('localWarm',message.root,message.baseId,message.editId,Math.ceil(performance.now()-inputAt),canvas.dataset.localLayout).catch(()=>{});const latency=Math.ceil(performance.now()-inputAt);input.displayedLatencyMs??=latency;canvas.dataset.localLatencyMs=String(latency);canvas.dataset.localLatencyEditId=message.editId;canvas.dataset.timingEndpoint=message.visible?'paint opportunity':'canvas (window hidden)';localStatus=`Affected ${span.last>span.first?'pages':'page'} updated in ${latency} ms from edit. Full document verification pending.`+(!message.visible?' Window hidden; measured to canvas.':'');refreshPreviewStatus();};
        if(message.visible)requestAnimationFrame(()=>requestAnimationFrame(finish));else finish();return;
      }
      if(!localProofs.has(proofKey(message)))throw Error('Local preview needs verification at this zoom.');
      const [pdf,ink]=await Promise.all([task!.promise,localInkFits(message)]);if(!ink)throw Error('Paragraph ink exceeds its verified footprint.');
      const checkedAt=performance.now();
      const tile=await pdf.renderRegion(1,message.footprint,scale,window.devicePixelRatio||1),key=proofKey(message),proof=localProofs.get(key);
      const tiledAt=performance.now();
      if(token===localRenderToken&&mayShowLocal(message)){
        if(!proof)throw Error('Local page baseline expired.');
        releaseLocalDocument();
        if(message.neutralBlock){
          if(!model.continuousPreview)throw Error('Neutral paragraphs require Continuous scroll.');
          if(neutralBaseId!==message.baseId){clearNeutralMetadata();neutralBaseId=message.baseId;}
          const block=message.neutralBlock;
          if(block.prior.length!==neutralIds.size||block.prior.some((id:string)=>!neutralIds.has(id)))throw Error('Neutral display history does not match the source.');
          const baselineText=continuousBasis?.texts?.[input.file]??(input.file===model.root?continuousBasis?.text:undefined);if(baselineText===undefined)throw Error('Retained source baseline is unavailable.');
          const nextNavigation=retainedNavigation.updated({root:message.root,file:input.file,baseId:message.baseId,sourceHash:message.sourceHash,editId:message.editId,text:input.text},baselineText,{...block,page:message.page},continuousBasis?.navigation);
          await continuousSetup;
          if(continuousView.id!==message.baseId||!continuousView.matchesScale(scale,window.devicePixelRatio||1)){
            if(neutralIds.size)throw Error('Neutral display scale changed.');
            const held=proof.retain(),baseline=await held.document;releaseContinuousLease();continuousLease={id:message.baseId,task:{destroy:async()=>held.release()}};
            const copy=document.createElement('canvas');copy.width=proof.canvas.width;copy.height=proof.canvas.height;copy.style.width=proof.canvas.style.width;copy.style.height=proof.canvas.style.height;copy.getContext('2d')!.drawImage(proof.canvas,0,0);continuousSetup=continuousView.show(message.baseId,baseline,copy,message.page,scale,window.devicePixelRatio||1);await continuousSetup;
          }
          if(token!==localRenderToken||!mayShowLocal(message)){tile.image?.close();return;}
          const region=tileCanvas(tile);let canvas:HTMLCanvasElement;try{canvas=continuousView.patchNeutral(message.page,proof.canvas,region,tile,block.id);}finally{region.width=region.height=0;}
          neutralPages.set(message.page,canvas);neutralIds.add(block.id);
          retainedNavigation=nextNavigation;
          retainedExperiment=true;
          ok=true;
          for(const c of neutralPages.values()){c.dataset.renderScope='local';c.dataset.localLayout='neutral-blocks';c.dataset.neutralActive=String(c===canvas);c.dataset.localSourceHash=message.sourceHash;c.dataset.localEditId=message.editId;c.dataset.sourceHash=current?.canvas.dataset.sourceHash??'';}
          localCanvas=canvas;localPatch=undefined;liveFlow=undefined;livePages=undefined;displayedSequence=input.sequence;
          canvas.dataset.localPipeline=JSON.stringify({compiler:message.timing,receiveMs:receivedAt-inputAt,loadAndInkMs:checkedAt-receivedAt,tileMs:tiledAt-checkedAt,canvasMs:performance.now()-tiledAt});
          if(model.followPreview&&Number.isFinite(block.caretY))continuousView.revealPosition(message.page,block.caretY);
          const latency=Math.ceil(performance.now()-inputAt);canvas.dataset.localLatencyMs=String(latency);canvas.dataset.localLatencyEditId=message.editId;localStatus=`Lecture blocks updated in ${latency} ms from edit. Full verification pending.`;refreshPreviewStatus();void api.call('localWarm',message.root,message.baseId,message.editId,latency,'neutral-blocks').catch(()=>{});return;
        }
        let canvas=localCanvas;
        if(!canvas||canvas.dataset.localProofKey!==key||canvas.width!==tile.fullWidth||canvas.height!==tile.fullHeight){
          canvas=document.createElement('canvas');canvas.width=tile.fullWidth;canvas.height=tile.fullHeight;canvas.style.width=tile.originalWidth*scale+'px';canvas.style.height=tile.originalHeight*scale+'px';
          const base=current?.page===message.page&&current.canvas.width===tile.fullWidth&&current.canvas.height===tile.fullHeight?current.canvas:proof.canvas;
          canvas.getContext('2d')!.drawImage(base,0,0);if(localCanvas)localCanvas.width=localCanvas.height=0;localCanvas=canvas;
        }
        const region=tileCanvas(tile);canvas.getContext('2d')!.drawImage(region,tile.sourceX,tile.sourceY,tile.patchWidth,tile.patchHeight,tile.x,tile.y,tile.patchWidth,tile.patchHeight);region.width=region.height=0;
        localPatch={x:tile.x,y:tile.y,width:tile.patchWidth,height:tile.patchHeight,page:message.page};
        displayedSequence=input.sequence;
        canvas.dataset.renderScope='local';canvas.dataset.localLayout='paragraph';canvas.dataset.localProofKey=key;canvas.dataset.localSourceHash=message.sourceHash;canvas.dataset.localEditId=message.editId;canvas.dataset.sourceHash=current?.canvas.dataset.sourceHash??'';canvas.dataset.localRasterMs=String(tile.rasterMs);
        canvas.dataset.localRecovered=String(!!message.recovery||!!message.recoveredBasis);
        canvas.dataset.localPipeline=JSON.stringify({compiler:message.timing,receiveMs:receivedAt-inputAt,loadAndInkMs:checkedAt-receivedAt,tileMs:tiledAt-checkedAt,canvasMs:performance.now()-tiledAt});
        if(canvas.parentElement!==el('pages'))el('pages').replaceChildren(canvas);el('empty').hidden=true;pageNumber=message.page;el('pageLabel').textContent=`${pageNumber} / ${current?.pdf.numPages??'?'}`;
        const finish=()=>{if(token!==localRenderToken||localCanvas!==canvas||canvas.dataset.localEditId!==message.editId)return;void api.call('localWarm',message.root,message.baseId,message.editId,Math.ceil(performance.now()-inputAt),canvas.dataset.localLayout).catch(()=>{});const latency=Math.ceil(performance.now()-inputAt);input.displayedLatencyMs??=latency;canvas.dataset.localLatencyMs=String(latency);canvas.dataset.localLatencyEditId=message.editId;canvas.dataset.timingEndpoint=message.visible?'paint opportunity':'canvas (window hidden)';localStatus=`Local paragraph updated in ${latency} ms from edit. Full document verification pending.`+(!message.visible?' Window hidden; measured to canvas.':'');refreshPreviewStatus();};
        if(message.visible)requestAnimationFrame(()=>requestAnimationFrame(finish));else finish();
      }else tile.image?.close();
    }catch(error){console.debug('Local page output rejected',String(error));ok=false;}finally{flowImage?.close();if(!keepTask)await task?.destroy();await api.call('localAck',message.token,ok);}
    return;
  }
  if(message.type==='backupStatus'){el('backupStatus').textContent=message.text;el('backupWarning').hidden=!message.error;el('backupWarning').querySelector('span')!.textContent=message.text;return;}
  if(message.type==='menuAction'){const {action,value}=message;if(action==='copyPerformanceReport'){void command(()=>api.call('copyPerformanceReport'));return;}if(action==='browseBackups'){void command(showBackups);return;}if(action==='backupNow'){void command(backupNow);return;}if(action==='automaticBackups'){void command(async()=>{model.backups=await api.call('automaticBackups',model.backups===false);el<HTMLInputElement>('automaticBackups').checked=model.backups;});return;}if(action==='pasteImage'){void command(()=>pasteImage());return;}if(['zoom','panelLayout','layoutMode','previewMode'].includes(action)){const select=el<HTMLSelectElement>(action);if(select.value===value)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}else if(action.startsWith('math-'))document.querySelector<HTMLButtonElement>(`[data-math="${action.slice(5)}"]`)?.click();else document.getElementById(action)?.click();return;}
  if(message.type==='cacheCleanup')el('cacheStatus').textContent=message.text;
  if(message.type==='root'){model.root=message.root;renderTabs();}
  if(message.type==='saved'){
    const doc=model.docs.find((d:any)=>d.path===message.path);
    const text=message.path===active?view?.state.doc.toString():doc?.text;
    if(doc&&text===message.text){doc.dirty=message.dirty;renderTabs();}
  }
  if(message.type==='status'){
    sourceWarning=message.conflict?` ${message.conflict} changed outside the app; its draft is preserved. Use Save copy or Reload disk.`:'';
    const updated=message.text.startsWith('Preview updated'),failed=/^Build failed:|snapshot exceeds|not found/i.test(message.text);
    if(updated){previewUpdating=true;refreshPreviewStatus();}
    else{
      el('status').textContent=message.text;
      if(failed){previewUpdating=false;previewKnownCurrent=false;el('previewState').textContent=current?'Preview behind source — build failed':'No successful preview yet';}
      else if(/Saving edits|Updating preview/.test(message.text)){previewUpdating=true;refreshPreviewStatus();}
      else if(/Build cancelled/.test(message.text)){previewUpdating=false;renderIssue();el('previewState').textContent=current?'Previous preview retained':'No successful preview yet';}
      else if(/Source saved|Restored last/.test(message.text))el('previewState').textContent='Preview has pending changes';
      else previewUpdating=false;
    }
  }
  if(message.type==='problems'){if(message.root!==model.root||message.editId!==latestEdit?.id)return;projectProblems=message.issues;if(!message.issues.some((i:any)=>i.severity!=='warning'))compileIssue=undefined;renderProblems();renderRecoveryNotice();}
  if(message.type==='diagnostic'){
    if(message.issue.root!==model.root||message.issue.editId!==latestEdit?.id)return;
    compileIssue=message.issue;projectProblems=[message.issue];previewKnownCurrent=false;previewUpdating=false;renderIssue();
  }
  if(message.type==='localRecovered'&&message.root===model.root&&message.editId===latestEdit?.id){compileIssue=undefined;projectProblems=[];renderIssue();}
  if(message.type==='log'){
    const log=el('log');
    if(!message.append){log.textContent=message.text;logLength=message.text.length;}
    else{
      log.append(document.createTextNode(message.text));
      // Keep the bounded log without retransmitting and replacing up to 2 MB
      // of old text for each compiler message during a long editing session.
      logLength+=message.text.length;
      let excess=logLength-2_000_000;logLength=Math.min(logLength,2_000_000);
      while(excess>0&&log.firstChild){const node=log.firstChild as Text;if(node.length<=excess){excess-=node.length;node.remove();}else{node.deleteData(0,excess);break;}}
    }
  }
  if(message.type==='reset'){
    releaseContinuousLease();
    continuousView.clear();continuousBases.clear();continuousBasis=undefined;liveFlow=undefined;livePages=undefined;canonicalRequested=false;
    baselineCache.clear();
    verifiedPageOutputs.clear();
    releaseLocalDocument();
    localProofToken++;localInputs.clear();displayedSequence=0;clearNeutralMetadata();
    localRenderToken++;if(localCanvas)localCanvas.width=localCanvas.height=0;localCanvas=undefined;localStatus='';localPatch=undefined;clearLocalProofs();
    endPreview();
    navigationToken++;
    latestEdit=editDetails.get(message.root);previewUpdating=false;previewKnownCurrent=false;compileIssue=undefined;projectProblems=[];renderIssue();
    renderToken++;loadToken++;void current?.task.destroy();void prepared?.task.destroy();current=prepared=undefined;pageNumber=1;
    el('pages').replaceChildren();el('empty').hidden=false;el('pageLabel').textContent='No document';
  }
  if(message.type==='prepare'){
    let pdf:any,task:any;const token=++loadToken,arrivedAt=performance.now();
    try{
      message.navigation=decodeNavigation(message.navigation);
      const decodedAt=performance.now();
      task=loadPdf(message.pdf);
      pdf=await task.promise;
      const loadedAt=performance.now();
      // Resolve continuous page geometry before acknowledging the frame, so
      // newly queued local proofs cannot postpone attaching its canvas.
      if(model.continuousPreview)await pdf.sizes(true);
      const proposedTarget=model.followPreview&&message.navigation?await cursorLocation(message.navigation,pageNumber)??await displayFocusLocation(message.displayFocus,message.navigation):undefined;
      const target=proposedTarget&&proposedTarget[2]<=pdf.numPages?proposedTarget:undefined;
      const visible=model.continuousPreview?continuousView.visiblePage:undefined;
      const page=model.followPreview&&target?target[2]:Math.min(visible??pageNumber,pdf.numPages);
      adoptZoom(await desiredZoom(pdf));
      const locatedAt=performance.now();
      let canvas=await render(pdf,page,true);
      while(Number(canvas.dataset.renderScale)!==scale&&token===loadToken){canvas.width=canvas.height=0;canvas=await render(pdf,page,true);}
      if(token!==loadToken)throw new Error('Project or preview changed while loading.');
      canvas.dataset.sourceHash=message.bundle.sourceHash??'';
      const renderedAt=performance.now();
      if(message.navigation){
        const text=model.docs.find((d:any)=>d.path===model.root)?.text;
        const texts:Record<string,string>={};for(const doc of model.docs)if(await matchesSource(message.navigation,doc.path,doc.text))texts[doc.path]=doc.text;
        continuousBases.set(message.bundle.id,{id:message.bundle.id,navigation:message.navigation,text:typeof text==='string'&&await matchesSource(message.navigation,model.root,text)?text:undefined,texts});
        if(continuousBases.size>4){const oldest=[...continuousBases.keys()].find(id=>id!==continuousBasis?.id&&id!==message.bundle.id);if(oldest)continuousBases.delete(oldest);}
      }
      if(message.profile)console.debug('Full preview preparation',JSON.stringify({id:message.bundle.id,page,targetPage:target?.[2],focusPage:message.displayFocus?.region?.[2],focusLine:message.displayFocus?.line,cursorLine:view?.state.doc.lineAt(view.state.selection.main.head).number,encodeMs:message.profile.encodeMs,transportMs:performance.timeOrigin+arrivedAt-message.profile.sentAt,decodeMs:decodedAt-arrivedAt,loadMs:loadedAt-decodedAt,locationMs:locatedAt-loadedAt,renderMs:renderedAt-locatedAt,sourceMapMs:performance.now()-renderedAt}));
      prepared={id:message.bundle.id,pdf,task,page,canvas,navigation:message.navigation,target,displayFocus:message.displayFocus};await api.call('ack',message.bundle.id,null);
    }catch(e){void task?.destroy();await api.call('ack',message.bundle.id,String(e));}
  }
  if(message.type==='commit'&&prepared?.id===message.id){
    const fullSequence=localInputs.get(message.timing?.editId)?.sequence??0,recoveryVerified=current?.timing?.recovered&&message.timing&&!message.timing.recovered&&fullSequence>=displayedSequence,retainLocal=!!message.timing&&!message.timing.recovered&&localCanvas?.dataset.localRecovered!=='true'&&!recoveryVerified&&!!localCanvas&&(fullSequence<displayedSequence||!canonicalRequested&&model.continuousPreview&&localCanvas.dataset.localLayout==='flow'&&localCanvas.dataset.localStateChanged!=='true'&&fullSequence===displayedSequence);
    renderToken++;const old=current;current=prepared;prepared=undefined;if(!retainLocal){show(current,!!localCanvas&&localCanvas.dataset.localSourceHash===current.canvas.dataset.sourceHash);canonicalRequested=false;}
    if(retainLocal&&localCanvas?.dataset.localLayout==='paragraph'&&localPatch&&current.page===localPatch.page&&current.canvas.width===localCanvas.width&&current.canvas.height===localCanvas.height){
      const p=localPatch,saved=document.createElement('canvas');saved.width=p.width;saved.height=p.height;saved.getContext('2d')!.drawImage(localCanvas,p.x,p.y,p.width,p.height,0,0,p.width,p.height);const ctx=localCanvas.getContext('2d')!;ctx.drawImage(current.canvas,0,0);ctx.drawImage(saved,p.x,p.y);saved.width=saved.height=0;
    }
    if(!retainLocal)displayedSequence=fullSequence;scheduleFit(true);
    navigationToken++;el('navState').textContent=retainLocal?'Source navigation will be available after full verification.':current.navigation?current.navigation.recovery?'Temporary preview: unchanged mapped text is navigable':'Click PDF text to show its source':'Source navigation unavailable for this preview';
    if(!retainLocal&&current.displayFocus&&current.navigation){const frame=current;void continuousSetup.then(async()=>{if(await matchesSource(frame.navigation,active))return;const row=await displayFocusLocation(frame.displayFocus,frame.navigation);if(current===frame&&model.continuousPreview&&model.followPreview&&row&&row[2]<=frame.pdf.numPages)continuousView.revealPosition(row[2],row[4]);}).catch(()=>{});}
    if(!retainLocal&&model.followPreview&&current.navigation)void locateSource(false).catch(e=>{el('navState').textContent=String(e);});
    current.timing=message.timing;
    if(previewSession){previewSession.pending=true;drawPreviewCaret();void refreshPreviewCaret().catch(()=>{endPreview();el('navState').textContent='Continue editing in the source pane.';});}
    previewKnownCurrent=!!message.timing&&message.timing.editId===latestEdit?.id;
    if(previewKnownCurrent){compileIssue=undefined;renderIssue();}
    if(message.timing)previewUpdating=true;
    const candidate=current,edit=latestEdit?.id===message.timing?.editId?latestEdit:undefined;
    // Allow a paint opportunity after inserting the canvas. Do not stop the
    // edit clock at offscreen rendering, durable publication, or the IPC send.
    const finishDisplay=()=>{
      if(retainLocal)return;
      if(current?.id!==candidate.id)return;
      current.displayReady=true;
      const verifiedElapsed=edit&&!edit.displayed?Math.ceil(performance.now()-edit.startedAt):undefined;
      if(verifiedElapsed!==undefined)void api.call('previewTiming',message.timing?.editId,verifiedElapsed).catch(()=>{});
      const localElapsed=message.timing?.editId?localInputs.get(message.timing.editId)?.displayedLatencyMs:undefined;
      const elapsed=localElapsed??verifiedElapsed;
      current.canvas.dataset.verificationLatencyMs=verifiedElapsed===undefined?'':String(verifiedElapsed);
      if(edit)edit.displayed=true;
      current.canvas.dataset.editLatencyMs=elapsed===undefined?'':String(elapsed);
      current.canvas.dataset.editId=message.timing?.editId??'';
      current.canvas.dataset.timingEndpoint=message.visible?'paint opportunity':'canvas (window hidden)';
      current.displayStatus=message.timing?.recovered?'Recovered preview updated.':localElapsed!==undefined?`Full document verified. Local preview appeared in ${localElapsed} ms from edit.`:elapsed===undefined?'Preview updated.':`Preview updated in ${elapsed} ms from edit.`;
      if(message.timing?.backend)current.displayStatus+=' '+message.timing.backend;
      if(message.timing&&!message.visible)current.displayStatus+=' Window hidden; measured to canvas.';
      if(message.timing&&previewUpdating)refreshPreviewStatus();
    };
    if(message.visible)requestAnimationFrame(()=>requestAnimationFrame(finishDisplay));else finishDisplay();
    const retainContinuous=retainLocal&&model.continuousPreview;
    if(old?.canvas&&old.canvas!==current.canvas&&!(model.continuousPreview&&old.canvas.isConnected))old.canvas.width=old.canvas.height=0;
    if(retainContinuous&&old?.id===continuousView.id&&!continuousLease)continuousLease={id:old.id,task:old.task};
    else if(old?.task!==continuousLease?.task)void old?.task.destroy();
  }
  if(message.type==='discard'&&prepared?.id===message.id){void prepared.task.destroy();prepared=undefined;}
  if(message.type==='close')await command(async()=>{
    // A failed autosave has already sent the draft to the main process. It
    // must not prevent the main process from offering to keep it and close.
    try{await flush();}catch(e){report(e);}
    await api.call('close');
  });
});
model=await api.call('initialize');zoomChoice=model.zoom==='fit-width'?'fit-width':[.8,1,1.25,1.5,2].includes(model.zoom)?model.zoom:1;el<HTMLSelectElement>('zoom').value=String(zoomChoice);if(typeof zoomChoice==='number')scale=zoomChoice;zoomLabel();panelLayout.restore(model.panelLayout);renderEditor();scheduleFit(true);renderToolchain(model.toolchain,true);if(model.showToolchainSetup)el('settings').click();
