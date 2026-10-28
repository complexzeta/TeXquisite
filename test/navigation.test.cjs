const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ArtifactStore,BuildController,hash,runProcess}=require('../dist/core');
const {forward,backward}=require('../dist/navigation-query');
const {nativeForward,nativeBackward}=require('../dist/native-navigation');

test('Resident line navigation follows included chapters, survives repair, and matches PDF text positions',async t=>{
 const directory=require('../scripts/test-artifacts.cjs').testDirectory('navigation'),project=path.join(directory,'source'),root=path.join(project,'main.tex');await fs.mkdir(path.join(project,'chapters'),{recursive:true});
 const one=path.join(project,'chapters','one.tex'),two=path.join(project,'chapters','two.tex');
 const source='\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nRoot introduction.\n\\input{chapters/one}\n\\newpage\n\\input{chapters/two}\n\\end{document}\n';
 await fs.writeFile(root,source);await fs.writeFile(one,'\\section{First chapter}\nAlphaOnly source marker.\n\\[\\sqrt{\\pi}+1\\]\n');await fs.writeFile(two,'\\section{Second chapter}\nBetaOnly source marker.\n');
 const store=new ArtifactStore(path.join(directory,'store')),logs=[];
 const controller=new BuildController(store,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},s=>logs.push(s));t.after(()=>controller.cancel());
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:60000,sourceText:source,automatic:true};await controller.request(options);
 const good=controller.current;assert.ok(good,logs.join(''));const nav=await store.navigation(good);assert.ok(nav,'Resident engine must produce navigation metadata');
 for(const [file,page,word]of [[one,1,'AlphaOnly'],[two,2,'BetaOnly']]){
  const row=forward(nav,file,2);assert.ok(row,file);assert.equal(row[1],2);assert.equal(row[2],page);assert.equal(backward(nav,page,row[3]+2,row[4]+2)[0],file);
  assert.equal(nav.sources[file],hash(await fs.readFile(file)));
 }
 const html=path.join(directory,'boxes.html');await runProcess('pdftotext',['-bbox',store.pdf(good),html],directory,30000,new AbortController().signal,()=>{});
 const boxes=await fs.readFile(html,'utf8');
 for(const [file,word]of [[one,'AlphaOnly'],[two,'BetaOnly']]){
  const match=boxes.match(new RegExp('<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">'+word+'</word>'));assert.ok(match,word);
  const row=forward(nav,file,2);assert.ok(Math.abs(row[3]-Number(match[1]))<1);assert.ok(Math.abs(row[4]-Number(match[2]))<1,'Map top must match actual PDF glyph position');
 }
 await controller.request({...options,sourceText:source.replace('Root introduction.','$\\undefinedNavigationDraft$')});assert.equal(controller.current.id,good.id);
 const changed=source.replace('Root introduction.','A revised introduction.');await controller.request({...options,sourceText:changed});assert.equal(controller.current.sourceHash,hash(changed));
 assert.equal((await store.navigation(controller.current)).sources[root],hash(changed));assert.equal(forward(await store.navigation(controller.current),two,2)[2],2);
 const recovered=new ArtifactStore(store.directory),bundle=(await recovered.history())[0];assert.ok(await recovered.navigation(bundle));
 await fs.writeFile(path.join(path.dirname(store.pdf(bundle)),'navigation.json'),'corrupt');assert.equal(await recovered.navigation(bundle),undefined);assert.equal((await recovered.history())[0].id,bundle.id,'Broken navigation must not erase the PDF');
});

test('Native SyncTeX navigates captured source paths in both directions',async t=>{
 const directory=require('../scripts/test-artifacts.cjs').testDirectory('native-navigation'),root=path.join(directory,'main.tex');
 const source='\\documentclass{article}\n\\begin{document}\nNativeAlpha source marker.\n\\newpage\nNativeBeta source marker.\n\\end{document}\n';await fs.writeFile(root,source);
 const executable=process.platform==='win32'?'latexmk.exe':(process.env.PATH.split(path.delimiter).map(dir=>path.join(dir,'latexmk')).find(file=>require('node:fs').existsSync(file)));
 const store=new ArtifactStore(path.join(directory,'.store')),logs=[],controller=new BuildController(store,{prepare:async()=>{},commit:()=>{},discard:()=>{}},()=>{},s=>logs.push(s));t.after(()=>controller.cancel());
 // Keep the store outside the captured project tree.
 await controller.request({root,engine:'pdflatex',executable,timeoutMs:60000,sourceText:source});assert.ok(controller.current,logs.join(''));assert.equal(controller.current.synctex,true);
 const nav=await store.navigation(controller.current);assert.ok(nav?.nativeInputs);
 const row=await nativeForward(store.pdf(controller.current),nav,root,5,1);assert.ok(row);assert.equal(row[2],2);
 const back=await nativeBackward(store.pdf(controller.current),nav,2,row[3]+3,row[4]+2);assert.ok(back);assert.equal(back[0],root);assert.ok(Math.abs(back[1]-5)<=1);
 const [obsolete,latest]=await Promise.all([nativeForward(store.pdf(controller.current),nav,root,3,1),nativeForward(store.pdf(controller.current),nav,root,5,1)]);
 assert.equal(obsolete,undefined,'A superseded navigation query must not keep running or return an old target');assert.equal(latest[2],2);
});
