const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident');
const signal=()=>new AbortController().signal;
test('Provisional baseline byte comparisons agree with complete state hashes and trim only local navigation',{timeout:120000},async t=>{
 const fast=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{fast.stop();strict.stop();});
 const prefix='\\documentclass{article}\n\\begin{document}\n\nEarlier page text.\\newpage\n\nMiddle page text.\\newpage\n\n',region='Target text with $\\sqrt{\\pi}$.\n\n',suffix='Following text.\n\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 const baseline=[];
 for(const [compiler,provisional]of [[fast,true],[strict,false]]){
  const prepared=await compiler.prepareRegion(source,range,signal(),60000,()=>{},project);
  const rows=prepared.navigation.split('\n').filter(Boolean).map(JSON.parse);assert.ok(rows.some(row=>row.glyph?.[3]===1),'Complete baseline must include earlier glyphs');
  baseline.push(await compiler.previewRegionFlow(source,range,signal(),30000,()=>{},project,provisional));
 }
 for(const next of [region.replace('text','longer words'),region.replace('text','\\global\\advance\\count20 by1 text'),region.replace('text','\\global\\everypar{changed} text'),region]){
  const outputs=[];for(const [compiler,provisional]of [[fast,true],[strict,false]])outputs.push(await compiler.previewRegionFlow(prefix+next+suffix,{from:range.from,to:prefix.length+next.length},signal(),30000,()=>{},project,provisional));
  const membership=outputs.map((out,i)=>out.fragment.flowStateHash===baseline[i].fragment.flowStateHash);assert.equal(membership[0],membership[1],'Fast comparison must make the same state decision as SHA256');
  assert.equal(outputs[0].timing.stateComparison,'baseline-bytes');assert.equal(outputs[1].timing.stateComparison,'sha256');
  for(const out of outputs){const rows=out.navigation.split('\n').filter(Boolean).map(JSON.parse),glyphs=rows.filter(r=>r.glyph||r.mathGlyph);assert.ok(glyphs.length>5);assert.ok(glyphs.every(r=>(r.glyph??r.mathGlyph)[1]>4),'Local response must omit historical page mappings');assert.ok(rows.some(r=>r.mathGlyph),'Current math mappings must survive trimming');}
 }
 const broken=region.replace('Target','\\long\\def\\Grab#1{#1}\\Grab{Target');await assert.rejects(fast.previewRegionFlow(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},signal(),30000,()=>{},project,true));
 const restored=await fast.previewRegionFlow(source,range,signal(),30000,()=>{},project,true);assert.equal(restored.fragment.flowStateHash,baseline[0].fragment.flowStateHash);
 await fast.compile(source,signal(),60000,()=>{},project);const rows=fast.navigation.split('\n').filter(Boolean).map(JSON.parse);assert.ok(rows.some(r=>r.glyph?.[3]===1));assert.ok(rows.some(r=>r.glyph?.[3]===3),'Full verification must still contain all pages');
});
test('A newly opened local input requires complete verification',{timeout:90000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());const dir=path.resolve('.test-output','flow-dependency-'+randomUUID());await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'fresh.tex'),'Fresh dependency words.');
 const prefix='\\documentclass{article}\n\\begin{document}\n\n',region='Target text.\n\n',suffix='Following.\n\n\\end{document}\n',source=prefix+region+suffix,project={characterMapping:true,supportFolders:[dir]},range={from:prefix.length,to:prefix.length+region.length};
 await compiler.prepareRegion(source,range,signal(),60000,()=>{},project);await compiler.previewRegionFlow(source,range,signal(),30000,()=>{},project,true);
 const next='Target \\input{fresh} text.\n\n';await assert.rejects(compiler.previewRegionFlow(prefix+next+suffix,{from:range.from,to:prefix.length+next.length},signal(),30000,()=>{},project,true),/new local dependency/);
 assert.ok((await compiler.compile(prefix+next+suffix,signal(),60000,()=>{},project)).length>100);assert.ok(compiler.navigation.includes('fresh.tex'),'Full verification includes the new input');
});
