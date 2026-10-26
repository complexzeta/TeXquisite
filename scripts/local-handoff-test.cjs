const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','local-handoff-ui-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-handoff-'));await fs.mkdir(directory,{recursive:true});
 const root=path.join(directory,'main.tex'),prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n',paragraphs=Array.from({length:8},(_,i)=>'Target paragraph '+i+' with math $\\sqrt{\\pi}$ and ordinary words.\n\n'),source=prefix+paragraphs.join('')+'\\newpage\n'+Array.from({length:100},(_,i)=>'Tail page '+i+'.\\newpage\n').join('')+'\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:['--force-device-scale-factor=2.5']}:{args:['--force-device-scale-factor=2.5','.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const move=i=>page.evaluate(i=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('Target paragraph '+i)+10},scrollIntoView:true});v.focus();},i);
 const held=()=>app.evaluate(()=>globalThis.__handoff.held.length);
 const waitHeld=async()=>{for(let i=0;i<300;i++){if(await held())return;await page.waitForTimeout(20);}throw new Error('No held paragraph proof');};
 const release=()=>app.evaluate(()=>{const g=globalThis.__handoff;for(const args of g.held.splice(0))g.send(...args);});
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(source),{timeout:90000});await move(1);
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='warming',null,{timeout:10000,polling:10});await page.waitForTimeout(50);await move(3);await move(1);
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  const initialHandoff=await page.evaluate(()=>JSON.parse(document.querySelector('#log').textContent.split('Local preparation: ').at(-1).split('\n')[0]));assert.equal(initialHandoff.reusedBaseline,true,'Moving during the cold compiler RPC must preserve the completed baseline');
  await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc),g=globalThis.__handoff={held:[],send,wc};wc.send=(channel,...args)=>{if(args[0]?.type==='localVerify'){g.held.push([channel,...args]);return;}send(channel,...args);};});
  await move(5);await waitHeld();await move(2);await move(6);await release();await waitHeld();
  assert.equal(await page.locator('#previewState').getAttribute('data-local-state'),'warming');
  await page.keyboard.type('zy');const expected=source.replace('Target paragraph 6','Target parzyagraph 6');
  const releasedAt=Date.now();await release();
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});
  const fromProofReleaseMs=Date.now()-releasedAt,editLatencyMs=Number(await page.locator('#pages canvas').getAttribute('data-local-latency-ms'));
  assert.notEqual(await page.locator('#pages canvas').getAttribute('data-source-hash'),hash(expected),'Queued input must use local output before full verification');
  const preparation=await page.evaluate(()=>JSON.parse(document.querySelector('#log').textContent.split('Local preparation: ').at(-1).split('\n')[0]));assert.equal(preparation.reusedBaseline,true,'Rapid cursor moves must preserve the warm compiler');
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(expected),{timeout:60000});assert.equal(await fs.readFile(root,'utf8'),expected);
  // Cancel an in-flight verification, then deliver its obsolete reply. It must
  // not resurrect local readiness or publish a stale local frame.
  await move(2);await waitHeld();await page.locator('#cancel').click();await release();await page.waitForTimeout(250);assert.equal(await page.locator('#previewState').getAttribute('data-local-state'),'off');assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);
  const result={passed:true,directory,coldRpcHandoff:true,rapidMovesReuseCompiler:true,earlyEditsCoalesced:true,obsoleteProofAfterCancelRejected:true,editLatencyMs,fromProofReleaseMs,preparation,autosave:true,fullVerification:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#status').textContent()+'\n'+await page.locator('#log').textContent());console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{const g=globalThis.__handoff;if(g)g.wc.send=g.send;dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
