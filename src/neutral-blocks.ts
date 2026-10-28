export type NeutralRange={from:number;to:number};
type Block=NeutralRange&{id:string;text:string};
export const neutralId=(range:NeutralRange)=>range.from+':'+range.to;
/** An immutable-source overlay for proved, geometry/state-neutral paragraphs.
 * Compiler checkpoints always consume the original prefix. Only the active
 * block is substituted; other substitutions have independent visual proofs. */
export class NeutralBlocks{
  private blocks:Block[]=[];
  constructor(readonly base:string,private limit=3){}
  get ids(){return this.blocks.map(b=>b.id);}
  get dirty(){return this.blocks.filter(b=>b.text!==this.base.slice(b.from,b.to));}
  get ranges(){let delta=0;return this.blocks.map(b=>{const range={id:b.id,baseFrom:b.from,baseTo:b.to,from:b.from+delta,to:b.from+delta+b.text.length};delta+=b.text.length-(b.to-b.from);return range;});}
  source(){let at=0,out='';for(const b of this.blocks){out+=this.base.slice(at,b.from)+b.text;at=b.to;}return out+this.base.slice(at);}
  editStart(editor:string){const expected=this.source();let at=0;while(at<expected.length&&at<editor.length&&expected[at]===editor[at])at++;return at===expected.length&&at===editor.length?undefined:at;}
  actual(range:NeutralRange){let delta=0;for(const b of this.blocks){if(b.to<=range.from)delta+=b.text.length-(b.to-b.from);else break;}const old=this.blocks.find(b=>b.id===neutralId(range));return {from:range.from+delta,to:range.from+delta+(old?.text.length??range.to-range.from)};}
  basePosition(at:number){let delta=0;for(const b of this.blocks){const from=b.from+delta,to=from+b.text.length;if(at<from)return at-delta;if(at<to)return b.from+Math.min(at-from,Math.max(0,b.to-b.from-1));delta+=b.text.length-(b.to-b.from);}return at-delta;}
  project(editor:string,range:NeutralRange){
    if(!Number.isSafeInteger(range.from)||!Number.isSafeInteger(range.to)||range.from<0||range.to<=range.from||range.to>this.base.length)return;
    const id=neutralId(range);if(this.blocks.some(b=>b.id!==id&&b.from<range.to&&range.from<b.to)||!this.blocks.some(b=>b.id===id)&&this.blocks.length>=this.limit)return;
    const expected=this.source(),actual=this.actual(range),prefix=expected.slice(0,actual.from),suffix=expected.slice(actual.to);
    if(editor.length<prefix.length+suffix.length||!editor.startsWith(prefix)||!editor.endsWith(suffix))return;
    const text=editor.slice(prefix.length,editor.length-suffix.length);
    if(!/\n[\t ]*\n$/.test(text))return;
    return {text,source:this.base.slice(0,range.from)+text+this.base.slice(range.to),actual:{from:actual.from,to:actual.from+text.length}};
  }
  proposed(range:NeutralRange,text:string){const next=new NeutralBlocks(this.base,this.limit);next.blocks=[...this.blocks.filter(b=>b.id!==neutralId(range)),{...range,id:neutralId(range),text}].sort((a,b)=>a.from-b.from);return next;}
}
