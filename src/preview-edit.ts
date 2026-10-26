import type {Navigation,Character} from './navigation';
export type PdfCharacter=[code:number,x:number,y:number,width:number,height:number];
// Columns and lengths in a ProseLine are UTF-16 offsets, as used by CodeMirror.
// Compiler metadata stays in input bytes; conversion is explicit at the boundary.
export interface ProseLine {file:string;line:number;page:number;from:number;to:number;glyphs:Character[];stops?:number[];}
export function ordinaryText(text:string){return !/[\\{}$%&#_^~\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(text.replace(/\t/g,''));}
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function textBoundary(text:string,position:number,direction:number){
 const points=[...segmenter.segment(text)].map(s=>s.index);points.push(text.length);
 return direction<0?points.filter(p=>p<position).at(-1)??0:points.find(p=>p>position)??text.length;
}
function byteOffsets(text:string){
 const result=new Map<number,number>();let byte=0,offset=0;
 for(const character of text){result.set(byte,offset);byte+=new TextEncoder().encode(character).length;offset+=character.length;}
 result.set(byte,offset);return result;
}
const normalized=(text:string)=>text.normalize('NFKC');
function unicodeText(characters:PdfCharacter[]){
 const accents:Record<string,string>={'´':'\u0301','`':'\u0300','ˆ':'\u0302','^':'\u0302','˜':'\u0303','~':'\u0303','¨':'\u0308','˙':'\u0307','˚':'\u030a','ˇ':'\u030c','˘':'\u0306','¯':'\u0304','˝':'\u030b','¸':'\u0327','˛':'\u0328'};
 const text=characters.map(p=>String.fromCodePoint(p[0]));
 if(text.length===2){const accent=text.find(c=>accents[c]||/^\p{M}$/u.test(c)),base=text.find(c=>c!==accent);if(accent&&base)return ((base==='ı'?'i':base==='ȷ'?'j':base)+(accents[accent]??accent)).normalize('NFC');}
 return normalized(text.join(''));
}
export function proseSpans(nav:Navigation,file:string,line:number,page:number,source:string,pdf:PdfCharacter[]):ProseLine[]{
 if(nav.nativeInputs)return [];
 const lines=source.split('\n'),text=lines[line-1];if(text===undefined||!text.trim())return [];
 const offsets=byteOffsets(text),all=(nav.characters??[]).filter(g=>g[0]===file&&g[1]===line),byColumn=new Map<number,Character[]>();
 for(const raw of all){const column=offsets.get(raw[2]),end=offsets.get(raw[2]+(raw[9]??1));if(column===undefined||end===undefined)continue;
  const g=[...raw] as Character;g[2]=column;g[9]=end-column;const entries=byColumn.get(column)??[];entries.push(g);byColumn.set(column,entries);
 }
 const usable=new Map<number,Character>(),used=new Set<PdfCharacter>();
 for(const [column,entries]of byColumn){
  const first=entries[0],literal=text.slice(column,column+first[9]!),unicode=/[^\x00-\x7f]/.test(literal);
  if(entries.length!==1&&!unicode)continue;
  if(entries.some(e=>e[3]!==page||e[9]!==first[9]))continue;
  const g=[...first] as Character;
  if(entries.length>1){const right=Math.max(...entries.map(e=>e[4]+e[6])),bottom=Math.max(...entries.map(e=>e[5]+e[7]));g[4]=Math.min(...entries.map(e=>e[4]));g[5]=Math.min(...entries.map(e=>e[5]));g[6]=right-g[4];g[7]=bottom-g[5];}
  if(g[3]!==page||!ordinaryText(literal)||!literal.trim())continue;
  // A compiler ligature must also have the expected literal components. Font
  // encoding numbers alone cannot establish the text represented by a glyph.
  if(!unicode&&(g[9]===1?g[8]!==literal.codePointAt(0):!['ff','fi','fl','ffi','ffl'].includes(literal)))continue;
  if(nav.regions.some(r=>(r[0]!==file||r[1]!==line)&&r[2]===page&&g[4]+g[6]/2>r[3]&&g[4]+g[6]/2<r[3]+r[5]&&g[5]+g[7]/2>r[4]&&g[5]+g[7]/2<r[4]+r[6]))continue;
  const matches=pdf.filter(p=>p[1]>=g[4]-1.5&&p[1]+p[3]<=g[4]+g[6]+1.5&&(unicode?p[2]>=g[5]-1.5&&p[2]+p[4]<=g[5]+g[7]+1.5:Math.abs(p[2]-g[5])<1.5&&Math.abs((p[2]+p[4])-(g[5]+g[7]))<1.5));
  if(!matches.length||matches.some(p=>used.has(p))||Math.abs(Math.min(...matches.map(p=>p[1]))-g[4])>=1.5||(unicode?unicodeText(matches):normalized(matches.map(p=>String.fromCodePoint(p[0])).join('')))!==literal)continue;
  for(const p of matches)used.add(p);usable.set(column,g);
 }
 // Any overlapping source intervals are ambiguous (e.g. reused macro args).
 for(const [column,g]of usable)if([...usable.keys()].some(c=>c>column&&c<column+g[9]!)){usable.delete(column);}
 const base=lines.slice(0,line-1).reduce((n,text)=>n+text.length+1,0),spans:ProseLine[]=[];
 for(let column=0;column<text.length;){
  if(!usable.has(column)){column++;continue;}
  const start=column,glyphs:Character[]=[];
  while(column<text.length){
   const g=usable.get(column);if(g){glyphs.push(g);column+=g[9]!;continue;}
   if(text[column]===' '){column++;if(usable.has(column))continue;break;}
   break;
  }
  spans.push({file,line,page,from:base+start,to:base+column,glyphs,stops:[...segmenter.segment(text.slice(start,column))].map(s=>base+start+s.index).concat(base+column)});
 }
 return spans;
}
export function proseLine(nav:Navigation,file:string,line:number,page:number,source:string,pdf:PdfCharacter[]){
 const spans=proseSpans(nav,file,line,page,source,pdf),text=source.split('\n')[line-1]??'';
 return spans.length===1&&spans[0].from===source.split('\n').slice(0,line-1).reduce((n,s)=>n+s.length+1,0)&&spans[0].to===spans[0].from+text.length&&ordinaryText(text)?spans[0]:undefined;
}
function boundaries(prose:ProseLine){
 const base=prose.from-prose.glyphs[0][2];
 return prose.glyphs.flatMap(g=>Array.from({length:(g[9]??1)+1},(_,i)=>({at:base+g[2]+i,x:g[4]+g[6]*i/(g[9]??1),y:g[5],baseline:g[5]+g[7],height:Math.max(9,g[7])}))).filter(p=>!prose.stops||prose.stops.includes(p.at));
}
export function nearestCaret(prose:ProseLine,x:number,y:number):number|undefined{
 const hit=prose.glyphs.some(g=>x>=g[4]-1&&x<=g[4]+g[6]+1&&y>=g[5]-1&&y<=g[5]+g[7]+1)||prose.glyphs.some((g,i)=>{const next=prose.glyphs[i+1];return next&&Math.abs(g[5]-next[5])<4&&x>=g[4]+g[6]&&x<=next[4]&&y>=Math.min(g[5],next[5])-1&&y<=Math.max(g[5]+g[7],next[5]+next[7])+1;});
 if(!hit)return;
 let best:number|undefined,score=12*12;
 for(const point of boundaries(prose)){const dy=Math.max(point.y-y,0,y-point.y-point.height),d=(x-point.x)**2+dy**2;if(d<score){score=d;best=point.at;}}
 return best;
}
export function caretBox(prose:ProseLine,position:number){
 const points=boundaries(prose),next=points.find(p=>p.at===position&&p.at<prose.to),prior=[...points].reverse().find(p=>p.at<=position),g=next??prior??points[0];
 return {x:g.x,y:g.y,height:g.height};
}
export function pageProse(nav:Navigation,file:string,page:number,source:string,pdf:PdfCharacter[]){
 const lines=new Set((nav.characters??[]).filter(g=>g[0]===file&&g[3]===page).map(g=>g[1]));
 return [...lines].sort((a,b)=>a-b).flatMap(line=>proseSpans(nav,file,line,page,source,pdf));
}
export function visualMoveAcross(spans:ProseLine[],active:ProseLine,position:number,key:string,preferredX?:number,currentBox?:{x:number;y:number;height:number}){
 const box=currentBox??caretBox(active,position),all=spans.flatMap(span=>boundaries(span).map(p=>({...p,span}))),rows:{y:number;points:typeof all}[]=[];
 for(const p of all){let row=rows.find(r=>Math.abs(r.y-p.baseline)<4);if(!row){row={y:p.baseline,points:[]};rows.push(row);}row.points.push(p);}
 rows.sort((a,b)=>a.y-b.y);const origin=all.find(p=>p.at===position&&Math.abs(p.x-box.x)<.1&&Math.abs(p.y-box.y)<.1),index=rows.findIndex(r=>r.points.includes(origin!)),row=rows[index];if(!row)return;
 if(key==='Home'||key==='End'){const target=row.points.reduce((a,b)=>key==='Home'?(b.x<a.x?b:a):(b.x>a.x?b:a));return {head:target.at,box:target,x:undefined,span:target.span};}
 const target=rows[index+(key==='ArrowUp'?-1:1)];if(!target)return;
 const x=preferredX??box.x,point=target.points.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);return {head:point.at,box:point,x,span:point.span};
}
export function visualMove(prose:ProseLine,position:number,key:string,preferredX?:number,currentBox?:{x:number;y:number;height:number}){
 return visualMoveAcross([prose],prose,position,key,preferredX,currentBox);
}
export function textChange(source:string,prose:Pick<ProseLine,'from'|'to'>,anchor:number,head:number,input:string,backward=false,forward=false){
 let from=Math.min(anchor,head),to=Math.max(anchor,head);
 if(from===to&&((backward&&from<=prose.from)||(forward&&to>=prose.to)))return;
 if(from===to){if(backward)from=textBoundary(source,from,-1);if(forward)to=textBoundary(source,to,1);}
 if(from<prose.from||to>prose.to||!ordinaryText(input))return;
 const result=source.slice(prose.from,from)+input+source.slice(to,prose.to);
 if(!ordinaryText(result))return;
 return {from,to,insert:input,head:from+input.length,end:prose.to+input.length-(to-from)};
}
