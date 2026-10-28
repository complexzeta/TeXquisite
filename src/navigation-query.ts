import type {Navigation,Region} from './navigation';
export interface LiveFlowFrame {root:string;file:string;baseId:string;sourceHash:string;editId:string;text:string;from:number;to:number;}
// Unchanged pages keep their original pixels. Their source offsets may move
// after a local replacement, but only exactly matching source is navigable.
export function unchangedPageLocations(nav:Navigation,file:string,before:string,after:string,excluded:{first:number;last:number}){
 let prefix=0,suffix=0;while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
 while(suffix<Math.min(before.length,after.length)-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
 const lines=before.split('\n'),starts=[0];for(let i=0;i<before.length;i++)if(before[i]==='\n')starts.push(i+1);
 const pages=new Map<number,{at:number;end:number;x:number;y:number;width:number;height:number}[]>();
 for(const g of [...(nav.characters??[]),...(nav.mathCharacters??[])]){
  if(g[0]!==file||g[3]>=excluded.first&&g[3]<=excluded.last)continue;
  const line=lines[g[1]-1],start=starts[g[1]-1];if(line===undefined||!sourceLineHasOutput(line))continue;
  const bytes=new TextEncoder().encode(line),left=g[2],right=left+(g[9]??1);
  if(left<0||right>bytes.length)continue;
  const decoder=new TextDecoder('utf-8',{fatal:true});let at:number,end:number;
  try{at=start+decoder.decode(bytes.slice(0,left)).length;end=start+decoder.decode(bytes.slice(0,right)).length;}catch{continue;}
  const shift=end<=prefix?0:at>=before.length-suffix?after.length-before.length:undefined;if(shift===undefined)continue;
  const locations=pages.get(g[3])??[];locations.push({at:at+shift,end:end+shift,x:g[4],y:g[5],width:g[6],height:g[7]});pages.set(g[3],locations);
 }
 return [...pages].map(([page,locations])=>({page,locations}));
}
export function liveFlowPosition(frame:LiveFlowFrame,current:{root:string;file:string;baseId:string;sourceHash?:string;editId?:string;text:string},locations:readonly {at:number;end:number;x:number;y:number;width:number;height:number}[],x:number,y:number){
 if(!frame.root||!frame.file||!frame.baseId||!frame.sourceHash||!frame.editId||(['root','file','baseId','sourceHash','editId','text'] as const).some(key=>frame[key]!==current[key]))return;
 if(!Number.isInteger(frame.from)||!Number.isInteger(frame.to)||frame.from<0||frame.to<=frame.from||frame.to>frame.text.length||!Number.isFinite(x)||!Number.isFinite(y))return;
 let closest:typeof locations[number]|undefined,distance=24*24;
 for(const g of locations){
  if(!Number.isInteger(g.at)||!Number.isInteger(g.end)||g.at<frame.from||g.end>frame.to||g.end<=g.at||![g.x,g.y,g.width,g.height].every(Number.isFinite)||g.width<=0||g.height<=0)continue;
  const d=Math.max(g.x-x,0,x-g.x-g.width)**2+Math.max(g.y-y,0,y-g.y-g.height)**2;
  if(d<distance){closest=g;distance=d;}
 }
 return closest?(x<closest.x+closest.width/2?closest.at:closest.end):undefined;
}
const sameFile=(a:string,b:string)=>a===b||a.replaceAll('\\','/').toLowerCase()===b.replaceAll('\\','/').toLowerCase();
export function sourceLineHasOutput(source:string){
 return !!source.trim()&&!/^\s*%/.test(source)&&!/^\s*\\(?:end\s*\{\s*document\s*\}|begin\s*\{\s*document\s*\}|(?:newpage|clearpage|cleardoublepage)\b)\s*(?:%.*)?$/.test(source);
}
export function forward(nav:Navigation,file:string,line:number,currentPage=1):Region|undefined{
 let best:Region|undefined,bestScore=Infinity;
 for(const row of nav.regions){if(!sameFile(row[0],file))continue;const delta=Math.abs(row[1]-line);if(delta>10)continue;const score=delta*100000+Math.abs(row[2]-currentPage)*100+row[4]/10000;if(score<bestScore){bestScore=score;best=row;}}
 return best;
}
// Prefer a glyph on the clicked source line, so a long physical line can
// navigate to its actual wrapped output rather than its first display line.
export function forwardPosition(nav:Navigation,file:string,text:string,at:number,currentPage=1):Region|undefined{
 const prefix=text.slice(0,Math.max(0,Math.min(at,text.length))),line=prefix.split('\n').length,column=new TextEncoder().encode(prefix.slice(prefix.lastIndexOf('\n')+1)).length;
 const lines=text.split('\n'),hasSourceOutput=(n:number)=>{
  const source=lines[n-1];
  // Shipout associates generated headers/footers with commands such as
  // \end{document}. They are not the output of the source cursor. Blank and
  // comment lines also have no position to reveal: preserve the viewport.
  return source!==undefined&&sourceLineHasOutput(source);
 };
 if(!hasSourceOutput(line))return;
 let best:NonNullable<Navigation['characters']>[number]|undefined,score=Infinity;
 for(const g of [...(nav.characters??[]),...(nav.mathCharacters??[])]){
  if(!sameFile(g[0],file)||g[1]!==line)continue;
  const distance=column>=g[2]&&column<g[2]+(g[9]??1)?0:Math.abs(column-g[2]);
  const rank=distance*100000+Math.abs(g[3]-currentPage)*100+g[5]/10000;
  if(rank<score){best=g;score=rank;}
 }
 return best?[best[0],best[1],best[3],best[4],best[5],best[6],best[7]]:forward({...nav,regions:nav.regions.filter(row=>!sameFile(row[0],file)||hasSourceOutput(row[1]))},file,line,currentPage);
}
export function backward(nav:Navigation,page:number,x:number,y:number):Region|undefined{
 let best:Region|undefined,distance=24*24;
 for(const row of nav.regions){if(row[2]!==page)continue;const dx=Math.max(row[3]-x,0,x-row[3]-row[5]),dy=Math.max(row[4]-y,0,y-row[4]-row[6]);const score=dx*dx+dy*dy;if(score<distance){distance=score;best=row;}}
 return best;
}

// A display hint belongs to an immutable full frame. It never authorizes
// source navigation, editing or local proof reuse against a newer source.
export interface PreviewFocus {file:string;sourceHash:string;prefixHash:string;line:number;column:number;region:Region;}
export function capturePreviewFocus(nav:Navigation|undefined,file:string,text:string,focus:{line:number;column:number}|undefined,digest:(text:string)=>string):PreviewFocus|undefined{
 if(!nav||!focus||!Number.isSafeInteger(focus.line)||!Number.isSafeInteger(focus.column)||focus.line<1||focus.column<0||nav.sources[file]!==digest(text))return;
 const lines=text.split('\n'),line=lines[focus.line-1];if(line===undefined||focus.column>line.length||!sourceLineHasOutput(line))return;
 const prefix=lines.slice(0,focus.line-1).map(line=>line+'\n').join(''),region=forwardPosition(nav,file,text,prefix.length+focus.column);
 if(!region||region[1]!==focus.line||region[2]<1||!Number.isSafeInteger(region[2])||!region.slice(3).every(Number.isFinite))return;
 return {file,sourceHash:nav.sources[file],prefixHash:digest(prefix),...focus,region};
}
export function previewFocusPrefix(hint:PreviewFocus|undefined,file:string,text:string,at:number):string|undefined{
 if(!hint||hint.file!==file||!Number.isSafeInteger(at)||at<0||at>text.length)return;
 const before=text.slice(0,at),line=before.split('\n').length,start=before.lastIndexOf('\n')+1,end=text.indexOf('\n',start),sourceLine=text.slice(start,end<0?text.length:end);
 if(line!==hint.line||Math.abs(at-start-hint.column)>64||!sourceLineHasOutput(sourceLine))return;
 return text.slice(0,start);
}
export async function previewFocusTarget(hint:PreviewFocus|undefined,nav:Navigation,file:string,text:string,at:number,digest:(text:string)=>Promise<string>):Promise<Region|undefined>{
 if(!hint||nav.sources[file]!==hint.sourceHash)return;
 const prefix=previewFocusPrefix(hint,file,text,at);if(prefix===undefined)return;
 const r=hint.region;if(r[0]!==file||r[1]!==hint.line||!Number.isSafeInteger(r[2])||r[2]<1||!r.slice(3).every(Number.isFinite))return;
 if(await digest(prefix)!==hint.prefixHash)return;
 return r;
}
