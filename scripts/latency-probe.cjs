const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
(async()=>{
 const source=await fs.readFile('fixtures/article/main.tex','utf8');const index=source.indexOf('\\begin{document}')+'\\begin{document}'.length;
 for(const [name,extra] of [
  ['map-once','\\pdfmapfile{pdftex.map}'],
  ['map-default-only','\\pdfmapline{+}'],
  ['map-once-fonts','\\pdfmapfile{pdftex.map}\n\\begingroup\\setbox0=\\hbox{\\normalfont x \\bfseries x \\itshape x $\\sum\\int x^2$}\\endgroup'],
 ]){
  const directory=path.resolve('.test-output','latency-'+name+'-'+randomUUID());await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'driver.tex'),source.slice(0,index)+'\n'+extra+'\n\\typeout{PERSISTENTTEXREADY}\n\\scrollmode\\read-1 to\\warmGo\n\\nonstopmode\\input{body.tex}\n');
  await fs.writeFile(path.join(directory,'body.tex'),source.slice(index));
  const start=performance.now();let ready=0,log='';const chunks=[];
  const child=spawn('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape','-jobname=main','driver.tex'],{cwd:directory,windowsHide:true});
  const timeout=setTimeout(()=>child.kill(),15000);
  child.stdout.on('data',chunk=>{log+=chunk;chunks.push({ms:Math.round(performance.now()-(ready||start)),text:chunk.toString()});if(!ready&&log.includes('PERSISTENTTEXREADY')){ready=performance.now();child.stdin.end('\n');}});
  child.stderr.on('data',chunk=>log+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timeout);
  await fs.writeFile(path.join(directory,'profile.json'),JSON.stringify(chunks,null,2));console.log(JSON.stringify({name,code,readyMs:Math.round(ready-start),bodyMs:Math.round(performance.now()-ready),directory}));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
