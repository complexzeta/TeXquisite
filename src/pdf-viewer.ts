import {RasterCanvasReuse} from './raster-canvas-reuse';
import type {PdfCharacter} from './preview-edit';
export interface PdfGlyphProof {glyph:PdfCharacter;outline?:string;}
const worker=new Worker(new URL('./pdf-worker.js',location.href),{type:'module'});
let sequence=0,failure:Error|undefined;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const reusableCanvases=new RasterCanvasReuse<HTMLCanvasElement>();
const proofPixels=new WeakMap<HTMLCanvasElement,Uint8ClampedArray>();
export function copyPdfRaster(canvas:HTMLCanvasElement){
  const pixels=proofPixels.get(canvas);if(!pixels||!canvas.width||pixels.length!==canvas.width*canvas.height*4)return;
  const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.style.width=canvas.style.width;copy.style.height=canvas.style.height;copy.getContext('2d')!.drawImage(canvas,0,0);return {canvas:copy,pixels};
}
worker.onmessage=event=>{
  const {id,result,error}=event.data,request=pending.get(id);if(!request)return;
  clearTimeout(request.timer);pending.delete(id);
  if(error)request.reject(new Error(error));else request.resolve(result);
};
worker.onerror=event=>{
  failure=new Error('PDF renderer failed: '+event.message);
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(failure);}pending.clear();
};
function request(method:string,args:Record<string,unknown>,transfer:Transferable[]=[]):Promise<any>{
  if(failure)return Promise.reject(failure);
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('PDF renderer timed out.'));},25000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({id,method,...args,postedAt:performance.timeOrigin+performance.now()},transfer);
  });
}
// Ephemeral local output needs no document handle or teardown round trip.
export function renderCheckedPdfRegion(bytes:Uint8Array,page:number,rect:{x:number;y:number;width:number;height:number},bounds:{left:number;top:number;right:number;bottom:number},scale:number,ratio:number){
  return request('checkedRegion',{bytes,page,rect,bounds,scale:scale*ratio,imageBitmap:true},[bytes.buffer as ArrayBuffer]);
}
export function loadPdf(bytes:Uint8Array,interactive=false,live=false){
  const call=(method:string,args:Record<string,unknown>,transfer:Transferable[]=[])=>request(method,{...args,interactive:interactive||args.interactive===true,live:live||args.live===true},transfer);
  let documentId:number|undefined,closed=false;
  const promise=call('load',{bytes},[bytes.buffer as ArrayBuffer]).then(result=>{
    documentId=result.documentId;
    const glyphCache=new Map<number,Promise<PdfCharacter[]>>();
    const glyphProofCache=new Map<number,Promise<PdfGlyphProof[]>>();
    let pageSizes:Promise<any>|undefined;
    // Proofs consume the worker raster directly, avoiding a GPU canvas readback.
    const rasterize=async(page:number,scale:number,ratio:number,retainPixels=false,includePixels=false,urgent=false,previous?:HTMLCanvasElement)=>{
        if(closed)throw new Error('PDF was closed.');
        const started=performance.now(),args={documentId,page,scale:scale*ratio,imageBitmap:!retainPixels,interactive:retainPixels||includePixels,includePixels,live:urgent};
        const reuseRasterId=!retainPixels&&!includePixels?reusableCanvases.token(previous):undefined;
        let bitmap=await call('render',{...args,reuseRasterId});
        if(bitmap.rasterReuse){
          const canvas=reusableCanvases.accept(previous,bitmap);
          if(canvas){canvas.style.width=bitmap.originalWidth*scale+'px';canvas.style.height=bitmap.originalHeight*scale+'px';canvas.dataset.pdfCanvasReused='true';canvas.dataset.rasterCacheHit='true';canvas.dataset.rasterMs='0';canvas.dataset.workerMs=String(bitmap.workerMs);canvas.dataset.renderMs=String(performance.now()-started);return{canvas,pixels:undefined};}
          // The view can retire or resize an offered canvas while the worker
          // checks it. Request pixels normally; never display an empty token.
          bitmap=await call('render',args);
        }
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        canvas.style.width=bitmap.originalWidth*scale+'px';canvas.style.height=bitmap.originalHeight*scale+'px';
        canvas.dataset.pdfPageWidth=String(bitmap.pageWidth);canvas.dataset.pdfPageHeight=String(bitmap.pageHeight);
        if(bitmap.image&&bitmap.inkTile){const t=bitmap.inkTile;if(![t.x,t.y,t.width,t.height].every(Number.isInteger)||t.x<0||t.y<0||t.width!==bitmap.image.width||t.height!==bitmap.image.height||t.x+t.width>bitmap.width||t.y+t.height>bitmap.height){bitmap.image.close();throw Error('Invalid page ink image');}const target=canvas.getContext('2d')!;target.fillStyle='white';target.fillRect(0,0,canvas.width,canvas.height);target.drawImage(bitmap.image,t.x,t.y);bitmap.image.close();}
        else if(bitmap.image){const target=canvas.getContext('bitmaprenderer');if(target)target.transferFromImageBitmap(bitmap.image);else{canvas.getContext('2d')!.drawImage(bitmap.image,0,0);bitmap.image.close();}}
        const pixels=bitmap.data?new Uint8ClampedArray(bitmap.data.buffer,bitmap.data.byteOffset,bitmap.data.byteLength):undefined;
        if(pixels&&!bitmap.image){canvas.getContext('2d')!.putImageData(new ImageData(pixels,bitmap.width,bitmap.height),0,0);}
        if(includePixels&&pixels)proofPixels.set(canvas,pixels);
        reusableCanvases.remember(canvas,bitmap.rasterId);canvas.dataset.pdfCanvasReused='false';
        canvas.dataset.rasterCacheHit=String(bitmap.rasterCacheHit===true);canvas.dataset.rasterMs=String(bitmap.rasterMs);canvas.dataset.workerMs=String(bitmap.workerMs);canvas.dataset.renderMs=String(performance.now()-started);
        return {canvas,pixels};
      };
    return {
      async verifyPageBand(frames:{pixels:Uint8ClampedArray;width:number;height:number}[],scale:number){
        if(closed)throw new Error('PDF was closed.');
        return call('verifyPageBand',{documentId,frames,scale},frames.map(frame=>frame.pixels.buffer as ArrayBuffer));
      },
      glyphs(page:number):Promise<PdfCharacter[]>{if(closed)return Promise.reject(new Error('PDF was closed.'));let result=glyphCache.get(page);if(!result){result=call('glyphs',{documentId,page});glyphCache.set(page,result);}return result;},
      glyphProofs(page:number):Promise<PdfGlyphProof[]>{if(closed)return Promise.reject(new Error('PDF was closed.'));let result=glyphProofCache.get(page);if(!result){result=call('glyphProofs',{documentId,page});glyphProofCache.set(page,result);}return result;},
      numPages:result.numPages,
      sizes(interactive=false){if(closed)return Promise.reject(new Error('PDF was closed.'));return pageSizes??(pageSizes=call('sizes',{documentId,interactive}));},
      async inkFits(page:number,bounds:{left:number;top:number;right:number;bottom:number},scale:number,ratio:number){
        if(closed)throw new Error('PDF was closed.');return call('inkFits',{documentId,page,bounds,scale:scale*ratio});
      },
      async renderRegion(page:number,rect:{x:number;y:number;width:number;height:number},scale:number,ratio:number){
        if(closed)throw new Error('PDF was closed.');return call('renderRegion',{documentId,page,rect,scale:scale*ratio,imageBitmap:true});
      },
      async regionPixels(page:number,rect:{x:number;y:number;width:number;height:number},scale:number,ratio:number){
        if(closed)throw new Error('PDF was closed.');return call('renderRegion',{documentId,page,rect,scale:scale*ratio,imageBitmap:false,interactive:true});
      },
      async renderPixels(page:number,scale:number,ratio:number){
        if(closed)throw new Error('PDF was closed.');
        const bitmap=await call('render',{documentId,page,scale:scale*ratio,imageBitmap:false,interactive:true});
        return {width:bitmap.width,height:bitmap.height,pixels:new Uint8ClampedArray(bitmap.data.buffer,bitmap.data.byteOffset,bitmap.data.byteLength)};
      },
      async render(page:number,scale:number,ratio:number,includePixels=false,urgent=false,previous?:HTMLCanvasElement){return (await rasterize(page,scale,ratio,false,includePixels,urgent,previous)).canvas;},
      async renderWithPixels(page:number,scale:number,ratio:number){const frame=await rasterize(page,scale,ratio,true);if(!frame.pixels)throw new Error('PDF proof pixels are unavailable.');return {canvas:frame.canvas,pixels:frame.pixels};}
    };
  });
  return {promise,async destroy(){
    if(closed)return;closed=true;
    try{await promise;if(documentId!==undefined)await call('close',{documentId});}catch{/* A failed load owns no usable document. */}
  }};
}
