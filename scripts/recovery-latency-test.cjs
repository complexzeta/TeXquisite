const waitForAsync=require('./wait-for-async.cjs');
// Temporary syntax errors must not evict the proved local compiler while the
// user corrects them. Synthetic document only; no user profile is read.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert.equal(process.env.CI,'true');const dir=require('./test-artifacts.cjs').testDirectory('recovery-latency'),profile=path.join(dir,'profile'),project=path.join(dir,'project with spaces');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);const root=path.join(project,'main.tex');
 let expected='\\documentclass{article}\n\\usepackage{amsmath,tikz,xcolor}\n\\begin{document}\n\nWarmupSentinel ordinary text.\n\nTargetSentinel ordinary lecture words with $x^2+1$.\n\n'+Array.from({length:100},(_,i)=>'Paragraph '+i+'. '+('Ordinary lecture prose with $x+1$. '.repeat(8))+'\n\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,expected);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:expected,diskHash:hash(expected),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,autoClose:false,followPreview:false,lastCursor:{file:root,at:expected.indexOf('TargetSentinel')+14}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0'},timeout:120000}),result={passed:false,samples:[]};let page;
 try{
  page=await app.firstWindow();await page.locator('.cm-content').waitFor();result.version=await app.evaluate(({app})=>app.getVersion());
  const visible=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>(c.dataset.localSourceHash||c.dataset.sourceHash)===h),hash(expected),{timeout:90000,polling:10});
  const ready=async at=>{await page.evaluate(async({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();await window.desktop.call('localCursor',root,at);},{root,at});await waitForAsync(page,async at=>{const p=await window.desktop.call('previewPerformance');return p.localReady&&!p.localBusy&&p.localRange?.from<=at&&at<p.localRange.to;},at,{timeout:60000,polling:20});};
  const edit=async(at,remove,insert)=>{await page.evaluate(({at,remove,insert})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,to:at+remove,insert},selection:{anchor:at+insert.length}});},{at,remove,insert});expected=expected.slice(0,at)+insert+expected.slice(at+remove);};
  await visible();
  for(const [kind,pause]of [['brace',100],['brace',700],['command',100],['command',900],['math',150],['math',900]]){
   const at=expected.indexOf('TargetSentinel')+'TargetSentinel'.length;await ready(at);const before=expected,token=kind==='brace'?' \\textbf{':kind==='command'?' \\unfinishedCommand':' $';await edit(at,0,token);await delay(pause);
   const started=performance.now();await edit(at,token.length,' repaired'+result.samples.length);await visible();
   const ms=Math.ceil(performance.now()-started),p=await page.evaluate(()=>window.desktop.call('previewPerformance',true));result.samples.push({kind,pause,ms,localReady:p.localReady,reclaims:p.trace.filter(e=>e.event==='local-log'&&String(e.message).includes('Idle verification reclaimed')).length});
   await page.waitForFunction(()=>document.querySelector('#errorCount').dataset.errors==='0'&&document.querySelector('#errorCount').dataset.checking==='0',null,{timeout:5000});result.samples.at(-1).diagnosticsMs=Math.ceil(performance.now()-started);
   assert.equal(await fs.readFile(root,'utf8'),expected);await delay(1100);
  }
  result.maximumCorrectionMs=Math.max(...result.samples.map(s=>s.ms));assert.ok(result.samples.every(s=>s.localReady&&s.reclaims===0),'A temporary error gave up the local compiler');assert.ok(result.maximumCorrectionMs<1000,'Correction regressed to a long full build');result.performance=await page.evaluate(()=>window.desktop.call('previewPerformance',true));result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{if(page){await fs.writeFile(path.join(dir,'build.log'),await page.locator('#log').textContent().catch(()=>''));result.performance=await page.evaluate(()=>window.desktop.call('previewPerformance',true)).catch(()=>undefined);}await app.close().catch(()=>{});await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory:dir,...result}));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
