const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {SourceMirror}=require('../dist/snapshot');
test('Pasted root resolves recursive support files, respects project overrides and keeps references inside allowed folders',async()=>{
 const base=path.resolve('.test-output','support-'+randomUUID()),source=path.join(base,'source'),support=path.join(base,'support'),output=path.join(base,'mirror');
 await fs.mkdir(source,{recursive:true});await fs.mkdir(support);
 const root=path.join(source,'main.tex');await fs.writeFile(root,'Old disk source');
 await fs.writeFile(path.join(source,'local.sty'),'Project override');await fs.writeFile(path.join(support,'local.sty'),'Wrong support override');
 await fs.writeFile(path.join(support,'custom.sty'),'\\input nested\n');await fs.writeFile(path.join(support,'nested.tex'),'\\input{../outside}\n');
 await fs.writeFile(path.join(base,'outside.tex'),'Do not copy this');await fs.writeFile(path.join(support,'unused.tex'),'Unrelated file');
 await fs.writeFile(path.join(support,'game10.tfm'),'Local font metric');await fs.writeFile(path.join(support,'figure.pdf'),'Named graphic');
 const text='\\documentclass{article}\n\\usepackage{local,custom}\n\\includegraphics{figure}\n';
 const mirror=new SourceMirror();await mirror.capture(root,output,[support],text);
 assert.equal(await fs.readFile(path.join(output,'main.tex'),'utf8'),text);
 assert.equal(await fs.readFile(path.join(output,'local.sty'),'utf8'),'Project override');
 assert.equal(await fs.readFile(path.join(output,'nested.tex'),'utf8'),'\\input{../outside}\n');
 assert.equal(await fs.readFile(path.join(output,'game10.tfm'),'utf8'),'Local font metric');
 assert.equal(await fs.readFile(path.join(output,'figure.pdf'),'utf8'),'Named graphic');
 await assert.rejects(fs.access(path.join(output,'outside.tex')));await assert.rejects(fs.access(path.join(output,'unused.tex')));
 await fs.writeFile(path.join(support,'nested.tex'),'Updated support contents');await mirror.capture(root,output,[support],text);
 assert.equal(await fs.readFile(path.join(output,'nested.tex'),'utf8'),'Updated support contents');
 await mirror.capture(root,output,[],text);await assert.rejects(fs.access(path.join(output,'custom.sty')));
 assert.equal(await fs.readFile(root,'utf8'),'Old disk source');
});


test('A captured set of open buffers overrides disk chapters and referenced support inputs without writing originals',async()=>{
 const base=path.resolve('.test-output','buffers-'+randomUUID()),source=path.join(base,'source'),support=path.join(base,'support'),output=path.join(base,'mirror');
 await fs.mkdir(source,{recursive:true});await fs.mkdir(support);
 const root=path.join(source,'main.tex'),chapter=path.join(source,'chapter.tex'),helper=path.join(support,'helper.tex'),fresh=path.join(source,'new.tex');
 await fs.writeFile(root,'Old root');await fs.writeFile(chapter,'Old chapter');await fs.writeFile(helper,'Old helper');
 const text='\\input{chapter}\\input{helper}\\input{new}';
 const mirror=new SourceMirror(),snapshot=await mirror.capture(root,output,[support],text,{[chapter]:'Captured chapter',[helper]:'Captured helper',[fresh]:'New unsaved chapter'});
 for(const [name,expected]of [['main.tex',text],['chapter.tex','Captured chapter'],['helper.tex','Captured helper'],['new.tex','New unsaved chapter']])assert.equal(await fs.readFile(path.join(output,name),'utf8'),expected);
 assert.equal(snapshot.origins['helper.tex'],helper);assert.equal(await fs.readFile(chapter,'utf8'),'Old chapter');assert.equal(await fs.readFile(helper,'utf8'),'Old helper');await assert.rejects(fs.access(fresh));
});

test('Custom class inheritance and local bibliography styles are captured recursively',async()=>{
 const base=path.resolve('.test-output','class-bibliography-'+randomUUID()),source=path.join(base,'source'),support=path.join(base,'support'),output=path.join(base,'mirror');await fs.mkdir(source,{recursive:true});await fs.mkdir(support);
 const root=path.join(source,'main.tex'),text='\\documentclass{custom}\n\\bibliography{references}\\bibliographystyle{local-style}\n';await fs.writeFile(root,text);await fs.writeFile(path.join(support,'custom.cls'),'\\LoadClassWithOptions{parent}\n\\RequirePackageWithOptions{local-package}\n');await fs.writeFile(path.join(support,'parent.cls'),'\\LoadClass{article}\n');await fs.writeFile(path.join(support,'local-package.sty'),'Local package');await fs.writeFile(path.join(support,'local-style.bst'),'Local bibliography style');await fs.writeFile(path.join(support,'references.bib'),'@book{example,title={Example}}');
 const snapshot=await new SourceMirror().capture(root,output,[support],text);for(const name of ['custom.cls','parent.cls','local-package.sty','local-style.bst','references.bib']){assert.equal(await fs.readFile(path.join(output,name),'utf8'),await fs.readFile(path.join(support,name),'utf8'));assert.equal(snapshot.origins[name],path.join(support,name));}
});
