// Experimental multi-paragraph edits must survive canonical export and restart.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);
 const directory=require('./test-artifacts.cjs').testDirectory('neutral-session'),profile=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(profile);await fs.mkdir(project);
 const root=path.join(project,'main.tex'),source='\\documentclass{article}\n\\begin{document}\n\nAlphaSentinel ordinary paragraph words for the first region.\n\nBetaSentinel ordinary paragraph words for the second region.\n\nTail paragraph.\n\n\\end{document}\n';let expected=source,app,page;const errors=[],result={passed:false,directory};
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',previewMode:'lecture',onSave:true,liveVersion:2,continuousPreview:true,lastCursor:{file:root,at:source.indexOf('AlphaSentinel')+13}}));
 const open=async()=>{app=await electron.launch({args:['.'],env:{...process.env,PERSISTENT_TEX_MULTI_BLOCK:'1',PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:90000});os.setPriority(app.process().pid,os.constants.priority.PRIORITY_BELOW_NORMAL);page=await app.firstWindow({timeout:90000});page.on('pageerror',e=>errors.push(String(e)));};
 const close=async()=>{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=undefined;}};
 const full=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h&&!c.dataset.localSourceHash),hash(expected),{timeout:90000});
 try{
  await open();await full();
  for(const [marker,insert] of [['AlphaSentinel',' FirstChange'],['BetaSentinel',' SecondChange']]){
   const at=expected.indexOf(marker)+marker.length;await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);
   await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
   await page.keyboard.insertText(insert);expected=expected.slice(0,at)+insert+expected.slice(at);
   await page.waitForFunction(h=>[...document.querySelectorAll('[data-neutral-active="true"]')].some(c=>c.dataset.localSourceHash===h),hash(expected),{timeout:30000});
  }
  for(let n=0;n<200&&await fs.readFile(root,'utf8')!==expected;n++)await delay(25);assert.equal(await fs.readFile(root,'utf8'),expected);result.savedBoth=true;
  const exported=path.join(directory,'export.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);await page.evaluate(()=>window.desktop.call('export'));
  const lib=await require('@hyzyla/pdfium').PDFiumLibrary.init(),doc=await lib.loadDocument(await fs.readFile(exported));try{let text='';for(const p of doc.pages()){text+=p.getText();p.close();}assert.match(text,/AlphaSentinel\s+FirstChange/);assert.match(text,/BetaSentinel\s+SecondChange/);result.exportedBoth=true;}finally{doc.destroy();lib.destroy();}
  await full();await fs.writeFile(path.join(directory,'build.log'),await page.locator('#log').textContent());await close();await open();await full();
  assert.equal(await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()),expected);assert.equal(await page.locator('#previewMode').inputValue(),'lecture');result.reopenedBoth=true;assert.deepEqual(errors,[]);result.passed=true;
 }catch(e){result.error=String(e);throw e;}finally{if(page&&!page.isClosed())await fs.writeFile(path.join(directory,'final-build.log'),await page.locator('#log').textContent().catch(()=>''));await close();await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
