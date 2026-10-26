import * as fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hash} from './core';

export interface SourceDocument {path:string;text:string;diskHash:string;dirty:boolean;eol:string;}
export class SourceConflictError extends Error {}
export function sourceBytes(doc:SourceDocument) {
  return Buffer.from(doc.eol==='\r\n'?doc.text.replace(/\r?\n/g,'\r\n'):doc.text,'utf8');
}
// The caller serializes saves. Retain edits arriving during I/O as dirty, and
// report the exact saved text so the UI cannot mark a newer edit as saved.
export async function saveDocument(doc:SourceDocument) {
  const text=doc.text,buffer=sourceBytes(doc),expected=doc.diskHash;
  const verify=async()=>{
    const disk=await fs.readFile(doc.path).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
    if(!disk||hash(disk)!==expected)throw new SourceConflictError('File changed outside the app. Your text is preserved. Use Save copy to continue in a new file, or Reload disk.');
  };
  const current=await fs.readFile(doc.path).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(current&&hash(current)===hash(buffer)){
    doc.diskHash=hash(buffer);doc.dirty=hash(sourceBytes(doc))!==doc.diskHash;return text;
  }
  await verify();
  const temp=doc.path+'.'+randomUUID()+'.tmp';
  try{
    const handle=await fs.open(temp,'wx');try{await handle.writeFile(buffer);await handle.sync();}finally{await handle.close();}
    for(let attempt=0;;attempt++){
      await verify();
      try{await fs.rename(temp,doc.path);break;}
      catch(error){
        if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;
        // Windows sync/virus scanners can briefly hold the destination open.
        // Recheck its bytes on every retry so a real external edit still wins.
        await new Promise(resolve=>setTimeout(resolve,20*2**attempt));
      }
    }
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  doc.diskHash=hash(buffer);doc.dirty=hash(sourceBytes(doc))!==doc.diskHash;
  return text;
}
