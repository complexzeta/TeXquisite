const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
(async()=>{
 const dir=path.resolve('.test-output','completion-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 await fs.mkdir(path.join(dir,'source'));const root=path.join(dir,'source','main.tex'),text='Start';await fs.writeFile(root,text);
 await fs.writeFile(path.join(dir,'session.json'),JSON.stringify({docs:[{path:root,text,diskHash:createHash('sha256').update(text).digest('hex'),dirty:false,eol:'\n'}],root,active:root,engine:'pdflatex',latexmk:'latexmk',onSave:false,liveVersion:2}));
 const launch=()=>electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:dir,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:30000});
 let app=await launch(),page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const source=()=>page.locator('.cm-content').evaluate(node=>Array.from(node.querySelectorAll('.cm-line'),line=>line.textContent).join('\n'));
 const clear=async()=>{await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');};
 try{
  await page.locator('.cm-content').waitFor();assert.equal(await page.locator('#autoClose').getAttribute('aria-pressed'),'true');
  for(const [open,body,close] of [['$','x','$'],['{','stuff','}'],['\\[','x','\\]'],['\\(','x','\\)'],['\\begin{align*}','x','\\end{align*}']]){
   await clear();await page.keyboard.type(open);assert.equal(await source(),open+close);
   await page.keyboard.type(body+close);assert.equal(await source(),open+body+close);
  }
  await clear();await page.keyboard.type('\\begin{align}\\begin{split}x\\end{split}\\end{align}');assert.equal(await source(),'\\begin{align}\\begin{split}x\\end{split}\\end{align}');
  await clear();await page.keyboard.type('\\begin{align}\\eta+\\epsilon\\end{align}');assert.equal(await source(),'\\begin{align}\\eta+\\epsilon\\end{align}');
  for(const open of ['{','$','\\[','\\(']){await clear();await page.keyboard.type(open);await page.keyboard.press('Backspace');assert.equal(await source(),'');}
  await clear();await page.keyboard.type('\\$ \\{');assert.equal(await source(),'\\$ \\{\\}');
  for(const [open,close]of [['(',')'],['[',']'],['\\{','\\}'],['\\langle','\\rangle'],['\\lfloor','\\rfloor'],['\\lceil','\\rceil'],['\\left(','\\right)']]){await clear();await page.keyboard.type(open);assert.equal(await source(),open+(/[A-Za-z]$/.test(open)?' ':'')+close+(/[A-Za-z]$/.test(close)?' ':''));await page.keyboard.type('x'+close);assert.equal(await source(),open+(/[A-Za-z]$/.test(open)?' ':'')+'x'+close+(/[A-Za-z]$/.test(close)?' ':''));}
  await clear();await page.keyboard.type('\\begin{align}');await page.keyboard.press('ArrowLeft');await page.keyboard.type('*');assert.equal(await source(),'\\begin{align*}\\end{align*}');await page.keyboard.press('Control+z');assert.equal(await source(),'\\begin{align}\\end{align}');await page.keyboard.press('Control+y');assert.equal(await source(),'\\begin{align*}\\end{align*}');
  await clear();await page.keyboard.type('word');await page.keyboard.press('Control+A');await page.keyboard.type('\\');await page.locator('#surroundDelimiter').waitFor({state:'visible'});await page.keyboard.type('lagnle');assert.equal(await source(),'word');await page.locator('#surroundDelimiter').fill('\\langle');assert.equal(await source(),'\\langle word\\rangle ');await page.keyboard.press('Control+z');assert.equal(await source(),'word');
  await page.keyboard.press('Control+A');await page.keyboard.type('\\');await page.keyboard.type('lagnle');await page.keyboard.press('Escape');assert.equal(await source(),'word');assert.equal(await page.locator('#surroundBox').isVisible(),false);
  await page.keyboard.type('(');assert.equal(await source(),'(word)');
  await clear();const pasted='\\begin{align}\nx&=1\\\\\n\\end{align}';await page.keyboard.insertText(pasted);assert.equal(await source(),pasted);
  await page.locator('#autoClose').click();await clear();await page.keyboard.type('${\\[');assert.equal(await source(),'${\\[');
  // The preference survives restarting the actual application.
  await page.evaluate(()=>window.desktop.call('autoClose',false));await app.evaluate(({app})=>app.exit(0));app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.locator('#autoClose').waitFor();assert.equal(await page.locator('#autoClose').getAttribute('aria-pressed'),'false');
  await page.locator('#autoClose').click();await clear();
  const document='\\documentclass{article}\n\\begin{document}\nTEXT\n\\end{document}';await page.keyboard.insertText(document);await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  await page.keyboard.type(' $\\sqrt{\\pi}$ \\(x\\) \\[x^2\\]');
  const expected=document.replace('TEXT','TEXT $\\sqrt{\\pi}$ \\(x\\) \\[x^2\\]');assert.equal(await source(),expected);
  await page.locator('#live').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preview updated')&&document.querySelector('#pages canvas'),null,{timeout:90000});
  assert.equal((await fs.readFile(root,'utf8')).replace(/\r\n/g,'\n'),expected);assert.deepEqual(errors,[]);
  const result={passed:true,directory:dir,pairs:12,selectionWrapping:true,editableDelimiterTypos:true,linkedEnvironmentRename:true,nestedEnvironments:true,emptyPairBackspace:true,escapedInput:true,bulkInsertion:true,togglePersists:true,autosaveAndCompiledPreview:true};await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){console.error(await page.locator('#status').textContent().catch(()=>''),await page.locator('#log').textContent().catch(()=>''));throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
