const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {WarmCompiler,splitSimpleArticle}=require('../dist/warm');
const {runProcess,hash}=require('../dist/core');

test('Warm path excludes dependency and cross-reference documents',async()=>{
 const source=await fs.readFile('fixtures/article/main.tex','utf8');
 assert.ok(splitSimpleArticle(source));
 for(const command of ['\\input{chapter}','\\label{a}','\\ref{a}','\\usepackage{tikz}','\\bibliography{refs}'])assert.equal(splitSimpleArticle(source.replace('\\begin{document}',command+'\n\\begin{document}')),undefined);
});

test('Preloaded whole-document output renders identically to ordinary pdfLaTeX',async t=>{
 const dir=path.resolve('.test-output','equivalence-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const source=await fs.readFile('fixtures/article/main.tex','utf8');await fs.writeFile(path.join(dir,'main.tex'),source);
 const warm=new WarmCompiler(path.join(dir,'pool'));t.after(()=>warm.stop());
 const signal=new AbortController().signal;
 const bytes=await warm.compile(source,'pdflatex','main',signal,30000,()=>{});assert.ok(bytes);await fs.writeFile(path.join(dir,'warm.pdf'),bytes);
 await runProcess('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex'],dir,30000,signal,()=>{});
 for(const name of ['main','warm'])await runProcess('pdftoppm',['-r','72',name+'.pdf',name],dir,30000,signal,()=>{});
 for(const page of [1,2])assert.equal(hash(await fs.readFile(path.join(dir,`warm-${page}.ppm`))),hash(await fs.readFile(path.join(dir,`main-${page}.ppm`))));
});
