import type {Navigation,Region,Character} from './navigation';
import type {BuildDiagnostic} from './diagnostics';
// A correspondence authorizes navigation only, never editing, compiler reuse,
// raster proofs or export. A changed line is deliberately unmapped as a whole.
export function sourceCorrespondence(original:string,compiled:string){
 const a=original.split('\n'),b=compiled.split('\n'),aStarts=[0],bStarts=[0];
 for(let i=0;i<original.length;i++)if(original[i]==='\n')aStarts.push(i+1);
 for(let i=0;i<compiled.length;i++)if(compiled[i]==='\n')bStarts.push(i+1);
 const lines=new Map<number,number>(),excluded:number[]=[];
 if(a.length===b.length){for(let i=0;i<b.length;i++)if(a[i]===b[i])lines.set(i+1,i+1);}
 else{let prefix=0,suffix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;for(let i=0;i<prefix;i++)lines.set(i+1,i+1);for(let i=0;i<suffix;i++)lines.set(b.length-i,a.length-i);}
 const kept=new Set(lines.values());for(let i=1;i<=a.length;i++)if(!kept.has(i))excluded.push(i);
 return {lines,excluded,position(at:number,end:number){
  if(!Number.isSafeInteger(at)||!Number.isSafeInteger(end)||at<0||end<=at||end>compiled.length)return;
  let low=0,high=bStarts.length;while(low+1<high){const mid=(low+high)>>>1;if(bStarts[mid]<=at)low=mid;else high=mid;}
  const line=lines.get(low+1);if(line===undefined||end>bStarts[low]+b[low].length)return;
  const shift=aStarts[line-1]-bStarts[low];return {at:at+shift,end:end+shift};
 }};
}
export function recoveryNavigation(nav:Navigation,root:string,original:string,compiled:string,originalHash:string):Navigation|undefined{
 if(nav.nativeInputs)return;const map=sourceCorrespondence(original,compiled),blocked=new Map<string,Region>();
 const project=<T extends Region|Character>(row:T):T|undefined=>{
  if(row[0]!==root)return row;const line=map.lines.get(row[1]);
  if(line!==undefined)return [row[0],line,...row.slice(2)] as T;
  const glyph=row.length>=9,page=row[glyph?3:2] as number,x=row[glyph?4:3] as number,y=row[glyph?5:4] as number,w=row[glyph?6:5] as number,h=row[glyph?7:6] as number;
  const key=row[1]+':'+page,prior=blocked.get(key);if(prior){const right=Math.max(prior[3]+prior[5],x+w),bottom=Math.max(prior[4]+prior[6],y+h);prior[3]=Math.min(prior[3],x);prior[4]=Math.min(prior[4],y);prior[5]=right-prior[3];prior[6]=bottom-prior[4];}else blocked.set(key,[root,row[1],page,x,y,w,h]);
 };
 const rows=<T extends Region|Character>(values:T[]|undefined)=>values?.map(project).filter((r):r is T=>!!r);
 const regions=rows(nav.regions)!,characters=rows(nav.characters),mathCharacters=rows(nav.mathCharacters);
 return {...nav,sources:{...nav.sources,[root]:originalHash},regions,characters,mathCharacters,recovery:{excluded:{[root]:map.excluded},blocked:[...blocked.values()]}};
}
export const recoveryLineBlocked=(nav:Navigation,file:string,line:number)=>!!Object.entries(nav.recovery?.excluded??{}).find(([path])=>path.replaceAll('\\','/').toLowerCase()===file.replaceAll('\\','/').toLowerCase())?.[1].includes(line);
export const recoveryPointBlocked=(nav:Navigation,page:number,x:number,y:number)=>!!nav.recovery?.blocked.some(r=>r[2]===page&&x>=r[3]-2&&x<=r[3]+r[5]+2&&y>=r[4]-2&&y<=r[4]+r[6]+2);
export function recoveryLocations<T extends {at:number;end:number;x:number;y:number;width:number;height:number}>(locations:readonly T[],original:string,compiled:string){
 const map=sourceCorrespondence(original,compiled),kept:T[]=[],blocked:{x:number;y:number;width:number;height:number}[]=[];
 for(const g of locations){const position=map.position(g.at,g.end);if(position)kept.push({...g,...position});else blocked.push({x:g.x,y:g.y,width:g.width,height:g.height});}return {locations:kept,blocked};
}

// Diagnostic projection is not a compiler proof. Callers require successful
// local flow and unchanged state or ordinary text edits. Lecture state changes
// remain provisional; this grants no compiler, editing or export authority.
export function carryRecoveryDiagnostics(issues:readonly BuildDiagnostic[],root:string,previous:string,current:string,sourceHash:string,editId:string){
 if(!issues.length)return;
 const map=sourceCorrespondence(current,previous),result:BuildDiagnostic[]=[];
 for(const issue of issues){
  if(issue.root!==root||issue.file!==root||!issue.line||issue.severity==='warning')return;
  const line=map.lines.get(issue.line);if(line===undefined)return;
  result.push({...issue,line,editId,sourceHash});
 }
 return result;
}
export function retainRecoveryProblems(carried:readonly BuildDiagnostic[],problems:readonly BuildDiagnostic[],diagnostic?:BuildDiagnostic){
 const byId=new Map(carried.map(issue=>[issue.id,issue]));if(!byId.size||byId.size!==carried.length)return;
 const errors=[...problems,...(diagnostic?[diagnostic]:[])].filter(issue=>issue.severity!=='warning');
 if(!errors.length||errors.some(issue=>!byId.has(issue.id)))return;
 const next=problems.map(issue=>byId.get(issue.id)??issue);
 for(const issue of carried)if(!next.some(prior=>prior.id===issue.id))next.push(issue);
 return {problems:next,diagnostic:diagnostic?byId.get(diagnostic.id)??carried[0]:carried[0]};
}
