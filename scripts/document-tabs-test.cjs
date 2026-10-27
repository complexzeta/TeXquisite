const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('document-tabs'),profile=path.join(directory,'profile'),a=path.join(directory,'alpha','main.tex'),b=path.join(directory,'beta','main.tex'),chapter=path.join(directory,'alpha','chapter.tex'),c=path.join(directory,'gamma','third.tex');
 for(const folder of [profile,path.dirname(a),path.dirname(b),path.dirname(c)])await fs.mkdir(folder,{recursive:true});
 const texts=new Map([[a,'\\documentclass{article}\n\\begin{document}\nAlpha document.\\input{chapter}\n\\end{document}\n'],[b,'\\documentclass{article}\n\\begin{document}\nBeta document: $\\sqrt{\\pi}$.\n\\end{document}\n'],[chapter,'% \\documentclass{article} is only a comment.\nChapter belongs to Alpha.\n'],[c,'\\documentclass [11pt] {article}\n\\begin{document}\nGamma document.\n\\end{document}\n']]);
 for(const [file,text]of texts)await fs.writeFile(file,text);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[...texts].map(([p,text])=>({path:p,text,diskHash:hash(text),dirty:false,eol:'\n'})),root:a,active:a,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,followPreview:false,autoClose:false}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),errors=[];let app=await launch(),page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));
 const click=async file=>page.locator('#tabs button').evaluateAll((buttons,file)=>buttons.find(b=>b.title===file).click(),file);
 const selected=file=>page.waitForFunction(file=>document.querySelector('#tabs .active')?.title===file,file,{timeout:15000});
 const preview=async file=>{await page.waitForFunction(file=>document.querySelector('#rootLabel').textContent==='Root: '+file,file,{timeout:15000});await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(texts.get(file)),{timeout:90000});};
 try{
  await preview(a);await click(b);await selected(b);await preview(b);
  const queued='% A delayed edit from the previous tab.\n'+texts.get(a);texts.set(a,queued);await page.evaluate(({file,text})=>window.desktop.call('edit',file,text,'late-alpha-edit',0),{file:a,text:queued});
  await page.locator('#build').click();await preview(b);
  for(let n=0;n<30&&JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8')).lastCursor?.file!==b;n++)await new Promise(r=>setTimeout(r,100));assert.equal(JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8')).lastCursor.file,b);
  await click(a);await selected(a);await preview(a);
  await click(chapter);await selected(chapter);await preview(a);
  await click(b);await selected(b);await preview(b);await click(chapter);await selected(chapter);await preview(a);
  await page.locator('#build').click();await preview(a);
  await page.evaluate(paths=>{for(const file of paths)[...document.querySelectorAll('#tabs button')].find(b=>b.title===file).click();document.querySelector('#build').click();},[b,a,c,b,c]);await selected(c);await preview(c);
  await page.locator('#live').click();await click(b);await selected(b);await page.waitForFunction(file=>document.querySelector('#rootLabel').textContent==='Root: '+file,b);
  const before=texts.get(b),at=before.indexOf('Beta document')+'Beta document'.length;await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at}});v.focus();},at);await page.keyboard.insertText(' manually rebuilt');texts.set(b,before.slice(0,at)+' manually rebuilt'+before.slice(at));await page.locator('#build').click();await preview(b);
  assert.deepEqual(errors,[]);const saved=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));assert.equal(saved.root,b);assert.equal(saved.active,b);for(const [file,text]of texts)assert.equal(await fs.readFile(file,'utf8'),text);
  await app.evaluate(({app})=>app.quit());await app.close().catch(()=>{});saved.root=a;await fs.writeFile(path.join(profile,'session.json'),JSON.stringify(saved));app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await selected(b);await preview(b);assert.deepEqual(errors,[]);
  const result={passed:true,directory,duplicateBasenames:true,tabSwitchSelectsPreview:true,buildUsesSelectedDocument:true,delayedEditPreservesSelectedCursor:true,chaptersRetainParent:true,chapterRestoresPriorParent:true,rapidTabsLatestWins:true,manualBuildWhilePaused:true,restartRepairsLegacyRootMismatch:true,onlyIntendedSourceChanged:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#rootLabel').textContent()+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
