// Real native-engine coverage of the reusable (not early-rejected) probe.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{LocalPreview}=require('../dist/local-preview'),{rasterBytesEqual}=require('../dist/local-raster');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('contraction-reuse'),root=path.join(directory,'main.tex');
 const prefix='\\documentclass{article}\n\\begin{document}\n\n',body='Target '+('ordinary words '.repeat(450))+'\n\n',suffix='\\end{document}\n',source=prefix+body+suffix,draft=source.replace('ordinary words '.repeat(25),'');await fs.writeFile(root,source);
 const owner=new ResidentCompiler(),full=new ResidentCompiler(),signal=()=>new AbortController().signal,project={characterMapping:true},library=await require('@hyzyla/pdfium').PDFiumLibrary.init();
 let local,base,outputPdf,result={passed:false,directory};
 const equal=async(bytes,reference,first)=>{const document=await library.loadDocument(bytes);try{for(let i=0;i<document.getPageCount();i++){const a=document.getPage(i),b=reference.getPage(first-1+i);try{const x=await a.render({scale:1,colorSpace:'RGBA',transparent:false}),y=await b.render({scale:1,colorSpace:'RGBA',transparent:false});assert.equal(x.width,y.width);assert.equal(x.height,y.height);assert.ok(rasterBytesEqual(x.data,y.data),'Page pixels differ');}finally{a.close();b.close();}}return document.getPageCount();}finally{document.destroy();}};
 try{
  const pdf=await owner.compile(source,signal(),60000,()=>{},project);base=await library.loadDocument(pdf);assert.ok(base.getPageCount()>=2&&base.getPageCount()<=3,'Fixture must span a bounded multi-page paragraph');
  const calls=[],native=owner.previewRegionPage.bind(owner);owner.previewRegionPage=async(text,...args)=>{calls.push(text);return native(text,...args);};
  let proofCount=0,finish;const displayed=new Promise(r=>finish=r),fallbacks=[];
  local=new LocalPreview(async()=>false,async candidate=>{assert.equal(proofCount,1);assert.equal(candidate.pageOutput,true);assert.equal(candidate.sourceHash,createHash('sha256').update(draft).digest('hex'));outputPdf=candidate.pdf;result.span=candidate.pageSpan;finish();return true;},id=>{fallbacks.push(id);finish();},()=>{},()=>{},async(_basis,pdf,span)=>{proofCount++;await equal(pdf,base,span.first);return true;});
  local.basis={source,compilerSource:source,pdf,bundle:{id:'fixture'},options:{root},project,returnCompiler:()=>true};local.cursor={file:root,at:prefix.length+12};local.continuous=true;local.warmCompiler=owner;local.pending={source:draft,editId:'draft',at:prefix.length+12};
  await local.arm(true);await Promise.race([displayed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No proved output')),30000);timer.unref();})]);
  assert.deepEqual(fallbacks,[]);assert.deepEqual(calls,[draft,source],'Edited response must be reused after baseline proof');assert.ok(outputPdf);
  const complete=await full.compile(draft,signal(),60000,()=>{},project),reference=await library.loadDocument(complete);try{result.pagesCompared=await equal(outputPdf,reference,result.span.first);}finally{reference.destroy();}
  result={...result,passed:true,nativePageCalls:calls.length,baselineProofs:proofCount,exactFullBuildPixels:true};
 }catch(error){result.error=String(error);throw error;}finally{local?.stop();owner.stop();full.stop();base?.destroy();library.destroy();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
