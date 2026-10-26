const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {forwardPosition}=require('../dist/navigation-query'),hash=s=>createHash('sha256').update(s).digest('hex');
(async()=>{
 const paged=process.env.PERSISTENT_TEX_FOLLOW_LAYOUT==='paged';
 const directory=require('./test-artifacts.cjs').testDirectory('follow'),profile=await fs.mkdtemp(path.join(directory,'persistent-follow-'));await fs.mkdir(directory,{recursive:true});
 await fs.mkdir(path.join(directory,'project'));const root=path.join(directory,'project','main.tex');let source='\\documentclass{article}\n\\setlength{\\textheight}{150pt}\n\\setlength{\\textwidth}{250pt}\n\\begin{document}\n'+('ordinary wrapping words '.repeat(120))+'ENDTOKEN\n\\end{document}\n',at=source.indexOf('ENDTOKEN');
 await fs.writeFile(root,source);await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[{path:root,text:source,diskHash:hash(source),dirty:false,eol:'\n'}],root,active:root,onSave:true,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',continuousPreview:!paged,followPreview:true,lastCursor:{file:root,at}}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1',PERSISTENT_TEX_DISABLE_LOCAL:'1'}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const settled=()=>page.waitForFunction(h=>[...document.querySelectorAll('#pages canvas')].some(c=>c.dataset.sourceHash===h),hash(source),{timeout:90000});
 const expected=async()=>{const folder=path.join(profile,'projects',hash(root.toLowerCase()).slice(0,32)),records=(await fs.readdir(path.join(folder,'commits'))).filter(n=>n.endsWith('.json')).sort(),record=JSON.parse(await fs.readFile(path.join(folder,'commits',records.at(-1)),'utf8')),nav=JSON.parse(await fs.readFile(path.join(folder,'bundles',record.id,'navigation.json'),'utf8'));return forwardPosition(nav,root,source,at,1);};
 const mapped=async()=>{for(let i=0;i<100;i++){const row=await expected();if(row?.[2]>1)return row;await page.waitForTimeout(100);}throw new Error('Follow did not publish a character-mapped preview');};
 const visible=async row=>{assert.ok(row&&row[2]>1,'Fixture must cross a PDF page within one physical source line');await page.waitForFunction(row=>{const marker=document.querySelector('.navigation-marker'),r=marker?.getBoundingClientRect(),v=document.querySelector('#pdfViewport').getBoundingClientRect();return !!marker&&(marker.parentElement.dataset.page===String(row[2])||Number(document.querySelector('#pageLabel').textContent.split(' / ')[0])===row[2])&&Math.abs(parseFloat(marker.style.top)-row[4]*Number(document.querySelector('#zoom').value))<1&&r.top>=v.top&&r.bottom<=v.bottom;},row,{timeout:10000});};
 try{
  await settled();const initial=await expected();await visible(initial);
  // Keyboard input, with no click, Show in PDF command or explicit navigation.
  await page.evaluate(()=>document.querySelector('.cm-content').cmTile.root.view.focus());await page.keyboard.type(' new words');source=source.slice(0,at)+' new words'+source.slice(at);at+=' new words'.length;
  await settled();await visible(await expected());
  await page.locator('#follow').click();await page.evaluate(()=>document.querySelector('#pdfViewport').scrollTop=0);
  await page.evaluate(at=>{const view=document.querySelector('.cm-content').cmTile.root.view;view.dispatch({selection:{anchor:at}});view.focus();},at);await page.keyboard.type(' paused follow');source=source.slice(0,at)+' paused follow'+source.slice(at);at+=' paused follow'.length;
  await settled();assert.equal(await page.locator('#pdfViewport').evaluate(e=>e.scrollTop),0,'Follow off must preserve the chosen viewport');
  await page.locator('#follow').click();await visible(await mapped());assert.deepEqual(errors,[]);
  const result={passed:true,paged,directory,page:initial[2],longPhysicalLine:true,initialFollow:true,typingAcrossPages:true,followOffPreservesScroll:true,reEnableRevealsCursor:true};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){console.error(await page.locator('#status').textContent(),await page.locator('#navState').textContent());throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
