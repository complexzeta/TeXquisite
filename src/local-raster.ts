export const LOCAL_INK_BLEED_BP=1;
// RGBA rasters are normally aligned. Compare all four channels at once without
// copying or changing the exact-byte criterion; odd-offset views use bytes.
export function rasterBytesEqual(a:Uint8Array|Uint8ClampedArray,b:Uint8Array|Uint8ClampedArray){
 if(a.length!==b.length)return false;let at=0;
 if(a.byteOffset%4===0&&b.byteOffset%4===0){const count=Math.floor(a.length/4),aa=new Uint32Array(a.buffer,a.byteOffset,count),bb=new Uint32Array(b.buffer,b.byteOffset,count);for(let i=0;i<count;i++)if(aa[i]!==bb[i])return false;at=count*4;}
 for(;at<a.length;at++)if(a[at]!==b[at])return false;return true;
}

// Calibration asks about the same page hundreds of times. Group by character
// once, then find the two nearest candidates without allocating or sorting.
export class GlyphLookup<T extends readonly number[]> {
  private readonly byCode=new Map<number,T[]>();
  constructor(glyphs:readonly T[]){
    for(const glyph of glyphs){let group=this.byCode.get(glyph[0]);if(!group){group=[];this.byCode.set(glyph[0],group);}group.push(glyph);}
  }
  nearest(code:number,box:readonly number[]){
    if(Number.isNaN(code))return;
    let first=Infinity,second=Infinity,chosen:T|undefined;
    for(const g of this.byCode.get(code)??[]){
      const distance=(g[1]+g[3]/2-box[0]-box[2]/2)**2+(g[2]+g[4]/2-box[1]-box[3]/2)**2;
      if(distance<first){second=first;first=distance;chosen=g;}else if(distance<second)second=distance;
    }
    if(chosen&&first<=4&&second-first>=.01)return chosen;
  }
}
export function inkFitsRaster(data:Uint8Array|Uint8ClampedArray,width:number,height:number,bounds:{left:number;top:number;right:number;bottom:number}){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||data.length!==width*height*4||![bounds.left,bounds.top,bounds.right,bounds.bottom].every(Number.isFinite)||bounds.right<=bounds.left||bounds.bottom<=bounds.top)return false;
  const left=Math.max(0,Math.min(width,Math.floor(bounds.left))),right=Math.max(0,Math.min(width,Math.ceil(bounds.right))),top=Math.floor(bounds.top),bottom=Math.ceil(bounds.bottom);
  const clear=(from:number,to:number)=>{for(let at=from;at<to;at+=4)if(data[at]<250||data[at+1]<250||data[at+2]<250)return false;return true;};
  for(let y=0;y<height;y++){const start=y*width*4;if(y<top||y>=bottom){if(!clear(start,start+width*4))return false;}else if(!clear(start,start+left*4)||!clear(start+right*4,start+width*4))return false;}
  return true;
}

