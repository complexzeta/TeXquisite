const {_electron:electron}=require('playwright'),{PDFDocument,StandardFonts,rgb}=require('pdf-lib'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const directory=path.resolve('.test-output','pdf-tiles-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-pdf-tiles-'));await fs.mkdir(directory,{recursive:true});
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),p=pdf.addPage([595.276,841.89]);
 for(let y=0;y<840;y+=23){p.drawText('Tile phase: 0123456789 thin strokes / () sqrt pi',{x:0.37+(y%37),y:y+.23,font,size:12.73,color:rgb(.1,.2,.4)});p.drawLine({start:{x:0,y:y+.77},end:{x:595.276,y:y+13.19},thickness:.37,color:rgb(.8,.1,.2)});}
 const bytes=Array.from(await pdf.save());const app=await electron.launch({args:['.'],env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow();
 try{
  const result=await page.evaluate(async bytes=>{
   const worker=new Worker(new URL('pdf-worker.js',location.href),{type:'module'});let id=0;const pending=new Map();worker.onmessage=e=>{const p=pending.get(e.data.id);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result);};const call=(method,args)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});worker.postMessage({id:n,method,...args});});
   try{const {documentId}=await call('load',{bytes:new Uint8Array(bytes)}),samples=[];
    for(const scale of [.8,1,1.25,2.5,5]){const full=await call('render',{documentId,page:1,scale});for(const rect of [{x:0,y:0,width:595.276,height:19.13},{x:13.17,y:70.23,width:181.31,height:42.77},{x:590,y:800,width:5.276,height:41.89},{x:0,y:830,width:595.276,height:11.89}]){
     const t=await call('renderRegion',{documentId,page:1,scale,rect});let differences=0,maxDelta=0;for(let y=0;y<t.patchHeight;y++)for(let x=0;x<t.patchWidth;x++){const a=((y+t.sourceY)*t.width+x+t.sourceX)*4,b=((y+t.y)*full.width+x+t.x)*4;for(let c=0;c<4;c++){const d=Math.abs(t.data[a+c]-full.data[b+c]);if(d){differences++;maxDelta=Math.max(maxDelta,d);}}}samples.push({scale,rect,differences,maxDelta,width:t.patchWidth,height:t.patchHeight});
    }}await call('close',{documentId});return samples;
   }finally{worker.terminate();}
  },bytes);await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));assert.equal(result.length,20);assert.ok(result.every(r=>r.maxDelta<=2),JSON.stringify(result.filter(r=>r.maxDelta>2)));console.log(JSON.stringify({passed:true,directory,comparisons:result.length,maxChannelDelta:Math.max(...result.map(r=>r.maxDelta)),note:'PDFium can round translated colored vector antialiasing by 1–2 channel levels. Production additionally requires exact parity for each actual baseline.'}));
 }finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
