import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {execFile} from 'node:child_process';
import {formatFingerprint} from './format-fingerprint';
import {FORMAT_FINGERPRINT_POLICY} from './format-fingerprint';
import {formatKey,preparedFormat} from './format-cache';
export type Probe=(exe:string,args:string[],env:NodeJS.ProcessEnv)=>Promise<string>;
export const probe:Probe=(exe,args,env)=>new Promise((resolve,reject)=>execFile(exe,args,{env,windowsHide:true,timeout:10000,maxBuffer:1024*1024},(error,out,err)=>error?reject(Error((err||error.message).trim())):resolve(out.trim())));
export interface Installation {bin:string;label:string;tools:Record<string,string>;}
export interface ToolchainReport {requested?:string;selected?:string;installations:Installation[];ready:boolean;distribution:string;tools:{name:string;path?:string;ok:boolean;detail:string}[];packages:{name:string;found:boolean}[];fast:{preparable?:boolean;available:boolean;reason:string;mismatches:string[];resources?:{root:string;files:Record<string,string>;formatManifest?:string}};issues:string[];}
const exists=async(file:string)=>(await fs.stat(file).catch(()=>undefined))?.isFile()??false;
export function toolEnvironment(bin:string|undefined,base:NodeJS.ProcessEnv=process.env){const env={...base},prior=base.PATH??base.Path??'';for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];return {...env,PATH:bin?bin+path.delimiter+prior:prior};}
export async function installationBins(folder:string){
 const candidates=[folder,path.join(folder,'bin','windows'),path.join(folder,'bin','win32'),path.join(folder,'bin'),path.join(folder,'miktex','bin','x64'),path.join(folder,'miktex','bin')];
 const addArchitectures=async(root:string)=>{for(const child of (await fs.readdir(path.join(root,'bin'),{withFileTypes:true}).catch(()=>[])).filter(e=>e.isDirectory()))candidates.push(path.join(root,'bin',child.name));};
 await addArchitectures(folder);
 for(const child of (await fs.readdir(folder,{withFileTypes:true}).catch(()=>[])).filter(e=>e.isDirectory()&&/^\d{4}(?:basic)?$/.test(e.name)).sort((a,b)=>b.name.localeCompare(a.name))){const root=path.join(folder,child.name);candidates.push(path.join(root,'bin','windows'),path.join(root,'bin','win32'));await addArchitectures(root);}
 return candidates;
}
export function defaultInstallationRoots(env:NodeJS.ProcessEnv,platform=process.platform){
 if(platform==='darwin')return ['/Library/TeX/texbin','/usr/local/texlive','/opt/homebrew/bin','/usr/local/bin'];
 if(platform!=='win32')return ['/usr/bin','/usr/local/bin','/usr/local/texlive','/opt/texlive'];
 return [path.join(env.SystemDrive??'C:','texlive'),path.join(env.ProgramFiles??'C:/Program Files','MiKTeX'),path.join(env.LOCALAPPDATA??'','Programs','MiKTeX'),path.join(env.LOCALAPPDATA??'','MiKTeX')];
}
export async function discoverInstallations(selected?:string,env:NodeJS.ProcessEnv=process.env,roots?:string[]){
 const defaults=defaultInstallationRoots(env);
 const candidates=[...(selected?await installationBins(selected):[]),...(env.PATH??env.Path??'').split(path.delimiter).map(p=>p.replace(/^"|"$/g,'')),...(await Promise.all((roots??defaults).map(installationBins))).flat()];
 const seen=new Set<string>(),installations:Installation[]=[];
 for(const candidate of candidates){if(!candidate)continue;const bin=path.resolve(candidate),key=process.platform==='win32'?bin.toLowerCase():bin;if(seen.has(key))continue;seen.add(key);const tools:Record<string,string>={};
  await Promise.all(['pdflatex','kpsewhich','latexmk','xelatex','lualatex','latex','synctex'].map(async name=>{const file=path.join(bin,name+(process.platform==='win32'?'.exe':''));if(await exists(file))tools[name]=file;}));
  if(tools.kpsewhich||tools.pdflatex)installations.push({bin,label:bin,tools});
 }
 return installations;
}
export async function inspectToolchain(options:{cache?:string;selected?:string;engine?:string;latexmk?:string;metadata:string;env?:NodeJS.ProcessEnv;roots?:string[];run?:Probe}){
 const base=options.env??process.env,run=options.run??probe,installations=await discoverInstallations(options.selected,base,options.roots);
 const pathKey=(p:string)=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 const selectedBins=options.selected?(await installationBins(options.selected)).map(pathKey):[];
 const chosen=options.selected?installations.find(i=>selectedBins.includes(pathKey(i.bin))):installations.find(i=>i.tools.pdflatex&&i.tools.kpsewhich&&i.tools.latexmk)??installations[0];
 const report:ToolchainReport={requested:options.selected,selected:chosen?.bin,installations,ready:false,distribution:'Not found',tools:[],packages:[],fast:{available:false,reason:'Select a TeX installation to check fast preview compatibility.',mismatches:[]},issues:[]};
 if(options.selected&&!chosen){report.issues.push('No TeX executables found in the selected folder. Select its bin folder or installation folder.');return report;}
 const env=toolEnvironment(chosen?.bin,base),engine=options.engine??'pdflatex';
 report.tools=await Promise.all([...new Set([engine,'kpsewhich','latexmk'])].map(async name=>{
  const exe=name==='latexmk'&&options.latexmk&&options.latexmk!=='latexmk'?options.latexmk:chosen?.tools[name];
  if(!exe){report.issues.push('Missing '+name+'.');return {name,ok:false,detail:'Not found in the selected installation.'};}
  try{const version=await run(exe,['--version'],env);if(name==='kpsewhich')report.distribution=/miktex/i.test(version)?'MiKTeX':/kpathsea|tex live/i.test(version)?'TeX Live':'Other TeX distribution';return {name,path:exe,ok:true,detail:version.split(/\r?\n/).find(line=>name==='latexmk'?/latexmk/i.test(line):/pdfTeX|MiKTeX|kpathsea/i.test(line))??version.split(/\r?\n/)[0]};}
  catch(error){const detail=String(error).slice(0,600);report.issues.push(name+' could not run. '+detail);return {name,path:exe,ok:false,detail};}
 }));
 report.ready=report.tools.every(t=>t.ok)&&report.tools.length===new Set([engine,'kpsewhich','latexmk']).size;
 const kpse=chosen?.tools.kpsewhich;if(!kpse||!report.tools.find(t=>t.name==='kpsewhich')?.ok)return report;
 report.packages=await Promise.all(['article.cls','amsmath.sty','graphicx.sty','tikz.sty'].map(async name=>({name,found:!!(await run(kpse,[name],env).catch(()=>''))})));for(const p of report.packages)if(!p.found)report.issues.push('Package file not found: '+p.name+'. Install it with your TeX distribution’s package manager.');
 if(!report.packages.find(p=>p.name==='article.cls')?.found)report.ready=false;
 if(engine!=='pdflatex'||options.latexmk&&options.latexmk!=='latexmk'){report.fast.reason='This engine or custom latexmk command uses native compilation. Select pdfLaTeX and the default latexmk command for fast preview.';return report;}
 try{
  const metadata=JSON.parse(await fs.readFile(options.metadata,'utf8')),root=await run(kpse,['-var-value=TEXMFDIST'],env);
  if(!await exists(path.join(root,'ls-R')))throw Error('The fast preview currently requires a TeX Live package tree with an ls-R index. MiKTeX is available only through native compilation and remains experimental.');
  const files:Record<string,string>={},actual:Record<string,string>={},checked=await Promise.all(Object.entries(metadata.fingerprints).map(async([name,expected])=>{const file=await run(kpse,[name],env).catch(()=>''),bytes=file?await fs.readFile(file):undefined;return {name,file,match:!!bytes&&formatFingerprint(name,bytes,metadata.fingerprintPolicy)===expected,actual:bytes?formatFingerprint(name,bytes,FORMAT_FINGERPRINT_POLICY):undefined};}));for(const item of checked){if(item.actual){actual[item.name]=item.actual;files[item.name]=item.file;}if(!item.match)report.fast.mismatches.push(item.name);}
  const fontMap=await run(kpse,['pdftex.map'],env).catch(()=>'');if(fontMap)files['pdftex.map']=fontMap;
  report.fast.available=!report.fast.mismatches.length;
  report.fast.preparable=report.ready&&checked.every(c=>!!c.actual);
  const missingInputs=checked.filter(c=>!c.actual).map(c=>c.name);
  if(missingInputs.length){report.fast.available=false;report.fast.reason='Native compilation only: fast-format preparation requires these missing TeX inputs: '+missingInputs.join(', ')+'. Install their packages with your TeX distribution’s package manager, then check the installation again.';return report;}
  if(report.fast.available)report.fast.resources={root,files};
  if(!report.fast.available&&options.cache&&report.fast.preparable){const manifest=path.join(options.cache,formatKey(path.dirname(options.metadata),chosen!.bin,actual),'manifest.json');if(preparedFormat(manifest,path.dirname(options.metadata),chosen!.bin,env)){report.fast.available=true;report.fast.resources={root,files,formatManifest:manifest};report.fast.reason='A prepared fast-preview format matches this installation.';return report;}}
  report.fast.reason=report.fast.available?'Fast local preview is compatible with this installation.':'Native compilation only: the installed LaTeX format differs from the bundled fast-preview format ('+report.fast.mismatches.join(', ')+'). Documents can still compile, but local updates may be slower. Choose Prepare matching fast preview to try creating a local format for this installation. Unsupported kernels can continue using native compilation.';
 }catch(error){report.fast.reason='Native compilation only: '+String(error).replace(/^Error: /,'');}
 return report;
}
