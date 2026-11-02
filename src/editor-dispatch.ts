// Queue comparisons must include accepted-but-unacknowledged revisions. A fast
// reversal is a real edit even if it equals the last acknowledged document.
export type PendingEditorEdit={text:string};
export function queueEditorEdit(file:string,text:string,sent:Map<string,string>,pending:Map<string,PendingEditorEdit>,previous:Promise<void>,send:()=>Promise<unknown>):Promise<void>{
 const queued=pending.get(file);
 if((queued?queued.text:sent.get(file))===text)return previous;
 const entry={text};pending.set(file,entry);
 return previous.catch(()=>{}).then(send).then(()=>{
  sent.set(file,text);if(pending.get(file)===entry)pending.delete(file);
 },error=>{
  // A rejected RPC might already have changed the backend draft. Do not treat
  // an earlier acknowledgement as evidence that retrying this text is a no-op.
  sent.delete(file);if(pending.get(file)===entry)pending.delete(file);throw error;
 });
}
