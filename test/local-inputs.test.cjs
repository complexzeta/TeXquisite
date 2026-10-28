const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{LocalPreview}=require('../dist/local-preview');
const hash=b=>createHash('sha256').update(b).digest('hex'),signal=()=>new AbortController().signal;
test('Local preview invalidates disk dependencies and other open buffers before reusing a paragraph',{timeout:120000},async t=>{
 const directory=require('../scripts/test-artifacts.cjs').testDirectory('local-inputs');
 const root=path.join(directory,'main.tex'),style=path.join(directory,'local-input.sty'),styleText='\\ProvidesPackage{local-input}\n\\def\\ContextWord{First context}\n';
 const source='\\documentclass{article}\n\\usepackage{local-input}\n\\begin{document}\n\n\\ContextWord: target paragraph with ordinary words.\n\nFollowing paragraph.\n\\end{document}\n';await fs.writeFile(root,source);await fs.writeFile(style,styleText);
 const compiler=new ResidentCompiler();let readyResolve,readyReject,fallbackResolve,published=0;
 const ready=()=>new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const lane=new LocalPreview(async()=>true,async()=>{published++;return true;},id=>fallbackResolve?.(id),state=>{if(state==='ready')readyResolve?.();},message=>{if(message.includes('Local preview unavailable'))readyReject?.(Error(message));});t.after(()=>{lane.stop();compiler.stop();});
 const makeBasis=async(text,key,sourceFiles={})=>{
  const project={characterMapping:true,resources:[['local-input.sty',Buffer.from(text)]],resourceKey:key,environmentKey:'local-input-test',origins:{'local-input.sty':style}},pdf=await compiler.compile(source,signal(),60000,()=>{},project);
  return {source,compilerSource:source,project,pdf,bundle:{schema:1,id:randomUUID(),revision:1,root,engine:'pdflatex',completed:new Date().toISOString(),pdfHash:hash(pdf),sourceHash:hash(source),pages:1,synctex:false},options:{root,engine:'pdflatex',executable:'latexmk',timeoutMs:60000,sourceFiles}};
 };
 lane.move(root,source.indexOf('target'));let wait=ready();lane.setBasis(await makeBasis(styleText,'first'));await wait;
 await fs.writeFile(style,styleText.replace('First context','Disk changed context'));
 const fallback=new Promise(resolve=>fallbackResolve=resolve);assert.equal(lane.request(root,source.replace('target','new target'),'disk-edit'),true);
 assert.equal(await fallback,'disk-edit');assert.equal(published,0,'Stale styles cannot publish local output');
 // An explicitly captured editor buffer is authoritative even when disk differs.
 const bufferText=styleText.replace('First context','Editor context');wait=ready();lane.setBasis(await makeBasis(bufferText,'buffer',{[style]:bufferText}));await wait;
 assert.equal(lane.request(style,bufferText+'% unsaved edit','style-edit'),false);
 assert.equal(lane.request(root,source.replace('target','new target'),'root-edit'),false,'An edit to another buffer must retire the captured context immediately');
 assert.equal(published,0);
});
