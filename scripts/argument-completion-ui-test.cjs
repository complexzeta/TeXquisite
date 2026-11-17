const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('argument-completion'),profile=path.join(directory,'profile'),root=path.join(directory,'main.tex');
 await fs.mkdir(profile);
 const source='\\newcommand{\\triple}[3]{#1#2#3}\n\\DeclareRobustCommand{\\sstirling}{\\genfrac\\{\\}{0pt}{}}\n\\DeclareRobustCommand{\\fstirling}{\\genfrac[]{0pt}{}}\n\\DeclareRobustCommand{\\eulerian}{\\genfrac\\langle\\rangle{0pt}{}}\n';
 await fs.writeFile(root,source);
 await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({root,active:root,docs:[{path:root,text:source,diskHash:createHash('sha256').update(source).digest('hex'),dirty:false,eol:'\n'}],onSave:false,liveVersion:2,engine:'pdflatex',latexmk:'latexmk',autoClose:true}));
 const executablePath=process.env.PERSISTENT_TEX_EXECUTABLE;
 const app=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'},timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.cm-content').waitFor({state:'attached'});
  await page.evaluate(()=>document.querySelector('#settingsDialog').close());
  const read=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
  await page.locator('.cm-content').focus();await page.keyboard.press('Control+End');
  await page.keyboard.type('\\frac{a');await page.keyboard.press('Tab');await page.keyboard.type('b');await page.keyboard.press('Tab');
  assert.equal(await read(),source+'\\frac{a}{b}');
  await page.keyboard.type('\\triple{one');await page.keyboard.press('Tab');await page.keyboard.type('two');await page.keyboard.press('Tab');await page.keyboard.type('three');await page.keyboard.press('Tab');
  assert.equal(await read(),source+'\\frac{a}{b}\\triple{one}{two}{three}');
  await page.keyboard.insertText('\\[x\\]');
  await page.evaluate(()=>{const view=document.querySelector('.cm-content').cmTile.root.view,at=view.state.doc.toString().lastIndexOf('\\[');view.dispatch({selection:{anchor:at,head:at+2}});});
  await page.keyboard.type('\\begin{align}');
  assert.equal(await read(),source+'\\frac{a}{b}\\triple{one}{two}{three}\\begin{align}x\\end{align}');
  await page.evaluate(()=>{const view=document.querySelector('.cm-content').cmTile.root.view,at=view.state.doc.toString().lastIndexOf('\\begin{align}');view.dispatch({selection:{anchor:at,head:at+'\\begin{align}'.length}});});
  await page.keyboard.type('\\[');
  assert.equal(await read(),source+'\\frac{a}{b}\\triple{one}{two}{three}\\[x\\]');
  await page.keyboard.press('Control+End');
  for(const name of ['sstirling','fstirling','eulerian']){
   await page.keyboard.type('\\'+name+'{n');await page.keyboard.press('Tab');await page.keyboard.type('k');await page.keyboard.press('Tab');
   assert.ok((await read()).endsWith('\\'+name+'{n}{k}'));
  }
  for(const [open,close]of [['\\[','\\]'],['\\(','\\)'],['\\begin{align*}','\\end{align*}']]){
   await page.keyboard.press('Control+End');const previous=await read();
   await page.keyboard.insertText('$a+b$');
   await page.evaluate(at=>{const view=document.querySelector('.cm-content').cmTile.root.view;view.dispatch({selection:{anchor:at,head:at+1}});},previous.length);
   await page.keyboard.press('Backspace');await page.keyboard.type(open);
   assert.equal(await read(),previous+open+'a+b'+close);
   await page.evaluate(({at,length})=>{const view=document.querySelector('.cm-content').cmTile.root.view;view.dispatch({selection:{anchor:at,head:at+length}});},{at:previous.length,length:open.length});
   await page.keyboard.press('Backspace');await page.keyboard.type('$');
   assert.equal(await read(),previous+'$a+b$');
  }
  console.log(JSON.stringify({passed:true,packaged:!!executablePath,keyboardTab:true,customArguments:true,mathConversion:true,reverseConversion:true,forwardingCommands:true,dollarConversions:true}));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
