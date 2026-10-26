const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{PDFDocument,rgb}=require('pdf-lib');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','local-ink-ui-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-ink-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),source='\\documentclass{article}\n\\begin{document}\n\nTarget paragraph with ordinary words.\n\nFollowing stable paragraph.\n\n\\newpage\nTail.\n\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:['--force-device-scale-factor=2.5']}:{args:['--force-device-scale-factor=2.5','.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(source),{timeout:60000});
  const fixtures=[];for(const kind of ['inside','outside','faint']){const doc=await PDFDocument.create(),p=doc.addPage([100,100]);p.drawRectangle({x:10,y:50,width:20,height:20,color:rgb(0,0,0)});if(kind!=='inside')p.drawRectangle({x:0,y:95,width:5,height:5,color:rgb(0,0,0),opacity:kind==='faint'?.01:1});fixtures.push({kind,pdf:Array.from(await doc.save())});}
  const rasterChecks=await page.evaluate(async fixtures=>{
   const worker=new Worker(new URL('./pdf-worker.js',location.href),{type:'module'});let id=0;const pending=new Map();worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data.result);};
   const call=(method,args)=>new Promise((resolve,reject)=>{const token=++id;pending.set(token,{resolve,reject});worker.postMessage({id:token,method,...args});});
   const results=[];
   try{for(const fixture of fixtures){const loaded=await call('load',{bytes:new Uint8Array(fixture.pdf)});for(const scale of [.8,1,1.25,2,2.5,5]){
     const bounds={left:8*scale,top:8*scale,right:60*scale,bottom:60*scale},bitmap=await call('render',{documentId:loaded.documentId,page:1,scale,imageBitmap:true}),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap.image);
     const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data;let old=true;
     for(let y=0;y<copy.height&&old;y++)for(let x=0;x<copy.width;x++)if(x<Math.floor(bounds.left)||x>=Math.ceil(bounds.right)||y<Math.floor(bounds.top)||y>=Math.ceil(bounds.bottom)){const at=4*(y*copy.width+x);if(data[at]<250||data[at+1]<250||data[at+2]<250){old=false;break;}}
     const current=await call('inkFits',{documentId:loaded.documentId,page:1,scale,bounds});results.push({kind:fixture.kind,scale,old,current:current.safe});canvas.width=canvas.height=copy.width=copy.height=0;
    }await call('close',{documentId:loaded.documentId});}return results;}finally{worker.terminate();}
  },fixtures);
  assert.equal(rasterChecks.length,18);assert.ok(rasterChecks.every(c=>c.old===c.current));assert.ok(rasterChecks.filter(c=>c.kind==='outside').every(c=>c.current===false));
  await page.evaluate(()=>{window.inkFrames=[];new MutationObserver(records=>{for(const r of records){const hash=r.target.dataset?.localSourceHash;if(hash)window.inkFrames.push(hash);}}).observe(document.querySelector('#pages'),{subtree:true,attributes:true,attributeFilter:['data-local-source-hash']});const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('ordinary words.')+'ordinary words.'.length},scrollIntoView:true});v.focus();});
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:30000});
  await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc),g=globalThis.__inkGate={wc,send,held:undefined};wc.send=(channel,...args)=>{if(args[0]?.type==='localPage'){wc.send=send;g.held=[channel,...args];return;}send(channel,...args);};});
  await page.keyboard.type('x');const expected=source.replace('ordinary words.','ordinary words.x');
  let fragment;for(let n=0;n<300&&!fragment;n++){fragment=await app.evaluate(()=>globalThis.__inkGate.held?.[1].fragmentPdf?Array.from(globalThis.__inkGate.held[1].fragmentPdf):undefined);if(!fragment)await page.waitForTimeout(10);}assert.ok(fragment);
  const bad=await PDFDocument.load(new Uint8Array(fragment));bad.getPages().at(-1).drawRectangle({x:0,y:0,width:4,height:4,color:rgb(0,0,0)});const bytes=Array.from(await bad.save());
  await app.evaluate((_,bytes)=>{const g=globalThis.__inkGate,[channel,m]=g.held;g.send(channel,{...m,fragmentPdf:new Uint8Array(bytes)});},bytes);
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:30000});assert.ok(!(await page.evaluate(()=>window.inkFrames)).includes(hash(expected)),'Out-of-bounds ink must never reach a local canvas');assert.match(await page.locator('#log').textContent(),/Broader layout required/);assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);
  const result={passed:true,directory,rasterChecks,unsafeInkRejected:true,fullFallback:true,autosave:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{const g=globalThis.__inkGate;if(g)g.wc.send=g.send;dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
