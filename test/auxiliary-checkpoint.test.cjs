const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {testDirectory}=require('../scripts/test-artifacts.cjs'),{ResidentCompiler}=require('../dist/resident'),{PDFiumLibrary}=require('@hyzyla/pdfium');

test('Pre-aux checkpoints replay references and hooks, reject changed early inputs, and retain native output',{timeout:240000},async()=>{
 const directory=testDirectory('auxiliary-checkpoint'),compiler=new ResidentCompiler(),library=await PDFiumLibrary.init(),report={passed:false,samples:[]};
 const signal=new AbortController().signal;
 const preamble='\\documentclass{article}\n\\usepackage{amsmath,hyperref}\n\\newcounter{startup}\n\\AtBeginDocument{\\stepcounter{startup}}\n';
 const document=(head,body)=>head+'\\begin{document}\n\n'+body+'\n\n\\end{document}\n';
 async function compare(name,source,project={}){
  const folder=path.join(directory,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'main.tex'),source);
  for(const [file,bytes]of project.resources??[])fs.writeFileSync(path.join(folder,file),bytes);
  for(let pass=0;pass<3;pass++)cp.execFileSync('pdflatex',['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','main.tex'],{cwd:folder,windowsHide:true,timeout:60000,stdio:'pipe'});
  let log='';const started=performance.now(),pdf=await compiler.compile(source,signal,60000,s=>log+=s,{characterMapping:true,...project});assert.ok(pdf,log);assert.doesNotMatch(log,/TXQ[0-9a-f]{32}[AB]/);
  fs.writeFileSync(path.join(folder,'resident.pdf'),pdf);
  const timing=compiler.lastTiming,sample={name,elapsedMs:performance.now()-started,timing};report.samples.push(sample);
  const left=await library.loadDocument(fs.readFileSync(path.join(folder,'main.pdf'))),right=await library.loadDocument(pdf);
  try{const a=[...left.pages()],b=[...right.pages()];assert.equal(a.length,b.length,name+' page count');
   for(let i=0;i<a.length;i++)try{
    assert.equal(a[i].getText().replace(/\s/g,''),b[i].getText().replace(/\s/g,''),name+' text');
    const ar=await a[i].render({scale:1}),br=await b[i].render({scale:1});assert.deepEqual([ar.width,ar.height],[br.width,br.height]);let different=0,total=0,max=0;
    for(let n=0;n<ar.data.length;n++){const delta=Math.abs(ar.data[n]-br.data[n]);if(delta)different++;total+=delta;max=Math.max(max,delta);}
    assert.ok(different/ar.data.length<=0.0002&&max<=64&&total/ar.data.length<=0.01,name+' pixels differ');
   }finally{a[i].close();b[i].close();}
  }finally{left.destroy();right.destroy();}
  console.log(JSON.stringify({name,ms:sample.elapsedMs,passes:timing.passes,early:timing.auxiliaryCheckpointReused}));return timing;
 }
 try{
  const body='Startup \\arabic{startup}.\\section{Alpha}\\label{alpha}\nSee section \\ref{alpha}.\n\\begin{figure}[h]\\centering A figure.\\caption{A caption}\\label{fig:a}\\end{figure}\nSee figure \\ref{fig:a}.';
  const original=await compare('labels',document(preamble,body));assert.ok(original.auxiliaryCheckpointReused);
  const deletion=await compare('bulk-deletion',document(preamble,'x'));assert.equal(deletion.passes,2);assert.equal(deletion.auxiliaryCheckpointReused,true);assert.equal(deletion.preambleRebuilt,false);
  const edit=await compare('small-edit',document(preamble,'xy'));assert.equal(edit.passes,1);assert.equal(edit.bodyCheckpointRebuilt,false);
  await compare('renumber',document(preamble,'Startup \\arabic{startup}.\\section{Earlier}\\section{Renamed}\\label{new} See \\ref{new}.'));
  await compare('changed-preamble',document(preamble.replace('{article}','[12pt]{article}'),'Startup \\arabic{startup}.\\section{Final}\\label{final} See \\ref{final}.'));
  const resourceHead=preamble+'\\input{helper.tex}\n';
  await compare('resource-original',document(resourceHead,'\\HelperWord'),{resources:[['helper.tex',Buffer.from('\\def\\HelperWord{Original}\n')]],resourceKey:'one'});
  const resource=await compare('resource-change',document(resourceHead,'\\HelperWord'),{resources:[['helper.tex',Buffer.from('\\def\\HelperWord{Changed}\n')]],resourceKey:'two'});assert.ok(resource.passTimings[0].preambleRebuilt);
  const earlyInput=preamble+'\\makeatletter\\InputIfFileExists{\\jobname.aux}{}{}\\makeatother\n';
  const guarded=await compare('early-aux-input',document(earlyInput,'\\section{Guarded}\\label{guard} See \\ref{guard}.'),{environmentKey:'early-input'});
  assert.ok(guarded.passTimings.every(pass=>!pass.auxiliaryCheckpointReused),'Aux read before checkpoint must force a reload');
  await compare('no-files',document(preamble+'\\nofiles\n','Startup \\arabic{startup}. No auxiliary files.'),{environmentKey:'nofiles'});
  const macro=preamble+'\\newcommand{\\StartDocument}{\\begin{document}}\n\\StartDocument\n\nMacro document.\\section{Macro}\\label{macro} See \\ref{macro}.\n\n\\end{document}\n';
  await compare('macro-document',macro,{environmentKey:'macro'});
  await assert.rejects(compiler.compile(macro.replace('Macro document.','\\UndefinedDraftCommand'),signal,60000,()=>{},{environmentKey:'macro'}),/Build failed/);
  await compare('repaired',macro.replace('Macro document.','Repaired document.'),{environmentKey:'macro'});
  report.passed=true;
 }finally{compiler.stop();library.destroy();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,directory}));}
});
