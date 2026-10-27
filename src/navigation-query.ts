import type {Navigation,Region} from './navigation';
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
