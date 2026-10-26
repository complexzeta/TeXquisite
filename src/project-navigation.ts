import * as fs from 'node:fs/promises';
import * as path from 'node:path';
export const editableProjectFile=(file:string)=>/\.(tex|bib|sty|cls|bst|def|cfg|clo|txt)$/i.test(file);
export function projectFolders(root:string,support:string[]=[]){return [...new Set([...(root?[path.dirname(path.resolve(root))]:[]),...support.map(folder=>path.resolve(folder))])];}
const within=(parent:string,file:string)=>{const relative=path.relative(parent,file);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export async function projectPath(file:string,folders:string[],directory=false){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Choose a file in the current project.');
 const resolved=path.resolve(file),real=await fs.realpath(resolved),roots=await Promise.all(folders.map(folder=>fs.realpath(folder).catch(()=>undefined)));
 if(!folders.some(folder=>within(path.resolve(folder),resolved))||!roots.some(folder=>folder&&within(folder,real)))throw Error('This path is outside the current project and support folders.');
 const stat=await fs.lstat(resolved);if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile()))throw Error('This project entry is not a regular '+(directory?'folder.':'file.'));
 if(!directory&&(!editableProjectFile(file)||stat.size>8*1024*1024))throw Error('Open a supported text file of at most 8 MB.');
 return resolved;
}
export async function listProjectFiles(folder:string,folders:string[],filter=''){
 folder=await projectPath(folder,folders,true);filter=String(filter).toLowerCase().slice(0,200);
 const entries:{path:string;name:string;directory:boolean}[]=[];let inspected=0,limited=false;
 const stream=await fs.opendir(folder);
 for await(const entry of stream){if(++inspected>20000){limited=true;break;}if(entry.isSymbolicLink()||entry.name.startsWith('.')||entry.name==='node_modules')continue;
  if(entry.isDirectory()||entry.isFile()&&editableProjectFile(entry.name)&&entry.name.toLowerCase().includes(filter))entries.push({path:path.join(folder,entry.name),name:entry.name,directory:entry.isDirectory()});
 }
 entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
 return {entries:entries.slice(0,500),limited:limited||entries.length>500};
}
