import {PDFDocument,rgb,pushGraphicsState,popGraphicsState,rectangle,clip,endPath} from 'pdf-lib';
import type {RegionFragment,PageSpan} from './resident';
import {LOCAL_INK_BLEED_BP} from './local-raster';
const sourceMatches=(file:string,name:string)=>{const actual=file.replaceAll('\\','/').replace(/^\/work\//,'').replace(/^\.\//,'').toLowerCase(),wanted=(name+'.tex').toLowerCase();return actual===wanted||!wanted.includes('/')&&actual.split('/').at(-1)===wanted;};
const spToBp=72/(72.27*65536);
export type ParagraphOutput={pdf:Uint8Array;fragment:RegionFragment;navigation:string};
export type ParagraphAnchor={code:number;full:number[];fragment:number[]};
// A taller letter can reduce the leading baseline glue by exactly the same
// amount. That leaves the baseline and all following material unchanged.
export function sameSingleLinePlacement(a:RegionFragment,b:RegionFragment){
  const [ag,ab]=a.shape,[bg,bb]=b.shape;
  return a.shape.length===2&&b.shape.length===2&&ag[0]===10&&bg[0]===10&&ab[0]===0&&bb[0]===0&&
    ag.slice(2).every((v,i)=>v===bg[i+2])&&ag.slice(2).every(v=>v===0)&&
    ab[1]===bb[1]&&ab[3]===bb[3]&&ab[4]===bb[4]&&ag[1]+ab[2]===bg[1]+bb[2]&&
    Math.abs(a.heightSp-b.heightSp)*spToBp<=LOCAL_INK_BLEED_BP;
}
type Glyph=[string,number,number,number,number,number,number,number,number,number?];
function glyphs(raw:string,page?:number){
  const rows:Glyph[]=[];
  for(const line of raw.split('\n')){if(!line)continue;const value=JSON.parse(line),row=value.glyph??value.mathGlyph;
    if(Array.isArray(row)&&(page===undefined||row[3]===page))rows.push(row as Glyph);}
  return rows;
}
const key=(g:Glyph)=>JSON.stringify([g[0],g[1],g[2],g[8],g[9]??1]);
export function paragraphPages(navigation:string,original:ParagraphOutput):PageSpan{
  const byKey=new Map<string,Glyph[]>();for(const row of glyphs(navigation)){const k=key(row),list=byKey.get(k)??[];list.push(row);byKey.set(k,list);}
  const pages:number[]=[];for(const row of glyphs(original.navigation,original.fragment.page)){const matches=byKey.get(key(row));if(matches?.length!==1)throw new Error('Paragraph source anchors are ambiguous.');pages.push(matches[0][3]);}
  if(!pages.length)throw new Error('Paragraph has no exact source anchors.');
  return {first:Math.min(...pages),last:Math.max(...pages)};
}
export function cursorPosition(navigation:string,source:string,at:number,jobName:string,span:PageSpan){
  at=Math.max(0,Math.min(source.length,at));const prefix=source.slice(0,at),line=prefix.split('\n').length,column=Buffer.byteLength(prefix.slice(prefix.lastIndexOf('\n')+1));
  const rows=glyphs(navigation).filter(g=>sourceMatches(g[0],jobName)&&g[3]>=span.first&&g[3]<=span.last&&g[1]<=line);
  if(!rows.length)return;const latestLine=Math.max(...rows.map(g=>g[1])),same=rows.filter(g=>g[1]===latestLine),before=same.filter(g=>latestLine<line||g[2]<=column),nearest=before.length?Math.max(...before.map(g=>g[2])):Math.min(...same.map(g=>g[2]));
  const candidates=same.filter(g=>g[2]===nearest),pages=new Set(candidates.map(g=>g[3]));
  if(pages.size===1){const row=candidates.reduce((best,g)=>g[5]+g[7]>best[5]+best[7]?g:best);return {page:row[3],x:row[4],y:row[5],width:row[6],height:row[7]};}
}
export function cursorPage(navigation:string,source:string,at:number,jobName:string,span:PageSpan){return cursorPosition(navigation,source,at,jobName,span)?.page;}
export function flowCaretY(navigation:string,source:string,at:number,jobName:string,page:number){
  const prefix=source.slice(0,Math.max(0,Math.min(at,source.length))),line=prefix.split('\n').length,column=Buffer.byteLength(prefix.slice(prefix.lastIndexOf('\n')+1));
  const rows=glyphs(navigation,page).filter(g=>sourceMatches(g[0],jobName)&&(g[1]<line||g[1]===line&&g[2]<=column));
  if(!rows.length)return;const latestLine=Math.max(...rows.map(g=>g[1])),same=rows.filter(g=>g[1]===latestLine),lastColumn=Math.max(...same.map(g=>g[2]));return Math.max(...same.filter(g=>g[2]===lastColumn).map(g=>g[5]+g[7]));
}
// Character positions in the current source and the raw flow fragment. These
// are navigation hints only; they do not authorize visual source editing.
export function flowLocations(navigation:string,source:string,jobName:string,page:number,from:number,to:number){
  const starts=[0];for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1);
  const result:{at:number;end:number;x:number;y:number;width:number;height:number}[]=[],columns=new Map<number,Map<number,number>>();
  for(const g of glyphs(navigation,page)){
    if(!sourceMatches(g[0],jobName))continue;
    const start=starts[g[1]-1];if(start===undefined)continue;
    let offsets=columns.get(g[1]);
    if(!offsets){
      offsets=new Map([[0,0]]);let bytes=0,characters=0;
      const stop=source.indexOf('\n',start),line=source.slice(start,stop<0?source.length:stop);
      for(const char of line){bytes+=Buffer.byteLength(char);characters+=char.length;offsets.set(bytes,characters);}
      columns.set(g[1],offsets);
    }
    const left=offsets.get(g[2]),right=offsets.get(g[2]+(g[9]??1));if(left===undefined||right===undefined)continue;
    const at=start+left,end=start+right;
    if(at<from||at>=to)continue;
    result.push({at,end,x:g[4],y:g[5],width:g[6],height:g[7]});
  }
  return result;
}
/** A provisional page compositor, not a proof of unchanged downstream TeX
 * state. The caller must verify the baseline raster before displaying updates
 * and retain the full compiler for verification and changed layout. */
export class RegionCompositor{
  private constructor(private base:PDFDocument,private original:ParagraphOutput,readonly page:number,public x:number,public y:number,readonly anchors:ParagraphAnchor[]){}
  static async create(pdf:Uint8Array|PDFDocument,navigation:string,original:ParagraphOutput){
    const all=glyphs(navigation),byKey=new Map<string,Glyph[]>();
    for(const row of all){const k=key(row),list=byKey.get(k)??[];list.push(row);byKey.set(k,list);}
    const offsets:{page:number;x:number;y:number}[]=[];
    const anchors:ParagraphAnchor[]=[];
    for(const row of glyphs(original.navigation,original.fragment.page)){
      const candidates=byKey.get(key(row));if(!candidates||candidates.length!==1)throw new Error('Paragraph anchor is ambiguous.');
      const full=candidates[0];offsets.push({page:full[3],x:full[4]-row[4],y:full[5]-row[5]});
      if(row[8]>=32&&row[8]<=126&&anchors.length<32)anchors.push({code:row[8],full:[full[4],full[5],full[6],full[7]],fragment:[row[4],row[5],row[6],row[7]]});
    }
    if(!offsets.length)throw new Error('Paragraph has no exact source anchors.');
    const anchor=offsets[0];
    if(offsets.some(o=>o.page!==anchor.page||Math.abs(o.x-anchor.x)>.003||Math.abs(o.y-anchor.y)>.003))throw new Error('Paragraph spans pages or has nonuniform page placement: '+JSON.stringify({pages:[...new Set(offsets.map(o=>o.page))],xSpread:Math.max(...offsets.map(o=>o.x))-Math.min(...offsets.map(o=>o.x)),ySpread:Math.max(...offsets.map(o=>o.y))-Math.min(...offsets.map(o=>o.y))})+'.');
    const base=pdf instanceof PDFDocument?pdf:await PDFDocument.load(pdf,{throwOnInvalidObject:true});
    if(anchor.page<1||anchor.page>base.getPageCount())throw new Error('Invalid paragraph page.');
    return new RegionCompositor(base,original,anchor.page,anchor.x,anchor.y,anchors);
  }
  adjust(dx:number,dy:number){if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>.01||Math.abs(dy)>.01)throw new Error('Invalid subpixel placement correction.');this.x+=dx;this.y+=dy;}
  get footprint(){const f=this.original.fragment,bleed=LOCAL_INK_BLEED_BP;return {x:this.x+f.paddingSp*spToBp-bleed,y:this.y+f.paddingSp*spToBp-bleed,width:f.widthSp*spToBp+2*bleed,height:(f.heightSp+f.depthSp)*spToBp+2*bleed};}
  compatible(output:ParagraphOutput){
    const a=this.original.fragment,b=output.fragment;
    return a.stateHash===b.stateHash&&a.widthSp===b.widthSp&&a.depthSp===b.depthSp&&a.paddingSp===b.paddingSp&&
      (a.heightSp===b.heightSp&&JSON.stringify(a.shape)===JSON.stringify(b.shape)||sameSingleLinePlacement(a,b));
  }
  neutralCompatible(output:ParagraphOutput){const a=this.original.fragment,b=output.fragment;return !!a.neutralCharacters&&!!a.neutralWriteFree&&!!b.neutralCharacters&&!!b.neutralWriteFree&&!b.lectureSideEffects&&a.flowStateHash===b.flowStateHash&&this.compatible(output);}
  inkTopSp(output:ParagraphOutput){return output.fragment.paddingSp+output.fragment.heightSp-this.original.fragment.heightSp;}
  flow(output:ParagraphOutput,allowStateChanges=false){
    const a=this.original.fragment,b=output.fragment;
    const leading=(f:RegionFragment)=>{let value=0;for(const row of f.shape){if(row[0]===0||row[0]===1)break;if(row[0]===10||row[0]===11)value+=row[1];else if(row[0]!==12&&!(f.lectureSideEffects&&(row[0]===4||row[0]===8)))return NaN;}return value*spToBp;};
    const oldLeading=leading(a),newLeading=leading(b),foot=this.footprint;
    if(!a.flowStateHash||!b.flowStateHash||!allowStateChanges&&(a.flowStateHash!==b.flowStateHash||b.lectureSideEffects)||a.widthSp!==b.widthSp||a.paddingSp!==b.paddingSp||![oldLeading,newLeading].every(v=>Number.isFinite(v)&&v>=0&&v<200))return;
    const rect={...foot,y:foot.y-oldLeading,height:foot.height+oldLeading};
    if(rect.y<0||rect.y+rect.height>this.base.getPage(this.page-1).getHeight())return;
    return {rect,leading:newLeading,baselineLeading:oldLeading,...(a.flowStateHash!==b.flowStateHash||b.lectureSideEffects?{stateChanged:true}:{}),fragmentRect:{x:b.paddingSp*spToBp-LOCAL_INK_BLEED_BP,y:b.paddingSp*spToBp-LOCAL_INK_BLEED_BP,width:b.widthSp*spToBp+2*LOCAL_INK_BLEED_BP,height:(b.heightSp+b.depthSp)*spToBp+2*LOCAL_INK_BLEED_BP}};
  }
  async compose(output:ParagraphOutput){
    if(!this.compatible(output))throw new Error('Paragraph layout or state changed; broader recomputation required.');
    const doc=await PDFDocument.create(),[page]=await doc.copyPages(this.base,[this.page-1]);doc.addPage(page);
    const [tile]=await doc.embedPdf(output.pdf,[output.fragment.page-1]),{x,y,width,height}=this.footprint;
    if(x<0||y<0||x+width>page.getWidth()+.01||y+height>page.getHeight()+.01)throw new Error('Paragraph lies outside its page.');
    const bottom=page.getHeight()-y-height;
    page.drawRectangle({x,y:bottom,width,height,color:rgb(1,1,1)});
    page.pushOperators(pushGraphicsState(),rectangle(x,bottom,width,height),clip(),endPath());
    page.drawPage(tile,{x:this.x,y:page.getHeight()-this.y-tile.height+(output.fragment.heightSp-this.original.fragment.heightSp)*spToBp});
    page.pushOperators(popGraphicsState());
    return {pdf:await doc.save({useObjectStreams:false,objectsPerTick:1000}),page:this.page,footprint:this.footprint};
  }
}
