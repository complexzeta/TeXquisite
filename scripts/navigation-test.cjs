const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const hash=text=>createHash('sha256').update(text).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','navigation-ui-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-navigation-'));
 const root=path.join(directory,'main.tex'),chapter=path.join(directory,'chapter.tex');
 const source='\\documentclass{article}\n\\begin{document}\nFirstMark source paragraph.\n\\newpage\nSecondMark source paragraph.\n\\input{chapter}\n\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(chapter,'\\newpage\nThirdMark included paragraph.\n');
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',followPreview:false}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 let app=await launch(),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated'),null,{timeout:90000,polling:30});
 const select=async word=>{await page.locator('.cm-line').filter({hasText:word}).click();await page.keyboard.press('Home');};
 try{
  await settled();assert.equal(await page.locator('#pageLabel').textContent(),'1 / 3');
  await select('SecondMark');await page.locator('#locate').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 3');
  await page.locator('#follow').click();await select('FirstMark');await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='1 / 3');
  await page.locator('#follow').click();await select('SecondMark');await page.waitForTimeout(250);assert.equal(await page.locator('#pageLabel').textContent(),'1 / 3','Following off must preserve manual reading');
  await page.keyboard.press('Control+Enter');await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 3');
  assert.equal((await page.locator('.cm-line').allTextContents()).join('\n'),source,'The navigation shortcut must not insert a blank line or edit source');
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='3 / 3');
  const project=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),records=(await fs.readdir(path.join(project,'commits'))).filter(n=>n.endsWith('.json')).sort();
  const record=JSON.parse(await fs.readFile(path.join(project,'commits',records.at(-1)))),nav=JSON.parse(await fs.readFile(path.join(project,'bundles',record.id,'navigation.json')));
  const row=nav.regions.find(r=>r[0]===chapter&&r[1]===2);assert.ok(row);
  await page.locator('#pages canvas').click({position:{x:row[3]+3,y:row[4]+3}});
  await page.waitForFunction(()=>document.querySelector('#tabs .active').textContent==='chapter.tex');
  assert.match(await page.locator('.cm-activeLine').textContent(),/ThirdMark/);assert.match(await page.locator('#rootLabel').textContent(),/main.tex/);
  // A stale accepted preview must not move the source cursor to an old line.
  await page.locator('#live').click();await page.keyboard.press('End');await page.keyboard.insertText(' changed');
  const before=await page.locator('.cm-activeLine').textContent();await page.locator('#pages canvas').click({position:{x:row[3]+3,y:row[4]+3}});
  await page.waitForFunction(()=>document.querySelector('#navState').textContent.includes('behind'));
  assert.equal(await page.locator('.cm-activeLine').textContent(),before);assert.equal(await fs.readFile(chapter,'utf8'),'\\newpage\nThirdMark included paragraph.\n','Paused draft must remain unsaved');
  await page.locator('#live').click();await settled();
  await page.waitForFunction(()=>!document.querySelector('#tabs .active').textContent.includes('•'));
  assert.match(await fs.readFile(chapter,'utf8'),/changed/);
  await page.locator('#follow').click();await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');
  if(process.env.PERSISTENT_TEX_CAPTURE_NAV){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.screenshot({path:path.join(directory,'navigation.png')});}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await app.close();
  app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await settled();
  assert.equal(await page.locator('#follow').getAttribute('aria-pressed'),'true','Follow preference must survive restart');
  await select('ThirdMark');await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='3 / 3');
  assert.deepEqual(errors,[]);
  const result={directory,passed:true,sourceToPdf:true,followToggle:true,includedFileClick:true,staleSourceRejected:true,restart:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#navState').textContent()+'\n'+await page.locator('#log').textContent());throw e;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
