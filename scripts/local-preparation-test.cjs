const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('local-preparation-ui'),profile=await fs.mkdtemp(path.join(directory,'persistent-preparation-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n',paragraphs=Array.from({length:8},(_,i)=>'Target paragraph '+i+' with math $\\sqrt{\\pi}$ and ordinary words.\n\n'),source=prefix+paragraphs.join('')+'\\newpage\n'+Array.from({length:100},(_,i)=>'Tail page '+i+'.\\newpage\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:['--force-device-scale-factor=2.5']}:{args:['--force-device-scale-factor=2.5','.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[],pageChecks=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.text().startsWith('Local page range verification '))pageChecks.push(JSON.parse(m.text().slice('Local page range verification '.length)));});
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(source),{timeout:90000});
  const measurements=[];
  for(const i of [1,5,2,6,1]){
   const before=await page.evaluate(()=>document.querySelector('#log').textContent.split('Local preparation: ').length);
   const started=Date.now();await page.evaluate(i=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('Target paragraph '+i)+10},scrollIntoView:true});v.focus();},i);
   await page.waitForFunction(n=>document.querySelector('#previewState').dataset.localState==='ready'&&document.querySelector('#log').textContent.split('Local preparation: ').length>n,before,{timeout:60000,polling:10});
   const timing=await page.evaluate(()=>JSON.parse(document.querySelector('#log').textContent.split('Local preparation: ').at(-1).split('\n')[0]));
   if(measurements.length>0||!timing.compilerFromPublishedBuild)assert.equal(timing.reusedBaseline,measurements.length>0);assert.ok(timing.anchorExcludedSuffixBytes>1000);measurements.push({paragraph:i,cursorToReadyMs:Date.now()-started,...timing});
  }
  assert.ok(pageChecks.some(c=>c.ok&&c.reused),'Identical page output must reuse its exact-byte verification');
  // Inject a blank page under the same root/base/page identity. A cached proof
  // must not authorize changed PDF bytes, even when the page count is right.
  const {PDFDocument}=require('pdf-lib'),blank=await PDFDocument.create();blank.addPage();const blankPdf=Array.from(await blank.save());
  await app.evaluate(({BrowserWindow},bytes)=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);globalThis.__verificationSend=send;wc.send=(channel,...args)=>{const m=args[0];if(m?.type==='localVerifyPages'){wc.send=send;send(channel,{...m,pdf:new Uint8Array(bytes)});return;}send(channel,...args);};},blankPdf);
  const move=async i=>{const n=await page.evaluate(()=>document.querySelector('#log').textContent.split('Local preparation: ').length);await page.evaluate(i=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('Target paragraph '+i)+10},scrollIntoView:true});v.focus();},i);await page.waitForFunction(n=>document.querySelector('#previewState').dataset.localState==='ready'&&document.querySelector('#log').textContent.split('Local preparation: ').length>n,n,{timeout:60000,polling:10});};
  const checksBefore=pageChecks.length;await move(5);assert.ok(pageChecks.slice(checksBefore).some(c=>c.ok===false&&!c.reused),'Changed bytes must undergo raster comparison and fail');
  await move(1);
  const beforeZoom=pageChecks.length;await page.locator('#zoom').selectOption('1.25');await move(2);assert.ok(pageChecks.slice(beforeZoom).some(c=>c.ok&&!c.reused),'Zoom changes must establish a new raster proof');
  // Return to the measured paragraph and default scale before testing typing.
  await page.locator('#zoom').selectOption('1');await move(1);
  await page.keyboard.type('z');const expected=source.replace('Target paragraph 1','Target parzagraph 1');
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});
  const editLatencyMs=Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms'));
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:60000});assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);
  const result={passed:true,directory,measurements,editLatencyMs,autosave:true,fullVerification:true,exactByteProofReuse:true,alteredPdfRejected:true,zoomInvalidation:true,pageChecks};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