// Live pageless flow may contain a slightly overfull TeX line. Capture its
// actual rightmost ink in the fragment's blank margin, rather than cropping it
// or rejecting the whole paragraph. Baseline proofs keep inkFitsRaster strict.
export function flowInkBounds(data:Uint8Array|Uint8ClampedArray,width:number,height:number,bounds:{left:number;top:number;right:number;bottom:number},allowance:number){
 if(inkFitsRaster(data,width,height,bounds))return bounds;
 if(!Number.isFinite(allowance)||allowance<=0||allowance>256)return;
 const limit=Math.min(width-1,Math.ceil(bounds.right+allowance));
 if(limit<=bounds.right||!inkFitsRaster(data,width,height,{...bounds,right:limit}))return;
 let right=Math.ceil(bounds.right);
 for(let y=Math.max(0,Math.floor(bounds.top));y<Math.min(height,Math.ceil(bounds.bottom));y++)for(let x=right;x<limit;x++){
  const p=(y*width+x)*4;if(data[p]<250||data[p+1]<250||data[p+2]<250)right=x+1;
 }
 return {...bounds,right:Math.min(limit,right+1)};
}
type RasterRect={x:number;y:number;width:number;height:number};
export function matchLocalRaster(a:Uint8ClampedArray,b:Uint8ClampedArray,width:number,height:number,rect:RasterRect){return matchRaster(a,b,width,height,rect,false);}
export function matchLocalPatchRaster(a:Uint8ClampedArray,b:Uint8ClampedArray,width:number,height:number,rect:RasterRect,calibratedGlyphs:RasterRect[]=[],pixelScale=1){return matchRaster(a,b,width,height,rect,true,calibratedGlyphs,pixelScale);}
function matchRaster(a:Uint8ClampedArray,b:Uint8ClampedArray,width:number,height:number,rect:RasterRect,patchOnly:boolean,calibratedGlyphs:RasterRect[]=[],pixelScale=1){
  const changed:number[]=[],limit=Math.max(64,Math.floor(width*height*.0001));let maxDifference=0,metricPixels=0;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Object.values(rect).every(Number.isFinite)||rect.width<=0||rect.height<=0)return {ok:false,differingPixels:0,maxDifference};
  if(a.length!==b.length||a.length!==width*height*4)return {ok:false,differingPixels:0,maxDifference};
  const left=patchOnly?Math.max(0,Math.floor(rect.x)):0,right=patchOnly?Math.min(width,Math.ceil(rect.x+rect.width)):width,top=patchOnly?Math.max(0,Math.floor(rect.y)):0,bottom=patchOnly?Math.min(height,Math.ceil(rect.y+rect.height)):height;
  const masks=patchOnly&&calibratedGlyphs.length<=4096?calibratedGlyphs.filter(g=>Object.values(g).every(Number.isFinite)&&g.width>0&&g.height>0&&g.width<=256&&g.height<=256):[];
  const glyphPixels=new Uint8Array(masks.length);
  const metricPositions=new Set<number>();
  const density=Math.min(4,Math.max(1,Number.isFinite(pixelScale)?pixelScale:1)),glyphLimit=Math.min(64,Math.ceil(8*density*density));
  const grayInk=(pixels:Uint8ClampedArray,p:number)=>{const i=p*4;return pixels[i+3]===255&&pixels[i]<250&&pixels[i]===pixels[i+1]&&pixels[i]===pixels[i+2];};
  const faintGray=(pixels:Uint8ClampedArray,p:number)=>{const i=p*4;return pixels[i+3]===255&&pixels[i]>=192&&pixels[i]===pixels[i+1]&&pixels[i]===pixels[i+2];};
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const p=y*width+x;
    // Only this integer crop is copied into the accepted canvas. PDF form
    // serialization can change unrelated page pixels which are never shown.
    let difference=0;for(let c=0;c<4;c++)difference=Math.max(difference,Math.abs(a[p*4+c]-b[p*4+c]));
    if(!difference)continue;maxDifference=Math.max(maxDifference,difference);changed.push(p);
    // Only independently matched PDF glyph geometry can authorize these
    // eight opaque grayscale coverage pixels per matched glyph at 1x, scaling
    // with pixel density. The entire patch, including any one glyph, is capped
    // at 64. Independent glyph geometry and both stroke-edge checks still apply.
    // Background, color, alpha and
    // missing/added ink remain subject to the original checks.
    let metric=false,metricGlyph=-1;
    if(difference>32&&difference<=80&&(grayInk(a,p)&&grayInk(b,p)||faintGray(a,p)&&faintGray(b,p))&&metricPixels<64){
      const glyph=masks.findIndex(g=>x>=Math.floor(g.x)-1&&x<=Math.ceil(g.x+g.width)+1&&y>=Math.floor(g.y)-1&&y<=Math.ceil(g.y+g.height)+1);
      metricGlyph=glyph;
      if(glyph>=0&&glyphPixels[glyph]<glyphLimit){glyphPixels[glyph]++;metricPixels++;metricPositions.add(p);metric=true;}
    }
    if(difference>32&&!metric||changed.length>limit||x<Math.floor(rect.x)-1||x>Math.ceil(rect.x+rect.width)+1||y<Math.floor(rect.y)-1||y>Math.ceil(rect.y+rect.height)+1)return {ok:false,differingPixels:changed.length,maxDifference,...(masks.length?{metricPixels,metricGlyph,metricGlyphPixels:metricGlyph>=0?glyphPixels[metricGlyph]:0}:{}),sample:[{x,y,a:[...a.slice(p*4,p*4+4)],b:[...b.slice(p*4,p*4+4)]}]};
  }
  // PDF form placement can change a handful of edge coverage values at high
  // DPI even with equivalent coordinates. Permit only small changes adjacent
  // to a dark/light stroke edge in BOTH images. Lost/added ink, background
  // changes, changes outside the paragraph and broad differences are refused.
  const edge=(pixels:Uint8ClampedArray,p:number)=>{const x=p%width,y=Math.floor(p/width);let dark=false,light=false;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const at=(yy*width+xx)*4,value=Math.min(pixels[at],pixels[at+1],pixels[at+2]);if(value<96)dark=true;if(value>224)light=true;}return dark&&light;};
  const background=(pixels:Uint8ClampedArray,p:number)=>pixels[p*4]>=250&&pixels[p*4+1]>=250&&pixels[p*4+2]>=250&&pixels[p*4+3]===255;
  const core=new Map<number,boolean>();let coveragePixels=metricPixels;
  const glyphFringe=(p:number)=>{
    const x=p%width,y=Math.floor(p/width),glyph=masks.findIndex(g=>x>=Math.floor(g.x)-1&&x<=Math.ceil(g.x+g.width)+1&&y>=Math.floor(g.y)-1&&y<=Math.ceil(g.y+g.height)+1);
    if(glyph<0)return false;
    const opaqueGray=(pixels:Uint8ClampedArray)=>{const at=p*4;return pixels[at+3]===255&&pixels[at]===pixels[at+1]&&pixels[at]===pixels[at+2];};
    if(!opaqueGray(a)||!opaqueGray(b))return false;
    if(!core.has(glyph)){
      const g=masks[glyph];let darkA=false,darkB=false;
      for(let yy=Math.max(0,Math.floor(g.y));yy<Math.min(height,Math.ceil(g.y+g.height));yy++)for(let xx=Math.max(0,Math.floor(g.x));xx<Math.min(width,Math.ceil(g.x+g.width));xx++){
        const at=(yy*width+xx)*4;darkA ||=Math.min(a[at],a[at+1],a[at+2])<96;darkB ||=Math.min(b[at],b[at+1],b[at+2])<96;
      }
      core.set(glyph,darkA&&darkB);
    }
    if(!core.get(glyph))return false;
    const fringe=(pixels:Uint8ClampedArray)=>{let ink=false,light=false;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const at=(yy*width+xx)*4,value=Math.min(pixels[at],pixels[at+1],pixels[at+2]);ink ||=value<224;light ||=value>224;}return ink&&light;};
    if(!fringe(a)||!fringe(b))return false;
    if(!metricPositions.has(p)){if(coveragePixels>=64||glyphPixels[glyph]>=glyphLimit)return false;coveragePixels++;glyphPixels[glyph]++;}
    return true;
  };
  // Use the same ink threshold as inkFitsRaster. Near-white coverage in both
  // images is background; darker or newly missing ink still needs both edges.
  const ok=changed.every(p=>background(a,p)&&background(b,p)||edge(a,p)&&edge(b,p)||glyphFringe(p));return {ok,differingPixels:changed.length,maxDifference,...(metricPixels?{metricPixels}:{}),...(coveragePixels>metricPixels?{coveragePixels}:{}),...(!ok?{sample:changed.slice(0,4).map(p=>({x:p%width,y:Math.floor(p/width),a:[...a.slice(p*4,p*4+4)],b:[...b.slice(p*4,p*4+4)]}))}:{})};
}

// Glyph bounding boxes can contain a metric outlier even when the paragraph
// origins agree. A strong geometric consensus may propose a tiny translation;
// callers must still repeat the raster and ink proof afterwards.
export function placementCorrection(offsets:{x:number;y:number}[],current:{x:number;y:number},allowAligned=false){
  if(offsets.length<3||![current.x,current.y,...offsets.flatMap(o=>[o.x,o.y])].every(Number.isFinite))return false;
  const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const x=median(offsets.map(o=>o.x)),y=median(offsets.map(o=>o.y)),inliers=offsets.filter(o=>Math.abs(o.x-x)<=.004&&Math.abs(o.y-y)<=.004);
  if(inliers.length<Math.max(3,Math.ceil(offsets.length*.9)))return false;
  const dx=median(inliers.map(o=>o.x))-current.x,dy=median(inliers.map(o=>o.y))-current.y;
  if(Math.abs(dx)>.01||Math.abs(dy)>.01)return false;
  if(Math.abs(dx)+Math.abs(dy)<.00001)return allowAligned?{dx:0,dy:0}:false;
  return {dx,dy};
}
