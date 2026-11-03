import {PDFDocument,rgb,pushGraphicsState,popGraphicsState,rectangle,clip,endPath} from 'pdf-lib';
import {matchedParagraphGlyphs,ParagraphOutput,ParagraphAnchor} from './region-compositor';
const bp=72/(72.27*65536),bleed=1;
export type CrossSlice={from:number;to:number;dx:number;dy:number};
export class CrossPagePart{
 private correction={x:0,y:0};
 constructor(private base:PDFDocument,private original:ParagraphOutput,readonly page:number,private cuts:CrossSlice[],readonly anchors:ParagraphAnchor[]){}
 get x(){return Math.min(...this.cuts.map(s=>s.dx))+this.correction.x;}
 get y(){return this.cuts[0].dy+this.correction.y;}
 get slices(){return this.cuts.map(s=>({...s,dx:s.dx+this.correction.x,dy:s.dy+this.correction.y}));}
 get rectangles(){const f=this.original.fragment;return this.slices.map(s=>({x:s.dx+f.paddingSp*bp-bleed,y:s.from+s.dy,width:f.widthSp*bp+2*bleed,height:s.to-s.from}));}
 get footprint(){const r=this.rectangles,x=Math.min(...r.map(b=>b.x)),y=Math.min(...r.map(b=>b.y));return{x,y,width:Math.max(...r.map(b=>b.x+b.width))-x,height:Math.max(...r.map(b=>b.y+b.height))-y};}
 adjust(dx:number,dy:number){if(![dx,dy].every(n=>Number.isFinite(n)&&Math.abs(n)<=.01))throw Error('Invalid cross-page correction');this.correction.x+=dx;this.correction.y+=dy;}
 async compose(){const doc=await PDFDocument.create(),[page]=await doc.copyPages(this.base,[this.page-1]);doc.addPage(page);const [tile]=await doc.embedPdf(this.original.pdf,[this.original.fragment.page-1]);
  for(const [i,s]of this.slices.entries()){const r=this.rectangles[i];if(r.x<0||r.y<0||r.x+r.width>page.getWidth()+.01||r.y+r.height>page.getHeight()+.01)throw Error('Cross-page ink lies outside its page');const bottom=page.getHeight()-r.y-r.height;page.drawRectangle({x:r.x,y:bottom,width:r.width,height:r.height,color:rgb(1,1,1)});page.pushOperators(pushGraphicsState(),rectangle(r.x,bottom,r.width,r.height),clip(),endPath());page.drawPage(tile,{x:s.dx,y:page.getHeight()-s.dy-tile.height});page.pushOperators(popGraphicsState());}
  return{pdf:await doc.save({useObjectStreams:false,objectsPerTick:1000}),page:this.page,footprint:this.footprint};
 }
}
export class CrossPageFlow{
 private constructor(private base:PDFDocument,private original:ParagraphOutput,readonly parts:CrossPagePart[],readonly navigation:string){}
 static async create(base:PDFDocument,nav:string,original:ParagraphOutput){
  const matched=matchedParagraphGlyphs(nav,original);if(!matched.length)throw Error('No cross-page anchors');
  const rows=matched.map(({full:g,fragment:f})=>({page:g[3],from:f[5],to:f[5]+f[7],dx:g[4]-f[4],dy:g[5]-f[5]})).sort((a,b)=>a.from-b.from||a.to-b.to);
  const bands:typeof rows=[];for(const r of rows){if(!Object.values(r).every(Number.isFinite)||r.to<r.from)throw Error('Invalid cross-page anchor');const last=bands.at(-1);if(last&&last.page===r.page&&Math.abs(last.dx-r.dx)<=.003&&Math.abs(last.dy-r.dy)<=.003){last.to=Math.max(last.to,r.to);continue;}if(last&&(r.from<last.to+.01||r.page<last.page))throw Error('Overlapping cross-page placement');bands.push({...r});}
  const pages=[...new Set(bands.map(b=>b.page))];if(pages.length<2||pages.length>3||pages.some((p,i)=>p!==pages[0]+i)||bands.length>64||Math.max(...rows.map(r=>r.dx))-Math.min(...rows.map(r=>r.dx))>32)throw Error('Unsupported cross-page placement');
  const size=base.getPage(pages[0]-1).getSize();for(const number of pages){const p=base.getPage(number-1),b=p.getCropBox();if(p.getRotation().angle!==0||Math.abs(p.getWidth()-size.width)>.003||Math.abs(p.getHeight()-size.height)>.003||b.x!==0||b.y!==0||Math.abs(b.width-size.width)>.003||Math.abs(b.height-size.height)>.003)throw Error('Cross-page geometry differs');}
  const f=original.fragment,top=f.paddingSp*bp-bleed,bottom=(f.paddingSp+f.heightSp+f.depthSp)*bp+bleed;
  if(rows.some(r=>r.from<top-.01||r.to>bottom+.01))throw Error('Fragment anchors exceed ink bounds');
  const slices=bands.map((b,i)=>({...b,from:i?(bands[i-1].to+b.from)/2:top,to:i+1<bands.length?(b.to+bands[i+1].from)/2:bottom}));
  return new CrossPageFlow(base,original,pages.map(page=>new CrossPagePart(base,original,page,slices.filter(s=>s.page===page),matched.filter(m=>m.full[3]===page).slice(0,32).map(({full:g,fragment:f})=>({code:f[8],full:[g[4],g[5],g[6],g[7]],fragment:[f[4],f[5],f[6],f[7]]})))),nav);
 }
 // The browser may join pages only after each removed margin has been
 // independently proved blank. Footnotes, headers and page numbers otherwise
 // keep the document on its ordinary page-rendering path.
 get layout(){const first=this.parts[0],last=this.parts.at(-1)!,span={first:first.page,last:last.page},prefixY=first.footprint.y,suffixY=last.footprint.y+last.footprint.height,x=Math.min(...this.parts.map(p=>p.x))+this.original.fragment.paddingSp*bp-bleed;return{span,prefixY,suffixY,x,key:JSON.stringify([span,prefixY,suffixY,x])};}
 guard(part:CrossPagePart){const l=this.layout;return{top:part.page===l.span.first?l.prefixY:0,bottom:part.page===l.span.last?l.suffixY:this.base.getPage(part.page-1).getHeight(),rectangles:part.rectangles};}
 flow(output:ParagraphOutput){const a=this.original.fragment,b=output.fragment;if(!a.flowStateHash||!b.flowStateHash||a.widthSp!==b.widthSp||a.paddingSp!==b.paddingSp)return;return{...this.layout,stateChanged:a.flowStateHash!==b.flowStateHash||!!b.lectureSideEffects,fragmentRect:{x:b.paddingSp*bp-bleed,y:b.paddingSp*bp-bleed,width:b.widthSp*bp+2*bleed,height:(b.heightSp+b.depthSp)*bp+2*bleed}};}
}
