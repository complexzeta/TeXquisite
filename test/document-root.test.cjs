const {test}=require('node:test'),assert=require('node:assert/strict'),{standaloneTex,previewRootForDocument}=require('../dist/document-root');
const doc=(path,text)=>({path,text});
test('Standalone TeX detection accepts whitespace, comments and pre-class commands',()=>{
 for(const text of ['\\documentclass{article}','% header\n\\documentclass % class\n [11pt] % options\n {article}','\\RequirePackage{iftex}\\documentclass{book}'])assert.ok(standaloneTex(doc('main.TEX',text)),text);
});
test('A standalone document can load its class through an external preamble',()=>{assert.ok(standaloneTex(doc('book.tex','\\input{shared-preamble}\n\\begin{document}\nText.\\end{document}')));});
test('Comments, escaped commands, command prefixes and support files do not become roots',()=>{
 for(const text of ['% \\documentclass{article}\nChapter text.','\\\\documentclass{article}','\\documentclassExample{article}'])assert.equal(standaloneTex(doc('chapter.tex',text)),false,text);
 assert.equal(standaloneTex(doc('local.sty','\\documentclass{article}')),false);
});
test('Literal TeX examples in chapter text do not select a new root',()=>{
 for(const text of ['Example: \\verb|\\documentclass{article}|.','\\begin{verbatim}\n\\documentclass{article}\n\\end{verbatim}','\\begin{filecontents*}{example.tex}\n\\documentclass{article}\n\\end{filecontents*}'])assert.equal(standaloneTex(doc('chapter.tex',text)),false);
});
test('A selected standalone owns its preview even when an older root association exists',()=>{assert.equal(previewRootForDocument('alpha/main.tex',doc('beta/main.tex','\\documentclass{article}'),'alpha/main.tex'),'beta/main.tex');});
test('An included chapter restores its known parent across independent documents',()=>{assert.equal(previewRootForDocument('beta/main.tex',doc('alpha/chapter.tex','Chapter body.'),'alpha/main.tex'),'alpha/main.tex');assert.equal(previewRootForDocument('alpha/main.tex',doc('chapter.tex','Chapter body.')),'alpha/main.tex');});
test('Explicit source navigation preserves the current project, including standalone inputs',()=>{assert.equal(previewRootForDocument('main.tex',doc('subfile.tex','\\documentclass{subfiles}'),'other.tex',true),'main.tex');assert.equal(previewRootForDocument('main.tex',undefined),'main.tex');});
