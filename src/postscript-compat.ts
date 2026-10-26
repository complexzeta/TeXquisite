import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type Runner=(exe:string,args:string[],cwd:string,timeout:number,signal:AbortSignal,log:(text:string)=>void,env?:NodeJS.ProcessEnv)=>Promise<void>;

// preview's dvips hook reads seven integers immediately after bop. Modern
// shipout hooks can put PGF/hyperref setup ahead of that special instead.
// Only relocate a unique, log-confirmed preview size record on every page.
export function reorderPreviewSizes(ps:string,texLog:string):string|undefined {
 if(!ps.includes('/preview@tightpage true def')||!ps.includes('7{currentfile token')||!ps.includes('/preview@version('))return;
 const borders=[...texLog.matchAll(/^Preview: Tightpage ((?:-?\d+ ){3}-?\d+)\s*$/gm)].map(m=>m[1]);
 if(!borders.length)return;
 const pages=[...ps.matchAll(/^%%Page: .+$/gm)];if(!pages.length)return;
 let result=ps.slice(0,pages[0].index),changed=false;
 for(let i=0;i<pages.length;i++){
  let page=ps.slice(pages[i].index,pages[i+1]?.index??ps.length);
  const bop=/\bTeXDict begin \d+ \d+ bop\b/.exec(page);if(!bop)return;
  const candidates=[...page.matchAll(/^(-?\d+(?: +-?\d+){6})[ \t]*\r?$/gm)].filter(m=>borders.some(border=>m[1].startsWith(border+' ')));
  if(candidates.length!==1)return;
  const size=candidates[0],at=bop.index+bop[0].length;
  if(size.index===undefined||size.index<at)return;
  if(page.slice(at,size.index).trim()){
   page=page.slice(0,size.index)+page.slice(size.index!+size[0].length);
   page=page.slice(0,at)+'\n'+size[1]+'\n'+page.slice(at);changed=true;
  }
  result+=page;
 }
 return changed?result:undefined;
}

export async function runWithPreviewCompatibility(run:Runner,exe:string,args:string[],cwd:string,timeout:number,signal:AbortSignal,log:(text:string)=>void,env?:NodeJS.ProcessEnv):Promise<void>{
 let transcript='';const start=performance.now();
 try{await run(exe,args,cwd,timeout,signal,text=>{transcript=(transcript+text).slice(-2_000_000);log(text);},env);return;}
 catch(error){
  if(signal.aborted||!args.includes('-pdfps')||!/Error: \/typecheck in --div--/.test(transcript)||!/ps2pdf: Command for 'ps2pdf' gave return code/.test(transcript))throw error;
  const outArg=args.find(arg=>arg.startsWith('-outdir=')),root=args.at(-1);
  if(!outArg||!root||!root.startsWith('./')||path.basename(root)!==root.slice(2))throw error;
  const out=path.resolve(cwd,outArg.slice(8)),base=path.basename(root,'.tex'),psFile=path.join(out,base+'.ps');
  const stat=await fs.lstat(psFile).catch(()=>undefined);if(!stat?.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw error;
  const original=await fs.readFile(psFile),texLog=await fs.readFile(path.join(out,base+'.log'),'utf8').catch(()=>'');
  const repaired=reorderPreviewSizes(original.toString('latin1'),texLog);if(!repaired)throw error;
  const remaining=timeout-(performance.now()-start);if(signal.aborted||remaining<=0)throw error;
  const candidate=path.join(out,base+'.preview-compat.ps');await fs.writeFile(candidate,Buffer.from(repaired,'latin1'));
  log('Compatibility: reordered misplaced preview page sizes before PostScript setup; source files are unchanged.\n');
  const converter=path.isAbsolute(exe)?path.join(path.dirname(exe),process.platform==='win32'?'ps2pdf.exe':'ps2pdf'):'ps2pdf';
  try{await run(converter,['-dALLOWPSTRANSPARENCY',candidate,path.join(out,base+'.pdf')],cwd,remaining,signal,log,env);}
  finally{await fs.rm(candidate,{force:true});}
 }
}
