const {_electron:electron}=require('playwright'),{PDFDocument,StandardFonts,rgb,degrees}=require('pdf-lib'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const directory=path.resolve('.test-output','checked-region-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-checked-'));await fs.mkdir(directory,{recursive:true});
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),p=pdf.addPage([595.276,841.89]);
 for(let y=0;y<840;y+=23){p.drawText('Checked phase: 0123456789 thin strokes / () sqrt pi',{x:.37+y%37,y:y+.23,font,size:12.73,color:rgb(.1,.2,.4)});p.drawLine({start:{x:0,y:y+.77},end:{x:595.276,y:y+13.19},thickness:.37,color:rgb(.8,.1,.2)});}
 const bytes=Array.from(await pdf.save()),rotated=await PDFDocument.load(new Uint8Array(bytes));rotated.getPage(0).setRotation(degrees(90));const rotatedBytes=Array.from(await rotated.save());
 const huge=await PDFDocument.create();huge.addPage([10000,10000]);const hugeBytes=Array.from(await huge.save());
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow();
 try{
 const result=await page.evaluate(async({bytes,rotatedBytes,hugeBytes})=>{
  const worker=new Worker(new URL('pdf-worker.js',location.href),{type:'module'});let id=0;const pending=new Map();worker.onmessage=e=>{const p=pending.get(e.data.id);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result);};const call=(method,args)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});worker.postMessage({id:n,method,...args});});
  const fail=(ok,label)=>{if(!ok)throw Error(label);};
  try{const {documentId}=await call('load',{bytes:new Uint8Array(bytes)}),samples=[];
   for(const scale of [.8,1,1.25,2.5,5]){const full=await call('render',{documentId,page:1,scale}),bounds={left:0,top:0,right:full.width,bottom:full.height};
    for(const rect of [{x:0,y:0,width:595.276,height:19.13},{x:13.17,y:70.23,width:181.31,height:42.77},{x:590,y:800,width:5.276,height:41.89},{x:0,y:830,width:595.276,height:11.89}])for(const imageBitmap of [false,true]){
     const t=await call('checkedRegion',{bytes:new Uint8Array(bytes),page:1,scale,rect,bounds,imageBitmap});fail(t.safe&&t.rasterPasses===1,'One checked raster required');let data=t.data;
     if(t.image){const c=document.createElement('canvas');c.width=t.width;c.height=t.height;c.getContext('bitmaprenderer').transferFromImageBitmap(t.image);const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;copy.getContext('2d').drawImage(c,0,0);data=copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data;c.width=c.height=copy.width=copy.height=0;}
     let differences=0;for(let y=0;y<t.patchHeight;y++)for(let x=0;x<t.patchWidth;x++){const a=((y+t.sourceY)*t.width+x+t.sourceX)*4,b=((y+t.y)*full.width+x+t.x)*4;for(let c=0;c<4;c++)if(data[a+c]!==full.data[b+c])differences++;}
     fail(differences===0,'Checked crop must equal independently rendered full page');samples.push({scale,rect,imageBitmap,differences});
    }
    const unsafe=await call('checkedRegion',{bytes:new Uint8Array(bytes),page:1,scale,rect:{x:0,y:0,width:10,height:10},bounds:{left:40,top:40,right:80,bottom:80},imageBitmap:true});fail(unsafe.safe===false&&!unsafe.image&&!unsafe.data,'Unsafe ink must return no display pixels');
   }
   const valid={bytes:new Uint8Array(bytes),page:1,scale:1,rect:{x:10,y:10,width:50,height:50},bounds:{left:0,top:0,right:596,bottom:842}};let rejected=0;
   for(const override of [{page:0},{page:2},{page:1.5},{scale:NaN},{scale:17},{bounds:{left:0,top:0,right:NaN,bottom:50}},{bounds:{left:20,top:0,right:10,bottom:50}},{rect:{x:0,y:0,width:0,height:10}},{rect:{x:900,y:900,width:10,height:10}},{bytes:new Uint8Array([1,2,3])},{bytes:new Uint8Array(rotatedBytes)},{bytes:new Uint8Array(hugeBytes)}]){
    let caught=false;try{await call('checkedRegion',{...valid,...override});}catch{caught=true;rejected++;}fail(caught,'Malformed/unsafe checked request must reject');
    const recovered=await call('checkedRegion',valid);fail(recovered.safe&&recovered.data?.length,'Worker must recover after each rejection');
   }
   await call('close',{documentId});return {passed:true,comparisons:samples.length,exactCrops:samples.every(s=>s.differences===0),unsafeInkChecks:5,rejectedAndRecovered:rejected,samples};
  }finally{worker.terminate();}
 },{bytes,rotatedBytes,hugeBytes});assert.equal(result.comparisons,40);assert.equal(result.rejectedAndRecovered,12);await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,samples:undefined,directory}));
 }finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1});
