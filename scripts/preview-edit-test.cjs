const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','preview-edit-ui-'+randomUUID()),project=path.join(directory,'source');await fs.mkdir(project,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-tex-preview-edit-')),root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex');
 const source='\\documentclass{article}\n\\begin{document}\n\nHello world. $a+b$ More words.\n\n$\\sum_{i=1}^{n} i$\n\\newpage\n\\input{chapter}\n\\end{document}\n',part='A simple chapter.\n';await fs.writeFile(root,source);await fs.writeFile(chapter,part);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:true,followPreview:true}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&!document.querySelector('#status').textContent.includes('queued'),null,{timeout:90000,polling:25});
 const currentMap=async()=>{const folder=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),records=(await fs.readdir(path.join(folder,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(folder,'commits',records.at(-1))));return JSON.parse(await fs.readFile(path.join(folder,'bundles',record.id,'navigation.json')));};
 const clickCharacter=async(file,line,column)=>{const nav=await currentMap(),g=nav.characters?.find(g=>g[0]===file&&g[1]===line&&g[2]===column);assert.ok(g,JSON.stringify(nav));const zoom=Number(await page.locator('#zoom').inputValue());await page.locator('#pages canvas').click({position:{x:g[4]*zoom+.1,y:(g[5]+g[7]/2)*zoom}});await page.waitForFunction(()=>document.activeElement?.id==='previewInput',null,{timeout:10000});};
 try{
  await settled();await clickCharacter(root,4,6);assert.equal(await page.locator('.preview-caret').count(),1);
  await page.keyboard.type('brave ');await settled();await page.waitForFunction(()=>!document.querySelector('#pages .preview-caret')?.classList.contains('pending'));
  assert.equal(await fs.readFile(root,'utf8'),source.replace('Hello world.','Hello brave world.'));assert.equal(await page.locator('#editor .cm-content').textContent().then(s=>s.includes('Hello brave world.')),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'previewInput');
  for(let i=0;i<6;i++)await page.keyboard.press('Backspace');await settled();assert.equal(await fs.readFile(root,'utf8'),source);assert.equal(await page.evaluate(()=>document.activeElement.id),'previewInput');
  await page.keyboard.press('Control+Z');await settled();assert.equal(await fs.readFile(root,'utf8'),source.replace('Hello world.','Hello brave world.'));
  // Restore through the source editor's shared undo history, then edit another file.
  await page.keyboard.press('Control+Z');await settled();assert.equal(await fs.readFile(root,'utf8'),source);
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='2 / 2');await clickCharacter(chapter,1,9);
  await page.keyboard.type('new ');await settled();assert.equal(await fs.readFile(chapter,'utf8'),'A simple new chapter.\n');assert.match(await page.locator('#rootLabel').textContent(),/main.tex/);assert.equal(await fs.readFile(root,'utf8'),source);
  // Reject TeX syntax and paragraph insertion without changing source.
  const unchanged=await fs.readFile(chapter,'utf8');await page.keyboard.type('$');await page.keyboard.press('Enter');await page.waitForTimeout(100);assert.equal(await fs.readFile(chapter,'utf8'),unchanged);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.preview-caret').count(),0);
  await page.locator('#prevPage').click();await page.waitForFunction(()=>document.querySelector('#pageLabel').textContent==='1 / 2');const nav=await currentMap(),math=nav.regions.find(r=>r[0]===root&&r[1]===6);assert.ok(math);
  await page.locator('#pages canvas').click({position:{x:math[3]+1,y:math[4]+math[6]/2}});assert.equal(await page.locator('.preview-caret').count(),0);assert.match(await page.locator('#navState').textContent(),/source editor/);assert.equal(await fs.readFile(root,'utf8'),source);
  // Zoom uses CSS points and must not move the insertion to another character.
  await page.locator('#zoom').selectOption('1.5');await page.waitForFunction(()=>document.querySelector('#pages canvas').style.width.startsWith('918')||parseFloat(document.querySelector('#pages canvas').style.width)>850);
  await clickCharacter(root,4,0);await page.keyboard.type('A ');await settled();assert.equal(await fs.readFile(root,'utf8'),source.replace('Hello world.','A Hello world.'));
  // Selection and clipboard replacement share the same bounded source range.
  await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Delete');await settled();assert.equal(await fs.readFile(root,'utf8'),source);
  await page.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain','New ');document.querySelector('#previewInput').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});await settled();const withPaste=source.replace('Hello world.','New Hello world.');assert.equal(await fs.readFile(root,'utf8'),withPaste);
  // A paused preview can edit a draft, but clicking its old geometry cannot
  // retarget that draft while the displayed source hash is out of date.
  await page.locator('#live').click();await clickCharacter(root,4,4);await page.keyboard.type('X');await page.waitForTimeout(100);assert.equal(await fs.readFile(root,'utf8'),withPaste);
  const staleMap=await currentMap(),old=staleMap.characters.find(g=>g[0]===root&&g[1]===4&&g[2]===4);await page.locator('#pages canvas').click({position:{x:old[4]*1.5+.1,y:(old[5]+old[7]/2)*1.5}});assert.equal(await page.locator('.preview-caret').count(),0);await page.waitForFunction(()=>document.querySelector('#navState').textContent.includes('behind'));
  await page.locator('#live').click();await settled();assert.equal(await fs.readFile(root,'utf8'),withPaste.replace('New Hello','New XHello'));
  await clickCharacter(root,4,5);
  if(process.env.PERSISTENT_TEX_CAPTURE_PREVIEW_EDIT){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.screenshot({path:path.join(directory,'preview-edit.png')});}
  assert.deepEqual(errors,[]);const result={directory,passed:true,typing:true,deleting:true,sharedUndo:true,includedFiles:true,mathRefused:true,specialSyntaxRefused:true,zoom:true,selection:true,paste:true,pausedDraft:true,staleClickRefused:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#navState').textContent()+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());throw e;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
