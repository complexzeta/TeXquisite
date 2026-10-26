import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/archive-builds.ps1')],{stdio:'inherit',windowsHide:true});
const root=path.resolve('.research/swift-source/pdftex.wasm');
const sdk=path.resolve('.research/emsdk');
const python=process.env.PYTHON||'python';
const emcc=path.join(sdk,'upstream/emscripten/emcc.py');
const env={...process.env,EM_CONFIG:path.join(sdk,'checkpoint.emscripten'),EMCC_CORES:'3'};
const lto=process.env.PERSISTENT_TEX_ENGINE_LTO==='1',directory=lto?'checkpoint-lto-build':'checkpoint-build';
const flags=['-O3',...(lto?['-flto']:[]),'-sUSE_ZLIB=1','-sUSE_LIBPNG=1','-Wno-parentheses-equality','-Wno-pointer-sign','-DWEBASSEMBLY_BUILD','-I.','-Itex','-Ipdftexdir','-Ixpdf','-Ixpdf/xpdf','-Ixpdf/goo'];
function run(args){return new Promise((resolve,reject)=>{const child=spawn(python,[emcc,...args],{cwd:root,env,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('emcc exited '+code)));});}
await fs.mkdir(path.join(root,directory),{recursive:true});
// A flag/header change must not reuse stale objects. Commit this signature only
// after a successful link, so interrupted builds cannot bless a partial cache.
const signature=createHash('sha256').update(JSON.stringify(flags));
async function headers(folder=''){
 for(const entry of (await fs.readdir(path.join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=path.join(folder,entry.name);
  if(entry.isDirectory()&&!entry.name.startsWith('checkpoint-'))await headers(name);
  else if(entry.isFile()&&entry.name.endsWith('.h'))signature.update(name).update(await fs.readFile(path.join(root,name)));
 }
}
await headers();const fingerprint=signature.digest('hex'),stamp=path.join(root,directory,'build-signature');
let reusable=false;try{reusable=(await fs.readFile(stamp,'utf8'))===fingerprint;}catch{}
const makefile=await fs.readFile(path.join(root,'Makefile'),'utf8');
const files=[...new Set([...makefile.matchAll(/(?:\b[\w-]+\/)*[\w-]+\.(?:c|cc)\b/g)].map(m=>m[0]))];
const objects=[];
// Initialize the port/cache once before parallel compiler jobs use it.
await run([...flags,'-c','md5.c','-o',directory+'/md5-bootstrap.o']);
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{
 while(cursor<files.length){
  const file=files[cursor++],object=directory+'/'+file.replaceAll('/','-')+'.o';objects.push(object);
  try{const [a,b]=await Promise.all([fs.stat(path.join(root,file)),fs.stat(path.join(root,object))]);if(reusable&&b.mtimeMs>a.mtimeMs)continue;}catch{}
  console.log('Compiling '+file);await run([...flags,'-c',file,'-o',object]);
 }
}));
await run([...flags,...objects,'xpdf/xpdf.a','--js-library','library.js','--pre-js','pre.js',...(process.env.PERSISTENT_TEX_ENGINE_PROFILE_NAMES==='1'?['--profiling-funcs']:[]),
 '-sEXPORTED_FUNCTIONS=["_compileBibtex","_compileLaTeX","_compileFormat","_main","_setMainEntry","_persistentEnableCheckpoint","_persistentSelectInput","_persistentSelectedOffset","_persistentEnableCharacters","_persistentResume","_persistentCheckpointOffset","_persistentCheckpointKind","_persistentRegionConfigure","_persistentFlowConfigure","_persistentRegionPdf","_persistentPageConfigure","_persistentPagePdf","_persistentPageFirst","_persistentPageLast","_persistentPageCheckpoint","_persistentPrefixConfigure","_persistentPrefixReload","_persistentPrefixPrevious","_persistentFontMemoryCapacity","_persistentFontMemoryUsed","_persistentMathGuardVersion","_persistentMathGuardCount"]',
 '-sEXPORTED_RUNTIME_METHODS=["cwrap","FS"]','-sNO_EXIT_RUNTIME=1','-sALLOW_MEMORY_GROWTH=1','-o',directory+'/checkpoint-pdftex.js']);
await fs.writeFile(stamp,fingerprint);
console.log('Checkpoint engine built ('+(lto?'whole-program optimization':'separate modules')+').');
