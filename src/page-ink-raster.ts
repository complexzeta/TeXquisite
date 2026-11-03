// Fast opaque-page rasterization. Keep the same full-page pixel phase and
// resolution, but avoid allocating/copying a native bitmap for empty margins.
// Unsupported objects/annotations/boxes retain the ordinary PDFium renderer.
export function renderInkPage(page:any,scale:number){
  const raw=page as any,m=raw.module,id=raw.pageIdx;
  if(!Number.isFinite(scale)||scale<=0||scale>16||m._FPDFPage_GetRotation(id)!==0||m._FPDFPage_GetAnnotCount(id)!==0)return;
  const actual=page.getOriginalSize(),size=raw.getSize({scale});
  if(size.width<1||size.height<1||size.width>32768||size.height>32768)return;
  let scratch=0,ptr=0,bitmap=0;
  try{
    scratch=m.wasmExports.malloc(32);if(!scratch)return;
    const read=()=>Array.from(new Float32Array(m.HEAPU8.buffer,scratch,4)) as number[];
    if(!m._FPDFPage_GetMediaBox(id,scratch,scratch+4,scratch+8,scratch+12))return;
    const box=read();
    if(Math.abs(box[0])>.001||Math.abs(box[1])>.001||Math.abs(box[2]-actual.originalWidth)>.001||Math.abs(box[3]-actual.originalHeight)>.001)return;
    if(m._FPDFPage_GetCropBox(id,scratch,scratch+4,scratch+8,scratch+12)&&read().some((n,i)=>Math.abs(n-box[i])>.001))return;
    const count=m._FPDFPage_CountObjects(id);if(count<1||count>5000)return;
    let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity;
    const fonts=new Set<number>();
    for(let i=0;i<count;i++){
      const object=m._FPDFPage_GetObject(id,i),type=m._FPDFPageObj_GetType(object);
      if(type===1){
        if(m._FPDFTextObj_GetTextRenderMode(object)!==0)return;
        const font=m._FPDFTextObj_GetFont(object);if(!font)return;
        if(!fonts.has(font)){
          // Type 3 programs and substituted fonts are not bounded by this path.
          if(m._FPDFFont_GetIsEmbedded(font)!==1||!m._FPDFFont_GetFontData(font,0,0,scratch+16)||new Uint32Array(m.HEAPU8.buffer,scratch+16,1)[0]===0)return;
          fonts.add(font);
        }
      }else if(type===2){
        if(!m._FPDFPath_GetDrawMode(object,scratch+16,scratch+20)||new Int32Array(m.HEAPU8.buffer,scratch+20,1)[0]!==0)return;
      }else return;
      if(!m._FPDFPageObj_GetBounds(object,scratch,scratch+4,scratch+8,scratch+12))return;
      const b=read();if(!b.every(Number.isFinite)||b[2]<b[0]||b[3]<b[1])return;
      left=Math.min(left,b[0]);bottom=Math.min(bottom,b[1]);right=Math.max(right,b[2]);top=Math.max(top,b[3]);
    }
    // Include overhang/antialiasing bleed, then clip at the identical integer
    // origin used by a complete render. The surrounding page stays white.
    const sx=size.width/actual.originalWidth,sy=size.height/actual.originalHeight;
    const x=Math.max(0,Math.floor((left-2)*sx)-2),y=Math.max(0,Math.floor((actual.originalHeight-top-2)*sy)-2);
    const r=Math.min(size.width,Math.ceil((right+2)*sx)+2),b=Math.min(size.height,Math.ceil((actual.originalHeight-bottom+2)*sy)+2);
    const width=r-x,height=b-y;
    if(width<1||height<1||width*height>16000000||width*height>=size.width*size.height*.75)return;
    ptr=m.wasmExports.malloc(width*height*4);if(!ptr)return;
    bitmap=m._FPDFBitmap_CreateEx(width,height,4,ptr,width*4);if(!bitmap)return;
    m._FPDFBitmap_FillRect(bitmap,0,0,width,height,4294967295);
    m._FPDF_RenderPageBitmap(bitmap,id,-x,-y,size.width,size.height,0,1|2|16);
    const tile=new Uint8ClampedArray(m.HEAPU8.buffer,ptr,width*height*4),canvas=new OffscreenCanvas(size.width,size.height),ctx=canvas.getContext('2d')!;
    ctx.fillStyle='white';ctx.fillRect(0,0,size.width,size.height);ctx.putImageData(new ImageData(tile,width,height),x,y);
    return {image:canvas.transferToImageBitmap(),width:size.width,height:size.height,...actual,inkPixels:width*height,fullPixels:size.width*size.height};
  }finally{if(bitmap)m._FPDFBitmap_Destroy(bitmap);if(ptr)m.wasmExports.free(ptr);if(scratch)m.wasmExports.free(scratch);}
}
