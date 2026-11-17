import {ChangeSet,ChangeDesc,EditorSelection,EditorState,Prec,StateEffect,StateField,TransactionSpec} from '@codemirror/state';
import {invertedEffects} from '@codemirror/commands';
import {keymap} from '@codemirror/view';
import {CommandArguments,multiArgumentCount} from './tex-arguments';

interface Closer {argument?:{group:number;index:number;count:number;opening:number};environment?:{from:number;to:number};opening?:{from:number;to:number;editing?:boolean};sized?:boolean;from:number;to:number;text:string;open:string;}
function mapClosers(values:readonly Closer[],changes:ChangeDesc):Closer[]{
  return values.flatMap(value=>{
    let touched=false;
    changes.iterChangedRanges((from,to)=>{if(from<value.to&&to>value.from||from===to&&from>value.from&&from<value.to)touched=true;});
    const from=changes.mapPos(value.from,1),to=changes.mapPos(value.to,-1);
    let opening=value.opening??(value.environment?{from:value.environment.from-7,to:value.environment.to+1,editing:false}:undefined);
    if(opening){
      const prior=opening;let editing=!!prior.editing;
      changes.iterChangedRanges((from,to)=>{if(from<prior.to&&to>prior.from||from===to&&from>prior.from&&from<prior.to)editing=true;});
      opening={from:changes.mapPos(prior.from,editing?-1:1),to:changes.mapPos(prior.to,editing?1:-1),editing};
    }
    const argument=value.argument?{...value.argument,group:changes.mapPos(value.argument.group,1),opening:changes.mapPos(value.argument.opening,1)}:undefined;
    return !touched&&to-from===value.text.length?[{...value,from,to,argument,opening,environment:value.environment?{from:changes.mapPos(value.environment.from,-1),to:changes.mapPos(value.environment.to,1)}:undefined}]:[];
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
 const commands=/\\(begin|end)\{([A-Za-z][\w*@.-]*)\}|\\([\[\]()])|%/g;
 let match:RegExpExecArray|null;
 while((match=commands.exec(text))){
   if(escaped(text,match.index))continue;
   if(match[0]==='%'){const end=text.indexOf('\n',match.index);if(end<0)break;commands.lastIndex=end+1;continue;}
   const name=match[2],literal=stack.at(-1);
   if(literal&&/^(?:verbatim\*?|Verbatim|lstlisting|minted|comment)$/.test(literal.name)&&!(match[1]==='end'&&name===literal.name))continue;
   if(match[3]){
     const token=match[3];
     if(token==='['||token==='(')stack.push({name:token,from:match.index,to:match.index+2,open:match[0]});
     else if(literal?.name===(token===']'?'[':'(')){
       stack.pop();values.push({from:match.index,to:match.index+2,text:match[0],open:literal.open,opening:{from:literal.from,to:literal.to}});
     }
     continue;
   }
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
    let pasted=false;tr.changes.iterChanges((_a,_b,_c,_d,text)=>{if(/\\(?:begin\{|[\[(])/.test(text.toString()))pasted=true;});
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
 return {changes,selection:EditorSelection.range(range.from+left.length,closeFrom),effects:remember.of([...mapClosers(state.field(closers,false)??[],changes),{from:closeFrom,to:closeFrom+close.length,text:close,open:left,sized:!!sized||delimiter.startsWith('\\'),opening:/^\\[\[(]$/.test(delimiter)?{from:range.from,to:range.from+delimiter.length}:undefined}])};
}
// This runs in the synchronous input path: source, autosave and typesetting see
// the opening and closing text in one transaction, never two separate edits.
export function completeTex(state:EditorState,input:string,enabled=true,signatures:CommandArguments={}):TransactionSpec{
  const plain=()=>state.replaceSelection(input),range=state.selection.main;
  if(!enabled||state.selection.ranges.length!==1||input.length!==1)return plain();
  const from=range.from,to=range.to;
  const known=state.field(closers,false)??[];
  if(input==='{'&&range.empty&&known.some(pair=>pair.argument?.opening===from))return {selection:{anchor:from+1}};
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
    const result=state.update(prefix,{...completeTex(intermediate,input,true,signatures),sequential:true});
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
  if((input==='['||input==='(')&&before.endsWith('\\')&&!escaped(before,before.length-1)){
    const replacing=known.find(pair=>pair.opening?.editing&&pair.opening.from===from-1&&pair.opening.to===from);
    if(replacing){
      const end=input==='['?'\\]':'\\)',changes=state.changes([{from,to,insert:input},{from:replacing.from,to:replacing.to,insert:end}]),closeFrom=changes.mapPos(replacing.from,-1);
      return {changes,selection:{anchor:from+1},effects:remember.of([...mapClosers(known.filter(pair=>pair!==replacing),changes),{from:closeFrom,to:closeFrom+end.length,text:end,open:'\\'+input,opening:{from:from-1,to:from+1}}])};
    }
  }
  if(input==='{'&&!escaped(before,before.length)){
    const command=multiArgumentCount(before,state.doc.sliceString(0,from),signatures);
    if(command&&!escaped(before,command.from)){
      const selected=state.doc.sliceString(from,to),insert='{'+selected+'}'+'{}'.repeat(command.count-1),changes=state.changes({from,to,insert});
      const group=state.doc.lineAt(from).from+command.from;
      const arguments_:Closer[]=Array.from({length:command.count},(_,index)=>{
        const opening=from+(index?selected.length+index*2:0),close=opening+1+(index?0:selected.length);
        return {from:close,to:close+1,text:'}',open:'{',argument:{group,index,count:command.count,opening}};
      });
      return {changes,selection:range.empty?{anchor:from+1}:EditorSelection.range(from+1,from+1+selected.length),effects:remember.of([...mapClosers(known,changes),...arguments_])};
    }
  }
  if((input==='$'||input==='}')&&escaped(before,before.length)&&!(matching&&matching.sized))return plain();
  const environment=input==='}'&&/\\begin\{([a-zA-Z][\w*@.-]*)$/.exec(before);
  const begin=environment&&!escaped(before,before.length-environment[0].length);
  if(begin){
    const end=`\\end{${environment![1]}}`,skip=!!matching;
    const replacing=known.find(pair=>pair.opening?.editing&&pair.opening.from===from-environment![0].length&&pair.from>=from+Number(skip));
    if(replacing){
      const changes=state.changes([...(skip?[]:[{from,to,insert:'}'}]),{from:replacing.from,to:replacing.to,insert:end}]);
      const closeFrom=changes.mapPos(replacing.from,-1);
      return {changes,selection:{anchor:from+1},effects:remember.of([...mapClosers(known.filter(pair=>pair!==replacing),changes),{from:closeFrom,to:closeFrom+end.length,text:end,open:environment![0]+'}',environment:{from:from-environment![1].length,to:from}}])};
    }
    if(skip&&known.some(pair=>pair.text===end&&(pair.from===from+1||pair.environment?.from===from-environment![1].length&&pair.environment.to===from)))return {selection:{anchor:from+1}};
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
  return {changes,selection:range.empty?{anchor:from+1}:EditorSelection.range(from+1,closeFrom),effects:remember.of([...mapClosers(known,changes),{from:closeFrom,to:closeFrom+close.length,text:close,open,opening:open==='\\['||open==='\\('?{from:from-1,to:from+1}:undefined}])};
}

export function nextTexArgument(state:EditorState,backward=false,enabled=true):TransactionSpec|undefined{
 if(!enabled||state.selection.ranges.length!==1)return;
 const range=state.selection.main,pairs=state.field(closers,false)??[];
 const current=pairs.filter(pair=>pair.argument&&range.from>pair.argument.opening&&range.to<=pair.from).sort((a,b)=>b.argument!.opening-a.argument!.opening)[0];
 if(!current?.argument)return;
 const argument=current.argument,group=pairs.filter(pair=>pair.argument?.group===argument.group);
 if(group.length!==argument.count||group.some(pair=>state.doc.sliceString(pair.argument!.opening,pair.argument!.opening+1)!=='{'))return;
 const next=group.find(pair=>pair.argument!.index===argument.index+(backward?-1:1));
 if(next)return {selection:{anchor:next.argument!.opening+1},scrollIntoView:true};
 if(!backward&&argument.index===argument.count-1)return {selection:{anchor:current.to},scrollIntoView:true};
}

export function texCompletion(enabled:()=>boolean){return [closers,pendingCloser,
  // Mirror tracked pairs in the same transaction, so history, autosave and
  // TeX receive the opener and its corresponding closer together.
  EditorState.transactionFilter.of(tr=>{
    if(!enabled()||!tr.docChanged||tr.effects.some(effect=>effect.is(remember)))return tr;
    const old=tr.startState.field(closers),mapped=mapClosers(old,tr.changes),edits:{from:number;to:number;insert:string}[]=[],renamed=new Map<Closer,string>(),mathConverted=new Map<Closer,string>();
    for(const pair of mapped){
      if(pair.opening?.editing){
        const opening=pair.opening,command=tr.newDoc.sliceString(opening.from,opening.to),match=/^\\begin\{([A-Za-z][\w*@.-]*)\}$/.exec(command);
        if(match){
          pair.environment={from:opening.from+7,to:opening.to-1};
          edits.push({from:pair.from,to:pair.to,insert:'\\end{'+match[1]+'}'});renamed.set(pair,match[1]);
        }else if(/^\\[\[(]$/.test(command)){
          const end=command==='\\['?'\\]':'\\)';
          edits.push({from:pair.from,to:pair.to,insert:end});mathConverted.set(pair,end);
        }
        continue;
      }
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
      const mathEnd=mathConverted.get(pair);
      if(mathEnd)return [{...pair,environment:undefined,opening:{from:changes.mapPos(pair.opening!.from,-1),to:changes.mapPos(pair.opening!.to,1)},from:changes.mapPos(pair.from,-1),to:changes.mapPos(pair.to,1),text:mathEnd,open:mathEnd==='\\]'?'\\[':'\\('}];
      const name=renamed.get(pair);
      if(name!==undefined)return [{...pair,opening:undefined,from:changes.mapPos(pair.from,-1),to:changes.mapPos(pair.to,1),text:'\\end{'+name+'}',open:'\\begin{'+name+'}',environment:{from:changes.mapPos(pair.environment!.from,-1),to:changes.mapPos(pair.environment!.to,1)}}];
      return mapClosers([pair],changes);
    });
    return tr.startState.update(tr,{changes,sequential:true,filter:false},{effects:remember.of(values),sequential:true});
  }),
  // CodeMirror's generic quote/parenthesis completion is deliberately disabled.
  EditorState.languageData.of(()=>[{closeBrackets:{brackets:[]}}]),
  invertedEffects.of(tr=>tr.docChanged||tr.effects.some(effect=>effect.is(remember))?[remember.of(tr.startState.field(closers))]:[]),
  Prec.highest(keymap.of([{key:'Tab',run(view){const spec=nextTexArgument(view.state,false,enabled());if(!spec)return false;view.dispatch(spec);return true;}},
  {key:'Shift-Tab',run(view){const spec=nextTexArgument(view.state,true,enabled());if(!spec)return false;view.dispatch(spec);return true;}},
  {key:'Backspace',run(view){
    const state=view.state,range=state.selection.main;
    if(!enabled()||state.selection.ranges.length!==1||!range.empty)return false;
    const pair=state.field(closers).find(pair=>pair.from===range.head&&pair.open.length<=2&&state.doc.sliceString(pair.from-pair.open.length,pair.from)===pair.open);
    if(!pair)return false;
    view.dispatch({changes:{from:pair.from-pair.open.length,to:pair.to},selection:{anchor:pair.from-pair.open.length},userEvent:'delete.backward'});return true;
  }}]))
];}
