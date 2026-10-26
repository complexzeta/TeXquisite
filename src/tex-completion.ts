import {ChangeSet,ChangeDesc,EditorSelection,EditorState,Prec,StateEffect,StateField,TransactionSpec} from '@codemirror/state';
import {invertedEffects} from '@codemirror/commands';
import {keymap} from '@codemirror/view';

interface Closer {environment?:{from:number;to:number};sized?:boolean;from:number;to:number;text:string;open:string;}
function mapClosers(values:readonly Closer[],changes:ChangeDesc):Closer[]{
  return values.flatMap(value=>{
    let touched=false;
    changes.iterChangedRanges((from,to)=>{if(from<value.to&&to>value.from||from===to&&from>value.from&&from<value.to)touched=true;});
    const from=changes.mapPos(value.from,1),to=changes.mapPos(value.to,-1);
    return !touched&&to-from===value.text.length?[{...value,from,to,environment:value.environment?{from:changes.mapPos(value.environment.from,-1),to:changes.mapPos(value.environment.to,1)}:undefined}]:[];
  });
}
const remember=StateEffect.define<readonly Closer[]>({map:mapClosers});
interface Pending {from:number;at:number;prefix:string;}
const rememberPending=StateEffect.define<Pending|undefined>();
const pendingCloser=StateField.define<Pending|undefined>({
  create:()=>undefined,
  update(value,tr){
    if(tr.docChanged||tr.selection&&tr.selection.main.head!==value?.at)value=undefined;
    for(const effect of tr.effects)if(effect.is(rememberPending))value=effect.value;
    return value;
  }
});
function existingEnvironments(text:string):Closer[]{
 const values:Closer[]=[],stack:{name:string;from:number;to:number;open:string}[]=[];
 const commands=/\\(begin|end)\{([A-Za-z][\w*@.-]*)\}|%/g;
 let match:RegExpExecArray|null;
 while((match=commands.exec(text))){
   if(escaped(text,match.index))continue;
   if(match[0]==='%'){const end=text.indexOf('\n',match.index);if(end<0)break;commands.lastIndex=end+1;continue;}
   const name=match[2],literal=stack.at(-1);
   if(literal&&/^(?:verbatim\*?|Verbatim|lstlisting|minted|comment)$/.test(literal.name)&&!(match[1]==='end'&&name===literal.name))continue;
   if(match[1]==='begin')stack.push({name,from:match.index+7,to:match.index+match[0].length-1,open:match[0]});
   else {
     const begin=stack.pop();
     if(begin?.name===name)values.push({from:match.index,to:match.index+match[0].length,text:match[0],open:begin.open,environment:{from:begin.from,to:begin.to}});
   }
 }
 return values;
}
const closers=StateField.define<readonly Closer[]>({
  create:state=>existingEnvironments(state.doc.toString()),
  update(value,tr){
    value=mapClosers(value,tr.changes);
    for(const effect of tr.effects)if(effect.is(remember))value=effect.value;
    // Discover complete environments pasted together, without rescanning on
    // each keystroke or reconnecting manually edited closing names.
    let pasted=false;tr.changes.iterChanges((_a,_b,_c,_d,text)=>{if(text.toString().includes('\\begin{'))pasted=true;});
    if(pasted){const seen=new Set(value.map(pair=>pair.from));value=[...value,...existingEnvironments(tr.newDoc.toString()).filter(pair=>!seen.has(pair.from))];}
    return value.filter(pair=>tr.newDoc.sliceString(pair.from,pair.to)===pair.text);
  }
});
function escaped(text:string,at:number){let slashes=0;while(at>0&&text[--at]==='\\')slashes++;return slashes%2===1;}
function comment(text:string){for(let at=0;at<text.length;at++)if(text[at]==='%'&&!escaped(text,at))return true;return false;}
function inDollarMath(text:string){
  let math=false;
  for(const line of text.split('\n'))for(let i=0;i<line.length;i++){
    if(line[i]==='%'&&!escaped(line,i))break;
    if(line[i]==='$'&&!escaped(line,i))math=!math;
  }
  return math;
}

