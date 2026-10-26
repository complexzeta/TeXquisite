const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash,validatePdf}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('The page byte limit fences an oversized newly read line before executing its tokens',{timeout:30000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const prefix='\\documentclass{article}\n\\begin{document}\n\n',region='Target.\n\n',suffix='\\typeout{OVERSIZED_LINE_MUST_NOT_RUN}'+(' '.repeat(66000))+'Trailing.\n\\newpage\nTail.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length};
 await compiler.prepareRegion(source,range,signal(),15000,()=>{},{});const logs=[];await assert.rejects(compiler.previewRegionPage(source,range,1,signal(),10000,s=>logs.push(s),{}),/104/);assert.ok(!logs.join('').includes('OVERSIZED_LINE_MUST_NOT_RUN'));
});
test('Affected-page output uses real page layout and excludes subsequent pages and end hooks',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','region-page-'+randomUUID());await fs.mkdir(directory,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\AtEndDocument{\\typeout{FORBIDDEN_END_HOOK}}\n\\begin{document}\nFirst page.\\newpage\nTop material.\\par\n\\vfill\n\n',region='Target paragraph with $\\sqrt{\\pi}$ and words.\n\n',suffix='\\typeout{REQUIRED_PAGE_SUFFIX}\nRemaining material.\\par\n\\newpage\n\\typeout{FORBIDDEN_PAGE_SUFFIX}\n'+Array.from({length:10},(_,i)=>'Following page '+i+'.\\newpage\n').join('')+'\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);
 for(const [name,next]of [['baseline',region],['wrap',region.replace('and words','and '+('more wrapping words '.repeat(25)))],['footnote',region.replace('and words','and words\\footnote{An inserted footnote.}')]]){
  const nextSource=prefix+next+suffix,logs=[],output=await local.previewRegionPage(nextSource,{from:range.from,to:prefix.length+next.length},2,signal(),30000,s=>logs.push(s),project);assert.equal(output.scope,'region-page');assert.equal(output.documentComplete,false);assert.equal(await validatePdf(output.pdf),2);assert.ok(logs.join('').includes('REQUIRED_PAGE_SUFFIX'));assert.ok(!/FORBIDDEN_PAGE_SUFFIX|FORBIDDEN_END_HOOK/.test(logs.join('')));assert.ok(output.timing.excludedSuffixBytes>100);assert.equal(output.timing.syntheticEnd,false);
  const complete=await full.compile(nextSource,signal(),60000,()=>{},project);for(const [kind,pdf]of [['local',output.pdf],['full',complete]]){await fs.writeFile(path.join(directory,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','144','-f','2','-l','2',name+'-'+kind+'.pdf',name+'-'+kind],directory,30000,signal(),()=>{});}assert.equal(hash(await fs.readFile(path.join(directory,name+'-local-02.ppm')).catch(()=>fs.readFile(path.join(directory,name+'-local-2.ppm')))),hash(await fs.readFile(path.join(directory,name+'-full-02.ppm'))),'Affected page must match a full build exactly');
 }
 const broken=region.replace('words.','\\long\\def\\Grab#1{#1}\\Grab{words.'),brokenLogs=[];await assert.rejects(local.previewRegionPage(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},2,signal(),30000,s=>brokenLogs.push(s),project));assert.ok(!brokenLogs.join('').includes('REQUIRED_PAGE_SUFFIX'));
 assert.ok((await local.previewRegionPage(source,range,2,signal(),30000,()=>{},project)).pdf.length>100);
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({passed:true,pixelComparisons:3,excludedFollowingPages:10},null,2));
});
test('Affected-page output does not force completion of a final page or expand end hooks',{timeout:90000},async t=>{
 const local=new ResidentCompiler();t.after(()=>local.stop());const prefix='\\documentclass{article}\n\\AtEndDocument{\\errmessage{FORBIDDEN_FINAL_HOOK}}\n\\begin{document}\n\n',region='Target paragraph.\n\n',suffix='Following material.\n\\end{document}\n',source=prefix+region+suffix;
 // Preparation completes normally; speculative final-page output must stop
 // before the same hook can run again.
 const safeSource=source.replace('\\errmessage{FORBIDDEN_FINAL_HOOK}','\\typeout{END_HOOK_MARKER}');await local.prepareRegion(safeSource,{from:prefix.replace('\\errmessage{FORBIDDEN_FINAL_HOOK}','\\typeout{END_HOOK_MARKER}').length,to:safeSource.indexOf(suffix)},signal(),60000,()=>{},{});
 const from=safeSource.indexOf(region),range={from,to:from+region.length};await assert.rejects(local.previewRegionPage(safeSource,range,1,signal(),30000,()=>{},{}),error=>!error.message.includes('END_HOOK_MARKER'));
 const indirect=safeSource.replace('\\begin{document}','\\def\\Finish{\\enddocument}\n\\begin{document}').replace('\\end{document}','\\Finish'),indirectFrom=indirect.indexOf(region),indirectRange={from:indirectFrom,to:indirectFrom+region.length};
 await local.prepareRegion(indirect,indirectRange,signal(),60000,()=>{},{});
 await assert.rejects(local.previewRegionPage(indirect,indirectRange,1,signal(),30000,()=>{},{}),error=>/\(105\)/.test(error.message)&&!error.message.includes('END_HOOK_MARKER'));
 const alias=indirect.replace('\\def\\Finish{\\enddocument}','\\let\\Finish\\enddocument'),aliasFrom=alias.indexOf(region),aliasRange={from:aliasFrom,to:aliasFrom+region.length};
 await local.prepareRegion(alias,aliasRange,signal(),60000,()=>{},{});
 await assert.rejects(local.previewRegionPage(alias,aliasRange,1,signal(),30000,()=>{},{}),error=>/\(105\)/.test(error.message)&&!error.message.includes('END_HOOK_MARKER'));
 for(const [text,range]of [[indirect,indirectRange],[alias,aliasRange]]){await local.prepareRegion(text,range,signal(),60000,()=>{},{});await assert.rejects(local.previewRegionPage(text,range,1,signal(),30000,()=>{},{},true),error=>/\(105\)/.test(error.message)&&!error.message.includes('END_HOOK_MARKER'));}
});
