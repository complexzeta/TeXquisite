import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {CommandArguments,definedArguments,texWithoutComments} from './tex-arguments';

export function argumentPackages(source:string){
 const names=['latex.ltx'];
 for(const match of texWithoutComments(source).matchAll(/\\(documentclass|LoadClass|usepackage|RequirePackage)(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)){
  for(const name of match[2].split(',').map(name=>name.trim()))if(/^[A-Za-z0-9_.-]+$/.test(name))names.push(name+(/class|Class/.test(match[1])?'.cls':'.sty'));
 }
 return [...new Set(names)];
}
// Read declarations only. Package code is never executed for editor completion.
export async function packageArguments(source:string,folders:string[],locate:(names:string[])=>Promise<string[]>):Promise<CommandArguments>{
 const levels:CommandArguments[]=[],seen=new Set<string>();
 let pending=argumentPackages(source),bytes=0;
 scan: for(let depth=0;depth<4&&pending.length&&seen.size<64;depth++){
  const counts:CommandArguments={};levels.push(counts);
  const names=pending.filter(name=>!seen.has(name)).slice(0,64-seen.size);names.forEach(name=>seen.add(name));
  const installed=await locate(names).catch(()=>[]),byName=new Map(installed.map(file=>[path.basename(file),file]));
  pending=[];
  for(const name of names){
   let text:string|undefined;
   for(const folder of folders){try{const file=path.join(folder,name),stat=await fs.stat(file);if(stat.size<=2*1024*1024){text=await fs.readFile(file,'utf8');break;}}catch{}}
   if(text===undefined&&byName.has(name)){try{const file=byName.get(name)!,stat=await fs.stat(file);if(stat.size<=2*1024*1024)text=await fs.readFile(file,'utf8');}catch{}}
   if(text===undefined)continue;
   bytes+=Buffer.byteLength(text);if(bytes>8*1024*1024)break scan;
   Object.assign(counts,definedArguments(text));
   pending.push(...argumentPackages(text).filter(name=>!seen.has(name)));
  }
 }
 return Object.assign({},...levels.reverse());
}
