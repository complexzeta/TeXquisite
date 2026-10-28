const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('page-navigation'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 if(process.env.PERSISTENT_TEX_NAV_FIXTURE)await fs.cp(process.env.PERSISTENT_TEX_NAV_FIXTURE,project,{recursive:true});
 const source=process.env.PERSISTENT_TEX_NAV_FIXTURE?await fs.readFile(path.join(project,'main.tex'),'utf8'):'\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n'+Array.from({length:95},(_,i)=>`Sentinel${i} has mathematical text $\\sqrt{\\pi}$ and more words. `).join('')+'\n\n\\end{document}\n',root=path.join(project,'main.tex');
 const editAt=process.env.PERSISTENT_TEX_NAV_AT?Number(process.env.PERSISTENT_TEX_NAV_AT):source.indexOf('Sentinel50')+10;
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,followPreview:false,lastCursor:{file:root,at:source.indexOf('Sentinel50')+10}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_MULTI_BLOCK:'0',PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);let page;const result={passed:false,directory};
 try{
  result.version=await app.evaluate(({app})=>app.getVersion());
  page=await app.firstWindow();await page.evaluate(()=>{window.pageFrames=[];window.desktop.on(m=>{if(m.type==='localPage'&&m.pageOutput)window.pageFrames.push(m);});});
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
  const at=editAt;await page.evaluate(({root,at})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();return window.desktop.call('localCursor',root,at);},{root,at});
  for(let n=0;;n++){const p=await page.evaluate(()=>window.desktop.call('previewPerformance'));if(p.localReady&&!p.localBusy)break;if(n>2000)throw Error('Page baseline not ready');await delay(25);}
  await page.keyboard.insertText(' EDIT');const expected=source.slice(0,at)+' EDIT'+source.slice(at);
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="continuous-pages"]')?.dataset.localSourceHash===h,hash(expected),{timeout:30000});
  const frames=await page.evaluate(()=>window.pageFrames.map(m=>({maps:m.pageLocations?.map(p=>({page:p.page,count:p.locations.length})),span:m.pageSpan})));result.frames=frames;assert.ok(frames.at(-1)?.maps?.length>=2,'Test must exercise a real multi-page fallback');
  const targets=await page.evaluate(()=>window.pageFrames.at(-1).pageLocations.map(p=>p.locations.find(g=>/[A-Za-z]/.test(document.querySelector('.cm-content').cmTile.root.view.state.doc.sliceString(g.at,g.end)))?.at).filter(at=>at!==undefined));
  const body=source.indexOf('\\begin{document}')+'\\begin{document}'.length,firstParagraph=/\n\n([A-Z][A-Za-z]+ [A-Za-z]+)/.exec(source.slice(body,editAt));
  if(firstParagraph)targets.push(body+firstParagraph.index+2);
  for(const want of targets){
   await page.evaluate(want=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:want}});},want);await page.locator('#locate').click();
   await page.waitForFunction(()=>!!document.querySelector('.navigation-marker'),null,{timeout:5000});
   const point=await page.locator('.navigation-marker').evaluate(m=>{const r=m.getBoundingClientRect();return {x:r.left+r.width*.25,y:r.top+r.height*.5};});
   await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:0}});});await page.mouse.click(point.x,point.y);
   assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head),want,String(want));
  }
  result.twoWayAcrossPages=true;result.unchangedPageChecked=!!firstParagraph;
  await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,c=document.querySelector('[data-local-layout="continuous-pages"]'),r=c.getBoundingClientRect();v.dispatch({changes:{from:0,insert:'%'},selection:{anchor:1}});c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+100,clientY:r.top+100}));if(v.state.selection.main.head!==1)throw Error('Stale page moved caret');});result.staleRejected=true;result.passed=true;
 }catch(e){result.error=String(e);throw e;}finally{if(page)await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
