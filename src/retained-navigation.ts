import {liveFlowPosition,LiveFlowFrame,sourceLineHasOutput} from './navigation-query';
import type {Navigation} from './navigation';
export type RetainedFrame=Omit<LiveFlowFrame,'from'|'to'>;
export type RetainedGlyph={at:number;end:number;x:number;y:number;width:number;height:number};
export type RetainedRange={id:string;from:number;to:number;baseFrom:number;baseTo:number};
type Block=RetainedRange&{page:number;locations:RetainedGlyph[]};
/** Navigation only. These maps never authorize editing or a visual patch. */
export class RetainedNavigation{
  private blocks=new Map<string,Block>();
  private baseline='';
  private baselineGlyphs:(RetainedGlyph&{page:number})[]=[];
  frame?:RetainedFrame;
  updated(frame:RetainedFrame,baseline:string,patch:{id:string;page:number;prior:string[];ranges:RetainedRange[];locations:RetainedGlyph[]},navigation?:Navigation){
    const fail=()=>{throw Error('Retained navigation context does not match the displayed source.');};
    if(!frame.root||frame.root!==frame.file||!frame.baseId||!frame.sourceHash||!frame.editId||!Number.isSafeInteger(patch.page)||patch.page<1)fail();
    if(this.frame&&(['root','file','baseId'] as const).some(k=>this.frame![k]!==frame[k])||this.frame&&this.baseline!==baseline)fail();
    if(patch.prior.length!==this.blocks.size||new Set(patch.prior).size!==patch.prior.length||patch.prior.some(id=>!this.blocks.has(id))||patch.ranges.length<1||patch.ranges.length>3)fail();
    const next=new RetainedNavigation();next.frame={...frame};next.baseline=baseline;
    let baseAt=0,actualAt=0,delta=0,reconstructed='';
    for(const r of patch.ranges){
      if(![r.from,r.to,r.baseFrom,r.baseTo].every(Number.isSafeInteger)||r.baseFrom<baseAt||r.baseTo<=r.baseFrom||r.baseTo>baseline.length||r.from!==r.baseFrom+delta||r.from<actualAt||r.to<=r.from||r.to>frame.text.length||r.id!==r.baseFrom+':'+r.baseTo||next.blocks.has(r.id))fail();
      const prior=this.blocks.get(r.id),active=r.id===patch.id;
      if(!active&&(!prior||prior.baseFrom!==r.baseFrom||prior.baseTo!==r.baseTo||this.frame!.text.slice(prior.from,prior.to)!==frame.text.slice(r.from,r.to)))fail();
      const shift=prior?r.from-prior.from:0,locations=active?patch.locations.map(g=>({...g})):prior!.locations.map(g=>({...g,at:g.at+shift,end:g.end+shift}));
      if(!locations.length||locations.some(g=>!Number.isSafeInteger(g.at)||!Number.isSafeInteger(g.end)||g.at<r.from||g.end>r.to||g.end<=g.at||![g.x,g.y,g.width,g.height].every(Number.isFinite)||g.width<=0||g.height<=0))fail();
      next.blocks.set(r.id,{...r,page:active?patch.page:prior!.page,locations});
      reconstructed+=baseline.slice(baseAt,r.baseFrom)+frame.text.slice(r.from,r.to);baseAt=r.baseTo;actualAt=r.to;delta+=r.to-r.from-(r.baseTo-r.baseFrom);
    }
    if(!next.blocks.has(patch.id)||[...this.blocks.keys()].some(id=>!next.blocks.has(id))||reconstructed+baseline.slice(baseAt)!==frame.text)fail();
    next.baselineGlyphs=this.baselineGlyphs;
    if(!this.frame&&navigation?.sources[frame.file]){
      const lines=baseline.split('\n'),starts=[0],offsets=new Map<number,Map<number,number>>();for(const line of lines)starts.push(starts.at(-1)!+line.length+1);
      next.baselineGlyphs=[];
      for(const g of [...(navigation.characters??[]),...(navigation.mathCharacters??[])]){
        const line=lines[g[1]-1];if(g[0]!==frame.file||line===undefined||!sourceLineHasOutput(line))continue;
        let columns=offsets.get(g[1]);if(!columns){columns=new Map([[0,0]]);let bytes=0,chars=0;for(const c of line){bytes+=new TextEncoder().encode(c).length;chars+=c.length;columns.set(bytes,chars);}offsets.set(g[1],columns);}
        const from=columns.get(g[2]),to=columns.get(g[2]+(g[9]??1));if(from===undefined||to===undefined||to<=from||![g[4],g[5],g[6],g[7]].every(Number.isFinite)||g[6]<=0||g[7]<=0)continue;
        next.baselineGlyphs.push({page:g[3],at:starts[g[1]-1]+from,end:starts[g[1]-1]+to,x:g[4],y:g[5],width:g[6],height:g[7]});
      }
    }
    return next;
  }
  private locations(){return [...this.blocks.values()].flatMap(b=>b.locations.map(g=>({...g,page:b.page}))).concat(this.baselineGlyphs.flatMap(g=>{
    let delta=0;for(const b of this.blocks.values()){if(g.at<b.baseTo&&g.end>b.baseFrom)return [];if(b.baseTo<=g.at)delta+=b.to-b.from-(b.baseTo-b.baseFrom);}return [{...g,at:g.at+delta,end:g.end+delta}];
  }));}
  matches(current:RetainedFrame){return !!this.frame&&(['root','file','baseId','sourceHash','editId','text'] as const).every(k=>this.frame![k]===current[k]);}
  inverse(current:RetainedFrame,page:number,x:number,y:number){
    if(!this.matches(current))return;
    return liveFlowPosition({...this.frame!,from:0,to:current.text.length},current,this.locations().filter(g=>g.page===page),x,y);
  }
  forward(current:RetainedFrame,at:number){
    if(!this.matches(current)||!Number.isSafeInteger(at))return;
    if(at<0||at>current.text.length)return;
    const from=current.text.lastIndexOf('\n',at-1)+1,end=current.text.indexOf('\n',at),to=end<0?current.text.length:end;
    if(!sourceLineHasOutput(current.text.slice(from,to)))return;
    const glyph=this.locations().filter(g=>g.at>=from&&g.at<to).reduce<(RetainedGlyph&{page:number})|undefined>((best,g)=>!best||Math.abs(g.at-at)<Math.abs(best.at-at)?g:best,undefined);
    return glyph?{page:glyph.page,glyph}:undefined;
  }
}
