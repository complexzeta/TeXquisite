// Cloud-only synthetic experiment. Never opens a desktop or a user profile.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.CI,'true');
const {ResidentCompiler}=require('../dist/resident'),resources=require('./retained-test-format.cjs').nativeResources();
assert.ok(resources);const directory=process.env.PERSISTENT_TEX_TEST_ARTIFACTS;assert.ok(path.isAbsolute(directory));fs.mkdirSync(directory,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),report={source:process.env.GITHUB_SHA,passed:false,trials:[]};
const fixtures=[
 {name:'inline',preamble:'',start:'',texts:['Alpha paragraph.','Beta paragraph with $x^2$.','Gamma words.','\nDelta paragraph.','Epsilon words.']},
 {name:'newline',preamble:'',start:'\n',texts:['Alpha paragraph.','Beta paragraph.','Gamma words.','Delta paragraph.','Epsilon words.']},
 {name:'hook-endline',preamble:'\\AtBeginDocument{\\endlinechar=-1}\n',start:'',texts:['Alpha paragraph.','Beta paragraph.','Gamma words.']},
 {name:'no-endline',preamble:'\\endlinechar=-1\n',start:'',texts:['Alpha paragraph.','Beta paragraph.','Gamma words.']},
 {name:'transformed-line',preamble:'',start:'',texts:['A^^6cpha paragraph.','B^^65ta paragraph.','Gamma words.']},
 {name:'changed-preamble',preamble:'\\newcommand{\\Prefix}{First}\n',start:'',texts:['Alpha \\Prefix.','Beta \\Prefix.','Gamma \\Prefix.'],change:true},
 {name:'line-number',preamble:'',start:'',texts:['Line \\the\\inputlineno.','\nLine \\the\\inputlineno.','Line \\the\\inputlineno.']},
 {name:'references',preamble:'',start:'',texts:['\\section{Alpha}\\label{a}See \\ref{a}.','\\section{Beta}\\label{a}See \\ref{a}.','\\section{Gamma}\\label{a}See \\ref{a}.']}
];
function nativeCheck(source,pdf,work){
 fs.mkdirSync(work,{recursive:true});fs.writeFileSync(path.join(work,'main.tex'),source);fs.writeFileSync(path.join(work,'resident.pdf'),pdf);
 const run=(cmd,args)=>cp.execFileSync(cmd,args,{cwd:work,timeout:30000,stdio:'pipe'});
 for(let i=0;i<2;i++)run('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex']);
 for(const name of ['main','resident']){run('pdftoppm',['-r','72',name+'.pdf',name]);run('pdftotext',[name+'.pdf',name+'.txt']);}
 assert.equal(fs.readFileSync(path.join(work,'resident.txt'),'utf8'),fs.readFileSync(path.join(work,'main.txt'),'utf8'));
 const pages=fs.readdirSync(work).filter(n=>/^main-\d+\.ppm$/.test(n));assert.ok(pages.length);assert.equal(fs.readdirSync(work).filter(n=>/^resident-\d+\.ppm$/.test(n)).length,pages.length);
 for(const file of pages)assert.equal(hash(fs.readFileSync(path.join(work,file))),hash(fs.readFileSync(path.join(work,file.replace('main-','resident-')))),'Native pixels: '+work);
 return pages.length;
}
(async()=>{try{
 for(const enabled of [false,true,false,true])for(const fixture of fixtures){
  process.env.PERSISTENT_TEX_PREAMBLE_READAHEAD=enabled?'1':'0';const compiler=new ResidentCompiler(resources),trial={enabled,fixture:fixture.name,edits:[]};report.trials.push(trial);
  try{for(let i=0;i<fixture.texts.length;i++){
   const preamble=fixture.change&&i>0?fixture.preamble.replace('First','Second'):fixture.preamble;
   const source='\\documentclass{article}\n'+preamble+'\\begin{document}'+fixture.start+fixture.texts[i]+'\n\nLater unchanged paragraph.\n\\end{document}\n';
   const start=performance.now(),pdf=await compiler.compile(source,new AbortController().signal,60000,()=>{},{characterMapping:true});assert.ok(pdf,compiler.diagnosticLog);
   const item={edit:i,elapsedMs:performance.now()-start,...compiler.lastTiming};trial.edits.push(item);
   item.nativePages=nativeCheck(source,pdf,path.join(directory,'scratch',String(report.trials.length)+'-'+i));
   fs.rmSync(path.join(directory,'scratch'),{recursive:true,force:true});
  }}finally{compiler.stop();}
 }
 const inline=report.trials.filter(t=>t.enabled&&t.fixture==='inline');assert.ok(inline.every(t=>t.edits.some(e=>e.preambleReadAhead)),'Experiment must actually exercise the native root-line descriptor');
 assert.ok(inline.every(t=>t.edits.slice(1).every(e=>!e.preambleRebuilt)),'Unread first-line edits must retain the preamble');
 for(const t of report.trials.filter(t=>t.fixture==='changed-preamble'))assert.equal(t.edits[1].preambleRebuilt,true,'Changed consumed preamble must invalidate');
 report.passed=true;
 }finally{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({passed:true,trials:report.trials.length,summary:report.trials.map(t=>({enabled:t.enabled,fixture:t.fixture,ms:t.edits.map(e=>Math.round(e.elapsedMs)),marks:t.edits.map(e=>e.preambleReadAheadMark),rebuilds:t.edits.map(e=>e.preambleRebuilt)}))}));
})().catch(e=>{console.error(e);process.exitCode=1;});
