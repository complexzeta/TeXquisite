import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';

export class SuccessfulSourceStore{
 private values=new Map<string,string>();
 private pending=new Map<string,string>();
 private timer?:ReturnType<typeof setTimeout>;
 private writing=Promise.resolve();
 constructor(private directory:string){}
 private file(source:string){return path.join(this.directory,createHash('sha256').update(path.resolve(source)).digest('hex')+'.json');}
 remember(file:string,text:string){
  if(this.values.get(file)===text)return;
  this.values.set(file,text);this.pending.set(file,text);
  clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),10000);this.timer.unref();
 }
 async read(file:string){
  if(this.values.has(file))return this.values.get(file);
  try{const saved=JSON.parse(await fs.readFile(this.file(file),'utf8'));if(this.values.has(file))return this.values.get(file);if(saved.file===file&&typeof saved.text==='string'){this.values.set(file,saved.text);return saved.text;}}catch{}
 }
 async flush(){
  clearTimeout(this.timer);const entries=[...this.pending];this.pending.clear();
  this.writing=this.writing.catch(()=>{}).then(async()=>{
   await fs.mkdir(this.directory,{recursive:true});
   for(const [file,text]of entries){
    const target=this.file(file),temporary=target+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({file,text}));await fs.rename(temporary,target);
   }
  }).catch(error=>{
   for(const [file,text]of entries)if(this.values.get(file)===text&&!this.pending.has(file))this.pending.set(file,text);
   throw error;
  });
  return this.writing;
 }
}
