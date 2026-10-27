const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('render-priority'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 const root=path.join(project,'main.tex'),prose='A lecture should respond immediately when we remove a word, restore it, or change a sentence. We can also recalculate the wrapping of a paragraph without reloading the document. Here is a short equation $\\sqrt{\\pi}+x^2$.',source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nBefore this region.\n\nLiveMark '+prose+'\n\nFollowing paragraph. '+prose+'\n\n'+Array.from({length:40},(_,i)=>'Paragraph '+i+'. '+prose+'\n\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,previewMode:'lecture',engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,lastCursor:{file:root,at:source.indexOf('LiveMark')+8}}));
 const dpr=process.env.PERSISTENT_TEX_TEST_DPR;if(dpr&&!['1','2.5'].includes(dpr))throw Error('Use test DPR 1 or 2.5');const args=[...(process.env.PERSISTENT_TEX_EXECUTABLE?[]:['.']),...(dpr?['--force-device-scale-factor='+dpr]:[])];
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE}:{}),args,env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});
 let page;const result={passed:false,directory,samples:[]},errors=[];
 try{
  await app.context().addInitScript(()=>{
   const Original=window.Worker;window.__pdfBench={events:[],documents:[],stress:0};
   window.Worker=class extends Original{constructor(url,options){super(url,options);if(!String(url).includes('pdf-worker'))return;const bench=window.__pdfBench;bench.worker=this;const methods=new Map(),post=this.postMessage.bind(this);
    this.postMessage=(message,...args)=>{methods.set(message.id,{method:message.method,documentId:message.documentId});return post(message,...args);};
    this.addEventListener('message',event=>{const request=methods.get(event.data.id);if(!request)return;methods.delete(event.data.id);if(request.method==='load'&&event.data.result?.documentId)bench.documents.push(event.data.result.documentId);if(request.method==='close')bench.documents=bench.documents.filter(id=>id!==request.documentId);bench.events.push({id:event.data.id,method:request.method,at:performance.now(),error:event.data.error});if(bench.events.length>300)bench.events.shift();});
   }};
  });
  page=await app.firstWindow({timeout:90000});page.on('pageerror',e=>errors.push(String(e)));if(!await page.evaluate(()=>!!window.__pdfBench?.worker))await page.reload();
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  let expected=source;
  for(const stress of [false,true,true,true]){
   const at=expected.indexOf('LiveMark')+8;await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);await delay(700);
   const group=await page.evaluate(stress=>{const b=window.__pdfBench;if(!b.worker||!b.documents.length)throw Error('PDF worker instrumentation did not attach');const group=900000000+(++b.stress)*10;b.events=[];if(stress)for(let n=0;n<6;n++)b.worker.postMessage({id:group+n,method:'render',documentId:b.documents[0],page:1,scale:3,imageBitmap:false});return group;},stress);
   const text=' edit'+result.samples.length,started=Date.now();await page.keyboard.insertText(text);expected=expected.slice(0,at)+text+expected.slice(at);
   await page.waitForFunction(h=>document.querySelector('[data-local-layout="flow"]')?.dataset.localSourceHash===h,hash(expected),{timeout:20000,polling:10});
   const observedMs=Date.now()-started,pipeline=JSON.parse(await page.locator('[data-local-layout="flow"]').getAttribute('data-local-pipeline'));
   if(stress)await page.waitForFunction(group=>window.__pdfBench.events.filter(e=>e.id>=group&&e.id<group+6).length===6,group,{timeout:25000});
   const events=await page.evaluate(()=>window.__pdfBench.events),foreground=events.find(e=>e.method==='checkedRegion'),background=events.filter(e=>e.id>=group&&e.id<group+6),prioritized=stress&&foreground&&background.some(e=>e.at>foreground.at);
   assert.ok(foreground,'A real checked PDF fragment must be displayed');assert.ok(background.every(e=>!e.error),'Background renders must still complete');
   if(stress&&process.env.PERSISTENT_TEX_EXPECT_RENDER_PRIORITY==='1')assert.ok(prioritized,'Interactive fragment must overtake queued background rendering');
   result.samples.push({stress,observedMs,prioritized:!!prioritized,receiveMs:pipeline.receiveMs,checkedRegionMs:pipeline.checkedRegionMs,pdfWorker:pipeline.pdfWorker,compilerMs:pipeline.compiler?.totalMs});
   await delay(200);
  }
  assert.deepEqual(errors,[]);result.passed=true;result.version=await app.evaluate(({app})=>app.getVersion());result.devicePixelRatio=await page.evaluate(()=>window.devicePixelRatio);
 }catch(error){result.error=String(error);throw error;}finally{await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));if(page)await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1});
