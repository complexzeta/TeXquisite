import {execFile} from 'node:child_process';
import * as path from 'node:path';
import type {Navigation,Region} from './navigation';
let cancelRunning:(()=>void)|undefined;
export function cancelNativeNavigation(){cancelRunning?.();cancelRunning=undefined;}
async function query(args:string[]):Promise<string>{cancelNativeNavigation();return new Promise((resolve,reject)=>{
 let obsolete=false;
 const child=execFile('synctex',args,{windowsHide:true,timeout:5000,maxBuffer:1024*1024,env:{...process.env,SYNCTEX_VIEWER:'',SYNCTEX_EDITOR:''}},(error,stdout)=>{
  if(cancelRunning===cancel)cancelRunning=undefined;
  if(obsolete)resolve('');else if(error)reject(Error('SyncTeX navigation failed: '+error.message));else resolve(stdout);
 });
 const cancel=()=>{obsolete=true;child.kill();};cancelRunning=cancel;
});}
const field=(result:string,key:string)=>result.match(new RegExp('^'+key+':([^\\r\\n]+)','m'))?.[1];
export async function nativeForward(pdf:string,nav:Navigation,file:string,line:number,page:number):Promise<Region|undefined>{
 const input=nav.nativeInputs?.[file];if(!input)return;
 const result=await query(['view','-i',`${line}:0:${input}`,'-o',pdf]);
 const target=Number(field(result,'Page')),x=Number(field(result,'h')),bottom=Number(field(result,'v')),width=Number(field(result,'W')),height=Number(field(result,'H'));
 if([target,x,bottom,width,height].every(Number.isFinite)&&target>0)return [file,line,target,x,bottom-height,Math.max(1,width),Math.max(5,height)];
}
export async function nativeBackward(pdf:string,nav:Navigation,page:number,x:number,y:number):Promise<Region|undefined>{
 const result=await query(['edit','-o',`${page}:${x}:${y}:${pdf}`]);
 const input=field(result,'Input'),line=Number(field(result,'Line'));
 const file=input?Object.keys(nav.nativeInputs??{}).find(file=>path.resolve(nav.nativeInputs![file]).toLowerCase()===path.resolve(input).toLowerCase()):undefined;
 if(file&&Number.isInteger(line)&&line>0)return [file,line,page,x,y,1,5];
}
