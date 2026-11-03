// Bounded worker-owned exact cache; no probabilistic identity can authorize reuse.
export class PageRasterCache<T extends {image:{close():void};width:number;height:number;inkTile?:{width:number;height:number}}>{
  private entries:{identity:Uint8Array;scale:number;value:T;bytes:number}[]=[];
  retainedBytes=0;
  constructor(readonly limit=32*1024*1024){}
  get(identity:Uint8Array,scale:number):T|undefined{
    const i=this.entries.findIndex(e=>e.scale===scale&&e.identity.length===identity.length&&e.identity.every((b,j)=>b===identity[j]));
    if(i<0)return;const [entry]=this.entries.splice(i,1);this.entries.push(entry);return entry.value;
  }
  set(identity:Uint8Array,scale:number,value:T){
    const area=value.inkTile??value,bytes=identity.length+area.width*area.height*4;
    if(bytes>this.limit){value.image.close();return;}
    while(this.retainedBytes+bytes>this.limit){const old=this.entries.shift()!;this.retainedBytes-=old.bytes;old.value.image.close();}
    this.entries.push({identity:identity.slice(),scale,value,bytes});this.retainedBytes+=bytes;
  }
  clear(){for(const e of this.entries)e.value.image.close();this.entries=[];this.retainedBytes=0;}
}
