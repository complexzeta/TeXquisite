import {PDFiumLibrary,PDFiumDocument} from '@hyzyla/pdfium';
import {inkFitsRaster} from './local-raster';
import {PdfWorkQueue} from './pdf-work-queue';

const library=PDFiumLibrary.init({wasmUrl:new URL('./vendor/pdfium.wasm',import.meta.url).href});
void library.catch(()=>{});
const documents=new Map<number,PDFiumDocument>();
let nextDocument=0;
const work=new PdfWorkQueue();
const worker=globalThis as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(value:unknown,transfer?:Transferable[])=>void};
worker.onmessage=event=>{
  const {id,method,...args}=event.data;
  // PDFium's instance is shared. Serialize calls, including document teardown,
  // while keeping the editor and its event loop independent of rasterization.
  void work.enqueue(method==='checkedRegion'||method==='renderRegion'?0:args.interactive===true?1:2,async()=>{
    try{
      const lib=await library;
      const queueMs=Number.isFinite(args.postedAt)?Math.max(0,performance.timeOrigin+performance.now()-args.postedAt):0;
      if(method==='load'){
        const document=await lib.loadDocument(args.bytes),documentId=++nextDocument;
        documents.set(documentId,document);
        worker.postMessage({id,result:{documentId,numPages:document.getPageCount()}});
      }else if(method==='sizes'){
        const document=documents.get(args.documentId);if(!document)throw new Error('PDF was closed.');
        const sizes=[];for(let i=0;i<document.getPageCount();i++){const page=document.getPage(i);try{sizes.push(page.getOriginalSize());}finally{page.close();}}
        worker.postMessage({id,result:sizes});
      }else if(method==='render'){
        const document=documents.get(args.documentId);if(!document)throw new Error('PDF was closed.');
        const page=document.getPage(args.page-1);
        try{
          const started=performance.now();
          const bitmap=await page.render({scale:args.scale,colorSpace:'RGBA',transparent:false});
          const rasterMs=performance.now()-started;
          if(args.imageBitmap&&typeof OffscreenCanvas!=='undefined'){
            const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
            const pixels=new Uint8ClampedArray(bitmap.data.buffer as ArrayBuffer,bitmap.data.byteOffset,bitmap.data.byteLength);
            canvas.getContext('2d')!.putImageData(new ImageData(pixels,bitmap.width,bitmap.height),0,0);
            const image=canvas.transferToImageBitmap();
            worker.postMessage({id,result:{width:bitmap.width,height:bitmap.height,originalWidth:bitmap.originalWidth,originalHeight:bitmap.originalHeight,image,...(args.includePixels?{data:bitmap.data}:{}),rasterMs,workerMs:performance.now()-started}},args.includePixels?[image,bitmap.data.buffer as ArrayBuffer]:[image]);
          }else worker.postMessage({id,result:{...bitmap,rasterMs,workerMs:performance.now()-started}},[bitmap.data.buffer as ArrayBuffer]);
        }finally{page.close();}
      }else if(method==='checkedRegion'){
        // A local flow fragment has no persistent viewer owner. Load, validate,
        // rasterize and crop in one serialized operation, and release it here.
        // The displayed pixels are copied from the very raster checked for ink.
        const started=performance.now();let document:PDFiumDocument|undefined;
        try{
          document=await lib.loadDocument(args.bytes);const loadedAt=performance.now();
          if(!Number.isSafeInteger(args.page)||args.page<1||args.page>document.getPageCount())throw new Error('Invalid checked PDF page.');
          const page=document.getPage(args.page-1),raw=page as any;
          try{
            const rect=args.rect,bounds=args.bounds;
            if(raw.module._FPDFPage_GetRotation(raw.pageIdx)!==0)throw new Error('Rotated pages require a full render.');
            if(!Number.isFinite(args.scale)||args.scale<=0||args.scale>16||!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new Error('Invalid PDF tile.');
            if(!bounds||![bounds.left,bounds.top,bounds.right,bounds.bottom].every(Number.isFinite)||bounds.right<=bounds.left||bounds.bottom<=bounds.top)throw new Error('Invalid ink bounds.');
            const size=raw.getSize({scale:args.scale}),actual=page.getOriginalSize();
            if(!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1||size.width>32768||size.height>32768||size.width*size.height>16000000)throw new Error('Paragraph ink raster is too large.');
            const sx=size.width/actual.originalWidth,sy=size.height/actual.originalHeight;
            const x=Math.max(0,Math.floor(rect.x*sx)),y=Math.max(0,Math.floor(rect.y*sy)),right=Math.min(size.width,Math.ceil((rect.x+rect.width)*sx)),bottom=Math.min(size.height,Math.ceil((rect.y+rect.height)*sy));
            if(right<=x||bottom<=y)throw new Error('PDF tile is outside the page.');
            const bitmap=await page.render({scale:args.scale,colorSpace:'RGBA',transparent:false}),renderedAt=performance.now();
            if(bitmap.width!==size.width||bitmap.height!==size.height)throw new Error('Checked raster geometry changed.');
            const safe=inkFitsRaster(bitmap.data,bitmap.width,bitmap.height,bounds),checkedAt=performance.now();
            const timing={queueMs,loadMs:loadedAt-started,rasterMs:renderedAt-loadedAt,checkMs:checkedAt-renderedAt,rasterPasses:1};
            if(!safe){worker.postMessage({id,result:{safe:false,...timing,workerMs:performance.now()-started}});}
            else{
              const bx=Math.max(0,x-2),by=Math.max(0,y-2),br=Math.min(size.width,right+2),bb=Math.min(size.height,bottom+2),width=br-bx,height=bb-by,data=new Uint8Array(width*height*4);
              for(let row=0;row<height;row++)data.set(bitmap.data.subarray(((by+row)*size.width+bx)*4,((by+row)*size.width+br)*4),row*width*4);
              const metadata={safe:true,width,height,x,y,patchWidth:right-x,patchHeight:bottom-y,sourceX:x-bx,sourceY:y-by,fullWidth:size.width,fullHeight:size.height,originalWidth:actual.originalWidth,originalHeight:actual.originalHeight,...timing};
              if(args.imageBitmap&&typeof OffscreenCanvas!=='undefined'){
                const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer),width,height),0,0);const image=canvas.transferToImageBitmap();
                worker.postMessage({id,result:{...metadata,image,cropMs:performance.now()-checkedAt,workerMs:performance.now()-started}},[image]);
              }else worker.postMessage({id,result:{...metadata,data,cropMs:performance.now()-checkedAt,workerMs:performance.now()-started}},[data.buffer]);
            }
          }finally{page.close();}
        }finally{document?.destroy();}
      }else if(method==='inkFits'){
        const document=documents.get(args.documentId);if(!document)throw new Error('PDF was closed.');
        const page=document.getPage(args.page-1);
        try{
          const started=performance.now(),bounds=args.bounds;
          if(!Number.isFinite(args.scale)||args.scale<=0||args.scale>16||!bounds||![bounds.left,bounds.top,bounds.right,bounds.bottom].every(Number.isFinite)||bounds.right<=bounds.left||bounds.bottom<=bounds.top)throw new Error('Invalid ink bounds.');
          const size=(page as any).getSize({scale:args.scale});if(size.width*size.height>16000000)throw new Error('Paragraph ink raster is too large.');
          const bitmap=await page.render({scale:args.scale,colorSpace:'RGBA',transparent:false}),renderedAt=performance.now();
          const safe=inkFitsRaster(bitmap.data,bitmap.width,bitmap.height,bounds);
          worker.postMessage({id,result:{safe,rasterMs:renderedAt-started,checkMs:performance.now()-renderedAt,workerMs:performance.now()-started}});
        }finally{page.close();}
      }else if(method==='renderRegion'){
        const document=documents.get(args.documentId);if(!document)throw new Error('PDF was closed.');
        const page=document.getPage(args.page-1),raw=page as any,m=raw.module;let ptr=0,handle=0;
        try{
          const started=performance.now(),rect=args.rect;
          if(m._FPDFPage_GetRotation(raw.pageIdx)!==0)throw new Error('Rotated pages require a full render.');
          if(!Number.isFinite(args.scale)||args.scale<=0||args.scale>16||!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new Error('Invalid PDF tile.');
          const size=raw.getSize({scale:args.scale}),actual=page.getOriginalSize(),sx=size.width/actual.originalWidth,sy=size.height/actual.originalHeight;
          if(size.width>32768||size.height>32768)throw new Error('PDF tile scale is too large.');
          const x=Math.max(0,Math.floor(rect.x*sx)),y=Math.max(0,Math.floor(rect.y*sy)),right=Math.min(size.width,Math.ceil((rect.x+rect.width)*sx)),bottom=Math.min(size.height,Math.ceil((rect.y+rect.height)*sy));
          if(right<=x||bottom<=y)throw new Error('PDF tile is outside the page.');
          // Render a halo at the SAME integer pixel phase as a full-page render,
          // then copy only the central rectangle. This preserves LCD edge ink.
          const bx=Math.max(0,x-2),by=Math.max(0,y-2),br=Math.min(size.width,right+2),bb=Math.min(size.height,bottom+2),width=br-bx,height=bb-by,bytes=width*height*4;
          if(width*height>16000000)throw new Error('PDF tile is too large.');
          ptr=m.wasmExports.malloc(bytes);if(!ptr)throw new Error('Could not allocate PDF tile.');
          handle=m._FPDFBitmap_CreateEx(width,height,4,ptr,width*4);if(!handle)throw new Error('Could not create PDF tile.');
          m._FPDFBitmap_FillRect(handle,0,0,width,height,4294967295);
          m._FPDF_RenderPageBitmap(handle,raw.pageIdx,-bx,-by,size.width,size.height,0,1|2|16);
          const data=m.HEAPU8.slice(ptr,ptr+bytes),rasterMs=performance.now()-started;
          const metadata={width,height,x,y,patchWidth:right-x,patchHeight:bottom-y,sourceX:x-bx,sourceY:y-by,fullWidth:size.width,fullHeight:size.height,originalWidth:size.originalWidth,originalHeight:size.originalHeight,rasterMs};
          if(args.imageBitmap&&typeof OffscreenCanvas!=='undefined'){
            const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer),width,height),0,0);const image=canvas.transferToImageBitmap();
            worker.postMessage({id,result:{...metadata,image,workerMs:performance.now()-started}},[image]);
          }else worker.postMessage({id,result:{...metadata,data,workerMs:performance.now()-started}},[data.buffer]);
        }finally{if(handle)m._FPDFBitmap_Destroy(handle);if(ptr)m.wasmExports.free(ptr);page.close();}
      }else if(method==='glyphs'){
        const document=documents.get(args.documentId);if(!document)throw new Error('PDF was closed.');
        const page=document.getPage(args.page-1),raw=page as any,m=raw.module;
        let text=0,buffer=0;
        try{
          if(m._FPDFPage_GetRotation(raw.pageIdx)!==0)throw new Error('Rotated pages are editable in the source pane.');
          text=m._FPDFText_LoadPage(raw.pageIdx);if(!text)throw new Error('PDF text is unavailable.');
          buffer=m.wasmExports.malloc(32);const count=m._FPDFText_CountChars(text),height=page.getOriginalSize().originalHeight,characters:number[][]=[];
          if(count>100000)throw new Error('This page has too many characters for preview editing.');
          for(let i=0;i<count;i++){
            const code=m._FPDFText_GetUnicode(text,i),angle=m._FPDFText_GetCharAngle(text,i);
            if(code<33||code>0x10ffff||!Number.isFinite(angle)||Math.abs(angle)>.01||!m._FPDFText_GetCharBox(text,i,buffer,buffer+8,buffer+16,buffer+24))continue;
            const [left,right,bottom,top]=new Float64Array(m.HEAPU8.buffer,buffer,4);
            if([left,right,bottom,top].every(Number.isFinite)&&right>left&&top>bottom)characters.push([code,left,height-top,right-left,top-bottom]);
          }
          worker.postMessage({id,result:characters});
        }finally{if(buffer)m.wasmExports.free(buffer);if(text)m._FPDFText_ClosePage(text);page.close();}
      }else if(method==='close'){
        documents.get(args.documentId)?.destroy();documents.delete(args.documentId);
        worker.postMessage({id,result:null});
      }else throw new Error('Unknown PDF worker request.');
    }catch(error){worker.postMessage({id,error:String(error)});}
  }).catch(error=>worker.postMessage({id,error:String(error)}));
};
