// Controlled end-to-end cloud comparison; never reads an existing user profile.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert.equal(process.env.CI,'true');const directory=require('./test-artifacts.cjs').testDirectory('preamble-viewer'),report={passed:false,source:process.env.GITHUB_SHA,endpoint:'completed hidden canvas, not physical paint',trials:[]};
 const original='\\documentclass{article}\n\\usepackage{amsmath,amsthm,graphicx,xcolor,geometry,hyperref}\n\\begin{document}Target ordinary lecture text with $x^2$.\n\nLater unchanged paragraph.\n\\end{document}\n';
 try{for(const enabled of [false,true,false,true]){
  const trial={enabled,samples:[]},trialDirectory=path.join(directory,'trial-'+report.trials.length),profile=path.join(trialDirectory,'profile'),project=path.join(trialDirectory,'project'),root=path.join(project,'main.tex'),at=original.indexOf('Target')+6;report.trials.push(trial);
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(project);require('./retained-test-format.cjs').seedProfile(profile);await fs.writeFile(root,original);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:original,diskHash:hash(original),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,autoClose:false,followPreview:false,backups:false,lastCursor:{file:root,at}}));
  const app=await electron.launch({args:['.'],env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PREAMBLE_READAHEAD:enabled?'1':'0'},timeout:120000});let page,source=original;
  try{
   page=await app.firstWindow();await page.locator('.cm-content').waitFor();await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});await delay(1000);
   await page.evaluate(()=>{window.readAheadCommits=0;window.desktop.on(m=>{if(m.type==='commit')window.readAheadCommits++;});});
   for(let n=0;n<8;n++)for(const insert of ['testing ','']){
    const remove=insert?0:8,input=await page.evaluate(({at,remove,insert})=>{const v=document.querySelector('.cm-content').cmTile.root.view,start=performance.now();v.dispatch({changes:{from:at,to:at+remove,insert},selection:{anchor:at+insert.length},userEvent:insert?'input.type':'delete.backward'});return{id:v.dom.dataset.editorEditId,start};},{at,remove,insert});source=source.slice(0,at)+insert+source.slice(at+remove);
    await page.waitForFunction(id=>JSON.parse(document.querySelector('#pages').dataset.displayedFrame||'{}').id===id,input.id,{timeout:30000,polling:10});const frame=await page.evaluate(()=>JSON.parse(document.querySelector('#pages').dataset.displayedFrame));assert.equal(frame.sourceHash,hash(source));trial.samples.push({kind:insert?'insert':'undo',ms:frame.at-input.start,layout:frame.layout});await delay(100);
   }
   assert.equal(source,original);await delay(300);assert.equal(await fs.readFile(root,'utf8'),source);trial.fullCommits=await page.evaluate(()=>window.readAheadCommits);trial.performance=await page.evaluate(()=>window.desktop.call('previewPerformance'));trial.sourcePreserved=true;
  }finally{if(page)await fs.writeFile(path.join(trialDirectory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.close();}
 }
 report.passed=true;
 }finally{await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
