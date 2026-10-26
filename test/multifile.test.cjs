const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ArtifactStore,BuildController,hash,runProcess}=require('../dist/core');
const {ResidentCompiler}=require('../dist/resident');
const signal=new AbortController().signal;
async function pdfText(pdf,directory,name){
 await fs.writeFile(path.join(directory,name+'.pdf'),pdf);
 await runProcess('pdftotext',[name+'.pdf',name+'.txt'],directory,30000,signal,()=>{});
 return fs.readFile(path.join(directory,name+'.txt'),'utf8');
}
test('Chapter snapshots reuse the preamble, invalidate consumed body checkpoints, and rebuild real preamble dependencies',async t=>{
 const directory=path.resolve('.test-output','multifile-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());let revision=0;
 const source='\\documentclass{book}\n\\usepackage{amsmath,tikz,hyperref}\n\\input{settings}\n\\IfFileExists{optional.tex}{\\input{optional}}{}\n\\begin{document}\n\\input{one}\n\\input{two}\n\\end{document}\n';
 let files={'settings.tex':'\\def\\Greeting{Alpha}\n','one.tex':'\\chapter{First}\\label{first}\n\\Greeting. ChapterOne original.\\[\\sqrt{\\pi}\\]\n','two.tex':'\\chapter{Second}\nChapterTwo original. See \\ref{first}.\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n'};
 const compile=async()=>{
  const pdf=await compiler.compile(source,signal,60000,()=>{},{resources:Object.entries(files).map(([name,text])=>[name,Buffer.from(text)]),resourceKey:String(++revision),environmentKey:'book-project'});
  assert.ok(pdf);return pdf;
 };
 await compile();await compile();assert.equal(compiler.lastTiming.preambleRebuilt,false);
 files['two.tex']=files['two.tex'].replace('original','RevisedTwo');let pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,false,'A body-only chapter edit must reuse the preamble');
 let text=await pdfText(pdf,directory,'two');assert.match(text,/RevisedTwo/);assert.match(text,/See 1/);
 files['one.tex']=files['one.tex'].replace('original','RevisedOne');pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,false);text=await pdfText(pdf,directory,'one');assert.match(text,/RevisedOne/);assert.match(text,/RevisedTwo/);
 files['one.tex']+='\\undefinedDraftCommand\n';await assert.rejects(compile(),/Build failed/);files['one.tex']=files['one.tex'].replace('\\undefinedDraftCommand','Repaired');pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,false);assert.match(await pdfText(pdf,directory,'repair'),/Repaired/);
 files['settings.tex']='\\def\\Greeting{Beta}\n';pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,true);assert.match(await pdfText(pdf,directory,'settings'),/Beta/);
 files['optional.tex']='\\def\\Greeting{Gamma}\n';pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,true,'Adding a previously missing preamble input must invalidate its existence check');assert.match(await pdfText(pdf,directory,'optional'),/Gamma/);
 delete files['optional.tex'];pdf=await compile();assert.equal(compiler.lastTiming.preambleRebuilt,true);assert.match(await pdfText(pdf,directory,'removed'),/Beta/);
 // A chapter-number change must converge references before publication.
 files['one.tex']='\\chapter{Inserted}\n'+files['one.tex'];pdf=await compile();assert.match(await pdfText(pdf,directory,'numbered'),/See 2/);
 // Compare this multi-file book with the selected native TeX installation.
 await fs.writeFile(path.join(directory,'main.tex'),source);for(const [name,text]of Object.entries(files))await fs.writeFile(path.join(directory,name),text);
 for(let pass=0;pass<2;pass++)await runProcess('pdflatex',['-interaction=nonstopmode','-halt-on-error','main.tex'],directory,60000,signal,()=>{});
 await runProcess('pdftotext',['main.pdf','native.txt'],directory,30000,signal,()=>{});assert.equal(await fs.readFile(path.join(directory,'numbered.txt'),'utf8'),await fs.readFile(path.join(directory,'native.txt'),'utf8'));
});

test('Queued root and chapter buffers publish one consistent revision while originals change independently',async t=>{
 const directory=path.resolve('.test-output','multifile-snapshot-'+randomUUID()),project=path.join(directory,'source');await fs.mkdir(project,{recursive:true});
 const root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex'),source='\\documentclass{article}\n\\begin{document}\nRootSnapshot.\n\\input{chapter}\n\\end{document}\n';await fs.writeFile(root,source);await fs.writeFile(chapter,'DiskOnly.');
 const store=new ArtifactStore(path.join(directory,'store')),logs=[];let controller,second,release,prepared;
 const ready=new Promise(resolve=>prepared=resolve),gate=new Promise(resolve=>release=resolve);
 const controllerViewer={prepare:async()=>{if(!second){prepared();await gate;}},commit:()=>{},discard:()=>{}};
 controller=new BuildController(store,controllerViewer,()=>{},s=>logs.push(s));t.after(()=>controller.cancel());
 const options={root,engine:'pdflatex',executable:'latexmk',timeoutMs:60000,sourceText:source,sourceFiles:{[chapter]:'CapturedOne.'},automatic:true};
 const first=controller.request(options);await ready;
 const next={...options,sourceText:source.replace('RootSnapshot','RootSecond'),sourceFiles:{[chapter]:'CapturedTwo.'}};second=controller.request(next);
 next.sourceFiles[chapter]='MutatedAfterRequest.';await fs.writeFile(chapter,'ExternalDiskChange.');release();await Promise.all([first,second]);
 const nav=await store.navigation(controller.current);assert.equal(nav.sources[chapter],hash('CapturedTwo.'));assert.equal(nav.sources[root],hash(next.sourceText));
 const text=await pdfText(await fs.readFile(store.pdf(controller.current)),directory,'captured');assert.match(text,/RootSecond/);assert.match(text,/CapturedTwo/);assert.doesNotMatch(text,/ExternalDiskChange|MutatedAfterRequest/);
 assert.equal(await fs.readFile(chapter,'utf8'),'ExternalDiskChange.');assert.doesNotMatch(logs.join(''),/Native compilation|Resident fallback/);
});
