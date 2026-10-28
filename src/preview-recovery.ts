// These edits exist only in a disposable compilation copy. They never authorize
// source edits, local checkpoint proofs, navigation, or a verified PDF export.
export function previewRepair(source:string,log:string):{source:string;message:string;line:number}|undefined{
 const context=/^l\.(\d+)[ \t]+([^\r\n]*)/m.exec(log);
 if(!context)return;
 const line=Number(context[1]),lines=source.split('\n'),text=lines[line-1];if(text===undefined)return;
 const start=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0);
 if(/Undefined control sequence/.test(log)){
  const beforeContext=log.slice(log.indexOf('Undefined control sequence'),context.index);
  if(/->|<argument>|<template>|<inserted text>|<to be read again>/.test(beforeContext))return;
  const command=/\\[A-Za-z@]+\s*$/.exec(context[2])?.[0].trim();if(!command)return;
  const prefix=context[2].trimEnd(),at=prefix.length-command.length;
  if(at<0||!text.startsWith(prefix)||/[A-Za-z@]/.test(text[at+command.length]??''))return;
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
