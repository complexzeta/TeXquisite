const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const directory=path.resolve('.test-output','continuous-pages-'+randomUUID()),profile=await fs.mkdtemp(path.join(os.tmpdir(),'persistent-continuous-pages-'));await fs.mkdir(directory,{recursive:true});
 const spanning=process.env.PERSISTENT_TEX_TEST_SPAN==='1';
 const root=path.join(directory,'main.tex'),prefix='\\documentclass{article}\n\\setlength{\\textheight}{'+(spanning?'96':'200')+'pt}\n\\begin{document}\nTop material.\\par\n\\vfill\n\n',region=spanning?'Target paragraph '+('wrapping words '.repeat(40))+'ENDTOKEN.\n\n':'Target paragraph with display math \\[\\sqrt{\\pi}+x^2\\] ENDTOKEN\\footnote{Inserted footnote.}.\n\n',suffix='Following stable paragraph.\n\n\\newpage\n'+Array.from({length:20},(_,i)=>'Following page '+i+'.\n'+(i<19?'\\newpage\n':'')).join('')+'\\end{document}\n',source=prefix+region+suffix;
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:true,previewEditing:false,followPreview:false}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:['--force-device-scale-factor=2.5']}:{args:['--force-device-scale-factor=2.5','.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.text().startsWith('Local '))console.log(m.text());});
 try{
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(source),{timeout:90000});
  await page.evaluate(()=>{window.frames028=[];window.desktop.on(m=>{if(m.type==='localPage')window.frames028.push({hash:m.sourceHash,span:m.pageSpan,timing:m.timing});});const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('ENDTOKEN')},scrollIntoView:true});v.focus();});
  await page.waitForFunction(()=>document.querySelector('#previewState').dataset.localState==='ready',null,{timeout:60000});
  await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);globalThis.gate028={wc,send,held:[]};wc.send=(channel,...args)=>{if(args[0]?.type==='commit'){globalThis.gate028.held.push([channel,...args]);return;}send(channel,...args);};});
  const before=await page.evaluate(()=>{const pages=document.querySelectorAll('.flow-page'),viewport=document.querySelector('#pages').parentElement;window.untouched028=pages[10];pages[10].scrollIntoView({block:'start'});return {count:pages.length,top:viewport.scrollTop,offset:pages[10].getBoundingClientRect().top};});
  await page.keyboard.type('z');const expected=source.replace('ENDTOKEN','zENDTOKEN');
  await page.waitForFunction(h=>document.querySelector('[data-local-layout="continuous-pages"]')?.dataset.localSourceHash===h,hash(expected),{timeout:10000,polling:10});
  const local=await page.evaluate(()=>{const c=document.querySelector('[data-local-layout="continuous-pages"]'),pages=document.querySelectorAll('.flow-page');return {...c.dataset,count:pages.length,untouched:pages[10]===window.untouched028,offset:pages[10].getBoundingClientRect().top,width:c.width};});
  assert.equal(local.count,before.count);assert.equal(local.untouched,true);assert.ok(Math.abs(local.offset-before.offset)<=1);assert.ok(local.width>0);
  await page.waitForTimeout(250);assert.ok(await page.locator('[data-local-layout="continuous-pages"]').first().evaluate(c=>c.width)>0,'Lazy page rendering must not erase patched pages');
  await app.evaluate(()=>{const g=globalThis.gate028;g.wc.send=g.send;for(const args of g.held)g.send(...args);g.held=[];});
  await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h&&!document.querySelector('[data-local-layout="continuous-pages"]'),hash(expected),{timeout:60000});
  assert.equal(await fs.readFile(root,'utf8'),expected);assert.deepEqual(errors,[]);
  if(spanning){
    const short='Target ENDTOKEN.\n\n',shrunk=prefix+short+suffix;
    await page.evaluate(({from,to,text})=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from,to,insert:text},selection:{anchor:from+7},scrollIntoView:true});v.focus();},{from:prefix.length,to:prefix.length+region.length+1,text:short});
    await page.waitForFunction(h=>document.querySelector('#pages canvas')?.dataset.sourceHash===h,hash(shrunk),{timeout:60000});
    assert.ok(await page.evaluate(h=>window.frames028.some(f=>f.hash===h),hash(shrunk)),'A changed page span with an explicit continuation should stay local');
    assert.equal(await fs.readFile(root,'utf8'),shrunk);
  }
  const frames=await page.evaluate(()=>window.frames028);assert.ok(frames.length);assert.ok(frames.every(f=>f.timing.excludedSuffixBytes>100));
  const result={passed:true,directory,displayMath:!spanning,multiplePages:spanning,changedSpanStaysLocal:spanning,continuousPagesRetained:true,scrollAnchorPreserved:true,autosave:true,fullVerification:true,localLatencyMs:Number(local.localLatencyMs),frames};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(directory,'failure.log'),String(error)+'\n'+await page.locator('#log').textContent().catch(()=>''));console.error(directory);throw error;}
 finally{await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
