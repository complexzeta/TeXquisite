const {ResidentCompiler}=require('../dist/resident');
const {SourceMirror}=require('../dist/snapshot');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
(async()=>{
 const root=path.resolve(process.argv[2]),source=(await fs.readFile(root,'utf8')).replace(/\r\n/g,'\n');
 const directory=path.resolve('.test-output','checkpoint-probe-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const supportFolders=(process.env.PERSISTENT_TEX_SUPPORT_FOLDERS||'').split(path.delimiter).filter(Boolean);
 const input=source.replace(/^[\t ]*\\usetkzobj\{all\}[\t ]*(?:%[^\r\n]*)?$/m,'% Compatibility: obsolete tkz object loader omitted.');
 const project={...await new SourceMirror().capture(root,path.join(directory,'mirror'),supportFolders,input),supportFolders,jobName:path.basename(root,'.tex')};
 const compiler=new ResidentCompiler(),results=[];
 try{
  for(const [name,text]of [ ['initial',input],['unchanged',input],['first body character',input.replace('Testing testing','XTesting testing')],['math character',input.replace('\\frac1n','\\frac2n')],['new paragraph',input.replace('\\end{document}','A new paragraph.\n\\end{document}')]]){
   let log='';const began=performance.now();const pdf=await compiler.compile(text,new AbortController().signal,120000,s=>log+=s,project);
   results.push({name,totalMs:performance.now()-began,pdfBytes:pdf?.length,timings:log.split('\n').filter(s=>s.startsWith('Timing: resident')).map(s=>JSON.parse(s.slice(17)))});
   await fs.writeFile(path.join(directory,name.replaceAll(' ','-')+'.log'),log);
   await fs.writeFile(path.join(directory,name.replaceAll(' ','-')+'.navigation.jsonl'),compiler.navigation);
  }
 }finally{compiler.stop();}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({directory,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
