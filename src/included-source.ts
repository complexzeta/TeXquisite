import * as path from 'node:path';
export interface IncludedInput {file:string;text:string;}
// Locate a single literal inclusion path. Dynamic or repeated input remains a full build.
export function includedEntry(root:string,resources:[string,Uint8Array][],target:string):number|undefined{
 const files=new Map(resources.map(([name,bytes])=>[name,Buffer.from(bytes).toString('utf8')]));
 const normalize=(name:string)=>{const s=name.replace(/^"|"$/g,'').replaceAll('\\','/');if(path.posix.isAbsolute(s)||s.includes(':')||s.split('/').includes('..'))return;const n=path.posix.normalize(s);return files.has(n)?n:files.has(n+'.tex')?n+'.tex':undefined;};
 const entries:number[]=[];
 const visit=(source:string,top:number|undefined,seen:Set<string>,depth:number)=>{
  if(depth>16)return;
  const visible=source.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm,m=>m.replace(/%[^\n]*/,s=>' '.repeat(s.length)));
  for(const match of visible.matchAll(/\\(?:input|include)(?![A-Za-z])\s*(?:\{([^{}\\]+)\}|([^\s{}%\\]+))/g)){
   const file=normalize((match[1]??match[2]).trim());if(!file)continue;const entry=top??match.index!;
   if(file===target){entries.push(entry);continue;}if(seen.has(file))continue;
   visit(files.get(file)!,entry,new Set([...seen,file]),depth+1);
  }
 };
 visit(root,undefined,new Set(),0);return entries.length===1?entries[0]:undefined;
}
