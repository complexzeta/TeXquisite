// These edits exist only in a disposable compilation copy. They never authorize
// source edits, local checkpoint proofs, navigation, or a verified PDF export.
function literalContextEnd(text:string,shown:string):number|undefined{
 // TeX shortens long input lines with a leading ellipsis. Recover the
 // location only when the remaining literal suffix identifies one occurrence.
 // Short or repeated suffixes cannot establish which token TeX rejected.
 if(!shown.startsWith('...'))return text.startsWith(shown)?shown.length:undefined;
 const suffix=shown.slice(3);if(suffix.length<16)return;
 const at=text.indexOf(suffix);if(at<0||text.indexOf(suffix,at+1)!==-1)return;
 return at+suffix.length;
}
export function previewRepair(source:string,log:string):{source:string;message:string;line:number}|undefined{
 const context=/^l\.(\d+)[ \t]+([^\r\n]*)/m.exec(log);
 if(!context)return;
 const line=Number(context[1]),lines=source.split('\n'),text=lines[line-1];if(text===undefined)return;
 const start=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0);
 if(/Undefined control sequence/.test(log)){
  const beforeContext=log.slice(log.indexOf('Undefined control sequence'),context.index);
  if(/->|<argument>|<template>|<inserted text>|<to be read again>/.test(beforeContext))return;
  const command=/\\[A-Za-z@]+\s*$/.exec(context[2])?.[0].trim();if(!command)return;
  const prefix=context[2].trimEnd(),end=literalContextEnd(text,prefix);if(end===undefined)return;
  const at=end-command.length;
  if(at<0||/[A-Za-z@]/.test(text[at+command.length]??''))return;
  // An expanded package/macro error must not delete a similarly named root
  // command. Require the diagnostic's source prefix to match literally.
  if(text.slice(at,at+command.length)!==command)return;
  return {source:source.slice(0,start+at)+' '.repeat(command.length)+source.slice(start+at+command.length),message:'Preview skipped undefined command '+command+'.',line};
 }
 if(/Missing \$ inserted/.test(log)){
  const prefix=context[2].trimEnd(),symbol=prefix.at(-1);
  if((symbol==='_'||symbol==='^')&&text.startsWith(prefix)&&text[prefix.length-2]!=='\\'){
   const at=start+prefix.length-1,replacement=symbol==='_'?'\\_':'\\^{}';
   return {source:source.slice(0,at)+replacement+source.slice(at+1),message:'Preview escaped a text-only '+symbol+' symbol.',line};
  }
 }
 if(/Extra }, or forgotten|Too many }/.test(log)){
  const prefix=context[2].trimEnd();if(!prefix.endsWith('}')||!text.startsWith(prefix))return;
  const at=start+prefix.length-1;
  return {source:source.slice(0,at)+' '+source.slice(at+1),message:'Preview ignored an extra closing brace.',line};
 }
 // At document end, LaTeX can identify an unclosed environment exactly.
 const environment=/\\begin\{([A-Za-z@*]+)\} on input line \d+ ended by \\end\{document\}/.exec(log);
 if(environment&&/^\s*\\end\s*\{document\}/.test(text)){
  const at=start+text.indexOf('\\end');
  return {source:source.slice(0,at)+'\\end{'+environment[1]+'}'+source.slice(at),message:'Preview temporarily closed '+environment[1]+'.',line};
 }
 // TeX also closes unterminated inline math at an empty paragraph boundary.
 if(/Missing \$ inserted/.test(log)&&!text.trim()){
  return {source:source.slice(0,start)+'$'+source.slice(start),message:'Preview temporarily closed math at a paragraph boundary.',line};
 }
 // Missing final math/group closers: insert only when TeX points at a literal
 // document end. Never scan arbitrary macro bodies to guess their grammar.
 if(/^\s*\\end\s*\{document\}/.test(text)){
  const token=/Missing \$ inserted/.test(log)?'$':/Missing } inserted/.test(log)?'}':/Missing \\right\./.test(log)?'\\right.':undefined;
  if(token){const at=start+text.indexOf('\\end');return {source:source.slice(0,at)+token+source.slice(at),message:'Preview temporarily inserted '+token+' before document end.',line};}
 }
}
export function recoverableTexError(log:string){return /Undefined control sequence|Missing \$ inserted|Missing [}{] inserted|Extra }, or forgotten|Too many }|Runaway argument|Paragraph ended before|File ended while scanning|Missing \\right|\\begin\{[^\n]+ended by \\end/.test(log);}

