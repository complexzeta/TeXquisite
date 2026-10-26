const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
(async()=>{
 const directory=path.resolve('.test-output','warm-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const source=await fs.readFile('fixtures/article/main.tex','utf8');
 const index=source.indexOf('\\begin{document}')+'\\begin{document}'.length;
 const preamble=source.slice(0,index),body=source.slice(index);
 await fs.writeFile(path.join(directory,'driver.tex'),preamble+'\n\\typeout{PERSISTENTTEXREADY}\n\\scrollmode\\read-1 to\\warmGo\n\\nonstopmode\\input{body.tex}\n');
 await fs.writeFile(path.join(directory,'body.tex'),body);
 const start=performance.now();let ready=0,log='';
 const child=spawn('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','-jobname=main','driver.tex'],{cwd:directory,windowsHide:true});
 const timeout=setTimeout(()=>child.kill(),15000);
 child.stdout.on('data',chunk=>{
  log+=chunk;
  if(!ready&&log.includes('PERSISTENTTEXREADY')){ready=performance.now();child.stdin.write('\n');}
 });child.stderr.on('data',chunk=>log+=chunk);
 child.on('close',async code=>{
  clearTimeout(timeout);await fs.writeFile(path.join(directory,'probe.log'),log);
  console.log(JSON.stringify({code,readyMs:ready-start,bodyMs:performance.now()-ready,directory},null,2));
 });
})().catch(e=>{console.error(e);process.exitCode=1;});
