const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const {PDFDocument,StandardFonts}=require('pdf-lib');
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('continuous-descender'),profile=path.join(directory,'profile');await fs.mkdir(profile);
 const bundle=async(entry,name)=>(await require('esbuild').build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',globalName:name,write:false})).outputFiles[0].text+`;window.${name}=${name};void 0;`;
 const helper=await bundle('src/continuous-view.ts','PatchedFlow'),viewer=await bundle('src/pdf-viewer.ts','ProofViewer');
 const before=process.env.PERSISTENT_TEX_BASELINE_SOURCE?await bundle(path.join(process.env.PERSISTENT_TEX_BASELINE_SOURCE,'src/continuous-view.ts'),'PreviousFlow'):undefined;
 const pdf=await PDFDocument.create(),italic=await pdf.embedFont(StandardFonts.TimesRomanItalic),roman=await pdf.embedFont(StandardFonts.TimesRoman),p=pdf.addPage([300,180]);
 p.drawText('This is the rising factorial',{x:18,y:125,size:20,font:italic});p.drawText('Continuing text below.',{x:18,y:88,size:20,font:roman});
 const bytes=Array.from(await pdf.save()),app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});let result={passed:false,directory};
 try{os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);const page=await app.firstWindow({timeout:90000});await page.evaluate(viewer);await page.evaluate(helper);if(before)await page.evaluate(before);
 result.samples=await page.evaluate(async({bytes,baseline})=>{
  const held=window.ProofViewer.loadPdf(new Uint8Array(bytes),true),doc=await held.promise,samples=[];
  try{for(const factor of [1,1.25,2.5]){
   const rendered=await doc.render(1,1,factor),base=document.createElement('canvas');base.width=rendered.width;base.height=rendered.height;base.style.width=rendered.style.width;base.style.height=rendered.style.height;base.getContext('2d').drawImage(rendered,0,0);rendered.width=rendered.height=0;const pixels=base.getContext('2d').getImageData(0,0,base.width,base.height).data;
   let lastInk=-1;for(let y=0;y<Math.floor(75*factor);y++)for(let x=0;x<base.width;x++){const at=(y*base.width+x)*4;if(pixels[at]<200||pixels[at+1]<200||pixels[at+2]<200)lastInk=y;}
   if(lastInk<0)throw Error('Missing italic fixture ink');const start=lastInk-Math.ceil(2*factor),y=(start+.2)/factor,leading=8,rect={x:0,y,width:300,height:65},end=Math.ceil((y+rect.height)*factor);
   const tileCanvas=document.createElement('canvas');tileCanvas.width=base.width;tileCanvas.height=Math.ceil(57*factor);const tc=tileCanvas.getContext('2d');tc.fillStyle='white';tc.fillRect(0,0,tileCanvas.width,tileCanvas.height);tc.fillStyle='#112244';tc.fillRect(Math.ceil(20*factor),Math.ceil(24*factor),Math.ceil(50*factor),Math.ceil(8*factor));
   const makeTile=()=>({width:tileCanvas.width,height:tileCanvas.height,patchWidth:tileCanvas.width,patchHeight:tileCanvas.height,sourceX:0,sourceY:0,data:tc.getImageData(0,0,tileCanvas.width,tileCanvas.height).data});
   for(const [name,View]of [...(baseline?[['previous',window.PreviousFlow.ContinuousView]]:[]),['fixed',window.PatchedFlow.ContinuousView]]){
    const viewport=document.createElement('div'),host=document.createElement('div');viewport.style.cssText='height:240px;overflow:auto';viewport.append(host);document.body.append(viewport);const view=new View(host,viewport),copy=document.createElement('canvas');copy.width=base.width;copy.height=base.height;copy.getContext('2d').drawImage(base,0,0);await view.show(name,doc,copy,1,1,factor);
    const flow={rect,leading,baselineLeading:leading},block=view.patch(1,base,makeTile(),flow),shown=block.getContext('2d').getImageData(0,0,block.width,Math.ceil((y+leading)*factor)-start).data;let lost=0;
    for(let row=0;row<shown.length/(block.width*4);row++)for(let x=0;x<block.width;x++){const original=((start+row)*block.width+x)*4,updated=(row*block.width+x)*4;for(let c=0;c<4;c++)if(pixels[original+c]!==shown[updated+c]){lost++;break;}}
    samples.push({name,factor,changedPrefixPixels:lost});if(name==='fixed'){
     if(lost)throw Error('Preceding descender was altered');for(const nextLeading of [10,5,8])view.patch(1,base,makeTile(),{...flow,leading:nextLeading});
     const previous=host.querySelectorAll('canvas')[1],height=previous.height;let rejected=false,closed=false;try{view.patch(1,base,{...makeTile(),image:{close(){closed=true;}}},{...flow,leading:0});}catch(e){rejected=/overlaps preceding ink/.test(String(e));}
     if(!rejected||!closed||previous.height!==height||host.querySelectorAll('canvas')[1]!==previous)throw Error('Overlapping update must preserve the last good block and release its bitmap');
     const pieces=[...host.querySelectorAll('canvas')],bottom=pieces.at(-1),tail=bottom.getContext('2d').getImageData(0,0,bottom.width,bottom.height).data;for(let i=0;i<tail.length;i++)if(tail[i]!==pixels[end*base.width*4+i])throw Error('Unchanged following content changed');
     view.rescale(1.2);base.style.width='360px';base.style.height=base.height/(factor/1.2)+'px';view.patchPages(1,[base]);if(pieces.some(c=>c.width||c.height))throw Error('Retired block pixels were retained');
    }
    view.clear();viewport.remove();
   }
  }return samples;}finally{await held.destroy();}
 },{bytes,baseline:!!before});
 for(const s of result.samples)assert.equal(s.name==='fixed'?s.changedPrefixPixels===0:s.changedPrefixPixels>0,true,'Baseline reproduction and fixed prefix preservation');result.passed=true;
 }finally{await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1});
