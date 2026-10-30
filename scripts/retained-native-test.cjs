// Architectural experiment, not a measurement of the installed editor.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os'),{deflateSync}=require('node:zlib');
const {ResidentCompiler,ResidentSourceError}=require('../dist/resident'),{RetainedLayout,retainedStateCompatible}=require('../dist/retained-layout'),{flowLocations}=require('../dist/region-compositor');
const signal=()=>new AbortController().signal,quantile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);process.env.PERSISTENT_TEX_MULTI_BLOCK='1';
 const directory=require('./test-artifacts.cjs').testDirectory('retained-native'),owner=new ResidentCompiler(),reference=new ResidentCompiler(),library=await require('@hyzyla/pdfium').PDFiumLibrary.init(),project={characterMapping:true};
 let result={passed:false,directory,samples:[],timingEndpoint:'native request + serialized PDFium raster; excludes editor IPC, canvas publication and physical display'};const fixture={baseline:[],patches:[]},packed=bitmap=>({width:bitmap.width,height:bitmap.height,rgba:deflateSync(bitmap.data).toString('base64')});
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n',paragraphs=['Alpha '+('ordinary words '.repeat(10))+'\n\n','Beta '+('neighboring words '.repeat(10))+'\n\n','Gamma inline $x^2+\\sqrt{\\pi}$ equation.\n\n',...Array.from({length:85},(_,i)=>'Paragraph '+i+' '+('following lecture words '.repeat(10))+'\n\n')],source=prefix+paragraphs.join('')+'\\end{document}\n';
 const raster=async(bytes,pageNumber=1)=>{const doc=await library.loadDocument(bytes);try{const page=doc.getPage(pageNumber-1);try{return {bitmap:await page.render({scale:1,colorSpace:'RGBA',transparent:false}),pages:doc.getPageCount()};}finally{page.close();}}finally{doc.destroy();}};
 try{
  await fs.writeFile(path.join(directory,'main.tex'),source);await owner.compile(source,signal(),60000,()=>{},project);await reference.compile(source,signal(),60000,()=>{},project);
  let from=prefix.length;const slots=[];
  for(let n=0;n<3;n++){
   const range={from,to:from+paragraphs[n].length},start=performance.now(),prepared=await owner.prepareRegion(source,range,signal(),30000,()=>{},project),output=await owner.previewRegionFlow(source,range,signal(),30000,()=>{},project,true,undefined,true),frame=await raster(output.pdf,output.fragment.page);
   slots.push({range,key:prepared.regionKey,output,height:frame.bitmap.height,width:frame.bitmap.width});fixture.baseline.push(packed(frame.bitmap));result.samples.push({kind:'preparation',paragraph:n,ms:performance.now()-start,neutralCharacters:output.fragment.neutralCharacters});from=range.to;
  }
  assert.equal(slots[0].width,slots[1].width);const offsets=[0,slots[0].height,slots[0].height+slots[1].height];let layout=new RetainedLayout(slots.reduce((n,s)=>n+s.height,0));
  for(let i=0;i<10;i++){
   const index=i%2,slot=slots[index],text=i===0?('Expanded ordinary lecture words '.repeat(320)+'\n\n'):i===2?'A.\n\n':paragraphs[index].trim()+' changed '+i+'\n\n',draft=source.slice(0,slot.range.from)+text+source.slice(slot.range.to),range={from:slot.range.from,to:slot.range.from+text.length};
   owner.useRegion(slot.key);const start=performance.now(),output=await owner.previewRegionFlow(draft,range,signal(),30000,()=>{},project,true,undefined,true),nativeAt=performance.now(),frame=await raster(output.pdf,output.fragment.page),end=performance.now();
   assert.ok(retainedStateCompatible(slot.output.fragment,output.fragment),'Ordinary text changed native state');assert.equal(frame.bitmap.width,slot.width);assert.equal(frame.pages,1);assert.equal(output.timing.documentComplete,false);assert.ok(output.timing.excludedSuffixBytes>1000);
   const slice={id:String(index),from:offsets[index],to:offsets[index]+slot.height};layout=layout.updated({...slice,height:frame.bitmap.height});fixture.patches.push({slice,bitmap:packed(frame.bitmap)});
   const locations=flowLocations(output.navigation,draft,'main',output.fragment.page,range.from,range.to);assert.ok(locations.length);
   for(const g of locations){const y=layout.forward(g.y,String(index));if(y!==undefined){const point=layout.inverse(y);assert.equal(point.id,String(index));assert.ok(Math.abs(point.y-g.y)<1e-8);}}
   const fullStart=performance.now(),full=await reference.compile(draft,signal(),30000,()=>{},project),fullAt=performance.now(),complete=await raster(full),fullEnd=performance.now();
   result.samples.push({kind:i===0?'growth-beyond-page':i===2?'deletion':'small-edit',paragraph:index,nativeMs:nativeAt-start,rasterMs:end-nativeAt,localMs:end-start,warmFullMs:fullEnd-fullStart,warmFullCompileMs:fullAt-fullStart,fullPages:complete.pages,localHeight:frame.bitmap.height,baselineHeight:slot.height,stateProved:true});
   if(i===0)assert.ok(frame.bitmap.height>792,'Fixture must grow beyond a normal page');
  }
  const math=slots[2];owner.useRegion(math.key);const mathText=paragraphs[2].replace('x^2','x^3'),mathDraft=source.slice(0,math.range.from)+mathText+source.slice(math.range.to),mathOut=await owner.previewRegionFlow(mathDraft,{from:math.range.from,to:math.range.from+mathText.length},signal(),30000,()=>{},project,true,undefined,true);
  assert.equal(retainedStateCompatible(math.output.fragment,mathOut.fragment),false,'Current proof must refuse inline math');result.inlineMathRequiresNewStateProof=true;
  owner.useRegion(slots[0].key);const broken='Broken $\\sqrt{\n\n',bad=source.slice(0,slots[0].range.from)+broken+source.slice(slots[0].range.to);await assert.rejects(owner.previewRegionFlow(bad,{from:slots[0].range.from,to:slots[0].range.from+broken.length},signal(),30000,()=>{},project,true,undefined,true),ResidentSourceError);
  owner.useRegion(slots[0].key);const recovered=await owner.previewRegionFlow(source,slots[0].range,signal(),30000,()=>{},project,true,undefined,true);assert.ok(retainedStateCompatible(slots[0].output.fragment,recovered.fragment));result.errorRecovery=true;
  await fs.writeFile(path.join(directory,'fixture.json'),JSON.stringify(fixture));const samples=result.samples.filter(s=>s.kind!=='preparation'),small=samples.filter(s=>s.kind==='small-edit');result.localMs={median:quantile(samples.map(s=>s.localMs),.5),max:Math.max(...samples.map(s=>s.localMs))};result.smallEditMs={median:quantile(small.map(s=>s.localMs),.5),max:Math.max(...small.map(s=>s.localMs))};result.warmFullMs={median:quantile(samples.map(s=>s.warmFullMs),.5),max:Math.max(...samples.map(s=>s.warmFullMs))};result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{owner.stop();reference.stop();library.destroy();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
