const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{RegionCompositor}=require('../dist/region-compositor'),{runProcess,hash,validatePdf}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('Live paragraph boxes avoid end hooks and preserve placement above stretchable page glue',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','region-nodes-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\AtEndDocument{\\typeout{REGION_END_HOOK_EXECUTED}}\n\\begin{document}\nTop material.\\par\n\\def\\BodyWord{Context}\n\\vfill\n';
 const region='\\BodyWord: target paragraph $\\sqrt{\\pi}+\\frac{a}{b}$ and plain words.\n\n',suffix='\\typeout{REGION_SUFFIX_EXECUTED}\nRemaining material.\\par\n\\newpage\nFollowing page.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 const base=await full.compile(source,signal(),60000,()=>{},project),navigation=full.navigation;
 await local.prepareRegion(source,range,signal(),60000,()=>{},project);
 const logs=[],original=await local.previewRegionNodes(source,range,signal(),30000,s=>logs.push(s),project);
 await fs.writeFile(path.join(directory,'original.json'),JSON.stringify({fragment:original.fragment,navigation:original.navigation,timing:original.timing},null,2));
 assert.equal(original.timing.syntheticEnd,false);assert.ok(!/REGION_END_HOOK_EXECUTED|REGION_SUFFIX_EXECUTED/.test(logs.join('')));
 assert.equal(original.fragment.lines,1);assert.equal(await validatePdf(original.pdf),1);
 const compositor=await RegionCompositor.create(base,navigation,original);
 for(const [name,nextRegion]of [['baseline',region],['edit',region.replace('plain words','newer words')]]){
  const nextSource=prefix+nextRegion+suffix,output=await local.previewRegionNodes(nextSource,{from:range.from,to:prefix.length+nextRegion.length},signal(),30000,()=>{},project);
  const composed=await compositor.compose(output),complete=await full.compile(nextSource,signal(),60000,()=>{},project);
  for(const [kind,pdf]of [['composed',composed.pdf],['full',complete]]){await fs.writeFile(path.join(directory,name+'-'+kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','144','-f','1','-l','1',name+'-'+kind+'.pdf',name+'-'+kind],directory,30000,signal(),()=>{});}
  const a=hash(await fs.readFile(path.join(directory,name+'-composed-1.ppm'))),b=hash(await fs.readFile(path.join(directory,name+'-full-1.ppm')));
  assert.equal(a,b,'Composed '+name+' must exactly match the complete page, including vertical placement');
 }
 const wrap=region.replace('plain words','longer words '.repeat(70)),wrapped=await local.previewRegionNodes(prefix+wrap+suffix,{from:range.from,to:prefix.length+wrap.length},signal(),30000,()=>{},project);
 assert.equal(compositor.compatible(wrapped),false,'Changed line count must request broader layout');
 const assigned=region.replace('plain words','\\global\\advance\\count20 by1 plain words'),assignment=await local.previewRegionNodes(prefix+assigned+suffix,{from:range.from,to:prefix.length+assigned.length},signal(),30000,()=>{},project);
 assert.equal(compositor.compatible(assignment),false,'A changed global register must request broader recomputation');
 const broken=region.replace('plain words','\\UndefinedParagraphProbe');
 await assert.rejects(local.previewRegionNodes(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},signal(),30000,()=>{},project));
 assert.equal(compositor.compatible(await local.previewRegionNodes(source,range,signal(),30000,()=>{},project)),true,'A failed local edit must not poison the checkpoint');
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({passed:true,fragment:original.fragment,timing:original.timing},null,2));
});

test('An unfinished long argument cannot consume the unchanged source suffix',{timeout:90000},async t=>{
 const local=new ResidentCompiler();t.after(()=>local.stop());
 const prefix='\\documentclass{article}\n\\long\\def\\Grab#1{#1}\n\\begin{document}\n\nPrefix paragraph.\n\n',region='\\Grab{Target paragraph.}\n\n',suffix='\\typeout{FORBIDDEN_SUFFIX_EXECUTION}\nFollowing material.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length};
 await local.prepareRegion(source,range,signal(),60000,()=>{},{characterMapping:true});
 const broken=region.replace('paragraph.}','paragraph.'),logs=[];
 await assert.rejects(local.previewRegionNodes(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},signal(),30000,s=>logs.push(s),{characterMapping:true}),error=>/needs input beyond its boundary/.test(error.message)&&!error.message.includes('FORBIDDEN_SUFFIX_EXECUTION'));
 assert.ok(!logs.join('').includes('FORBIDDEN_SUFFIX_EXECUTION'));
 assert.ok((await local.previewRegionNodes(source,range,signal(),30000,()=>{},{characterMapping:true})).pdf.length>100);
});
