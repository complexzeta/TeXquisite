type Event=Record<string,unknown>;
export interface PerformanceSnapshot{
  version:string;mode:'lecture'|'document';continuous:boolean;automatic:boolean;visible:boolean;
  localReady:boolean;localBusy:boolean;fastAvailable:boolean;fastPreparable:boolean;
  freeMiB:number;totalMiB:number;latestEditId?:string;standby?:string;retained:boolean;
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const layouts=new Set(['flow','retained-flow','neutral-blocks','paragraph','continuous-pages','page']);
const standbyStates=new Set(['retired','ready','preparing','unseeded','stale-seed','no-local-owner','busy','memory','active','waiting']);
function statistics(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,medianMs:sorted.length?sorted[Math.floor(sorted.length/2)]:null,p95Ms:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null,maxMs:sorted.at(-1)??null};}
/** Explicit whitelist: never copy arbitrary trace fields, source, IDs, paths,
 * compiler log messages or command lines into a user-shareable report. */
export function performanceReport(snapshot:PerformanceSnapshot,events:readonly Event[],now=Date.now()){
 const recent=events.slice(-64),frames=recent.filter(e=>(e.event==='local-displayed'||e.event==='full-displayed')&&finite(e.elapsedMs)&&e.elapsedMs<=86400000).slice(-20).map(e=>({kind:e.event==='local-displayed'?'local':'full',ms:Math.ceil(e.elapsedMs as number),...(layouts.has(String(e.layout))?{layout:String(e.layout)}:{})}));
 const routes={localReady:0,localWarming:0,full:0};for(const e of recent)if(e.event==='edit-route'){if(e.route==='local-ready')routes.localReady++;else if(e.route==='local-warming')routes.localWarming++;else if(e.route==='full')routes.full++;}
 const edit=snapshot.latestEditId?[...recent].reverse().find(e=>e.event==='edit-route'&&e.editId===snapshot.latestEditId):undefined,shown=!!edit&&recent.some(e=>(e.event==='local-displayed'||e.event==='full-displayed')&&e.editId===snapshot.latestEditId&&finite(e.elapsedMs));
 return {schema:1,version:snapshot.version,mode:snapshot.mode,continuous:!!snapshot.continuous,automatic:!!snapshot.automatic,windowVisible:!!snapshot.visible,retainedLayoutEnabled:!!snapshot.retained,
  memory:{freeMiB:finite(snapshot.freeMiB)?Math.round(snapshot.freeMiB):null,totalMiB:finite(snapshot.totalMiB)?Math.round(snapshot.totalMiB):null},
  preview:{ready:!!snapshot.localReady,busy:!!snapshot.localBusy,fastAvailable:!!snapshot.fastAvailable,fastPreparable:!!snapshot.fastPreparable,standby:standbyStates.has(snapshot.standby??'')?snapshot.standby:null},
  latestEdit:{observed:!!edit,frameAcknowledged:shown,pendingAgeMs:edit&&!shown&&finite(edit.time)&&finite(now)?Math.min(86400000,Math.max(0,Math.round(now-edit.time))):null},
  routes,latencyMs:{local:statistics(frames.filter(f=>f.kind==='local').map(f=>f.ms)),full:statistics(frames.filter(f=>f.kind==='full').map(f=>f.ms))},recentFrames:frames,
  scope:'Last 64 in-memory events, at most 20 renderer acknowledgements. Full times can include verification after an earlier local preview; this is not a physical-display benchmark.',privacy:'No source text, file paths, edit IDs or compiler logs. Nothing is uploaded automatically.'};
}
