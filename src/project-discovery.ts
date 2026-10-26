import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID} from 'node:crypto';
import type {BuildOptions} from './core';
import {runWithPreviewCompatibility} from './postscript-compat';
import {snapshotSignature,snapshotDirectorySignature,snapshotPathKey,DiscoveredInputs} from './snapshot';
type Runner=(exe:string,args:string[],cwd:string,timeout:number,signal:AbortSignal,log:(text:string)=>void,env?:NodeJS.ProcessEnv)=>Promise<void>;
const ignored=/\.(aux|log|fls|fdb_latexmk|synctex(?:\.gz)?|toc|out|lof|lot|blg|bcf|run\.xml|nav|snm|vrb|tmp)$/i;
const excluded=new Set(['.git','node_modules','.research','.test-output','release','dist','build']);
const inside=(base:string,file:string)=>{const relative=path.relative(base,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?relative:undefined;};
const safe=(name:string)=>!path.isAbsolute(name)&&!name.includes(':')&&name.split(/[\\/]/).every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&!excluded.has(part));
// This output is solely an input-discovery probe. It is never a PDF candidate.
// All writes and subprocesses use the isolated directory, never the manuscript cwd.
export async function discoverProject(options:BuildOptions,parent:string,signal:AbortSignal,run:Runner,log:(text:string)=>void){
 const requested=path.resolve(parent),storage=process.platform==='win32'&&requested.length>120?path.join(os.tmpdir(),'ptx-probes'):requested;
 await fs.mkdir(storage,{recursive:true});if((await fs.lstat(storage)).isSymbolicLink())throw Error('Dependency discovery storage must be an ordinary directory.');
 const base=await fs.realpath(storage),directory=path.resolve(base,'discovery-'+randomUUID()),work=path.join(directory,'work'),out=path.join(directory,'out');
 if(path.dirname(directory)!==base)throw Error('Invalid dependency discovery directory.');
 await fs.mkdir(work,{recursive:true});await fs.mkdir(out);
 const source=path.dirname(options.root),rootName=path.basename(options.root),job=path.basename(options.root,'.tex'),folders=[...new Set([source,...(options.supportFolders??[])].map(folder=>path.resolve(folder)))];
 const rootSource=options.sourceText??await fs.readFile(options.root,'utf8');
 try{
  // Draft overlays have the same virtual paths and precedence as the real snapshot.
  const overlays=new Set<string>();
  for(const folder of folders)for(const [file,text]of Object.entries(options.sourceFiles??{})){
   const name=inside(folder,path.resolve(file));if(!name||!safe(name)||overlays.has(name))continue;overlays.add(name);const destination=path.join(work,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,text);
  }
  await fs.writeFile(path.join(work,rootName),rootSource);
  // Metadata freezes discovery's observed namespace without copying its assets.
  // Used inputs are checked again before accepting the discovered graph.
  const expected:Record<string,string>={},directories:Record<string,string>={};let entries=0;
  const index=async(folder:string)=>{
   if(Object.hasOwn(directories,folder))return;const stat=await fs.lstat(folder);if(!stat.isDirectory()||stat.isSymbolicLink())return;directories[folder]=await snapshotDirectorySignature(folder);
   for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(entry.name.startsWith('.')||excluded.has(entry.name)||entry.isSymbolicLink()||ignored.test(entry.name))continue;const file=path.join(folder,entry.name);if(++entries>50000)throw Error('Project discovery exceeds 50000 directory entries. Choose narrower support folders.');if(entry.isDirectory())await index(file);else if(entry.isFile())expected[snapshotPathKey(file)]=snapshotSignature(await fs.lstat(file));}
  };
  for(const folder of folders)await index(folder);
  // Do not let old job auxiliary files in a search folder poison discovery.
  for(const extension of ['aux','out','toc','lof','lot','nav','snm','vrb','bbl'])for(const target of [work,out])await fs.writeFile(path.join(target,job+'.'+extension),'');
  const search=[work,...folders].map(folder=>folder.replace(/\\/g,'/')).join(path.delimiter)+path.delimiter;
  const env:NodeJS.ProcessEnv={};for(const name of ['TEXINPUTS','BIBINPUTS','BSTINPUTS','TFMFONTS','VFFONTS','T1FONTS','ENCFONTS','TEXFONTMAPS','TEXPSHEADERS'])env[name]=search+(process.env[name]??'');
  const mode:Record<string,string>={pdflatex:'-pdf',xelatex:'-xelatex',lualatex:'-lualatex',latex:'-pdfps'};if(!mode[options.engine])throw Error('Unsupported discovery engine.');
  const args=['-norc',mode[options.engine],'-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-no-shell-escape','-outdir='+out,'./'+rootName];
  log('Discovering project inputs in an isolated, unpublished build.\n');
  let probeError:unknown;
  try{await runWithPreviewCompatibility(run,options.executable,args,work,options.timeoutMs,signal,log,env);}catch(error){if(signal.aborted)throw error;probeError=error;log('Input discovery stopped before a complete document; checking the recorded inputs. '+String(error)+'\n');}
  if(probeError&&/\\usepackage(?:\[[^\]]*\])?\{tkz-euclide\}/.test(rootSource)&&/^[\t ]*\\usetkzobj\{all\}[\t ]*(?:%[^\r\n]*)?\r?$/m.test(rootSource)){
   const transcript=await fs.readFile(path.join(out,job+'.log'),'utf8').catch(()=>'');
   if(/I can't find file [`']tkz-obj-[^\r\n]+\.tex/.test(transcript)){
    await fs.writeFile(path.join(work,rootName),rootSource.replace(/^[\t ]*\\usetkzobj\{all\}[\t ]*(?:%[^\r\n]*)?\r?$/m,'% Compatibility: obsolete tkz object loader omitted.'));
    log('Discovery compatibility: retrying the retired tkz-euclide object loader in the probe copy.\n');
    try{await runWithPreviewCompatibility(run,options.executable,args,work,options.timeoutMs,signal,log,env);probeError=undefined;}catch(error){if(signal.aborted)throw error;probeError=error;log('Discovery compatibility probe stopped: '+String(error)+'\n');}
   }
  }
  if(signal.aborted)throw Error('Build cancelled.');
  const names=new Set<string>(),observed=new Set<string>();
  const accept=async(file:string)=>{
   file=path.resolve(file);if(observed.has(file))return;observed.add(file);
   for(const folder of folders){const name=inside(folder,file);if(!name||!safe(name)||ignored.test(name)||name===job+'.pdf')continue;
    let stat;try{stat=await fs.lstat(file);}catch{continue;}if(!stat.isFile()||stat.isSymbolicLink())throw Error('Discovered input is not an ordinary source file: '+name);
    if(expected[snapshotPathKey(file)]!==snapshotSignature(stat))throw Error('A project input changed during discovery. Build again after it stops changing.');
    const relative=inside(await fs.realpath(folder),await fs.realpath(file));if(!relative)throw Error('Discovered input leaves its allowed folder: '+name);
    names.add(name);if(names.size>10000)throw Error('Discovered project contains more than 10000 inputs.');
   }
  };
  const record=await fs.readFile(path.join(out,job+'.fls'),'utf8').catch(()=>undefined);if(!record)throw Error('The toolchain did not record project inputs. '+(probeError?String(probeError):'Check the dependency discovery log.'));
  let cwd=work;
  for(const line of record.split(/\r?\n/)){if(line.startsWith('PWD '))cwd=path.resolve(line.slice(4));else if(line.startsWith('INPUT ')){const name=line.slice(6).replace(/^"|"$/g,'');await accept(path.resolve(cwd,name));}}
  // Bibliography processors do not necessarily appear in the TeX recorder.
  const aux=await fs.readFile(path.join(out,job+'.aux'),'utf8').catch(()=>'');
  for(const match of aux.matchAll(/\\(bibdata|bibstyle)\{([^}]+)\}/g))for(const item of match[2].split(','))for(const folder of folders)await accept(path.join(folder,item+(path.extname(item)?'':match[1]==='bibdata'?'.bib':'.bst')));
  // latexmk also records inputs read by bibliography/conversion subprocesses.
  const database=await fs.readFile(path.join(out,job+'.fdb_latexmk'),'utf8').catch(()=>'');
  for(const match of database.matchAll(/^\s+"([^"\r\n]+)"\s+\d/gm)){const file=match[1];if(path.isAbsolute(file))await accept(file);else{
    const name=path.normalize(file);if(!safe(name))continue;
    const overlay=await fs.lstat(path.join(work,name)).catch(()=>undefined),output=await fs.lstat(path.join(out,name)).catch(()=>undefined);if(overlay?.isFile()||output?.isFile())continue;
    for(const folder of folders)await accept(path.join(folder,name));
  }}
  for(const [folder,signature]of Object.entries(directories))if(await snapshotDirectorySignature(folder)!==signature)throw Error('The project folder changed during discovery. Build again after it stops changing.');
  names.add(rootName);log(`Discovered ${names.size} project inputs; the probe PDF will not be displayed.\n`);
  return {names:[...names],expected,directories,complete:!probeError} satisfies DiscoveredInputs;
 }finally{
  // Only this owned, unique child of the controller cache may be removed.
  if(path.dirname(path.resolve(directory))!==base||!path.basename(directory).startsWith('discovery-'))throw Error('Invalid discovery cleanup directory.');
  await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
}
export const missingProjectInput=(text:string)=>/I can't find file|File [`'"]?[^\r\n]+not found|couldn't open (?:style|database) file|Cannot find (?:file|input)|can't find (?:file|header)/i.test(text);
