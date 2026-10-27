// Change only the compilation copy. Keep source bytes/line numbers in the editor.
// A literal empty document otherwise succeeds without creating a PDF at all.
export function emptyDocumentPreview(source:string){
 const blank=(text:string)=>text.replace(/[^\r\n]/g,' ');
 const visible=source.replace(/(^|[^\\])(?:\\\\)*%[^\r\n]*/gm,m=>m.replace(/%[^\r\n]*/,blank))
  .replace(/\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|filecontents\*?|comment)\}[\s\S]*?\\end\s*\{\1\}/g,blank)
  .replace(/\\verb\*?([^\sA-Za-z])[^\r\n]*?\1/g,blank);
 // Ignore document tokens inside macro definitions/arguments. Stop at the real
 // top-level document start, rather than finding a later example in its body.
 let depth=0,at:number|undefined;
 for(const token of visible.matchAll(/\\(?:[A-Za-z@]+|[^A-Za-z@])|[{}]/g)){
  if(token[0]==='{'){depth++;continue;}if(token[0]==='}'){depth--;continue;}
  if(depth!==0||token[0]!=='\\begin')continue;
  const begin=/^\\begin\s*\{document\}/.exec(visible.slice(token.index));if(!begin)continue;
  const from=token.index!+begin[0].length,end=/^(\s*)\\end\s*\{document\}/.exec(visible.slice(from));
  if(!end)return source;at=from+end[1].length;break;
 }
 if(at===undefined)return source;
 // Test after LaTeX flushes its output, so preamble/end-document hooks that
 // already produce a page retain their output. A raw empty box has no footer.
 const placeholder='\\ifdefined\\AddToHook\\AddToHook{enddocument/afterlastpage}{\\ifnum\\ReadonlyShipoutCounter=0 \\shipout\\hbox{}\\fi}\\else\\null\\thispagestyle{empty}\\fi ';
 return source.slice(0,at)+placeholder+source.slice(at);
}
