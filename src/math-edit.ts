import type {Navigation,Character} from './navigation';
import type {PdfCharacter,ProseLine} from './preview-edit';
export interface MathNode {kind:'atom'|'group'|'frac'|'sqrt'|'script';from:number;to:number;text?:string;codes?:number[];children:MathSequence[];base?:MathNode;slot:string;}
export interface MathSequence {id:string;from:number;to:number;items:MathNode[];unbraced?:boolean;}
export interface MathFormula {block?:MathBlock;from:number;to:number;root:MathSequence;slots:MathSequence[];leaves:MathNode[];}
export interface MathBox {x:number;y:number;height:number;width:number;}
export interface MathCaret {at:number;slot:string;box:MathBox;}
export interface MathSpan extends ProseLine {kind:'math';formula:MathFormula;carets:MathCaret[];nodes:{node:MathNode;box:MathBox}[];}
const commands:Record<string,string>={pi:'π',alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ϵε',theta:'θ',lambda:'λ',mu:'μ',sigma:'σ',phi:'ϕφ',omega:'ω',infty:'∞',cdot:'⋅·',times:'×',pm:'±',leq:'≤',geq:'≥',neq:'≠'};
export function parseMath(source:string,from:number,to:number):MathFormula|undefined{
 if(to-from>8000)return;let at=from;const slots:MathSequence[]=[],leaves:MathNode[]=[];let depth=0;
 const space=()=>{while(at<to&&/\s/.test(source[at]))at++;};
 const sequence=(id:string,endBrace=false):MathSequence=>{if(++depth>32)throw Error('Math nesting limit');const s:MathSequence={id,from:at,to:at,items:[]};slots.push(s);
  while(at<to){space();if(at===to||endBrace&&source[at]==='}')break;const index=s.items.length;let node=primary(id,id+'.'+index);
   while(true){space();const marker=source[at];if(marker!=='^'&&marker!=='_')break;at++;const arg=argument(id+'.'+index+(marker==='^'?'.sup':'.sub'));if(node.kind!=='script')node={kind:'script',from:node.from,to:arg.to,children:[],base:node,slot:id};if(node.children.some(c=>c.id.endsWith(marker==='^'?'.sup':'.sub')))throw Error('Duplicate script');node.children.push(arg);node.to=at;}
   s.items.push(node);
  }s.to=at;depth--;return s;};
 const argument=(id:string):MathSequence=>{space();if(source[at]==='{'){at++;const s=sequence(id,true);if(source[at++]!=='}')throw Error('Missing brace');return s;}
  const start=at,n=primary(id,id+'.0'),s:MathSequence={id,from:start,to:at,items:[n],unbraced:true};slots.push(s);return s;};
 const primary=(slot:string,id:string):MathNode=>{space();const start=at,c=source[at];if(at>=to)throw Error('Missing math atom');
  if(c==='{'){at++;const group=sequence(id+'.group',true);if(source[at++]!=='}')throw Error('Missing brace');return {kind:'group',from:start,to:at,children:[group],slot};}
  if(c==='\\'){at++;const match=/^[A-Za-z]+/.exec(source.slice(at,to));if(!match)throw Error('Unsupported math command');at+=match[0].length;const name=match[0];
   if(name==='frac'||name==='sqrt'){space();if(source[at]!=='{')throw Error('Use braced math arguments');const children=[argument(id+(name==='frac'?'.num':'.rad'))];if(name==='frac'){space();if(source[at]!=='{')throw Error('Missing denominator');children.push(argument(id+'.den'));}return {kind:name,from:start,to:at,children,slot};}
   if(!commands[name])throw Error('Unsupported math command');const n:MathNode={kind:'atom',from:start,to:at,text:source.slice(start,at),codes:Array.from(commands[name]).map(c=>c.codePointAt(0)!),children:[],slot};leaves.push(n);return n;
  }
  if(!/[A-Za-z0-9+\-=<>(),.!:|/]/.test(c))throw Error('Unsupported math token');at++;const codes=c==='-'?[45,0x2212]:[c.codePointAt(0)!],n:MathNode={kind:'atom',from:start,to:at,text:c,codes,children:[],slot};leaves.push(n);return n;
 };
 try{const root=sequence('root');if(at!==to)return;return {from,to,root,slots,leaves};}catch{return;}
}
export interface MathBlock {from:number;to:number;kind:string;row:number;column:number;}
export interface MathRange {from:number;to:number;block?:MathBlock;}
// Delimiters and alignment separators are protected source boundaries. Each
// aligned cell has its own AST; navigation may cross cells, edits may not.
export function mathRanges(source:string):MathRange[]{
 const ranges:MathRange[]=[];let open:{from:number;closing:string;kind:string;aligned:boolean}|undefined;
 const add=(to:number)=>{const o=open!;if(o.kind==='inline'){ranges.push({from:o.from,to});return;}
  let start=o.from,depth=0,row=0,column=0;
  const cell=(end:number)=>{let from=start,last=end,again=true;
   while(again){again=false;const text=source.slice(from,last),lead=/^\s*(?:\\(?:label|tag\*?)\{[^{}\\\r\n]*\}|\\(?:notag|nonumber)\b)\s*/.exec(text);if(lead){from+=lead[0].length;again=true;continue;}const tail=/\s*(?:\\(?:label|tag\*?)\{[^{}\\\r\n]*\}|\\(?:notag|nonumber)\b)\s*$/.exec(text);if(tail){last=from+tail.index;again=true;}}
   if(from<last)ranges.push({from,to:last,block:{from:o.from,to,kind:o.kind,row,column}});
  };
  for(let i=o.from;i<to;i++){const c=source[i];if(c==='%'){while(i<to&&source[i]!=='\n')i++;continue;}if(c==='\\'){if(o.aligned&&depth===0&&source[i+1]==='\\'){cell(i);i++;if(source[i+1]==='*')i++;const space=/^\s*\[[\d. +\-a-zA-Z]*\]/.exec(source.slice(i+1,to));if(space)i+=space[0].length;start=i+1;row++;column=0;}else i++;continue;}if(c==='{')depth++;else if(c==='}')depth--;else if(o.aligned&&depth===0&&c==='&'){cell(i);start=i+1;column++;}}
  cell(to);
 };
 for(let at=0;at<source.length;at++){const c=source[at];if(c==='%'){while(at<source.length&&source[at]!=='\n')at++;continue;}
  if(open&&source.startsWith(open.closing,at)){const close=open.closing;add(at);open=undefined;at+=close.length-1;continue;}
  if(c==='\\'){
   if(!open){const begin=/^\\begin\{(equation\*?|align\*?)\}/.exec(source.slice(at));if(begin){open={from:at+begin[0].length,closing:'\\end{'+begin[1]+'}',kind:begin[1],aligned:begin[1].startsWith('align')};at+=begin[0].length-1;continue;}
    const next=source[at+1];if(next==='('||next==='['){open={from:at+2,closing:next==='('? '\\)':'\\]',kind:next==='('?'inline':'display',aligned:false};at++;continue;}
   }at++;continue;
  }
  if(c==='$'&&!open){const display=source[at+1]==='$';open={from:at+(display?2:1),closing:display?'$$':'$',kind:display?'display':'inline',aligned:false};if(display)at++;}
 }return ranges;
}
export function inlineMath(source:string){return mathRanges(source).filter(r=>!r.block).map(({from,to})=>({from,to}));}

const union=(boxes:MathBox[]):MathBox=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};};
export function mathSpans(nav:Navigation,file:string,line:number|undefined,page:number,source:string,pdf:PdfCharacter[],blockFrom?:number):MathSpan[]{
 if(nav.nativeInputs||!nav.mathCharacters)return [];const starts=[0];for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1);
 const offsets=new Map<number,Map<number,number>>(),byPosition=new Map<number,Character[]>();
 for(const raw of nav.mathCharacters){if(raw[0]!==file)continue;let map=offsets.get(raw[1]);if(!map){map=new Map();let byte=0,offset=starts[raw[1]-1];if(offset===undefined)continue;for(const c of source.slice(offset,starts[raw[1]]===undefined?source.length:starts[raw[1]]-1)){map.set(byte,offset);byte+=new TextEncoder().encode(c).length;offset+=c.length;}map.set(byte,offset);offsets.set(raw[1],map);}
  const start=map.get(raw[2]),end=map.get(raw[2]+(raw[9]??1));if(start===undefined||end===undefined)continue;const g=[...raw] as Character;g[2]=start;g[9]=end-start;const entries=byPosition.get(start)??[];entries.push(g);byPosition.set(start,entries);
 }
 const results:MathSpan[]=[];
 for(const range of mathRanges(source)){if(blockFrom!==undefined&&range.block?.from!==blockFrom)continue;if(line!==undefined&&(range.from>(starts[line]??source.length)||range.to<starts[line-1]))continue;const formula=parseMath(source,range.from,range.to);if(!formula?.leaves.length)continue;formula.block=range.block;
  const boxes=new Map<MathNode,MathBox>(),glyphs:Character[]=[],used=new Set<PdfCharacter>();let valid=true;
  for(const leaf of formula.leaves){const entries=byPosition.get(leaf.from);if(entries?.length!==1){valid=false;break;}const g=entries[0];if(g[3]!==page||g[9]!==leaf.to-leaf.from){valid=false;break;}
   if(nav.regions.some(r=>(r[0]!==file||r[1]!==g[1]&&(!range.block||(starts[r[1]]??source.length)<range.block.from||starts[r[1]-1]>range.block.to))&&r[2]===page&&g[4]+g[6]/2>r[3]&&g[4]+g[6]/2<r[3]+r[5]&&g[5]+g[7]/2>r[4]&&g[5]+g[7]/2<r[4]+r[6])){valid=false;break;}
   const matches=pdf.filter(p=>leaf.codes!.includes(p[0])&&p[1]>=g[4]-1.5&&p[1]+p[3]<=g[4]+g[6]+2&&p[2]>=g[5]-1.5&&p[2]+p[4]<=g[5]+g[7]+1.5);
   if(matches.length!==1||used.has(matches[0])){valid=false;break;}used.add(matches[0]);glyphs.push(g);boxes.set(leaf,{x:g[4],y:g[5],width:g[6],height:Math.max(g[7],1)});
  }if(!valid)continue;
  const nodes:{node:MathNode;box:MathBox}[]=[],carets:MathCaret[]=[];
  const nodeBox=(n:MathNode):MathBox|undefined=>{let box=boxes.get(n);if(box)return box;const parts=[...(n.base?[nodeBox(n.base)]:[]),...n.children.flatMap(s=>s.items.map(nodeBox))].filter(Boolean) as MathBox[];if(!parts.length)return;
   box=union(parts);if(n.kind==='sqrt'){const root=pdf.filter(p=>p[0]===0x221a&&p[1]<box!.x&&box!.x-p[1]<24&&p[2]<box!.y+box!.height&&p[2]+p[4]>box!.y);if(root.length===1)box=union([box,{x:root[0][1],y:root[0][2],width:root[0][3],height:root[0][4]}]);}boxes.set(n,box);return box;};
  const add=(at:number,slot:string,b:MathBox,right=false)=>{if(carets.some(c=>c.at===at&&c.slot===slot))return;carets.push({at,slot,box:{x:b.x+(right?b.width:0),y:b.y,width:0,height:Math.max(7,b.height)}});};
  const visit=(seq:MathSequence,fallback?:MathBox)=>{const parts=seq.items.map(nodeBox).filter(Boolean) as MathBox[],first=parts[0]??fallback,last=parts.at(-1)??fallback;if(!first||!last)return;add(seq.from,seq.id,first);add(seq.to,seq.id,last,true);
   for(const n of seq.items){const box=nodeBox(n);if(!box)continue;nodes.push({node:n,box});add(n.from,seq.id,box);add(n.to,seq.id,box,true);if(n.base){const b=nodeBox(n.base);if(b){add(n.base.from,seq.id,b);add(n.base.to,seq.id,b,true);}}
    for(const child of [...n.children,...(n.base?.children??[])]){let fb=box;if(!child.items.length&&n.kind==='frac'){const other=n.children.find(c=>c!==child),ob=other?.items.map(nodeBox).filter(Boolean) as MathBox[];if(ob?.length){const u=union(ob);fb={...u,y:u.y+(child.id.endsWith('.den')?1:-1)*(u.height+5)};}}visit(child,fb);}
   }
  };visit(formula.root);carets.sort((a,b)=>a.at-b.at||b.slot.split('.').length-a.slot.split('.').length);results.push({kind:'math',file,line:line??glyphs[0][1],page,from:formula.from,to:formula.to,glyphs,formula,carets,nodes});
 }return results;
}
export const isMath=(span:ProseLine):span is MathSpan=>(span as MathSpan).kind==='math';
export function mathCaretBox(span:MathSpan,at:number,slot?:string){return span.carets.find(c=>c.at===at&&(!slot||slot===c.slot))?.box??span.carets.reduce((a,b)=>Math.abs(b.at-at)<Math.abs(a.at-at)?b:a).box;}
export function nearestMathCaret(span:MathSpan,x:number,y:number):MathCaret|undefined{
 for(const g of span.glyphs){if(x>=g[4]-1&&x<=g[4]+g[6]+1&&y>=g[5]-1&&y<=g[5]+g[7]+1){const leaf=span.formula.leaves.find(n=>n.from===g[2])!;return span.carets.find(c=>c.slot===leaf.slot&&c.at===(x<g[4]+g[6]/2?leaf.from:leaf.to));}}
 if(!span.nodes.some(({box:b})=>x>=b.x-2&&x<=b.x+b.width+2&&y>=b.y-2&&y<=b.y+b.height+2))return;
 return [...span.carets].sort((a,b)=>distance(a.box,x,y)-distance(b.box,x,y))[0];
}
function distance(b:MathBox,x:number,y:number){return (b.x-x)**2+Math.max(b.y-y,0,y-b.y-b.height)**2;}
export function moveMath(span:MathSpan,at:number,slot:string,key:string,back=false){
 const list=span.carets,index=list.findIndex(c=>c.at===at&&c.slot===slot),current=list[index];if(!current)return;
 if(key==='Home'||key==='End'){const seq=list.filter(c=>c.slot===slot);return key==='Home'?seq[0]:seq.at(-1);}
 if(key==='Tab'){const ids=span.formula.slots.filter(s=>s.id!=='root');if(!ids.length)return;const i=ids.findIndex(s=>s.id===slot),s=ids[(i+(back?-1:1)+ids.length)%ids.length];return list.find(c=>c.slot===s.id&&c.at===s.from);}
 if(key==='ArrowLeft'||key==='ArrowRight')return list[index+(key==='ArrowLeft'?-1:1)];
 const sign=key==='ArrowUp'?-1:1,cy=current.box.y+current.box.height/2;return list.filter(c=>(c.box.y+c.box.height/2-cy)*sign>3).sort((a,b)=>distance(a.box,current.box.x,cy)-distance(b.box,current.box.x,cy))[0];
}
export function moveMathAcross(spans:MathSpan[],span:MathSpan,at:number,slot:string,key:string,back=false):{span:MathSpan;caret:MathCaret}|undefined{
 const block=span.formula.block;
 if(!block){const caret=moveMath(span,at,slot,key,back);return caret?{span,caret}:undefined;}
 const cells=spans.filter(s=>s.formula.block?.from===block.from).sort((a,b)=>a.from-b.from),current=span.carets.find(c=>c.at===at&&c.slot===slot);if(!current)return;
 if(key==='Tab'){
  const stops=cells.flatMap(s=>s.formula.slots.map(seq=>({span:s,caret:s.carets.find(c=>c.slot===seq.id&&c.at===seq.from)}))).filter(v=>v.caret) as {span:MathSpan;caret:MathCaret}[];
  const i=stops.findIndex(v=>v.span.from===span.from&&v.caret.slot===slot);return stops[(i+(back?-1:1)+stops.length)%stops.length];
 }
 if(key==='ArrowUp'||key==='ArrowDown'){
  const local=moveMath(span,at,slot,key,back);
  if(local&&local.slot!=='root')return {span,caret:local};
  // Stay in the same alignment column when changing rows. Ink heights vary
  // between letters and relation signs; Euclidean distance alone can jump
  // across the ampersand even when the caret's x position has not changed.
  const direction=key==='ArrowUp'?-1:1,rows=cells.filter(s=>(s.formula.block!.row-block.row)*direction>0).sort((a,b)=>Math.abs(a.formula.block!.row-block.row)-Math.abs(b.formula.block!.row-block.row));
  if(rows.length){const row=rows[0].formula.block!.row,all=rows.filter(s=>s.formula.block!.row===row),same=all.filter(s=>s.formula.block!.column===block.column),targets=(same.length?same:all).flatMap(s=>s.carets.map(caret=>({span:s,caret})));
   return targets.sort((a,b)=>Math.abs(a.caret.box.x-current.box.x)-Math.abs(b.caret.box.x-current.box.x)||distance(a.caret.box,current.box.x,current.box.y)-distance(b.caret.box,current.box.x,current.box.y))[0];
  }
  const sign=key==='ArrowUp'?-1:1,cy=current.box.y+current.box.height/2;
  return cells.flatMap(s=>s.carets.map(caret=>({span:s,caret}))).filter(v=>(v.caret.box.y+v.caret.box.height/2-cy)*sign>3).sort((a,b)=>distance(a.caret.box,current.box.x,cy)-distance(b.caret.box,current.box.x,cy))[0];
 }
 const local=moveMath(span,at,slot,key,back);if(local)return {span,caret:local};
 if(key==='ArrowLeft'||key==='ArrowRight'){const index=cells.findIndex(s=>s.from===span.from),next=cells[index+(key==='ArrowLeft'?-1:1)];if(next)return {span:next,caret:key==='ArrowLeft'?next.carets.at(-1)!:next.carets[0]};}
}
export type MathAction='frac'|'sqrt'|'sup'|'sub'|'pi';
export function changeMath(source:string,formula:MathFormula,slot:string,anchor:number,head:number,input:string,back=false,forward=false,action?:MathAction){
 let from=Math.min(anchor,head),to=Math.max(anchor,head),insert=input,selected=source.slice(from,to),anchorOut:number|undefined,headOut:number|undefined;
 if(from<formula.from||to>formula.to||/[\n\r$%&#~]/.test(input))return;
 let seq=formula.slots.find(s=>s.id===slot)??formula.root;
 if(!action&&(input==='^'||input==='_')){action=input==='^'?'sup':'sub';input='';}
 if(action){
  if(action==='frac'){insert='\\frac{'+(selected||'x')+'}{y}';anchorOut=from+(selected?insert.length-2:6);headOut=anchorOut+(selected?1:1);}
  if(action==='sqrt'){insert='\\sqrt{'+(selected||'x')+'}';anchorOut=from+6;headOut=anchorOut+(selected||'x').length;}
  if(action==='sup'||action==='sub'){from=to;insert=(action==='sup'?'^':'_')+'{'+(action==='sup'?'2':'i')+'}';anchorOut=from+2;headOut=anchorOut+1;}
  if(action==='pi')insert='\\pi ';
 }else if(from===to&&(back||forward)){
  const n=seq.items.find(n=>back?n.to===head:n.from===head);
  if(!n){
   if(!back||seq.items.length||!/(?:\.sup|\.sub)$/.test(seq.id)||source[seq.from-1]!=='{'||!['^','_'].includes(source[seq.from-2]))return;
   from=seq.from-2;to=seq.to+1;const parents:MathNode[]=[];const visit=(s:MathSequence)=>{for(const n of s.items){parents.push(n);for(const c of n.children)visit(c);if(n.base)for(const c of n.base.children)visit(c);}};visit(formula.root);const parent=parents.find(n=>n.children.includes(seq));slot=parent?.slot??'root';seq=formula.slots.find(s=>s.id===slot)??formula.root;
  }else{from=n.from;to=n.to;}
 }
 if(from<seq.from||to>seq.to)return;
 if(seq.unbraced&&!action){const value=source.slice(seq.from,from)+insert+source.slice(to,seq.to);insert='{'+value+'}';headOut=seq.from+1+(from-seq.from)+input.length;from=seq.from;to=seq.to;}
 const nextSource=source.slice(0,from)+insert+source.slice(to),end=formula.to+insert.length-(to-from),next=parseMath(nextSource,formula.from,end);if(!next)return;
 if(formula.block)next.block={...formula.block,to:formula.block.to+insert.length-(to-from)};
 const nextHead=headOut??from+insert.length,nextAnchor=anchorOut??nextHead;const nextSlot=(!action?next.slots.find(s=>s.id===slot&&nextHead>=s.from&&nextHead<=s.to):undefined)??[...next.slots].sort((a,b)=>(a.to-a.from)-(b.to-b.from)).find(s=>nextHead>=s.from&&nextHead<=s.to)??next.root;
 return {from,to,insert,head:nextHead,anchor:nextAnchor,end,formula:next,slot:nextSlot.id};
}
