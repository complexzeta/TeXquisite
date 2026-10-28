const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {ResidentCompiler}=require('../dist/resident');
const text=pdf=>cp.execFileSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8',windowsHide:true}).replace(/\s+/g,' ').trim();

test('Unresolved references retain the resident compiler and editable local checkpoint',{timeout:90000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const prefix='\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\nSee chapter \\ref{missing}.\n\n',region='Editable words.\n\n',suffix='\\end{document}\n',source=prefix+region+suffix,signal=new AbortController().signal,logs=[],project={characterMapping:true};
 const compile=s=>compiler.compile(s,signal,30000,s=>logs.push(s),project);
 const pdf=await compile(source);assert.ok(pdf);assert.match(text(pdf),/chapter \?\?/);assert.match(compiler.diagnosticLog,/undefined references/);assert.ok(compiler.lastTiming.passes<=2);
 const edited=source.replace('Editable words.','Editable words again.');assert.ok(await compile(edited));assert.equal(compiler.lastTiming.preambleRebuilt,false);
 const nextRegion='Editable words again.\n\n',range={from:prefix.length,to:prefix.length+nextRegion.length};
 await compiler.prepareRegion(edited,range,signal,30000,s=>logs.push(s),project);
 const local='Editable words again immediately.\n\n',out=await compiler.previewRegionFlow(prefix+local+suffix,{from:prefix.length,to:prefix.length+local.length},signal,10000,s=>logs.push(s),project,true,undefined,true);
 assert.match(text(out.pdf),/again immediately/);assert.equal(out.timing.documentComplete,false);assert.ok(!logs.some(s=>s.startsWith('Resident fallback:')));
 const resolved=await compile(source.replace(suffix,'\\refstepcounter{section}\\label{missing}\n'+suffix));assert.ok(resolved);assert.match(text(resolved),/chapter 1/);assert.doesNotMatch(text(resolved),/\?\?/);
});

test('A requested external bibliography still falls back instead of accepting missing citations',{timeout:60000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());const logs=[];
 const pdf=await compiler.compile('\\documentclass{article}\n\\begin{document}\nA citation \\cite{unavailable}.\n\\bibliographystyle{plain}\n\\bibliography{missing-database}\n\\end{document}\n',new AbortController().signal,30000,s=>logs.push(s));
 assert.equal(pdf,undefined);assert.match(logs.join(''),/External bibliography or index processing is required/);
});
