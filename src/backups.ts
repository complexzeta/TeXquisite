import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {sourceBytes,SourceDocument} from './saving';
const zip=promisify(gzip),unzip=promisify(gunzip),digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const namePattern=/^[a-f\d]{32}\.\d{13}\.[a-f\d-]{36}\.ptbackup$/;
const maxHeader=65536,maxSource=32*1024*1024,maxPayload=48*1024*1024;
export interface BackupFile {path:string;bytes:number;hash:string;eol:string;dirty:boolean;}
export interface BackupRecord {schema:1;id:string;scope:string;root:string;created:number;signature:string;payloadHash:string;files:BackupFile[];}
export interface BackupSummary extends BackupRecord {size:number;}
export interface BackupOptions {maxBytes?:number;maxSnapshots?:number;now?:()=>number;}
export class BackupStore {
 private chain:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private options:BackupOptions={}){}
 private async base(){await fs.mkdir(this.directory,{recursive:true});const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Backup storage must be an ordinary directory.');return fs.realpath(this.directory);}
 private file(base:string,id:string){if(!namePattern.test(id))throw Error('Invalid backup identifier.');const file=path.resolve(base,id);if(path.dirname(file)!==base)throw Error('Invalid backup location.');return file;}
 private async header(base:string,id:string):Promise<BackupSummary>{
  const file=this.file(base,id),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Backup is not an ordinary file.');
  const handle=await fs.open(file,'r');try{
   const length=Buffer.alloc(4);if((await handle.read(length,0,4,0)).bytesRead!==4)throw Error('Incomplete backup.');const n=length.readUInt32LE();if(n<2||n>maxHeader||stat.size<4+n)throw Error('Invalid backup header.');
   const bytes=Buffer.alloc(n);if((await handle.read(bytes,0,n,4)).bytesRead!==n)throw Error('Incomplete backup header.');const record=JSON.parse(bytes.toString('utf8')) as BackupRecord;
   if(record.schema!==1||record.id!==id||!Number.isSafeInteger(record.created)||record.created<0||typeof record.root!=='string'||!/^[a-f\d]{32}$/.test(record.scope)||!id.startsWith(record.scope+'.')||!/^[a-f\d]{64}$/.test(record.signature)||!/^[a-f\d]{64}$/.test(record.payloadHash)||!Array.isArray(record.files)||!record.files.length||record.files.length>512||record.files.some(f=>typeof f.path!=='string'||!f.path||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>maxSource||!/^[a-f\d]{64}$/.test(f.hash)||!['\n','\r\n'].includes(f.eol)))throw Error('Invalid backup metadata.');
   return {...record,size:stat.size};
  }finally{await handle.close();}
 }
 private async inventory(base:string){
  const found:BackupSummary[]=[];let unknownBytes=0;
  for(const id of await fs.readdir(base)){if(!namePattern.test(id))continue;try{found.push(await this.header(base,id));}catch{try{const s=await fs.lstat(this.file(base,id));if(s.isFile()&&!s.isSymbolicLink())unknownBytes+=s.size;}catch{}}}
  return {found:found.sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id)),unknownBytes};
 }
 async list(){const base=await this.base();return (await this.inventory(base)).found;}
 capture(root:string,documents:readonly SourceDocument[]){
  // Snapshot immutable strings immediately; never read a later draft during I/O.
  const docs=documents.map(d=>({...d}));const work=this.chain.catch(()=>{}).then(()=>this.captureNow(root,docs));this.chain=work;return work;
 }
 private async captureNow(root:string,documents:SourceDocument[]){
  if(!documents.length)return {saved:false,id:undefined};if(documents.length>512)throw Error('Backup skipped: too many open source files.');
  const buffers=documents.map(sourceBytes);if(buffers.reduce((sum,b)=>sum+b.length,0)>maxSource)throw Error('Backup skipped: open source buffers exceed 32 MiB.');
  const scope=digest(path.resolve(root||documents[0].path).toLowerCase()).slice(0,32),files=documents.map((d,i)=>({path:d.path,bytes:buffers[i].length,hash:digest(buffers[i]),eol:d.eol,dirty:d.dirty})),signature=digest(JSON.stringify(files.map(f=>[f.path,f.hash,f.eol]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  const base=await this.base(),inventory=await this.inventory(base),last=inventory.found.find(s=>s.scope===scope);
  if(last?.signature===signature){try{await this.read(last.id,0);return {saved:false,id:last.id};}catch{/* A damaged snapshot must not suppress a fresh valid copy. */}}
  const created=Math.max(this.options.now?.()??Date.now(),(inventory.found[0]?.created??0)+1),id=scope+'.'+String(created).padStart(13,'0')+'.'+randomUUID()+'.ptbackup',payload=await zip(Buffer.from(JSON.stringify(buffers.map(b=>b.toString('base64')))),{level:1});
  const record:BackupRecord={schema:1,id,scope,root,created,signature,payloadHash:digest(payload),files},header=Buffer.from(JSON.stringify(record));if(header.length>maxHeader)throw Error('Backup skipped: metadata exceeds its size limit.');
  const prefix=Buffer.alloc(4);prefix.writeUInt32LE(header.length);const size=4+header.length+payload.length,maxBytes=this.options.maxBytes??128*1024*1024;
  if(size+inventory.unknownBytes>maxBytes)throw Error('Backup storage limit reached; existing damaged backups have been preserved.');
  const destination=this.file(base,id),temporary=destination+'.tmp-'+randomUUID();
  try{const handle=await fs.open(temporary,'wx');try{await handle.writeFile(Buffer.concat([prefix,header,payload]));await handle.sync();}finally{await handle.close();}await fs.rename(temporary,destination);}
  finally{await fs.unlink(temporary).catch(()=>{});}
  await this.prune(base,[{...record,size},...inventory.found],inventory.unknownBytes,id);
  return {saved:true,id};
 }
 private async prune(base:string,records:BackupSummary[],unknownBytes:number,newest:string){
  const keep=new Set<string>(),now=this.options.now?.()??Date.now();
  for(const scope of new Set(records.map(r=>r.scope))){const group=records.filter(r=>r.scope===scope).sort((a,b)=>b.created-a.created),hours=new Set<number>(),days=new Set<number>();
   group.forEach((r,i)=>{const hour=Math.floor(r.created/3600000),day=Math.floor(r.created/86400000);if(i<20||now-r.created<86400000&&!hours.has(hour)||now-r.created<14*86400000&&!days.has(day))keep.add(r.id);hours.add(hour);days.add(day);});
  }
  let total=records.reduce((sum,r)=>sum+r.size,unknownBytes),count=records.length;
  for(const record of [...records].sort((a,b)=>a.created-b.created)){
   if(record.id===newest||keep.has(record.id)&&total<=(this.options.maxBytes??128*1024*1024)&&count<=(this.options.maxSnapshots??200))continue;
   // Only unlink a recognised ordinary snapshot inside the canonical store.
   const file=this.file(base,record.id),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())continue;
   await fs.unlink(file);total-=record.size;count--;
  }
 }
 async read(id:string,index:number){
  const base=await this.base(),record=await this.header(base,id);if(!Number.isInteger(index)||index<0||index>=record.files.length)throw Error('Invalid backup file selection.');
  const file=this.file(base,id),handle=await fs.open(file,'r');let bytes:Buffer;
  try{const length=Buffer.alloc(4);await handle.read(length,0,4,0);const offset=4+length.readUInt32LE(),stat=await handle.stat();if(stat.size-offset>maxPayload)throw Error('Backup payload is too large.');bytes=Buffer.alloc(stat.size-offset);if((await handle.read(bytes,0,bytes.length,offset)).bytesRead!==bytes.length)throw Error('Incomplete backup payload.');}finally{await handle.close();}
  if(digest(bytes)!==record.payloadHash)throw Error('Backup checksum failed; current source has not been changed.');
  const data=JSON.parse((await unzip(bytes,{maxOutputLength:maxPayload})).toString('utf8'));if(!Array.isArray(data)||data.length!==record.files.length||typeof data[index]!=='string')throw Error('Invalid backup contents.');const restored=Buffer.from(data[index],'base64'),metadata=record.files[index];if(restored.length!==metadata.bytes||digest(restored)!==metadata.hash)throw Error('Backup source checksum failed.');
  return {record,file:metadata,bytes:restored};
 }
}
