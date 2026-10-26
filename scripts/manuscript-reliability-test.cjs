// Uses a frozen copy and isolated profile; never edits the user's manuscript.
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {SourceMirror}=require('../dist/snapshot');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','manuscript-reliability-'+randomUUID()),project=path.join(directory,'project'),profile=path.join(directory,'profile');await fs.mkdir(project,{recursive:true});await fs.mkdir(profile);
 const session=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Persistent TeX','session.json'),'utf8')),source=session.docs.find(d=>d.path===session.root).text.replace(/\r\n/g,'\n'),originalHash=hash(await fs.readFile(session.root));
 await new SourceMirror().capture(session.root,project,session.supportFolders,source,Object.fromEntries(session.docs.filter(d=>d.path!==session.root).map(d=>[d.path,d.text])));
 const root=path.join(project,path.basename(session.root)),marker='Testing testing testing ',at=source.lastIndexOf(marker+'\n')+marker.length;assert.ok(at>marker.length,'Expected manuscript test paragraph');
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({...session,root,active:root,docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],onSave:true,continuousPreview:true,previewEditing:false,followPreview:false,lastCursor:{file:root,at}}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}});
 let app,page;const errors=[],checks=[];
 const open=async()=>{app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.locator('.cm-content').waitFor();};
 const text=()=>page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
 const saved=async expected=>{for(let i=0;i<150;i++){if(await fs.readFile(root,'utf8')===expected)return;await page.waitForTimeout(100);}assert.fail('Latest editor text was not automatically saved');};
 const displayed=async(expected,full=false)=>{await page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.localSourceHash===h&&c.dataset.localLatencyEditId===c.dataset.localEditId||c.dataset.sourceHash===h),hash(expected),{timeout:120000,polling:20});await saved(expected);if(full){
  // A verified continuous canvas may intentionally retain its local pixels.
  // Require the matching full artifact to have committed, independent of that layout choice.
  const folder=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32));let found=false;
  for(let i=0;i<600&&!found;i++){try{for(const name of (await fs.readdir(path.join(folder,'commits'))).filter(n=>n.endsWith('.json')).sort().reverse()){const record=JSON.parse(await fs.readFile(path.join(folder,'commits',name))),bundle=JSON.parse(await fs.readFile(path.join(folder,'bundles',record.id,'bundle.json')));if(bundle.sourceHash===hash(expected)){found=true;break;}}}catch{}if(!found)await page.waitForTimeout(200);}assert.ok(found,'Matching full-document artifact was not committed');
 }};
 const close=async()=>{const ended=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await ended;app=undefined;};
 try{
  await open();await displayed(source,true);
  await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:at},scrollIntoView:true});v.focus();},at);
  const addition=' reliability burst one two three';await page.keyboard.type(addition,{delay:5});const edited=source.slice(0,at)+addition+source.slice(at);assert.equal(await text(),edited);await displayed(edited);checks.push('rapid typing and autosave');
  // Undo/redo the entire burst, regardless of CodeMirror's time grouping.
  for(let i=0;i<addition.length+2&&await text()!==source;i++)await page.keyboard.press('Control+z');assert.equal(await text(),source);await displayed(source);checks.push('undo to original');
  for(let i=0;i<addition.length+2&&await text()!==edited;i++)await page.keyboard.press('Control+y');assert.equal(await text(),edited);await displayed(edited);checks.push('redo to latest');
  await displayed(edited,true);
  const beforeError=await page.evaluate(()=>[...document.querySelectorAll('#pages canvas')].map(c=>c.toDataURL()));
  await page.keyboard.insertText(' \\TeXquisiteUndefinedReliability ');const broken=await text();await saved(broken);
  await page.waitForFunction(()=>/Undefined control sequence/.test(document.querySelector('#log').textContent),null,{timeout:90000});
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#pages canvas')].map(c=>c.toDataURL())),beforeError,'Compile errors must preserve the last successful pixels');checks.push('error preserves preview and saves draft');
  await page.keyboard.press('Control+z');assert.equal(await text(),edited);await displayed(edited,true);checks.push('repair returns verified preview');
  // Allow delayed verification/idle work to finish after repair; no older source may replace it.
  for(let i=0;i<20;i++){await page.waitForTimeout(100);const frames=await page.evaluate(()=>[...document.querySelectorAll('#pages canvas')].map(c=>({local:c.dataset.localSourceHash,full:c.dataset.sourceHash,scope:c.dataset.renderScope})));assert.ok(frames.some(c=>(c.local||c.full)===hash(edited)),'Latest edited canvas disappeared');assert.ok(frames.filter(c=>c.local).every(c=>c.local===hash(edited)),'Obsolete edited canvas appeared: '+JSON.stringify(frames));}
  await close();const persisted=JSON.parse(await fs.readFile(path.join(profile,'session.json'),'utf8'));assert.equal(persisted.docs.find(d=>d.path===root).text,edited);assert.equal(persisted.docs.find(d=>d.path===root).dirty,false);
  await open();assert.equal(await text(),edited);await displayed(edited,true);checks.push('normal close and reopen retain saved text and preview');
  assert.equal(hash(await fs.readFile(session.root)),originalHash);assert.deepEqual(errors,[]);
  const result={passed:true,directory,checks,originalUnchanged:true,sourceHash:hash(edited),errors};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){if(page&&!page.isClosed())await fs.writeFile(path.join(directory,'failure.txt'),String(e)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw e;}
 finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
