const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const directory=path.resolve('.test-output','continuous-cross-page-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-cross-page-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),source='\\documentclass{article}\n\\begin{document}\n\n'+Array.from({length:800},(_,i)=>'UniqueWord'+i+' some ordinary words. ').join('')+'\n\n\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false,continuousPreview:true}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h&&document.querySelectorAll('.flow-page').length>2,hash(source),{timeout:120000});
  const project=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),records=(await fs.readdir(path.join(project,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(project,'commits',records.at(-1)))),nav=JSON.parse(await fs.readFile(path.join(project,'bundles',record.id,'navigation.json')));
  const targets=['UniqueWord790','UniqueWord300','UniqueWord10'];const actual=[];
  for(const target of targets){
   const at=source.indexOf(target)+3;
   await page.evaluate(at=>{const v=document.querySelector('.cm-content').cmTile.root.view;document.querySelector('.navigation-marker')?.remove();v.dispatch({selection:{anchor:at},scrollIntoView:true});},at);await delay(100);
   const pos=await page.evaluate(at=>{const r=document.querySelector('.cm-content').cmTile.root.view.coordsAtPos(at);return {x:r.left+1,y:(r.top+r.bottom)/2};},at);await page.mouse.click(pos.x,pos.y);
   await page.waitForFunction(()=>!!document.querySelector('.navigation-marker'),null,{timeout:10000});
   actual.push(await page.locator('.navigation-marker').evaluate(e=>Number(e.parentElement.dataset.page)));
  }
  assert.ok(actual[0]>actual[1]&&actual[1]>actual[2],'Clicks along one physical source line must navigate between its different PDF pages: '+actual);
  assert.ok(nav.characters?.length>10000,'Continuous builds need character mappings, not only line mappings');
  for(let i=0;i<targets.length;i++){const at=source.indexOf(targets[i])+3,prefix=source.slice(0,at),line=prefix.split('\n').length,column=Buffer.byteLength(prefix.slice(prefix.lastIndexOf('\n')+1)),glyph=nav.characters.find(g=>g[1]===line&&g[2]===column);assert.ok(glyph);assert.equal(actual[i],glyph[3]);}
  await page.waitForFunction(()=>{const e=document.querySelector('.navigation-marker'),r=e?.getBoundingClientRect(),v=document.querySelector('#pdfViewport').getBoundingClientRect();return r&&r.top>=v.top&&r.top<v.bottom;});
  assert.equal(await fs.readFile(root,'utf8'),source);assert.deepEqual(errors,[]);
  const result={passed:true,directory,clickedPages:actual,onePhysicalSourceLine:true,characterMappings:nav.characters.length,autosaveUnchanged:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await fs.writeFile(path.join(directory,'failure.log'),String(e)+'\n'+await page.locator('#navState').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw e;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
