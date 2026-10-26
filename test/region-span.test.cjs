const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash,validatePdf}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('A paragraph can grow across pages and shrink again without processing the document tail',{timeout:120000},async t=>{
 const dir=path.resolve('.test-output','region-span-'+randomUUID());await fs.mkdir(dir,{recursive:true});const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\setlength{\\textheight}{96pt}\n\\AtEndDocument{\\typeout{FORBIDDEN_SPAN_END}}\n\\begin{document}\nCover.\\newpage\nTop material.\\par\n\n',region='Target paragraph with ordinary words.\n\n',suffix='Following stable paragraph.\n\n\\newpage\nBridge page.\\newpage\n\\typeout{FORBIDDEN_SPAN_TAIL}\n'+Array.from({length:20},(_,i)=>'Tail page '+i+'.\\newpage\n').join('')+'\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);const results=[];
 for(const [name,next]of [['grow',region.replace('ordinary words','wrapping words '.repeat(65))],['three',region.replace('ordinary words','wrapping words '.repeat(95))],['shrink',region]]){
  const text=prefix+next+suffix,logs=[],out=await local.previewRegionPage(text,{from:prefix.length,to:prefix.length+next.length},2,signal(),30000,s=>logs.push(s),project),span=out.pageSpan;assert.equal(span.first,2);assert.ok(span.last-span.first<3);if(name==='grow')assert.ok(span.last>=3);if(name==='three')assert.equal(span.last-span.first+1,3);assert.ok(!/FORBIDDEN_SPAN_TAIL|FORBIDDEN_SPAN_END/.test(logs.join('')));assert.ok(out.timing.excludedSuffixBytes>100);assert.equal(await validatePdf(out.pdf),span.last);
  const finalColumn=Buffer.byteLength(next.trimEnd())-1,regionLine=prefix.split('\n').length;assert.ok(out.navigation.split('\n').filter(Boolean).map(s=>JSON.parse(s).glyph).some(g=>g&&g[1]===regionLine&&g[2]===finalColumn&&g[8]===46),'The final edited glyph must actually have shipped');
  const complete=await full.compile(text,signal(),60000,()=>{},project);for(const [kind,pdf]of [['local',out.pdf],['full',complete]]){await fs.writeFile(path.join(dir,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-f',String(span.first),'-l',String(span.last),name+'-'+kind+'.pdf',name+'-'+kind],dir,30000,signal(),()=>{});}
  for(let page=span.first;page<=span.last;page++){const find=async kind=>{const files=await fs.readdir(dir);return fs.readFile(path.join(dir,files.find(f=>new RegExp('^'+name+'-'+kind+'-0*'+page+'\\.ppm$').test(f))));};assert.equal(hash(await find('local')),hash(await find('full')),'Every affected page must match the full build');}results.push({name,span,timing:out.timing});
 }
 const huge=region.replace('ordinary words','too many words '.repeat(500));await assert.rejects(local.previewRegionPage(prefix+huge+suffix,{from:prefix.length,to:prefix.length+huge.length},2,signal(),30000,()=>{},project),error=>/106/.test(error.message));
 assert.ok((await local.previewRegionPage(source,range,2,signal(),30000,()=>{},project)).pdf.length>100);await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,results},null,2));
});
test('Shrinking a kept-together paragraph can change the page before its original first glyph',{timeout:90000},async t=>{
 const local=new ResidentCompiler();t.after(()=>local.stop());
 const prefix='\\documentclass{article}\n\\setlength{\\textheight}{96pt}\n\\begin{document}\n'+('Top material.\\par\n'.repeat(5))+'\n',region='\\begin{samepage}\nTarget '+('ordinary words '.repeat(16))+'.\\par\n\\end{samepage}\n\n',suffix='Following.\\par\n\\newpage\nBridge.\\newpage\nTail.\\newpage\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 const prepared=await local.prepareRegion(source,range,signal(),60000,()=>{},project),line=prefix.split('\n').length+1;
 const glyphs=raw=>raw.split('\n').filter(Boolean).map(s=>JSON.parse(s).glyph).filter(g=>g&&g[1]===line&&g[2]===0&&g[8]===84);
 assert.equal(glyphs(prepared.navigation)[0][3],2,'Fixture must originally push the paragraph to page two');
 const short=region.replace('ordinary words '.repeat(16),'short words'),output=await local.previewRegionPage(prefix+short+suffix,{from:range.from,to:prefix.length+short.length},2,signal(),30000,()=>{},project);
 assert.equal(output.pageSpan.first,1,'The checkpoint page, including earlier material, must be included');assert.equal(glyphs(output.navigation)[0][3],1,'The shortened paragraph must move back onto page one');
});
