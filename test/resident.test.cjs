const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {testDirectory}=require('../scripts/test-artifacts.cjs');
const {ResidentCompiler,splitResidentArticle}=require('../dist/resident');
const {runProcess,hash,validatePdf}=require('../dist/core');
const {PDFDocument,rgb}=require('pdf-lib');
test('Resident checkpoints preserve edits, reject errors, and match native TeX pixels and text',async t=>{
 const directory=testDirectory('resident');
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const original=await fs.readFile('fixtures/article/main.tex','utf8'),signal=new AbortController().signal;
 const compile=async source=>{const bytes=await compiler.compile(source,signal,30000,()=>{});assert.ok(bytes,'Resident engine must be available for this test');return bytes;};
 await compile(original);
 await compile(original.replace('Keep your place','Second-page edit'));
 await compile(original.replace('Keep your place','Second-page edit 2'));
 const late=original.replace('Keep your place','Second-page edit 3');
 await compile(late);
 await assert.rejects(compile(late.replace('\\end{document}','\\undefinedAfterPdfWasOpened\n\\end{document}')),/Build failed/);
 assert.equal(await validatePdf(await compile(late)),2,'Repair must reconnect a deleted partial PDF to the saved stream');
 // Invalidate a checkpoint on a later page by editing its earlier source prefix.
 const earlier=original.replace('A useful invariant','Earlier changed invariant');
 await compile(earlier);
 await assert.rejects(compile(earlier.replace('\\end{document}','\\undefinedResidentFailure\n\\end{document}')),/Build failed/);
 await compile(earlier.replace('Keep your place','Repaired later page'));
 await assert.rejects(compile(original.replace('\\begin{document}','\\undefinedPreambleFailure\n\\begin{document}')),/Build failed/);
 const final=original.replace('Keep your place','Final later page').replace('A useful invariant','Final earlier invariant');
 await fs.writeFile(path.join(directory,'resident.pdf'),await compile(final));
 await fs.writeFile(path.join(directory,'main.tex'),final);
 await runProcess('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex'],directory,30000,signal,()=>{});
 for(const name of ['main','resident']){
  await runProcess('pdftoppm',['-r','72',name+'.pdf',name],directory,30000,signal,()=>{});
  await runProcess('pdftotext',[name+'.pdf',name+'.txt'],directory,30000,signal,()=>{});
 }
 for(const page of [1,2])assert.equal(hash(await fs.readFile(path.join(directory,`resident-${page}.ppm`))),hash(await fs.readFile(path.join(directory,`main-${page}.ppm`))));
 assert.equal(await fs.readFile(path.join(directory,'resident.txt'),'utf8'),await fs.readFile(path.join(directory,'main.txt'),'utf8'));
 const alternate='\\documentclass{article}\n\\catcode`!=0\n!begin{document}\nAn alternate escape character.\n!end{document}\n';
 assert.equal(await validatePdf(await compile(alternate)),1,'TeX itself must recognize document start, including changed input catcodes');
});
test('Resident cancellation interrupts a running engine and permits a fresh worker',async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const source='\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n';
 await compiler.compile(source,new AbortController().signal,30000,()=>{});
 const cancel=new AbortController();setTimeout(()=>cancel.abort(),150);
 await assert.rejects(compiler.compile(source.replace('Hello','\\loop\\iftrue\\repeat'),cancel.signal,30000,()=>{}),/cancelled/);
 assert.ok(await compiler.compile(source,new AbortController().signal,30000,()=>{}));
});
test('Resident dispatch accepts arbitrary classes and packages without a whitelist',()=>{
 const source='\\documentclass{article}\n\\begin{document}\nHello\\end{document}';
 assert.ok(splitResidentArticle(source));
 for(const command of ['\\input{part}','\\label{a}','\\catcode`a=12','\\usepackage{tikz}'])assert.ok(splitResidentArticle(source.replace('Hello',command)));
 assert.ok(splitResidentArticle(source.replace('{article}','{custom-unlisted-class}')));
 assert.equal(splitResidentArticle(source.replace('Hello','\\PersistentTeXCheckpoint')),undefined);
});

test('Custom classes, TikZ, recursive inputs, dynamic preamble dependencies and references retain native output',async t=>{
 const directory=testDirectory('general-resident'),support=path.join(directory,'support');await fs.mkdir(support,{recursive:true});
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());const logs=[];
 const graphic=await PDFDocument.create();graphic.addPage([16,16]).drawRectangle({x:0,y:0,width:16,height:16,color:rgb(0.8,0.1,0.2)});
 const files=[['custom.cls',Buffer.from('\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesClass{custom}\n\\LoadClass{article}\n\\RequirePackage{tikz,hyperref,graphicx,fancyvrb,currfile}\n')],['sections/part.tex',Buffer.from('\\section{A section}\\label{sec:test}\nAn included section.\n')],['figures/box.pdf',await graphic.save({useObjectStreams:false})]];
 const helper=path.join(support,'dynamic-helper.tex');await fs.writeFile(helper,'\\newcommand{\\HelperText}{Alpha}\n');
 const source='\\def\\ChosenClass{custom}\\documentclass{\\ChosenClass}\n\\def\\helpername{dynamic-helper.tex}\n\\input{\\helpername}\n\\newcommand{\\StartThisDocument}{\\begin{document}}\\StartThisDocument\nJob \\jobname, helper \\HelperText. Current file: \\currfilename.\n\\input{sections/part}\nSee section \\ref{sec:test}.\n\\includegraphics[width=12pt]{figures/box.pdf}\n\\begin{tikzpicture}\\draw[blue,thick] (0,0) rectangle (2,1);\\end{tikzpicture}\n\\par\\VerbatimInput[fontsize=\\tiny]{\\jobname.tex}\n\\end{document}\n';
 const context={resources:files,resourceKey:'custom-class-resources',supportFolders:[support],jobName:'custom-job'};
 const compile=text=>compiler.compile(text,new AbortController().signal,60000,s=>logs.push(s),context);
 assert.ok(await compile(source));
 const revised=source.replace('An included section.','Unused root edit').replace('See section','Now see section');
 assert.ok(await compile(revised));
 await fs.writeFile(helper,'\\newcommand{\\HelperText}{Beta}\n');
 const pdf=await compile(revised);assert.ok(pdf);
 await fs.writeFile(path.join(directory,'resident.pdf'),pdf);
 for(const [name,bytes]of files){await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),bytes);}
 await fs.copyFile(helper,path.join(directory,'dynamic-helper.tex'));await fs.writeFile(path.join(directory,'custom-job.tex'),revised);
 const signal=new AbortController().signal;
 for(let pass=0;pass<2;pass++)await runProcess('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','custom-job.tex'],directory,60000,signal,()=>{});
 for(const name of ['custom-job','resident']){
  await runProcess('pdftotext',[name+'.pdf',name+'.txt'],directory,30000,signal,()=>{});
  await runProcess('pdftoppm',['-r','72',name+'.pdf',name],directory,30000,signal,()=>{});
 }
 const text=await fs.readFile(path.join(directory,'resident.txt'),'utf8');assert.match(text,/helper Beta/);assert.match(text,/Job custom-job/);assert.match(text,/section 1/);
 assert.equal(text,await fs.readFile(path.join(directory,'custom-job.txt'),'utf8'));
 assert.equal(hash(await fs.readFile(path.join(directory,'resident-1.ppm'))),hash(await fs.readFile(path.join(directory,'custom-job-1.ppm'))));
 assert.match(logs.join(''),/"passes":2/);
});
