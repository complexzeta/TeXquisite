// Preserve source offsets while ignoring TeX comments when inspecting the preamble.
function visibleSource(source:string){return source.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm,match=>match.replace(/%[^\n]*/,tail=>' '.repeat(tail.length)));}
export function documentBodyStart(source:string){
 const begin=/\\begin\s*\{document\}/.exec(visibleSource(source));
 if(!begin)throw new Error('The root document needs \\begin{document} before an image can be inserted.');
 return begin.index+begin[0].length;
}
export function graphicxInsertion(source:string):{from:number;insert:string}|undefined {
 const visible=visibleSource(source);
 const begin=/\\begin\s*\{document\}/.exec(visible);
 if(!begin)throw new Error('The root document needs \\begin{document} before an image can be inserted.');
 const preamble=visible.slice(0,begin.index);
 if([...preamble.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g)].some(m=>m[1].split(',').some(p=>p.trim()==='graphicx')))return;
 const line=source.lastIndexOf('\n',begin.index-1)+1;
 const from=source.slice(line,begin.index).trim()?begin.index:line;
 return {from,insert:'\\usepackage{graphicx}\n'};
}
export function imageTex(name:string){
 if(!/^images\/pasted-image-[a-zA-Z0-9-]+\.png$/.test(name))throw new Error('Invalid pasted image name.');
 return '\n\\includegraphics[width=0.8\\linewidth]{'+name+'}\n';
}