const sizedDelimiters:Record<string,string>={
 '(':')','[':']',')':'(',']':'[','.':'.','|':'|','/':'/','<':'>','>':'<',
 '\\{':'\\}','\\}':'\\{','\\|':'\\|','\\langle':'\\rangle','\\rangle':'\\langle',
 '\\lfloor':'\\rfloor','\\rfloor':'\\lfloor','\\lceil':'\\rceil','\\rceil':'\\lceil',
 '\\lbrace':'\\rbrace','\\rbrace':'\\lbrace','\\lbrack':'\\rbrack','\\rbrack':'\\lbrack',
 '\\lvert':'\\rvert','\\rvert':'\\lvert','\\lVert':'\\rVert','\\rVert':'\\lVert',
 '\\vert':'\\vert','\\Vert':'\\Vert','\\backslash':'\\backslash',
 '\\uparrow':'\\uparrow','\\downarrow':'\\downarrow','\\updownarrow':'\\updownarrow',
 '\\Uparrow':'\\Uparrow','\\Downarrow':'\\Downarrow','\\Updownarrow':'\\Updownarrow',
 '\\lmoustache':'\\rmoustache','\\rmoustache':'\\lmoustache','\\lgroup':'\\rgroup','\\rgroup':'\\lgroup',
 '\\arrowvert':'\\arrowvert','\\Arrowvert':'\\Arrowvert','\\bracevert':'\\bracevert'
};
const openingDelimiters:Record<string,string>=Object.fromEntries(Object.entries(sizedDelimiters).filter(([name])=>/^\\l/.test(name)||['\\{','\\|','\\vert','\\Vert'].includes(name)));
export function surroundTex(state:EditorState,delimiter:string,enabled=true):TransactionSpec|undefined{
 const range=state.selection.main;if(!enabled||state.selection.ranges.length!==1||range.empty)return;
 const sized=/^\\left[ \t]*(.+)$/.exec(delimiter),token=sized?sized[1]:delimiter;
 const ordinary:Record<string,string>={'(':')','[':']','{':'}','\\(':'\\)','\\[':'\\]'};
 const right=sized?sizedDelimiters[token]:(ordinary[token]??(token.startsWith('\\')?sizedDelimiters[token]:undefined));
 if(!right)return;
 const left=delimiter+(/^\\[A-Za-z]+$/.test(token)?' ':''),close=(sized?'\\right':'')+right+(/^\\[A-Za-z]+$/.test(right)?' ':''),text=state.doc.sliceString(range.from,range.to),changes=state.changes({from:range.from,to:range.to,insert:left+text+close}),closeFrom=range.from+left.length+text.length;
 return {changes,selection:EditorSelection.range(range.from+left.length,closeFrom),effects:remember.of([...mapClosers(state.field(closers,false)??[],changes),{from:closeFrom,to:closeFrom+close.length,text:close,open:left,sized:!!sized||delimiter.startsWith('\\')}])};
}
// This runs in the synchronous input path: source, autosave and typesetting see
// the opening and closing text in one transaction, never two separate edits.
export function completeTex(state:EditorState,input:string,enabled=true):TransactionSpec{
  const plain=()=>state.replaceSelection(input),range=state.selection.main;
  if(!enabled||state.selection.ranges.length!==1||input.length!==1)return plain();
  const from=range.from,to=range.to;
  const known=state.field(closers,false)??[];
  const matching=range.empty&&known.find(pair=>from>=pair.from&&from<pair.to&&state.doc.sliceString(from,from+1)===input);
  const pending=state.field(pendingCloser,false);
  // Until a command closer has been fully typed, its prefix may instead be a
  // new command: \eta, \endless or a nested \begin. Restore that typed prefix
  // before the intact closer when input diverges, in a single transaction.
  const sizedPending=range.empty&&pending?.at===from?known.find(pair=>pair.sized&&pair.from===pending.from):undefined;
  if(!matching&&sizedPending&&pending&&(pending.prefix==='\\right'&&/[.()[\]|/<>\\]/.test(input)||/^\\right\\[A-Za-z]*$/.test(pending.prefix)&&/[A-Za-z]/.test(input))){
    const changes=state.changes({from,to:sizedPending.to,insert:input});
    return {changes,selection:{anchor:from+1},effects:[remember.of(mapClosers(known.filter(pair=>pair!==sizedPending),changes)),rememberPending.of(undefined)]};
  }
  if(!matching&&range.empty&&pending?.at===from&&known.some(pair=>pair.from===pending.from)){
    const prefix={changes:{from:pending.from,insert:pending.prefix},selection:{anchor:from}};
    const intermediate=state.update(prefix).state;
    const result=state.update(prefix,{...completeTex(intermediate,input),sequential:true});
    return {changes:result.changes,selection:result.selection,effects:result.effects};
  }
  if(!matching){
    const line=state.doc.sliceString(state.doc.lineAt(from).from,from),typed=line+input,match=/\\left[ \t]*(\\[A-Za-z]+|\\[^A-Za-z]|[()[\].|/<>])$/.exec(typed);
    if(match&&!comment(line)&&!escaped(typed,match.index)&&sizedDelimiters[match[1]]){
      const named=/^\\[A-Za-z]+$/.test(match[1]),right=sizedDelimiters[match[1]],separator=named?' ':'',close='\\right'+right+(/^\\[A-Za-z]+$/.test(right)?' ':'');
      const selected=state.doc.sliceString(from,to),insert=input+separator+selected+close,changes=state.changes({from,to,insert}),closeFrom=from+input.length+separator.length+selected.length;
      return {changes,selection:range.empty?{anchor:from+input.length+separator.length}:EditorSelection.range(from+input.length+separator.length,closeFrom),effects:remember.of([...mapClosers(known,changes),{from:closeFrom,to:closeFrom+close.length,text:close,open:match[0]+separator,sized:true}])};
    }
  }
  if(!matching){
    const line=state.doc.sliceString(state.doc.lineAt(from).from,from),typed=line+input,token=/\\(?:[A-Za-z]+|[{}|])$/.exec(typed);
    if(token&&!comment(line)&&!escaped(typed,token.index)&&openingDelimiters[token[0]]){
      const named=/[A-Za-z]$/.test(token[0]),separator=named?' ':'',right=openingDelimiters[token[0]],close=right+(/[A-Za-z]$/.test(right)?' ':''),selected=state.doc.sliceString(from,to),changes=state.changes({from,to,insert:input+separator+selected+close}),closeFrom=from+1+separator.length+selected.length;
      return {changes,selection:range.empty?{anchor:from+1+separator.length}:EditorSelection.range(from+1+separator.length,closeFrom),effects:remember.of([...mapClosers(known,changes),{from:closeFrom,to:closeFrom+close.length,text:close,open:token[0]+separator,sized:true}])};
    }
  }
  if(!matching&&!['{','}','$','[','('].includes(input))return plain();
  const line=state.doc.sliceString(state.doc.lineAt(from).from,from),before=line;
  if(comment(line))return plain();
  if((input==='$'||input==='}')&&escaped(before,before.length)&&!(matching&&matching.sized))return plain();
  const environment=input==='}'&&/\\begin\{([a-zA-Z][\w*@.-]*)$/.exec(before);
  const begin=environment&&!escaped(before,before.length-environment[0].length);
  if(begin){
    const end=`\\end{${environment![1]}}`,skip=!!matching;
    if(skip&&known.some(pair=>pair.from===from+1&&pair.text===end))return {selection:{anchor:from+1}};
    const changes=state.changes({from,to,insert:(skip?'':'}')+end});
    // A skipped brace stays on disk. Insert the environment end after it.
    const actual=skip?state.changes({from:from+1,insert:end}):changes;
    const closeFrom=from+1;
    return {changes:actual,selection:{anchor:closeFrom},effects:remember.of([...mapClosers(known,actual),{from:closeFrom,to:closeFrom+end.length,text:end,open:environment![0]+'}',environment:{from:from-environment![1].length,to:from}}])};
  }
  if(matching&&matching.sized&&matching.text.endsWith(' ')&&from+2===matching.to)return {selection:{anchor:matching.to},effects:rememberPending.of(undefined)};
  if(matching)return {selection:{anchor:from+1},effects:rememberPending.of(from+1<matching.to?{from:matching.from,at:from+1,prefix:matching.text.slice(0,from+1-matching.from)}:undefined)};
  let open=input,close='';
  if(input==='{'&&!escaped(before,before.length))close='}';
  else if(input==='$'&&!escaped(before,before.length)&&!inDollarMath(state.doc.sliceString(0,from)))close='$';
  else if((input==='['||input==='(')&&escaped(before,before.length)){open='\\'+input;close=input==='['?'\\]':'\\)';}
  if(!close&&(input==='('||input==='['))close=input==='('?')':']';
  if(!close)return plain();
  const selected=state.doc.sliceString(from,to),insert=input+selected+close,changes=state.changes({from,to,insert});
  const closeFrom=from+input.length+selected.length;
  return {changes,selection:range.empty?{anchor:from+1}:EditorSelection.range(from+1,closeFrom),effects:remember.of([...mapClosers(known,changes),{from:closeFrom,to:closeFrom+close.length,text:close,open}])};
}

export function texCompletion(enabled:()=>boolean){return [closers,pendingCloser,
  // Mirror only environments created by this completion extension. Both names
  // change in the same transaction, so history, autosave and TeX see one edit.
  EditorState.transactionFilter.of(tr=>{
    if(!enabled()||!tr.docChanged||tr.effects.some(effect=>effect.is(remember)))return tr;
    const old=tr.startState.field(closers),mapped=mapClosers(old,tr.changes),edits:{from:number;to:number;insert:string}[]=[],renamed=new Map<Closer,string>();
    for(const pair of mapped){
      if(!pair.environment)continue;
      const original=old.find(value=>value.environment&&tr.changes.mapPos(value.from,1)===pair.from);let touched=false;
      if(original?.environment)tr.changes.iterChangedRanges((from,to)=>{if(from<=original.environment!.to&&to>=original.environment!.from)touched=true;});
      if(!touched)continue;
      const {from,to}=pair.environment,name=tr.newDoc.sliceString(from,to);
      if(tr.newDoc.sliceString(Math.max(0,from-7),from)!=='\\begin{'||tr.newDoc.sliceString(to,to+1)!=='}'||!/^[A-Za-z][\w*@.-]*$/.test(name))continue;
      const end='\\end{'+name+'}';
      if(end!==pair.text){edits.push({from:pair.from,to:pair.to,insert:end});renamed.set(pair,name);}
    }
    if(!edits.length)return tr;
    edits.sort((a,b)=>a.from-b.from);
    const changes=ChangeSet.of(edits,tr.newDoc.length);
    const values=mapped.flatMap(pair=>{
      const name=renamed.get(pair);
      if(name!==undefined)return [{...pair,from:changes.mapPos(pair.from,-1),to:changes.mapPos(pair.to,1),text:'\\end{'+name+'}',open:'\\begin{'+name+'}',environment:{from:changes.mapPos(pair.environment!.from,-1),to:changes.mapPos(pair.environment!.to,1)}}];
      return mapClosers([pair],changes);
    });
    return tr.startState.update(tr,{changes,sequential:true,filter:false},{effects:remember.of(values),sequential:true});
  }),
  // CodeMirror's generic quote/parenthesis completion is deliberately disabled.
  EditorState.languageData.of(()=>[{closeBrackets:{brackets:[]}}]),
  invertedEffects.of(tr=>tr.docChanged||tr.effects.some(effect=>effect.is(remember))?[remember.of(tr.startState.field(closers))]:[]),
  Prec.highest(keymap.of([{key:'Backspace',run(view){
    const state=view.state,range=state.selection.main;
    if(!enabled()||state.selection.ranges.length!==1||!range.empty)return false;
    const pair=state.field(closers).find(pair=>pair.from===range.head&&pair.open.length<=2&&state.doc.sliceString(pair.from-pair.open.length,pair.from)===pair.open);
    if(!pair)return false;
    view.dispatch({changes:{from:pair.from-pair.open.length,to:pair.to},selection:{anchor:pair.from-pair.open.length},userEvent:'delete.backward'});return true;
  }}]))
];}
