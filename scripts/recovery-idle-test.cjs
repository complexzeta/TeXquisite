// Compare the same paragraph with/without a remote error across typing pauses.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('recovery-idle'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),root=path.join(project,'main.tex');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);
 const source='\\documentclass{article}\n\\pdfpagewidth=8.5in\\pdfpageheight=11in\n\\begin{document}\n\nWarmupSentinel ordinary words.\n\nTargetSentinel ordinary lecture words.\n\nRemoteSentinel '+('Distant ordinary context. '.repeat(40))+'$\\int_0^1 x$\n\nTailSentinel ordinary words.\n\n\\end{document}\n';let expected=source;
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,followPreview:false,autoClose:false}));
 assert.ok(os.freemem()>1024*1024*1024,'Insufficient memory for an isolated app');
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0',PERSISTENT_TEX_TEST_HIDDEN:'1'}});os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const result={passed:false,samples:[]},guard=setInterval(()=>{if(os.freemem()<256*1024*1024)void app.evaluate(({app})=>app.exit(0)).catch(()=>{});},1000);guard.unref();let page;
 try{
  page=await app.firstWindow();result.version=await app.evaluate(({app})=>app.getVersion());
  await page.evaluate(()=>{window.idleCommits=0;window.desktop.on(m=>{if(m.type==='commit')window.idleCommits++;});});
  const full=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h&&!c.dataset.localEditId),hash(expected),{timeout:90000});
  const ready=async at=>{await page.evaluate(async({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();await window.desktop.call('localCursor',root,at);},{root,at});await page.waitForFunction(async({root,at})=>{const p=await window.desktop.call('previewPerformance'),r=p.localRange;return p.localReady&&!p.localBusy&&r?.file===root&&r.from<=at&&at<r.to;},{root,at},{timeout:45000,polling:20});};
  await full();
  for(const broken of [false,true]){
   if(broken){expected=source.replace('x$','\\intt 01$');await page.evaluate(text=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});},expected);await full();}
   let at=expected.indexOf('TargetSentinel')+'TargetSentinel'.length;await ready(at);
   for(const word of [' first',' second',' third']){
    const commits=await page.evaluate(()=>window.idleCommits);
    await page.evaluate(({at,word})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,insert:word},selection:{anchor:at+word.length}});},{at,word});expected=expected.slice(0,at)+word+expected.slice(at);at+=word.length;
    await page.waitForFunction(({h,broken})=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localRecovered===String(broken)&&c.dataset.localLatencyEditId===c.dataset.localEditId),{h:hash(expected),broken},{timeout:15000,polling:10});
    const ms=await page.evaluate(h=>Number([...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId).dataset.localLatencyMs),hash(expected));result.samples.push({broken,word,ms});
    if(broken){await page.waitForFunction(()=>!document.querySelector('#previewNoticeError').disabled);assert.match(await page.locator('#previewNotice').textContent(),/intt/);}
    await delay(1000);assert.equal(await page.evaluate(()=>window.idleCommits),commits,'Unchanged error or healthy typing must not reclaim the local compiler after a pause');assert.equal(await fs.readFile(root,'utf8'),expected);
   }
  }
  result.keptContextAcrossPauses=true;
  const commits=await page.evaluate(()=>window.idleCommits);await page.evaluate(()=>window.desktop.call('retryPreview'));await page.waitForFunction(n=>window.idleCommits>n,commits);await full();result.explicitRetryWorks=true;
  const forbidden=path.join(directory,'must-not-export.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},forbidden);
  const failure=await page.evaluate(async()=>{try{await window.desktop.call('export');return '';}catch(error){return String(error);}});assert.match(failure,/error|verified|Undefined/i);assert.equal(await fs.stat(forbidden).then(()=>true,()=>false),false);result.strictExportRejected=true;
  const defineAt=expected.indexOf('TargetSentinel')+'TargetSentinel'.length,definition='\\providecommand{\\intt}{\\int} ';
  const definingAt=performance.now();await page.evaluate(({at,definition})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,insert:definition},selection:{anchor:at+definition.length}});},{at:defineAt,definition});expected=expected.slice(0,defineAt)+definition+expected.slice(defineAt);
  await full();await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);result.definitionCorrectionMs=Math.ceil(performance.now()-definingAt);assert.ok(expected.includes('\\intt 01'));result.definitionChangeRechecked=true;
  expected=expected.replace(definition,'');
  expected=expected.replace('\\intt 01','x');await page.evaluate(text=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});},expected);await full();await page.waitForFunction(()=>document.querySelector('#previewNotice').hidden);result.correctionClearsError=true;result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{clearInterval(guard);if(page){await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));if(!result.passed)result.performance=await page.evaluate(()=>window.desktop.call('previewPerformance',true)).catch(()=>undefined);}await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
