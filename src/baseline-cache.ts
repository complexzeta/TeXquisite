type Task<D>={promise:Promise<D>;destroy:()=>Promise<void>};
type Entry<F>={promise:Promise<F>;value?:F;users:number;used:number};
type State<D,F>={task:Task<D>;render:(doc:D,page:number)=>Promise<F>;pages:Map<number,Entry<F>>;users:number;retired:boolean;closed?:boolean};
/** Cached accepted-page images are immutable. Leases keep asynchronous checks
 * alive across invalidation; retired documents close after their last user. */
export class BaselineCache<D,F>{
  private current?:{key:string;state:State<D,F>};
  private sequence=0;
  constructor(private load:(bytes:Uint8Array)=>Task<D>,private size:(frame:F)=>number,private dispose:(frame:F)=>void,private maxPages=3,private maxBytes=64*1024*1024){}
  clear(){const old=this.current;this.current=undefined;if(old){old.state.retired=true;this.trim(old.state);}}
  acquire(key:string,bytes:Uint8Array,render:(doc:D,page:number)=>Promise<F>){
    if(this.current?.key!==key){
      this.clear();const state:State<D,F>={task:this.load(bytes),render,pages:new Map(),users:0,retired:false};this.current={key,state};
      void state.task.promise.catch(()=>{if(this.current?.state===state)this.clear();});
    }
    const state=this.current!.state;state.users++;let released=false;
    const release=()=>{if(released)return;released=true;state.users--;this.trim(state);};
    const retain=()=>{if(state.closed)throw new Error('Baseline document was closed.');state.users++;let done=false;return {document:state.task.promise,release:()=>{if(done)return;done=true;state.users--;this.trim(state);}};};
    return {document:state.task.promise,release,retain,page:async(page:number)=>{
      if(released)throw new Error('Baseline lease was released.');
      let entry=state.pages.get(page);
      if(!entry){
        entry={users:0,used:++this.sequence,promise:Promise.resolve(undefined as F)};
        const created=entry;entry.promise=state.task.promise.then(doc=>state.render(doc,page)).then(frame=>{created.value=frame;return frame;});
        state.pages.set(page,entry);
      }
      const held=entry;held.users++;held.used=++this.sequence;state.users++;
      let done=false;const free=()=>{if(done)return;done=true;held.users--;state.users--;this.trim(state);};
      try{return {value:await held.promise,release:free};}catch(error){if(state.pages.get(page)===held)state.pages.delete(page);free();throw error;}
    }};
  }
  private trim(state:State<D,F>){
    let bytes=[...state.pages.values()].reduce((n,e)=>n+(e.value?this.size(e.value):0),0);
    for(const [page,entry]of [...state.pages].sort((a,b)=>a[1].used-b[1].used)){
      if(entry.users||!entry.value)continue;
      if(!state.retired&&state.pages.size<=this.maxPages&&bytes<=this.maxBytes)break;
      state.pages.delete(page);bytes-=this.size(entry.value);this.dispose(entry.value);
    }
    if(state.retired&&state.users===0&&!state.closed){state.closed=true;void state.task.destroy().catch(()=>{});}
  }
}
