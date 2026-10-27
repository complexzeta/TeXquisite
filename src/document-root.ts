export interface PreviewDocument {path:string;text:string;}
export function standaloneTex(doc:PreviewDocument){
 if(!/\.tex$/i.test(doc.path))return false;
 const blank=(s:string)=>s.replace(/[^\n]/g,' ');
 const visible=doc.text.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm,m=>m.replace(/%[^\n]*/,blank))
  .replace(/\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|filecontents\*?|comment)\}[\s\S]*?\\end\s*\{\1\}/g,blank)
  .replace(/\\verb\*?([^\sA-Za-z])[^\r\n]*?\1/g,blank);
 return /(^|[^\\])(?:\\\\)*\\documentclass(?![A-Za-z@])\s*(?:\[[^\]]*\]\s*)?\{[^{}]+\}/m.test(visible)
  ||/(^|[^\\])(?:\\\\)*\\begin\s*\{document\}/m.test(visible);
}
// A standalone tab owns its preview. Chapters/support files retain the project
// in which they were opened or observed by actual compiler navigation.
export function previewRootForDocument(root:string,doc:PreviewDocument|undefined,rememberedRoot?:string,keepRoot=false){
 if(!doc||keepRoot)return root;
 if(standaloneTex(doc)||!root&&/\.tex$/i.test(doc.path))return doc.path;
 return rememberedRoot||root;
}
