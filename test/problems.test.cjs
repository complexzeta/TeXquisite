const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseWarnings}=require('../dist/diagnostics');
const inputs=[{file:'ROOT',aliases:['main.tex','/work/main.tex']},{file:'CHAPTER',aliases:['chapter.tex','/work/chapter.tex']}];
test('Warnings join wrapped messages, retain captured include locations, and refuse unknown files',()=>{
 const warnings=parseWarnings("(main.tex (chapter.tex\nLaTeX Warning: Citation `missing' on page 1 undefined on input\n line 3.\n\n)\nLaTeX Warning: Reference `label' on page 1 undefined on input line 8.\n\n(/tex/unknown.sty\nPackage example Warning: A warning on input line 12.\n\n",inputs);
 assert.equal(warnings.length,3);assert.equal(warnings[0].severity,'warning');assert.equal(warnings[0].file,'CHAPTER');assert.equal(warnings[0].line,3);assert.equal(warnings[1].file,'ROOT');assert.equal(warnings[1].line,8);assert.equal(warnings[2].file,undefined);
});
test('Missing bibliography warnings are deduplicated and summary rerun notices do not duplicate source warnings',()=>{
 const result=parseWarnings("LaTeX Warning: There were undefined references.\n\nLaTeX Warning: Label(s) may have changed. Rerun.\n\n",inputs,"Bib file(s) not found in search path:\n  refs.bib\nLatexmk: next pass\nBib file(s) not found in search path:\n  refs.bib\n");assert.equal(result.length,1);assert.equal(result[0].message,'Bibliography file not found: refs.bib');assert.equal(result[0].file,undefined);
});
test('Successful full builds publish final-pass warnings and clear repaired bibliography problems',{timeout:150000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{BuildController,ArtifactStore}=require('../dist/core');
 const dir=path.resolve('.test-output','problems-core-'+randomUUID());await fs.mkdir(dir,{recursive:true});const root=path.join(dir,'main.tex'),source='\\documentclass{article}\n\\begin{document}\nSee \\cite{entry}.\n\\bibliographystyle{plain}\\bibliography{references}\n\\end{document}\n';await fs.writeFile(root,source);
 const publications=[],logs=[],controller=new BuildController(new ArtifactStore(path.join(dir,'artifacts')),{prepare:async()=>{},commit:()=>{},discard:()=>{},problems:(issues,editId)=>publications.push({issues,editId})},()=>{},s=>logs.push(s));t.after(()=>controller.dispose());
 const options={root,sourceText:source,engine:'pdflatex',executable:'latexmk',timeoutMs:60000,editId:'missing'};await controller.request(options);assert.ok(controller.current,logs.join('').slice(-6000));assert.ok(publications.at(-1).issues.some(i=>/Bibliography file not found/.test(i.message)));assert.ok(publications.at(-1).issues.some(i=>/Citation/.test(i.message)&&i.file===root&&i.line===3&&i.sourceHash));
 await fs.writeFile(path.join(dir,'references.bib'),'@book{entry,author={Example Author},title={Repaired Bibliography},year={2026},publisher={Test Press}}\n');await controller.request({...options,editId:'repaired'});assert.ok(controller.current);assert.equal(publications.at(-1).editId,'repaired');assert.deepEqual(publications.at(-1).issues,[],'Transient first-pass citation warnings must be absent');
 const clean=source.replace('See \\cite{entry}.','See \\ref{later}. \\section{Resolved}\\label{later}').replace('\\bibliographystyle{plain}\\bibliography{references}','');await controller.request({...options,sourceText:clean,editId:'resident'});assert.equal(controller.current.sourceHash,require('../dist/core').hash(clean));assert.deepEqual(publications.at(-1).issues,[],'Resident warnings must come from the converged pass');
});
