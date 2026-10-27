import type {PdfCharacter} from './preview-edit';
const worker=new Worker(new URL('./pdf-worker.js',location.href),{type:'module'});
let sequence=0,failure:Error|undefined;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
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
export function loadPdf(bytes:Uint8Array,interactive=false){
  const call=(method:string,args:Record<string,unknown>,transfer:Transferable[]=[])=>request(method,{...args,interactive:interactive||args.interactive===true},transfer);
  let documentId:number|undefined,closed=false;
  const promise=call('load',{bytes},[bytes.buffer as ArrayBuffer]).then(result=>{
    documentId=result.documentId;
    const glyphCache=new Map<number,Promise<PdfCharacter[]>>();
    let pageSizes:Promise<any>|undefined;
    // Proofs consume the worker raster directly, avoiding a GPU canvas readback.
    const rasterize=async(page:number,scale:number,ratio:number,retainPixels=false,includePixels=false)=>{
        if(closed)throw new Error('PDF was closed.');
        const started=performance.now(),bitmap=await call('render',{documentId,page,scale:scale*ratio,imageBitmap:!retainPixels,interactive:retainPixels||includePixels,includePixels});
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        canvas.style.width=bitmap.originalWidth*scale+'px';canvas.style.height=bitmap.originalHeight*scale+'px';
        if(bitmap.image){const target=canvas.getContext('bitmaprenderer');if(target)target.transferFromImageBitmap(bitmap.image);else{canvas.getContext('2d')!.drawImage(bitmap.image,0,0);bitmap.image.close();}}
        const pixels=bitmap.data?new Uint8ClampedArray(bitmap.data.buffer,bitmap.data.byteOffset,bitmap.data.byteLength):undefined;
        if(pixels&&!bitmap.image){canvas.getContext('2d')!.putImageData(new ImageData(pixels,bitmap.width,bitmap.height),0,0);}
        if(includePixels&&pixels)proofPixels.set(canvas,pixels);
        canvas.dataset.rasterMs=String(bitmap.rasterMs);canvas.dataset.workerMs=String(bitmap.workerMs);canvas.dataset.renderMs=String(performance.now()-started);
        return {canvas,pixels};
      };
    return {
      glyphs(page:number):Promise<PdfCharacter[]>{if(closed)return Promise.reject(new Error('PDF was closed.'));let result=glyphCache.get(page);if(!result){result=call('glyphs',{documentId,page});glyphCache.set(page,result);}return result;},
      numPages:result.numPages,
      sizes(){if(closed)return Promise.reject(new Error('PDF was closed.'));return pageSizes??(pageSizes=call('sizes',{documentId}));},
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
      async render(page:number,scale:number,ratio:number,includePixels=false){return (await rasterize(page,scale,ratio,false,includePixels)).canvas;},
      async renderWithPixels(page:number,scale:number,ratio:number){const frame=await rasterize(page,scale,ratio,true);if(!frame.pixels)throw new Error('PDF proof pixels are unavailable.');return {canvas:frame.canvas,pixels:frame.pixels};}
    };
  });
  return {promise,async destroy(){
    if(closed)return;closed=true;
    try{await promise;if(documentId!==undefined)await call('close',{documentId});}catch{/* A failed load owns no usable document. */}
  }};
}
