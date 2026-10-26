const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('Included paragraphs use real root and preceding file context, with exact full-page pixels',{timeout:150000},async t=>{
 const dir=path.resolve('.test-output','included-parity-'+randomUUID());await fs.mkdir(dir,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const root='\\documentclass{article}\n\\def\\RootContext{Root context}\n\\AtEndDocument{\\typeout{END_HOOK_FORBIDDEN_LOCALLY}}\n\\begin{document}\n\\input{before.tex}\n\\newpage\n\\input{chapters/nested.tex}\n\\newpage\n\\typeout{TAIL_FORBIDDEN_LOCALLY}\nTail.\\end{document}\n',before='\\def\\ChapterContext{Previous chapter}\nPrevious page.\n',wrapper='\\begingroup\\def\\NestedContext{Actual nested group}\n\\input{chapters/target.tex}\n\\endgroup\n',prefix='First paragraph in the included file.\n\n',region='Target \\RootContext, \\ChapterContext, \\NestedContext, and $\\sqrt{\\pi}$.\n\n',tail='Following material.\\par\n\\vfill\n\\newpage\n',text=prefix+region+tail,input={file:'chapters/target.tex',text},range={from:prefix.length,to:prefix.length+region.length};
 const context=content=>({characterMapping:true,resourceKey:hash(content),resources:[['before.tex',Buffer.from(before)],['chapters/nested.tex',Buffer.from(wrapper)],[input.file,Buffer.from(content)]]});
 const prepared=await local.prepareRegion(root,range,signal(),60000,()=>{},context(text),undefined,input);assert.equal(local.lastTiming.sourceFile,input.file);assert.equal(local.lastTiming.inputCheckpoint,true);
 for(const [name,next]of [['baseline',region],['text',region.replace('Target','Changed target')],['footnote',region.replace('and $','with a note\\footnote{New included note.}, and $')]]){
  const changed=prefix+next+tail,logs=[],out=await local.previewRegionPage(root,{from:prefix.length,to:prefix.length+next.length},2,signal(),30000,s=>logs.push(s),context(text),false,{...input,text:changed});assert.equal(out.documentComplete,false);assert.equal(out.timing.sourceFile,input.file);assert.ok(!/END_HOOK_FORBIDDEN_LOCALLY|TAIL_FORBIDDEN_LOCALLY/.test(logs.join('')));assert.ok(out.navigation.includes('chapters/target.tex'));
  const complete=await full.compile(root,signal(),60000,()=>{},context(changed));
  for(const [kind,pdf]of [['local',out.pdf],['full',complete]]){await fs.writeFile(path.join(dir,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-f','2','-l','2','-singlefile',name+'-'+kind+'.pdf',name+'-'+kind],dir,30000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,name+'-local.ppm'))),hash(await fs.readFile(path.join(dir,name+'-full.ppm'))),'Included page pixels must equal full compilation: '+name);
 }
 const logs=[];const normal=await local.compile(root,signal(),60000,s=>logs.push(s),context(text));assert.ok(normal.length>1000);assert.ok(logs.join('').includes('END_HOOK_FORBIDDEN_LOCALLY'));
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,pixelComparisons:3,inputCheckpoint:true,rootAndPreviousAndNestedContext:true,fullBuildAfterLocal:true},null,2));
});
test('Included first paragraphs render from an actual parent checkpoint and repeated input falls back',{timeout:90000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const text='Target with $x$.\n\nFollowing.\n\n',input={file:'chapter.tex',text},project={characterMapping:true,resourceKey:'included-first',resources:[[input.file,Buffer.from(text)]]},root='\\documentclass{article}\n\\begin{document}\nBefore.\\newpage\n\\input{chapter.tex}\n\\newpage\nTail.\\end{document}',range={from:0,to:text.indexOf('Following')};
 const prepared=await c.prepareRegion(root,range,signal(),60000,()=>{},project,undefined,input);assert.equal(c.lastTiming.inputCheckpoint,false);const out=await c.previewRegionFlow(root,range,signal(),30000,()=>{},project,true,input);assert.ok(out.navigation.includes('chapter.tex'));assert.ok(out.timing.reprocessedSourceBytes>=0);
 await assert.rejects(c.previewRegionFlow(root+'\n',range,signal(),30000,()=>{},project,true,input));
 await assert.rejects(c.prepareRegion(root.replace('\\newpage\nTail','\\input{chapter.tex}\\newpage\nTail'),range,signal(),60000,()=>{},project,undefined,input),/literal|unique|included|inclusion/i);
});
