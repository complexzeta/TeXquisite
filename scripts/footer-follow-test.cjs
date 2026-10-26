const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {testDirectory}=require('./test-artifacts.cjs'),hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=testDirectory('footer-follow'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);const root=path.join(project,'main.tex'),paged=process.env.PERSISTENT_TEX_FOLLOW_LAYOUT==='paged';
 let source='\\documentclass{article}\n\\begin{document}\nOrdinary body words near the top.\n\n\n\\end{document}\n';await fs.writeFile(root,source);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({root,active:root,docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],engine:'pdflatex',latexmk:'latexmk',onSave:true,continuousPreview:!paged,followPreview:true,lastCursor:{file:root,at:source.indexOf('body')+2}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_DISABLE_LOCAL:'1'}}),page=await app.firstWindow(),checks=[];
 const move=at=>page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);
 const state=()=>page.evaluate(()=>({scroll:document.querySelector('#pdfViewport').scrollTop,markerTop:parseFloat(document.querySelector('.navigation-marker')?.style.top??'0'),status:document.querySelector('#navState').textContent}));
 try{
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h)&&document.querySelector('.navigation-marker'),hash(source),{timeout:90000});
  const original=await state();assert.ok(original.markerTop<300);
  for(const [label,at] of [['blank',source.indexOf('\n\n')+1],['end-document',source.indexOf('\\end{document}')+3]]){
   await move(at);await page.waitForTimeout(350);const automatic=await state();assert.ok(Math.abs(automatic.scroll-original.scroll)<2,label+' must preserve scroll: '+JSON.stringify(automatic));assert.ok(automatic.markerTop<300,label+' must not highlight the footer');
   await page.locator('#locate').click();const explicit=await state();assert.ok(Math.abs(explicit.scroll-original.scroll)<2);assert.ok(explicit.markerTop<300);checks.push({label,automatic,explicit});
  }
  await move(source.indexOf('\n\n')+1);await page.keyboard.press('Enter');source=await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});await page.waitForTimeout(350);const rebuilt=await state();assert.ok(Math.abs(rebuilt.scroll-original.scroll)<2,'Recompilation at a blank line must preserve scroll');assert.ok(rebuilt.markerTop<300);
  await move(source.indexOf('body')+2);await page.waitForFunction(()=>{const m=document.querySelector('.navigation-marker');return !!m&&parseFloat(m.style.top)<300;},null,{timeout:10000});assert.equal(await fs.readFile(root,'utf8'),source);
  const result={passed:true,directory,paged,checks,rebuilt,bodyNavigation:true,autosave:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({error:String(e),state:await state()},null,2));throw e;}finally{await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent().catch(()=>''));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
