// Each streamed image has one consumer. Closing/failing a revision releases
// unclaimed GPU images and rejects pending reads; late images are closed too.
export class PdfBandFrames<T extends {image?:{close():void}}>{
 private ready=new Map<number,T>();private waiting=new Map<number,{resolve:(v:T)=>void;reject:(e:Error)=>void}>();private received=new Set<number>();private taken=new Set<number>();private error?:Error;private closed=false;
 constructor(private complete:()=>void=()=>{}){}
 claim(page:number):Promise<T>|undefined{if(this.error)return Promise.reject(this.error);if(this.closed)return Promise.reject(Error('PDF was closed.'));if(this.taken.has(page))return;this.taken.add(page);const value=this.ready.get(page);if(value){this.ready.delete(page);return Promise.resolve(value);}return new Promise((resolve,reject)=>this.waiting.set(page,{resolve,reject}));}
 receive(page:number,value:T,last=false){if(this.closed||this.error){value.image?.close();return;}if(!Number.isSafeInteger(page)||page<1||page>3||this.received.has(page)){value.image?.close();this.fail(Error('Invalid streamed page frame.'));return;}this.received.add(page);const reader=this.waiting.get(page);if(reader){this.waiting.delete(page);reader.resolve(value);}else this.ready.set(page,value);if(last){if(this.received.size!==page){this.fail(Error('Incomplete streamed page band.'));return;}this.complete();}}
 fail(error:Error){this.error=error;for(const value of this.ready.values())value.image?.close();this.ready.clear();for(const reader of this.waiting.values())reader.reject(error);this.waiting.clear();this.complete();}
 close(){this.closed=true;this.fail(Error('PDF was closed.'));}
}