// Only a failed, already proved local region may use this lexical approximation.
// It is not a TeX parser or a proof: the engine must accept the repaired copy,
// normal layout guards still apply, and the resulting frame has no navigation.
export function previewRegionRepair(source:string,log:string,range:{from:number;to:number},cursor?:number):ReturnType<typeof previewRepair>{
 if(!Number.isSafeInteger(range.from)||!Number.isSafeInteger(range.to)||range.from<0||range.to>source.length||range.from>=range.to)return;
 // Prepared windows sometimes include an unchanged neighboring paragraph.
 // Narrow to the cursor's complete paragraph, never close an environment just
 // because it legitimately continues into the next paragraph of that window.
 if(cursor!==undefined){
  if(!Number.isSafeInteger(cursor)||cursor<range.from||cursor>=range.to)return;
  let from=range.from,to=range.to;
  for(const separator of source.slice(range.from,range.to).matchAll(/\n[\t ]*\n/g)){
   const start=range.from+separator.index,end=start+separator[0].length;
   if(end<=cursor)from=end;else{to=end;break;}
  }
  range={from,to};
 }
 const text=source.slice(range.from,range.to),ending=/\n[\t ]*\n$/.exec(text);
 if(!ending||text.length>16000||/\n[\t ]*\n/.test(text.slice(0,ending.index)))return;
 if(!/Local paragraph needs input beyond its boundary|Missing [}{$] inserted|Missing \\right|Paragraph ended before|File ended while scanning|ended by \\end|Misplaced \\cr|Bad math environment delimiter|You can't use [^\r\n]*\\eqno[^\r\n]*math mode/.test(log))return;
 // Catcode changes, literal verbatim and macro definitions cannot be inferred
 // from braces. Reject them even though the output is only approximate.
 if(/\\(?:catcode|csname|def|edef|gdef|xdef|let|futurelet|newcommand|renewcommand|providecommand|verb|lstinline)\b|\\begin\s*\{(?:verbatim\*?|Verbatim|lstlisting|minted)\}/.test(text))return;
 type Token={kind:'group'|'math'|'left'|'env';close:string;math?:boolean};
 const stack:Token[]=[],edits:{at:number;to:number;insert:string}[]=[];let finalComment:number|undefined;
 const inMath=()=>stack.some(t=>t.kind==='math'||t.math);
 const insert=(at:number,value:string)=>{edits.push({at,to:at,insert:value});};
 const closeMath=(at:number,close:string)=>{
  const last=stack.map(t=>t.kind).lastIndexOf('math');if(last<0)return false;
  if(stack[last].close!==close)return false;
  let extra='';while(stack.length>last+1){const top=stack.pop()!;if(top.kind!=='group'&&top.kind!=='left')return false;extra+=top.close;}
  if(extra)insert(at,extra);stack.pop();return true;
 };
 for(let i=0;i<ending.index;){
  const c=text[i];if(c==='%'){const end=text.indexOf('\n',i);if(end===ending.index)finalComment=i;i=end<0?ending.index:end+1;continue;}
  if(c==='\\'){
   const token=/^\\(?:[A-Za-z@]+|[^\r\n])/.exec(text.slice(i))?.[0];if(!token)return;
   const at=i;i+=token.length;
   if(token==='\\begin'||token==='\\end'){
    const env=/^[\t \r\n]*\{([A-Za-z*]+)\}/.exec(text.slice(i));if(!env||env[1]==='document')return;
    i+=env[0].length;
    if(token==='\\begin')stack.push({kind:'env',close:'\\end{'+env[1]+'}',math:/^(?:equation|align|alignat|gather|multline|displaymath|math)\*?$/.test(env[1])});
    else{
     const last=stack.map(t=>t.kind).lastIndexOf('env');if(last<0)return;
     let extra='';while(stack.length>last+1){const top=stack.pop()!;if(!stack[last].math||(top.kind!=='group'&&top.kind!=='left'))return;extra+=top.close;}
     if(extra)insert(at,extra);const top=stack.pop()!;if(top.close!=='\\end{'+env[1]+'}')edits.push({at,to:i,insert:top.close});
    }
   }else if(/^\\(?:frac|dfrac|tfrac)$/.test(token)&&inMath()){
    // Recognize only a missing literal braced argument at a math boundary.
    // TeX also allows token/macro arguments; leave those to the engine.
    const tail=text.slice(i,ending.index),numerator=/^\s*\{[^{}\\%]*\}/.exec(tail),after=numerator?tail.slice(numerator[0].length):tail;
    if(/^\s*(?:\$|\\[)\]]|\\end\{|$)/.test(after))insert(i+(numerator?.[0].length??0),numerator?'{}':'{}{}');
   }else if(token==='\\('||token==='\\['){if(inMath())return;stack.push({kind:'math',close:token==='\\('?'\\)':'\\]'});}
   else if(token==='\\)'||token==='\\]'){if(!closeMath(at,token))return;}
   else if(token==='\\left'||token==='\\right'){
    const delimiter=/^[\t ]*(?:\\(?:[A-Za-z]+|[^\r\n])|[.()[\]{}|<>/])/.exec(text.slice(i));if(!delimiter||!inMath())return;i+=delimiter[0].length;
    if(token==='\\left')stack.push({kind:'left',close:'\\right.'});else if(stack.pop()?.kind!=='left')return;
   }
   continue;
  }
  if(c==='$'){
   const token=text[i+1]==='$'?'$$':'$';if(stack.some(t=>t.kind==='math')){if(!closeMath(i,token))return;}else{if(inMath())return;stack.push({kind:'math',close:token});}i+=token.length;continue;
  }
  if(c==='{')stack.push({kind:'group',close:'}'});
  else if(c==='}'&&stack.pop()?.kind!=='group')return;
  i++;
 }
 if(stack.length){
  // Do not guess the end of an arbitrary text command's runaway argument.
  if(stack.some((t,i)=>t.kind==='group'&&!stack.slice(0,i).some(p=>p.kind==='math'||p.math)))return;
  insert(finalComment??ending.index,stack.reverse().map(t=>t.close).join(''));
 }
 if(!edits.length||edits.length>8||edits.some(e=>e.insert.length>256))return;
 let repaired=text;for(const edit of edits.sort((a,b)=>b.at-a.at||b.to-a.to))repaired=repaired.slice(0,edit.at)+edit.insert+repaired.slice(edit.to);
 return {source:source.slice(0,range.from)+repaired+source.slice(range.to),message:'Preview temporarily balanced unfinished math or an environment in this paragraph.',line:source.slice(0,range.from).split('\n').length};
}
