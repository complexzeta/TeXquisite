// Isolated installed-kernel override: never edits the user's TeX installation.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(x).digest('hex');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('format-portability-ui'),profile=path.join(directory,'profile'),project=path.join(directory,'project'),custom=path.join(directory,'custom-tex');
 for(const folder of [profile,project,custom])await fs.mkdir(folder);
 const kernel=cp.execFileSync('kpsewhich',['latex.ltx'],{encoding:'utf8',windowsHide:true}).trim(),override=path.join(custom,'latex.ltx');await fs.writeFile(override,await fs.readFile(kernel,'utf8')+'\n% Disposable portability test override.\n');
 const root=path.join(project,'main.tex');let source='\\documentclass{article}\n\\usepackage{amsmath,tikz}\n\\begin{document}\n\nPortable preview prose.\n\n$\\sqrt{\\pi}+\\frac12$\n\n\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}\n\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:false,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,autoClose:false,followPreview:false,lastCursor:{file:root,at:source.indexOf('prose')+5}}));
 const env={...process.env,TEXINPUTS:custom+path.delimiter+(process.env.TEXINPUTS??''),PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},errors=[];
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env});
 let app=await launch(),page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));const close=()=>app.evaluate(({app})=>app.quit());
 const ready=()=>page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready'&&document.querySelector('#pages canvas')?.width>0,null,{timeout:90000});
 try{
  await page.waitForFunction(()=>document.querySelector('#settingsDialog').open&&!document.querySelector('#prepareFastFormat').disabled,null,{timeout:90000});assert.match(await page.locator('#toolchainSummary').textContent(),/Native compilation only/);
  const start=Date.now();await page.locator('#prepareFastFormat').click();await page.waitForFunction(()=>document.querySelector('#formatPreparation').textContent.startsWith('Prepared.'),null,{timeout:180000});const preparationMs=Date.now()-start;
  assert.match(await page.locator('#toolchainSummary').textContent(),/prepared fast-preview format/i);await page.locator('#onSave').check();await page.locator('#applySettings').click();await ready();
  const at=source.indexOf('prose')+5;await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);await ready();const editStart=Date.now();await page.keyboard.insertText(' improved');source=source.slice(0,at)+' improved'+source.slice(at);const expected=hash(source);
  await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h),expected,{timeout:30000,polling:10});const editMs=Date.now()-editStart;
  assert.equal(await fs.readFile(root,'utf8'),source);const caches=await fs.readdir(path.join(profile,'formats'));assert.equal(caches.length,1);const manifest=path.join(profile,'formats',caches[0],'manifest.json'),before=await fs.readFile(manifest,'utf8');
  await close();await app.close().catch(()=>{});app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await ready();assert.equal(await page.locator('#settingsDialog').evaluate(e=>e.open),false);assert.equal(await fs.readFile(manifest,'utf8'),before,'Restart must reuse the prepared cache');assert.deepEqual(errors,[]);
  await close();await app.close().catch(()=>{});await fs.appendFile(override,'\n% Changed after preparation.\n');const {preparedFormat}=require('../dist/format-cache');assert.equal(preparedFormat(manifest,path.resolve('engine/resident'),undefined,env),undefined);
  const result={passed:true,directory,preparationMs,editMs,restartReusedCache:true,modifiedInputInvalidated:true,mathAndTikZ:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#formatPreparation').textContent().catch(()=>'' )+'\n'+await page.locator('#log').textContent().catch(()=>''));throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
