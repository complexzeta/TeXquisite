const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {emptyDocumentPreview}=require('../dist/empty-document'),{ResidentCompiler}=require('../dist/resident'),{PDFiumLibrary}=require('@hyzyla/pdfium'),{PDFDocument}=require('pdf-lib'),{testDirectory}=require('../scripts/test-artifacts.cjs');
test('Only empty literal document bodies receive a line-preserving, idempotent compilation placeholder',()=>{
 for(const body of ['', '\n\n', '\n% a comment\n \t\n']){
  const source='\\documentclass{article}\n\\begin{document}'+body+'\\end{document}\n',copy=emptyDocumentPreview(source);
  assert.notEqual(copy,source);assert.equal(copy.split('\n').length,source.split('\n').length);assert.equal(emptyDocumentPreview(copy),copy);
 }
 for(const source of ['\\begin{document}x\\end{document}','\\begin{document}\\%\\end{document}','% \\begin{document}\ntext\\end{document}','\\begin{verbatim}\n\\begin{document}\\end{document}\n\\end{verbatim}','\\\\begin{document}\\end{document}','\\begin{document}\n% \\end{document}'])assert.equal(emptyDocumentPreview(source),source);
 const example='\\newcommand{\\example}{\\begin{document}\\end{document}}\n';
 assert.equal(emptyDocumentPreview(example+'\\begin{document}Actual content.\\end{document}'),example+'\\begin{document}Actual content.\\end{document}');
 assert.ok(emptyDocumentPreview(example+'\\begin{document}\\end{document}').startsWith(example),'Only the real empty document changes');
 assert.equal(emptyDocumentPreview('\\begin{document}'+example+'\\end{document}'),'\\begin{document}'+example+'\\end{document}');
});
test('Empty, comments-only and restored documents complete with one page in resident and native builds',{timeout:120000},async()=>{
 const directory=testDirectory('empty-document'),compiler=new ResidentCompiler(),library=await PDFiumLibrary.init(),signal=new AbortController().signal,report={passed:false,samples:[]};
 try{for(const [name,head,body,blank]of [
  ['original','','Original lecture text.',false],['empty','','',true],['comments','','% No lecture content.\n',true],['restored','','Restored lecture text.',false],
  ['custom-paper','\\usepackage[paperwidth=18cm,paperheight=24cm]{geometry}\n','',true],['begin-hook','\\AtBeginDocument{Begin hook content.}\n','',false],['end-hook','\\AtEndDocument{End hook content.}\n','',false]
 ]){
  const source='\\documentclass{article}\n'+head+'\\begin{document}\n\n'+body+'\n\n\\end{document}\n',started=performance.now();let log='';
  const pdf=await compiler.compile(source,signal,60000,s=>log+=s,{characterMapping:true});assert.ok(pdf,log);assert.equal((await PDFDocument.load(pdf)).getPageCount(),1);
  const folder=path.join(directory,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'main.tex'),emptyDocumentPreview(source));fs.writeFileSync(path.join(folder,'resident.pdf'),pdf);
  cp.execFileSync('pdflatex',['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','main.tex'],{cwd:folder,windowsHide:true,timeout:30000,stdio:'pipe'});
  const a=await library.loadDocument(pdf),b=await library.loadDocument(fs.readFileSync(path.join(folder,'main.pdf')));
  try{const ap=[...a.pages()],bp=[...b.pages()];assert.equal(ap.length,1);assert.equal(bp.length,1);const ar=await ap[0].render({scale:1}),br=await bp[0].render({scale:1});assert.deepEqual([ar.width,ar.height],[br.width,br.height]);assert.equal(ap[0].getText().replace(/\s/g,''),bp[0].getText().replace(/\s/g,''));assert.equal(ap[0].getText().trim()==='',blank,name);if(blank)assert.ok(ar.data.every(n=>n===255),'Blank page has no page number or ink');ap[0].close();bp[0].close();}finally{a.destroy();b.destroy();}
  report.samples.push({name,ms:performance.now()-started,passes:compiler.lastTiming.passes,blank});
 }
 report.passed=true;
 }finally{compiler.stop();library.destroy();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,directory,samples:report.samples}));}
});
