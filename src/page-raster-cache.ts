// Bounded worker-owned exact cache; no probabilistic identity can authorize reuse.
function sameBytes(a:Uint8Array,b:Uint8Array){
  if(a.length!==b.length)return false;let i=0;
  if(a.byteOffset%4===0&&b.byteOffset%4===0){const count=a.length>>>2,x=new Uint32Array(a.buffer,a.byteOffset,count),y=new Uint32Array(b.buffer,b.byteOffset,count);for(let j=0;j<count;j++)if(x[j]!==y[j])return false;i=count*4;}
  for(;i<a.length;i++)if(a[i]!==b[i])return false;return true;
}
export class PageRasterCache<T extends {image:{close():void};width:number;height:number;inkTile?:{width:number;height:number}}>{
  private entries:{identity:Uint8Array;scale:number;value:T;bytes:number}[]=[];
  retainedBytes=0;
  constructor(readonly limit=32*1024*1024,readonly maxEntries=8){}
  get(identity:Uint8Array,scale:number):T|undefined{
    const i=this.entries.findIndex(e=>e.scale===scale&&sameBytes(e.identity,identity));
    if(i<0)return;const [entry]=this.entries.splice(i,1);this.entries.push(entry);return entry.value;
  }
  set(identity:Uint8Array,scale:number,value:T){
    const area=value.inkTile??value,bytes=identity.length+area.width*area.height*4;
    if(bytes>this.limit){value.image.close();return;}
    while(this.entries.length>=this.maxEntries||this.retainedBytes+bytes>this.limit){const old=this.entries.shift()!;this.retainedBytes-=old.bytes;old.value.image.close();}
    this.entries.push({identity:identity.slice(),scale,value,bytes});this.retainedBytes+=bytes;
  }
  clear(){for(const e of this.entries)e.value.image.close();this.entries=[];this.retainedBytes=0;}
}
