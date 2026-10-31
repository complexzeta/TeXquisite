// Synthetic cloud diagnosis; never borrows a user profile or manuscript.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function scenario(name,body,broken=false){
 const directory=require('./test-artifacts.cjs').testDirectory('editing-position'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),root=path.join(project,'main.tex');await fs.mkdir(profile);await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);
 let expected='\\documentclass[12pt]{amsart}\n\\usepackage{amsmath,tikz}\n'+(name.includes('spanning')?'\\setlength{\\textheight}{150pt}\n':'')+'\\newcommand{\\LaterDrawing}{\\begin{tikzpicture}\\foreach \\x in {1,...,150}{\\draw (0,0) -- (\\x:1cm); }\\end{tikzpicture}}\n\\begin{document}'+(name.includes('ragged')?'\\raggedbottom':'')+'\n\nWarmup paragraph.\n\n'+body+'\n\\end{document}\n';
 await fs.writeFile(root,expected);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:expected,diskHash:hash(expected),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,followPreview:false,autoClose:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_RETAINED_FLOW:'0',PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}});os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const result={passed:false,name,broken,samples:[],rendererFailures:[]};let page;
 try{
  page=await app.firstWindow();page.on('console',m=>{if(/^Local page output rejected/.test(m.text())&&result.rendererFailures.length<12)result.rendererFailures.push(m.text());});
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h&&!c.dataset.localEditId),hash(expected),{timeout:90000,polling:25});
  let at=expected.indexOf('TargetSentinel')+'TargetSentinel'.length;assert.ok(at>15);
  await page.evaluate(async({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();await window.desktop.call('localCursor',root,at);},{root,at});
  let streak=0;for(let i=0;i<1200;i++){const p=await page.evaluate(()=>window.desktop.call('previewPerformance'));if(p.localReady&&!p.localBusy&&p.localRange?.from<=at&&p.localRange?.to>at)streak++;else streak=0;if(streak>=3)break;await delay(50);}result.before=await page.evaluate(()=>window.desktop.call('previewPerformance',true));assert.ok(result.before.localReady,'The target must have an available local context');
  for(const word of [' more',' ordinary',' words']){
   await page.evaluate(({at,word})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:at,insert:word},selection:{anchor:at+word.length}});},{at,word});expected=expected.slice(0,at)+word+expected.slice(at);at+=word.length;
   await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId),hash(expected),{timeout:30000,polling:10});
   result.samples.push(await page.evaluate(h=>{const c=[...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId);return {ms:Number(c.dataset.localLatencyMs),layout:c.dataset.localLayout,pipeline:JSON.parse(c.dataset.localPipeline??'null')};},hash(expected)));await delay(750);
  }
  assert.equal(await fs.readFile(root,'utf8'),expected);result.passed=true;
 }catch(error){result.error=String(error);}finally{if(page){await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));result.after=await page.evaluate(()=>window.desktop.call('previewPerformance',true)).catch(()=>undefined);}await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({name,passed:result.passed,error:result.error,samples:result.samples}));}
 return result.passed;
}
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const tail=Array.from({length:12},(_,i)=>'Following paragraph '+i+'. '+('Unchanged ordinary mathematical context with $x^2$. '.repeat(8))+'\n\n').join(''),short='TargetSentinel ordinary words with $x^2$ and \\emph{rising} descenders.\n\n',display='TargetSentinel '+('Ordinary material with $x^2$ remains in the paragraph. '.repeat(4))+' A display follows \\[\\sum_{k=0}^{\\infty}\\frac{z^k}{k!}=e^z\\] '+('Following ordinary words with $y^2$. '.repeat(10))+'\n\n';
 const cases=[['early-short',short+tail],['late-short',tail+short],['early-display',display+tail],['early-display-error',display+'Remote broken $\\unknownCommand$.\n\n'+tail,true],['ragged-display',display+tail],['ragged-display-error',display+'Remote broken $\\unknownCommand$.\n\n'+tail,true],['spanning-display',display+tail],['text-before-drawing',short+'\\LaterDrawing\n\n'+tail],['attached-drawing',short.trimEnd()+'\n\\LaterDrawing\n\n'+tail]];
 let passed=true;for(const args of cases)passed=(await scenario(...args))&&passed;if(!passed)process.exitCode=1;
})().catch(error=>{console.error(String(error));process.exitCode=1;});
