// End-to-end edit-to-matching-canvas timings in an isolated hidden window.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(x).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','tikz-speed-'+randomUUID());await fs.mkdir(directory,{recursive:true});const results=[];
 for(const dense of [false,true]){
  const folder=path.join(directory,dense?'dense':'simple'),profile=path.join(folder,'profile'),root=path.join(folder,'source','main.tex');await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.dirname(root));
  let source='\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{arrows.meta,calc,positioning}\n\\begin{document}\n\nPlainMark ordinary typing before the picture.\n\n\\begin{tikzpicture}[>=Stealth]\n\\draw[->] (0,0) -- (5,0);\n\\draw[blue,thick] (0,0) -- (2,2) -- (4,1);\n\\node at (2,2.4) {NodeMark};\n'+(dense?'\\foreach \\i in {1,...,120} {\\draw[gray!40] (0,0) -- ({4*cos(\\i*3)},{2*sin(\\i*3)});}\n\\draw[red,thick,domain=0:4,samples=180] plot (\\x,{sin(\\x*180)/2});\n':'')+'\\end{tikzpicture}\n\nAfter unchanged text.\n\n\\end{document}\n';
  const lateLabel=process.env.PERSISTENT_TEX_TIKZ_LATE_LABEL==='1';if(lateLabel){source=source.replace('\\node at (2,2.4) {NodeMark};\n','').replace('\\end{tikzpicture}','\\node at (2,2.4) {NodeMark};\n\\end{tikzpicture}');}
  const extended=process.env.PERSISTENT_TEX_TIKZ_EXTENDED==='1',curveExpression=extended?'sin((\\x+1)*180)/':'sin(\\x*180)/';
  if(extended)source=source.replace('4*cos(\\i*3)','2+4*cos(-\\i*3)').replace('2*sin(\\i*3)','1+2*sin((\\i-60)*3)').replace('domain=0:4','domain=-2:2').replace('sin(\\x*180)/2','0.5+sin((\\x+1)*180)/2');
  if(process.env.PERSISTENT_TEX_TIKZ_SPLIT==='1')source=source.replace('\\node at (2,2.4)','\n\\node at (2,2.4)').replace('{NodeMark};\n','{NodeMark};\n\n').replace('\\end{tikzpicture}','\n\\end{tikzpicture}');
  await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,autoClose:false,followPreview:false,lastCursor:{file:root,at:lateLabel?source.indexOf('NodeMark')+8:source.indexOf('PlainMark')+9}}));
  const coldStart=Date.now(),app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_PROFILE:'1'}}),page=await app.firstWindow(),errors=[],samples=[];page.on('pageerror',e=>errors.push(String(e)));
  const pixels=()=>page.evaluate(()=>[...document.querySelectorAll('#pages canvas')].map(c=>c.toDataURL()).join(''));
  const full=()=>page.waitForFunction(h=>{const status=document.querySelector('#status')?.textContent;if(status?.startsWith('Build failed:'))throw Error(status);return [...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h);},hash(source),{timeout:120000,polling:10});
  const move=async(at,end=at)=>page.evaluate(({at,end})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at,head:end},scrollIntoView:true});v.focus();},{at,end});
  const edit=async(label,at,text,end=at,delay=0)=>{
   await move(at,end);const before=hash(await pixels()),start=Date.now();await page.keyboard.type(text,{delay});source=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
   await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.sourceHash===h&&c.dataset.editLatencyMs),hash(source),{timeout:120000,polling:10});
   const observedMs=Date.now()-start;const sample=await page.evaluate(h=>{const c=[...document.querySelectorAll('#pages canvas')].find(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.sourceHash===h&&c.dataset.editLatencyMs),local=c.dataset.localSourceHash===h;return {local,reportedMs:Number(local?c.dataset.localLatencyMs:c.dataset.editLatencyMs),pipeline:c.dataset.localPipeline?JSON.parse(c.dataset.localPipeline):undefined,status:document.querySelector('#status').textContent};},hash(source));
   assert.notEqual(hash(await pixels()),before,'Edit must change rendered pixels');samples.push({label,observedMs,confirmationMs:Date.now()-start,...sample});console.log(JSON.stringify({fixture:dense?'dense':'simple',...samples.at(-1)}));
  };
  try{
   await full();const coldMs=Date.now()-coldStart;console.log(JSON.stringify({fixture:dense?'dense':'simple',coldMs}));
   await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready'||document.querySelector('#log').textContent.includes('Local preview unavailable for this paragraph:'),null,{timeout:60000});
   for(const ch of lateLabel?'':'abc')await edit('plain-text-with-tikz',source.indexOf('PlainMark')+9,ch);
   for(const ch of 'xyz')await edit('picture-node-label',source.indexOf('NodeMark')+8,ch);
   if(lateLabel){const at=source.indexOf('\\node at (2,2.4)')+'\\node at ('.length;await edit('picture-late-node-coordinate',at,'3',at+1);}
   const coordinate=source.indexOf('(4,1)')+3;await edit('picture-coordinate',coordinate,'2',coordinate+1);
   if(process.env.PERSISTENT_TEX_TIKZ_GEOMETRY==='1'){
    let at=source.indexOf('(2,2)')+1;await edit('picture-move-point',at,'3',at+1);
    at=source.indexOf('\\draw[blue,thick]');await edit('picture-add-edge',at,'\\draw[green,thick] (0,0) -- (3,1);\n');
    if(dense){
     at=source.indexOf('4*cos');await edit('picture-change-radius',at,'3',at+1);
     at=source.indexOf(curveExpression+'2')+curveExpression.length;await edit('picture-change-curve',at,'3',at+1);
     at=source.indexOf('3*cos');await edit('picture-restore-radius',at,'4',at+1);
     at=source.indexOf('4*cos');await edit('picture-repeat-radius',at,'3',at+1);
     at=source.indexOf(curveExpression+'3')+curveExpression.length;await edit('picture-restore-curve',at,'2',at+1);
     at=source.indexOf(curveExpression+'2')+curveExpression.length;await edit('picture-repeat-curve',at,'3',at+1);
    }
   }
   if(process.env.PERSISTENT_TEX_TIKZ_BURST==='1')await edit('picture-typing-burst',source.indexOf('NodeMark')+8,'burst',source.indexOf('NodeMark')+8,10);
   if(process.env.PERSISTENT_TEX_TIKZ_MATH_LABEL==='1'){const at=source.indexOf('NodeMark');await edit('picture-math-label',at,'$\\sqrt\\pi$',source.indexOf('}',at));}
   await full();assert.equal(await fs.readFile(root,'utf8'),source);assert.deepEqual(errors,[]);
   if(process.env.PERSISTENT_TEX_TIKZ_ASSERT_WARM==='1'){
    const log=await page.locator('#log').textContent();assert.ok(!/Broader layout required: Error: Build timed out/.test(log),'A valid dense picture must not repeatedly time out');
    assert.ok(!samples.filter(s=>s.label.startsWith('picture')).some(s=>!s.local&&s.status.includes('Preamble initialized')),'Crossing from prose must reuse the warm preamble');
   }
   const log=await page.locator('#log').textContent(),preparations=log.split('\n').filter(line=>line.startsWith('Local preparation: ')).map(line=>JSON.parse(line.slice('Local preparation: '.length)));
   if(dense&&process.env.PERSISTENT_TEX_TIKZ_ASSERT_WITNESS==='1'){
    const from=source.indexOf(process.env.PERSISTENT_TEX_TIKZ_SPLIT==='1'?'\\node at (2,2.4)':'\\begin{tikzpicture}');
    assert.ok(preparations.some(p=>p.pageBaselineFromWitness&&(p.rangeFrom===from||p.pictureFamilyCount>1&&p.rangeFrom<=from&&p.rangeTo>from)),'The edited picture-label block must reuse its full-build checkpoint');
   }
   if(dense&&process.env.PERSISTENT_TEX_TIKZ_ASSERT_FAMILY==='1'){assert.ok(preparations.some(p=>p.pictureFamilyCount>1),'A split picture must retain multiple verified editing blocks');assert.ok(samples.filter(s=>s.label.startsWith('picture')).slice(1).every(s=>s.local),'Moving between prepared family blocks must keep edits local');}
   if(dense&&process.env.PERSISTENT_TEX_TIKZ_ASSERT_MATH==='1')assert.ok(samples.filter(s=>s.label.startsWith('picture')).some(s=>s.pipeline?.compiler?.tikzMathEntries>0),'The dense picture must load guarded numerical results');
   if(dense&&process.env.PERSISTENT_TEX_TIKZ_ASSERT_GEOMETRY==='1'){
    assert.ok(samples.filter(s=>/picture-(?:move|add|change|restore|repeat)-/.test(s.label)).every(s=>s.local),'Warm drawing edits must retain local preview');
    for(const label of ['picture-repeat-radius','picture-repeat-curve'])assert.equal(samples.find(s=>s.label===label)?.pipeline?.compiler?.tikzMathLearned,0,'Previously successful drawing calculations must be immediately reusable');
   }
   const result={fixture:dense?'dense':'simple',coldMs,samples,preparations};results.push(result);await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(result,null,2));
  }finally{await fs.writeFile(path.join(folder,'build.log'),await page.locator('#log').textContent().catch(()=>''));await fs.writeFile(path.join(folder,'samples.json'),JSON.stringify(samples,null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 }
 await fs.writeFile(path.join(directory,'results.json'),JSON.stringify({results,measurement:'Isolated hidden canvas, including drawing; not a physical monitor timing guarantee.'},null,2));console.log(JSON.stringify({passed:true,directory}));
})().catch(e=>{console.error(e);process.exitCode=1;});
