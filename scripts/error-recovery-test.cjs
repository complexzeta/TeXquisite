const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('error-recovery'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 const source='\\documentclass{article}\n\\begin{document}\n\nHelloSentinel ordinary words.\n\nTailSentinel survives.\n\n\\end{document}\n',root=path.join(project,'main.tex');
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,autoClose:false,followPreview:false,lastCursor:{file:root,at:source.indexOf('HelloSentinel')+13}}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});let app=await launch();os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);let page,expected=source;const result={passed:false,directory,samples:[]};
 try{
  result.version=await app.evaluate(({app})=>app.getVersion());page=await app.firstWindow();
  const visible=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>(c.dataset.localSourceHash??c.dataset.sourceHash)===h),hash(expected),{timeout:30000});
  const replace=async text=>{expected=text;await page.evaluate(text=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});},text);};
  const recovered=async()=>{await visible();await page.waitForFunction(()=>document.querySelector('#previewState').textContent.match(/^Recovered(?: local)? preview/),null,{timeout:10000});assert.equal(await fs.readFile(root,'utf8'),expected);};
  await visible();const at=source.indexOf('HelloSentinel')+13;
  await page.evaluate(({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();return window.desktop.call('localCursor',root,at);},{root,at});
  for(let n=0;n<1500;n++){const p=await page.evaluate(()=>window.desktop.call('previewPerformance'));if(p.localReady&&!p.localBusy)break;if(n===1499)throw Error('Local context never ready');await delay(20);}
  let began=Date.now();await page.keyboard.insertText(' \\tyopCommand');expected=source.slice(0,at)+' \\tyopCommand'+source.slice(at);await recovered();result.samples.push({case:'local undefined command',ms:Date.now()-began});
  assert.match(await page.locator('#diagnosticMessage').textContent(),/Undefined control sequence|undefined command/i);assert.match(await page.locator('#diagnosticMessage').textContent(),/Saved source is unchanged/);result.localErrorRecovers=true;
  began=Date.now();await replace(expected.replace('TailSentinel','NewTailSentinel'));await recovered();result.samples.push({case:'keep typing with existing error',ms:Date.now()-began});result.subsequentEditsContinue=true;
  await page.evaluate(()=>{window.recoveryFullCommits=0;window.desktop.on(m=>{if(m.type==='commit')window.recoveryFullCommits++;});});await page.evaluate(()=>window.desktop.call('continuous',true));await page.waitForFunction(()=>window.recoveryFullCommits>0,null,{timeout:30000});
  const store=path.join(profile,'projects',hash(path.resolve(root).toLowerCase()).slice(0,32)),commits=(await fs.readdir(path.join(store,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(store,'commits',commits.at(-1))));
  const lib=await require('@hyzyla/pdfium').PDFiumLibrary.init(),doc=await lib.loadDocument(await fs.readFile(path.join(store,'bundles',record.id,'document.pdf')));
  try{let text='';for(const p of doc.pages()){text+=p.getText();p.close();}assert.match(text,/NewTailSentinel/);assert.match(text,/HelloSentinel/);}finally{doc.destroy();lib.destroy();}result.recoveredPdfContainsNewText=true;
  const exported=path.join(directory,'must-not-export.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);
  const error=await page.evaluate(async()=>{try{await window.desktop.call('export');return '';}catch(e){return String(e);}});assert.match(error,/verified|errors/i);assert.equal(await fs.stat(exported).then(()=>true,()=>false),false);result.repairedPreviewNotExported=true;
  await replace(source.replace('TailSentinel','CorrectedTailSentinel'));await visible();await page.waitForFunction(()=>!document.querySelector('#toggleProblems').dataset.count,null,{timeout:10000});result.correctingErrorRestoresNormalPreview=true;
  await replace(source.replace('TailSentinel survives.','Math $x+1'));await recovered();result.unclosedMathRecovers=true;
  await replace(source.replace('TailSentinel survives.','TailSentinel unescaped_symbol.'));await recovered();result.textSymbolRecovers=true;
  await replace(source.replace('TailSentinel survives.','\\begin{center}TailSentinel survives.'));
  // A paragraph can render inside an open environment. Only full verification
  // reaches document end and establishes that its closing environment is absent.
  await page.evaluate(()=>{window.recoveryFullCommits=0;});await page.evaluate(()=>window.desktop.call('continuous',true));await page.waitForFunction(()=>window.recoveryFullCommits>0,null,{timeout:30000});await recovered();result.unclosedEnvironmentRecovers=true;
  // A runaway argument cannot safely be guessed. Keep the old image, report
  // the error, and prove that the next corrected revision still compiles.
  await replace(source.replace('HelloSentinel ordinary words.','\\textbf{HelloSentinel ordinary words.'));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Build failed:'),null,{timeout:15000});assert.match(await page.locator('#status').textContent(),/retry automatically/);result.unrepairableErrorReported=true;
  await replace(source);await visible();await page.waitForFunction(()=>!document.querySelector('#toggleProblems').dataset.count,null,{timeout:10000});result.correctedAfterHardError=true;
  // An obsolete infinite expansion must not hold the corrected draft behind a
  // two-minute timeout. Only this disposable project's worker is interrupted.
  await replace(source.replace('HelloSentinel ordinary words.','\\def\\spin{\\spin}\\spin'));await delay(250);began=Date.now();await replace(source.replace('TailSentinel','AfterLoopSentinel'));await visible();result.samples.push({case:'correct obsolete runaway worker',ms:Date.now()-began});assert.ok(Date.now()-began<10000);result.runawaySuperseded=true;
  await replace(source.replace('HelloSentinel','HelloSentinel \\tyopCommand'));await recovered();
  await page.evaluate(()=>window.desktop.call('close')).catch(()=>{});await app.close().catch(()=>{});
  app=await launch();os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);page=await app.firstWindow();await recovered();result.recoveredLabelSurvivesReopen=true;
  assert.equal(await fs.readFile(root,'utf8'),expected);result.passed=true;
 }catch(e){result.error=String(e);throw e;}finally{if(page)await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
