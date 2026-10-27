const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('sustained-typing'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 const prose='A lecture should respond immediately when we remove a word, restore it, or change a sentence. We can also recalculate the wrapping of a paragraph without reloading the document. Here is a short equation $\\sqrt{\\pi}+x^2$.';
 const root=path.join(project,'main.tex'),source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\nLiveMark '+prose+'\n\n'+Array.from({length:40},(_,i)=>'Paragraph '+i+'. '+prose+'\n\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,previewMode:'lecture',engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,followPreview:true,autoClose:false,lastCursor:{file:root,at:source.indexOf('LiveMark')+8}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE}:{}),args:[...(process.env.PERSISTENT_TEX_EXECUTABLE?[]:['.']),'--force-device-scale-factor=2.5'],env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});
 let page,cdp;const result={passed:false,directory,scenarios:[]},errors=[];
 try{
  page=await app.firstWindow({timeout:90000});if(process.env.PERSISTENT_TEX_PROFILE_TYPING==='1'){cdp=await app.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}page.on('pageerror',e=>errors.push(String(e)));
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
  await page.evaluate(()=>{
   const v=document.querySelector('.cm-content').cmTile.root.view,b=window.__typing={inputs:[],previews:[],lastText:v.state.doc.toString(),seen:new Set()};
   new MutationObserver(()=>{const text=v.state.doc.toString();if(text!==b.lastText){b.lastText=text;b.inputs.push({at:performance.now(),text});}}).observe(v.contentDOM,{subtree:true,childList:true,characterData:true});
   new MutationObserver(()=>{for(const c of document.querySelectorAll('#pages canvas')){for(const hash of [c.dataset.localSourceHash,c.dataset.sourceHash])if(hash&&!b.seen.has(hash)){b.seen.add(hash);b.previews.push({at:performance.now(),hash,layout:c.dataset.localLayout,pipeline:c.dataset.localPipeline});}}}).observe(document.querySelector('#pages'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-local-source-hash','data-source-hash']});
  });
  const text=()=>page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  const ready=()=>page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  const focus=async marker=>{await ready();await page.evaluate(marker=>{const v=document.querySelector('.cm-content').cmTile.root.view,at=v.state.doc.toString().indexOf(marker)+marker.length;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},marker);await delay(350);};
  const measure=async(name,action)=>{
   await page.evaluate(()=>{window.__typing.inputs=[];window.__typing.previews=[];window.__typing.seen=new Set([...document.querySelectorAll('#pages canvas')].flatMap(c=>[c.dataset.localSourceHash,c.dataset.sourceHash]).filter(Boolean));});
   await action();const expected=await text();await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h||c.dataset.sourceHash===h),hash(expected),{timeout:30000,polling:10});
   const trace=await page.evaluate(()=>({inputs:window.__typing.inputs,previews:window.__typing.previews})),inputs=trace.inputs.map(({text,...i})=>({...i,hash:hash(text)})),frames=trace.previews.map(p=>({...p,input:inputs.findIndex(i=>i.hash===p.hash)})).filter(p=>p.input>=0),latencies=frames.map(p=>p.at-inputs[p.input].at),stalls=[];let last=inputs[0]?.at;
   for(const frame of frames){if(last!==undefined)stalls.push(frame.at-last);last=frame.at;}
   const s={name,inputCount:inputs.length,displayedStates:frames.length,maxLatencyMs:Math.round(Math.max(0,...latencies)),maxPreviewGapMs:Math.round(Math.max(0,...stalls)),frames:frames.map(p=>({input:p.input,latencyMs:Math.round(p.at-inputs[p.input].at),layout:p.layout,pipeline:p.pipeline?JSON.parse(p.pipeline):undefined}))};assert.ok(inputs.length&&frames.length,'Real source changes and matching preview required');result.scenarios.push(s);
  };
  for(const mode of ['lecture','document']){
   await page.locator('#previewMode').selectOption(mode);await focus('LiveMark');
   await measure(mode+'-typing',()=>page.keyboard.type(' a continuous stream of words',{delay:80}));
   await focus('Paragraph 20.');await measure(mode+'-later-page',()=>page.keyboard.type(' later page typing',{delay:80}));
   await measure(mode+'-new-paragraph',async()=>{await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('A new paragraph appears.',{delay:80});});
   await measure(mode+'-delete',async()=>{for(let n=0;n<12;n++){await page.keyboard.press('Backspace');await delay(80);}});
   await measure(mode+'-restore',()=>page.keyboard.type('ph appears.',{delay:80}));
  }
  assert.deepEqual(errors,[]);for(let n=0;n<200&&await fs.readFile(root,'utf8')!==await text();n++)await delay(25);assert.equal(await fs.readFile(root,'utf8'),await text(),'All final edits saved');result.passed=true;result.version=await app.evaluate(({app})=>app.getVersion());result.dpr=await page.evaluate(()=>devicePixelRatio);
 }catch(error){result.error=String(error);throw error;}finally{if(cdp){const {profile:cpu}=await cdp.send('Profiler.stop');await fs.writeFile(path.join(directory,'renderer.cpuprofile'),JSON.stringify(cpu));}if(page)await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1});