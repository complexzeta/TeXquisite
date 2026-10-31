import type {RegionFragment} from './resident';

/** Reuse the existing native character/write/table proofs, while allowing
 * changed vertical geometry. Inline math currently fails the character proof.
 * This is necessary, not sufficient: source/resources and raster checks still
 * belong to the caller. No lexical guess can substitute for these witnesses. */
export function retainedStateCompatible(a:RegionFragment,b:RegionFragment){
  return !!a.neutralCharacters&&!!b.neutralCharacters&&!!a.neutralWriteFree&&!!b.neutralWriteFree&&
    !a.lectureSideEffects&&!b.lectureSideEffects&&!!a.flowStateHash&&a.flowStateHash===b.flowStateHash&&
    !!a.stateHash&&a.stateHash===b.stateHash&&a.widthSp===b.widthSp&&a.paddingSp===b.paddingSp;
}

/** Geometry only: callers must prove source ownership and TeX state separately.
 * Coordinates always refer to the immutable baseline, never an earlier patch. */
export type RetainedSlice={id:string;from:number;to:number;height:number};
export type PlacedSlice=RetainedSlice&{top:number;bottom:number};
export class RetainedLayout{
  readonly slices:readonly PlacedSlice[];
  readonly height:number;
  constructor(readonly baselineHeight:number,slices:readonly RetainedSlice[]=[],readonly limit=32){
    if(!Number.isSafeInteger(baselineHeight)||baselineHeight<=0||!Number.isSafeInteger(limit)||limit<1||slices.length>limit)throw Error('Invalid retained layout bounds.');
    let previous=0,delta=0;const ids=new Set<string>();
    this.slices=Object.freeze([...slices].sort((a,b)=>a.from-b.from).map(s=>{
      if(!s.id||ids.has(s.id)||![s.from,s.to,s.height].every(Number.isSafeInteger)||s.from<previous||s.to<=s.from||s.to>baselineHeight||s.height<1)throw Error('Invalid or overlapping retained slice.');
      ids.add(s.id);previous=s.to;const top=s.from+delta;delta+=s.height-(s.to-s.from);
      if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(s.from+delta))throw Error('Retained layout overflow.');
      return Object.freeze({...s,top,bottom:top+s.height});
    }));
    this.height=baselineHeight+delta;if(!Number.isSafeInteger(this.height)||this.height<1)throw Error('Retained layout overflow.');
  }
  updated(slice:RetainedSlice){
    const old=this.slices.find(s=>s.id===slice.id);
    if(old&&(old.from!==slice.from||old.to!==slice.to))throw Error('Retained baseline slice changed.');
    return new RetainedLayout(this.baselineHeight,[...this.slices.filter(s=>s.id!==slice.id),slice],this.limit);
  }
  removed(id:string){return new RetainedLayout(this.baselineHeight,this.slices.filter(s=>s.id!==id),this.limit);}
  /** Map an unchanged baseline point, or a point local to a named live block. */
  forward(y:number,id?:string){
    if(!Number.isFinite(y)||y<0)return;
    if(id!==undefined){const s=this.slices.find(s=>s.id===id);return s&&y<s.height?s.top+y:undefined;}
    if(y>=this.baselineHeight)return;
    let delta=0;for(const s of this.slices){if(y<s.from)break;if(y<s.to)return;delta+=s.height-(s.to-s.from);}return y+delta;
  }
  inverse(y:number):{id?:string;y:number}|undefined{
    if(!Number.isFinite(y)||y<0||y>=this.height)return;
    let delta=0;for(const s of this.slices){if(y<s.top)break;if(y<s.bottom)return {id:s.id,y:y-s.top};delta+=s.height-(s.to-s.from);}return {y:y-delta};
  }
}
