const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','panels-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-panels-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex');let source='\\documentclass{article}\n\\begin{document}\n\\vspace*{330pt}\nPanel test with $x^2$.\n\\end{document}\n';const at=source.indexOf('Panel')+5;
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,lastCursor:{file:root,at}}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_DISABLE_LOCAL:'1'}});
 let app=await launch(),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
 const geometry=()=>page.evaluate(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return {main:box('workspace'),source:box('sourcePane'),output:box('previewPane'),divider:box('panelDivider')};});
 const check=async(mode,share)=>{await page.waitForTimeout(30);const g=await geometry(),stacked=mode!=='side-by-side';
  assert.ok(Math.abs((stacked?g.source.height/(g.main.height-8):g.source.width/(g.main.width-8))-share)<.025,JSON.stringify(g));
  if(!stacked)assert.ok(Math.abs(g.source.right+8-g.output.x)<1);
  else if(mode==='source-top')assert.ok(Math.abs(g.source.bottom+8-g.output.y)<1);
  else assert.ok(Math.abs(g.output.bottom+8-g.source.y)<1);
  assert.ok(g.source.width>0&&g.source.height>0&&g.output.width>0&&g.output.height>0);return g;
 };
 const drag=async first=>{const g=await geometry(),stacked=await page.locator('#panelLayout').inputValue()!=='side-by-side';await page.mouse.move(g.divider.x+g.divider.width/2,g.divider.y+g.divider.height/2);await page.mouse.down();await page.mouse.move(stacked?g.divider.x+g.divider.width/2:g.main.x+(g.main.width-8)*first+4,stacked?g.main.y+(g.main.height-8)*first+4:g.divider.y+g.divider.height/2,{steps:6});await page.mouse.up();};
 try{
  await settled();await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;window.panelEditor=v;window.panelState=v.state;window.panelCanvas=document.querySelector('#pages canvas');window.panelBuilds=0;window.desktop.on(m=>{if(m.type==='prepare'||m.type==='commit')window.panelBuilds++;});});
  await check('side-by-side',.5);await drag(.65);await check('side-by-side',.65);
  await page.locator('#panelDivider').focus();await page.keyboard.press('ArrowLeft');await check('side-by-side',.6);
  await page.locator('#panelDivider').dblclick();await check('side-by-side',.5);await drag(.65);
  await page.locator('#panelLayout').selectOption('output-top');await check('output-top',.5);await drag(.6);await check('output-top',.4);
  await page.locator('#panelDivider').focus();await page.keyboard.press('ArrowUp');await check('output-top',.45);
  await page.locator('#panelLayout').selectOption('source-top');await check('source-top',.45);
  if(process.env.PERSISTENT_TEX_LAYOUT_SCREENSHOTS==='1')await page.screenshot({path:path.join(directory,'source-top.png')});
  await page.locator('#panelLayout').selectOption('side-by-side');await check('side-by-side',.65);
  // Escape cancels a captured drag without changing the saved dimensions.
  const g=await geometry();await page.mouse.move(g.divider.x+4,g.divider.y+20);await page.mouse.down();await page.mouse.move(g.main.x+g.main.width*.4,g.divider.y+20);await page.keyboard.press('Escape');await page.mouse.up();await check('side-by-side',.65);
  await page.locator('#panelLayout').selectOption('output-top');await check('output-top',.45);
  assert.equal(await page.locator('#panelDivider').getAttribute('aria-orientation'),'horizontal');
  const retained=await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;return {editor:v===window.panelEditor,state:v.state===window.panelState,canvas:window.panelCanvas.isConnected&&window.panelCanvas.width>0,builds:window.panelBuilds,at:v.state.selection.main.head};});
  assert.deepEqual(retained,{editor:true,state:true,canvas:true,builds:0,at});assert.equal(await fs.readFile(root,'utf8'),source);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,720));await page.waitForTimeout(150);const small=await geometry();assert.ok(small.source.bottom<=small.main.bottom+1&&small.output.y>=small.main.y);assert.ok(small.source.height>=150&&small.output.height>=150);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,940));await check('output-top',.45);if(process.env.PERSISTENT_TEX_LAYOUT_SCREENSHOTS==='1')await page.screenshot({path:path.join(directory,'output-top.png')});
  for(let i=0;i<100;i++){const saved=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));if(saved.panelLayout?.mode==='output-top'&&Math.abs(saved.panelLayout.stacked-.45)<.01)break;await page.waitForTimeout(20);}
  const saved=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));assert.equal(saved.panelLayout.mode,'output-top');assert.ok(Math.abs(saved.panelLayout.side-.65)<.01);assert.ok(Math.abs(saved.panelLayout.stacked-.45)<.01);
  await app.evaluate(({app})=>app.exit(0));app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await settled();await check('output-top',.45);
  await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.focus());await page.keyboard.type(' resized');source=source.slice(0,at)+' resized'+source.slice(at);await settled();assert.equal(await fs.readFile(root,'utf8'),source);await check('output-top',.45);
  await page.evaluate(()=>{window.panelPagedReady=false;window.desktop.on(m=>{if(m.type==='commit')window.panelPagedReady=true;});});
  await page.locator('#layoutMode').selectOption('paged');await page.waitForFunction(()=>window.panelPagedReady&&!document.querySelector('#pages').classList.contains('continuous'),null,{timeout:90000});
  for(const mode of ['source-top','output-top']){
   await page.locator('#panelLayout').selectOption(mode);await check(mode,.45);await page.locator('#pdfViewport').evaluate(e=>e.scrollTop=0);await page.locator('#locate').click();
   await page.waitForFunction(()=>{const r=document.querySelector('.navigation-marker')?.getBoundingClientRect(),v=document.querySelector('#pdfViewport').getBoundingClientRect();return r&&r.top>=v.top&&r.bottom<=v.bottom;},null,{timeout:10000});
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,directory,threeLayouts:true,drag:true,keyboard:true,equalSizeReset:true,cancelDrag:true,independentRatios:true,editorAndPreviewRetained:true,noLayoutBuilds:true,smallWindow:true,persistedAfterRestart:true,autosaveAndCompile:true,stackedPagedNavigation:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){console.error(directory,await page.locator('#status').textContent().catch(()=>''));throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
