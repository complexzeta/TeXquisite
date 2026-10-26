import {parentPort,workerData} from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
import {formatFingerprint,FORMAT_FINGERPRINT_POLICY} from './format-fingerprint';
const options=workerData as {assets:string;installation:string;files:Record<string,string>;fingerprints:Record<string,string>;root:string};
async function run(){
 const engineJs=fs.readFileSync(path.join(options.assets,'pdftex.js')),wasmBytes=fs.readFileSync(path.join(options.assets,'pdftex.wasm')),engine=createHash('sha256').update(engineJs).update(wasmBytes).digest('hex');
 const dependencies=new Map<string,{name:string;file:string;hash:string;rawHash:string}>(),missing=new Set<string>(),lookups=new Map<string,string>();let format:Buffer|undefined;
 const kpse=path.join(options.installation,process.platform==='win32'?'kpsewhich.exe':'kpsewhich');
 const index=new Map<string,string>(),overrides=new Map<string,string>();let indexedDirectory='';
 for(const line of fs.readFileSync(path.join(options.root,'ls-R'),'utf8').split(/\r?\n/)){
  if(line.startsWith('./')&&line.endsWith(':'))indexedDirectory=line.slice(2,-1);
  else if(line&&/^(tex|fonts|web2c)\//.test(indexedDirectory)&&!line.startsWith('%')&&(!index.has(line)||indexedDirectory.startsWith('tex/latex/')))index.set(line,path.join(options.root,indexedDirectory,line));
 }
 for(let pass=0;pass<3;pass++){
 dependencies.clear();missing.clear();lookups.clear();format=undefined;
 const resolve=(name:string)=>{if(options.files[name])return options.files[name];if(overrides.has(name))return overrides.get(name)!;if(index.has(name))return index.get(name)!;if(lookups.has(name))return lookups.get(name)!;let file='';try{file=execFileSync(kpse,[name],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();}catch{}lookups.set(name,file);return file;};
 const read=(name:string)=>{const file=resolve(name);if(!file){missing.add(name);return;}const bytes=fs.readFileSync(file);if(bytes.length>64*1024*1024)throw Error('A TeX input exceeds the preparation limit.');dependencies.set(name,{name,file,hash:formatFingerprint(name,bytes,FORMAT_FINGERPRINT_POLICY),rawHash:createHash('sha256').update(bytes).digest('hex')});return bytes;};
 for(const [name,expected]of Object.entries(options.fingerprints)){const bytes=read(name);if(!bytes||formatFingerprint(name,bytes,FORMAT_FINGERPRINT_POLICY)!==expected)throw Error('A kernel/configuration input changed before preparation: '+name);}
 class LocalRequest{
  url='';status=301;headers:Record<string,string>={};response:ArrayBuffer=new ArrayBuffer(0);
  open(_method:string,url:string){this.url=url;}
  getResponseHeader(name:string){return this.headers[name.toLowerCase()]??null;}
  send(){const parts=new URL(this.url).pathname.split('/'),name=decodeURIComponent(parts.at(-1)!),kind=parts.at(-2);if(!name||name==='.'||name==='..'||name.startsWith('-')||/[\\/\0:]/.test(name))return;
   const bytes=name==='swiftlatexpdftex.fmt'?format:kind==='3'&&!path.posix.extname(name)?read(name+'.tfm'):read(name)??(!path.posix.extname(name)?read(name+'.tex'):undefined);if(!bytes)return;
   this.status=200;this.headers={fileid:name};this.response=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  }
 }
 let respond:((r:any)=>void)|undefined;
 const context=vm.createContext({console:{log(){},error(){},warn(){}},process,require,module:{exports:{}},__dirname:options.assets,TextDecoder,TextEncoder,WebAssembly,Buffer,setTimeout,clearTimeout,XMLHttpRequest:LocalRequest,wasmBytes:new Uint8Array(wasmBytes)});
 context.self=context;context.postMessage=(r:any)=>{const next=respond;respond=undefined;next?.(r);};const receive=()=>new Promise<any>(r=>respond=r),ready=receive();
 vm.runInContext(engineJs.toString('utf8').replace(/var Module\s*=\s*\{\};/,'var Module={wasmBinary:wasmBytes};'),context);await ready;
 let result=receive();context.onmessage({data:{cmd:'compileformat'}});let value=await result;if(value.status!==0||!value.pdf)throw Error('Installed LaTeX could not prepare a fast format. '+String(value.log??'').slice(-2000));format=Buffer.from(value.pdf);
 const formatNames=new Set(dependencies.keys()),formatMissing=[...missing];
 result=receive();context.onmessage({data:{cmd:'writefile',url:'main.tex',src:'\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nFast format check: $\\sqrt{\\pi}+\\frac{1}{2}$.\n\\end{document}\n'}});await result;context.onmessage({data:{cmd:'setmainfile',url:'main.tex'}});
 result=receive();context.onmessage({data:{cmd:'compilelatex'}});value=await result;if(value.status!==0||!value.pdf)throw Error('The prepared format failed its document check. '+String(value.log??'').slice(-2000));
 const pdf=await PDFDocument.load(Buffer.from(value.pdf));if(pdf.getPageCount()!==1)throw Error('The prepared format produced an invalid test document.');
 // Resolve positive inputs together after execution. If a user TeX tree
 // overrides an indexed file, repeat with the actual native search result.
 // This preserves selected-installation precedence without one process/input.
 const entries=[...dependencies.values()];let changed=false;
 for(let at=0;at<entries.length;at+=80){const group=entries.slice(at,at+80),resolved=execFileSync(kpse,group.map(d=>d.name),{encoding:'utf8',windowsHide:true,timeout:10000}).trim().split(/\r?\n/);if(resolved.length!==group.length)throw Error('Could not verify prepared-format input resolution.');
  for(let i=0;i<group.length;i++){const actual=resolved[i],d=group[i];if(createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==d.rawHash){overrides.set(d.name,actual);changed=true;}else d.file=actual;}
 }
 if(changed)continue;
 parentPort!.postMessage({engine,format,dependencies:entries.filter(d=>formatNames.has(d.name)),missing:formatMissing},[format.buffer as ArrayBuffer]);return;
 }
 throw Error('TeX resource overrides did not stabilize during format preparation.');
}
run().catch(error=>parentPort!.postMessage({error:String(error).slice(-2500)}));
