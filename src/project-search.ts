import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {editableProjectFile,projectPath} from './project-navigation';
export const searchHash=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
const fileKey=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
export interface SearchDocument {path:string;text:string;diskHash:string;dirty:boolean;eol:string;}
export interface SearchOptions {query:string;replacement:string;regex:boolean;caseSensitive:boolean;}
export interface SearchMatch {id:string;file:string;from:number;to:number;line:number;context:string;before:string;after:string;}
export interface SearchSnapshot {file:string;text:string;diskHash:string;baselineHash:string;eol:string;}
export interface SearchResult {matches:SearchMatch[];files:SearchSnapshot[];scanned:number;skipped:number;limited:boolean;}
export function findMatches(text:string,file:string,options:SearchOptions,limit=1000):SearchMatch[]{
 if(!options.query||options.query.length>1000)throw Error('Enter a search of 1–1000 characters.');
 if(options.replacement.length>10000)throw Error('The replacement is too long (maximum 10,000 characters).');
 const pattern=new RegExp(options.regex?options.query:options.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),(options.regex?'gmu':'gu')+(options.caseSensitive?'':'i')),matches:SearchMatch[]=[];let match:RegExpExecArray|null,line=1,previous=0;
 while((match=pattern.exec(text))&&matches.length<limit){
  const from=match.index,to=from+match[0].length;line+=(text.slice(previous,from).match(/\n/g)||[]).length;previous=from;
  const after=options.regex?options.replacement.replace(/\$(\$|&|<[^>]+>|\d{1,2})/g,(token,key:string)=>{if(key==='$')return '$';if(key==='&')return match![0];if(key[0]==='<')return match!.groups?match!.groups[key.slice(1,-1)]??'':token;const index=Number(key);if(index>0&&index<match!.length)return match![index]??'';if(key.length===2&&Number(key[0])>0&&Number(key[0])<match!.length)return (match![Number(key[0])]??'')+key[1];return token;}):options.replacement;
  if(after.length>100000)throw new RangeError('A replacement expands beyond 100,000 characters. Narrow the expression.');
  matches.push({id:file+'#'+matches.length,file,from,to,line,context:text.slice(Math.max(text.lastIndexOf('\n',from-1)+1,from-70),Math.min(text.indexOf('\n',to)<0?text.length:text.indexOf('\n',to),to+90)),before:match[0].slice(0,300)+(match[0].length>300?'…':''),after});
  if(!match[0].length)pattern.lastIndex=from+(text.codePointAt(from)!>0xffff?2:1);
 }
 return matches;
}
export async function scanProject(folders:string[],docs:SearchDocument[],options:SearchOptions):Promise<SearchResult>{
 const result:SearchResult={matches:[],files:[],scanned:0,skipped:0,limited:false},seen=new Set<string>();let bytes=0,entries=0;
 const visit=async(folder:string,depth:number)=>{
  if(depth>20||result.limited)return;let items;try{await projectPath(folder,folders,true);items=await fs.readdir(folder,{withFileTypes:true});}catch{result.skipped++;return;}
  for(const item of items){if(result.limited)break;if(++entries>10000){result.limited=true;break;}if(item.isSymbolicLink()||item.name.startsWith('.')||item.name==='node_modules')continue;const file=path.join(folder,item.name),key=process.platform==='win32'?file.toLowerCase():file;if(seen.has(key))continue;seen.add(key);
   if(item.isDirectory()){await visit(file,depth+1);continue;}if(!item.isFile()||!editableProjectFile(file))continue;
   if(result.scanned>=2000||result.matches.length>=1000||result.files.length>=200){result.limited=true;break;}
   try{await projectPath(file,folders);const raw=await fs.readFile(file),doc=docs.find(d=>fileKey(d.path)===fileKey(file));if(raw[0]===0xef&&raw[1]===0xbb){result.skipped++;continue;}const diskText=new TextDecoder('utf-8',{fatal:true}).decode(raw),text=doc?.text??diskText.replace(/\r\n/g,'\n');bytes+=raw.length+Buffer.byteLength(text);if(bytes>32*1024*1024){result.limited=true;break;}result.scanned++;
    const target=doc?.path??file,remaining=1000-result.matches.length,matches=findMatches(text,target,options,remaining+1);if(matches.length>remaining){matches.length=remaining;result.limited=true;}if(matches.length){const diskHash=searchHash(raw);result.files.push({file:target,text,diskHash,baselineHash:doc?.diskHash??diskHash,eol:doc?.eol??(diskText.includes('\r\n')?'\r\n':'\n')});result.matches.push(...matches);}
   }catch(error){if(error instanceof SyntaxError||error instanceof RangeError)throw error;result.skipped++;}
  }
 };
 // Validate even if the folder has no editable files.
 findMatches('', '',options);for(const folder of folders)await visit(folder,0);return result;
}
export async function replacementPlan(result:SearchResult,ids:string[],docs:SearchDocument[],folders:string[]){
 const wanted=new Set(ids);if(!wanted.size||wanted.size!==ids.length||ids.some(id=>!result.matches.some(m=>m.id===id)))throw Error('Select current search matches.');
 const changes:{file:string;before:string;after:string;diskHash:string;eol:string;edits:{from:number;to:number;insert:string}[]}[]=[];
 for(const snapshot of result.files){const matches=result.matches.filter(m=>m.file===snapshot.file&&wanted.has(m.id));if(!matches.length)continue;await projectPath(snapshot.file,folders);const doc=docs.find(d=>d.path===snapshot.file),diskHash=searchHash(await fs.readFile(snapshot.file));
  if(diskHash!==snapshot.diskHash||snapshot.baselineHash!==snapshot.diskHash||doc&&(doc.text!==snapshot.text||doc.diskHash!==snapshot.baselineHash))throw Error('Search preview is stale or a file changed outside the app: '+path.basename(snapshot.file)+'. Search again after resolving any disk conflict.');
  let after=snapshot.text;for(const match of [...matches].reverse())after=after.slice(0,match.from)+match.after+after.slice(match.to);if(Buffer.byteLength(after)>8*1024*1024)throw Error('Replacement would make '+path.basename(snapshot.file)+' exceed 8 MB.');
  changes.push({file:snapshot.file,before:snapshot.text,after,diskHash,eol:snapshot.eol,edits:matches.map(m=>({from:m.from,to:m.to,insert:m.after}))});
 }
 return changes;
}
export class ProjectSearch{
 constructor(private timeoutMs=10000){}
 private cancel?:()=>void;
 stop(){this.cancel?.();}
 run(folders:string[],docs:SearchDocument[],options:SearchOptions):Promise<SearchResult>{
  this.cancel?.();return new Promise((resolve,reject)=>{const worker=new Worker(path.join(__dirname,'project-search-worker.js'),{workerData:{folders,docs,options}}),timer=setTimeout(()=>finish(Error('Search took too long. Narrow the search or simplify the regular expression.')),this.timeoutMs);
   const finish=(error?:Error,value?:SearchResult)=>{clearTimeout(timer);worker.removeAllListeners();void worker.terminate();if(this.cancel===cancel)this.cancel=undefined;error?reject(error):resolve(value!);},cancel=()=>finish(Error('Search cancelled.'));this.cancel=cancel;
   worker.once('message',result=>result.error?finish(Error(result.error)):finish(undefined,result));worker.once('error',error=>finish(error));worker.once('exit',code=>finish(Error('Search worker stopped ('+code+').')));
  });
 }
}
