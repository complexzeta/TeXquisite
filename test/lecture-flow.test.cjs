const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {ResidentCompiler}=require('../dist/resident'),{RegionCompositor}=require('../dist/region-compositor'),{PDFDocument,PDFName,PDFDict,PDFArray}=require('pdf-lib');
const signal=()=>new AbortController().signal,text=pdf=>cp.execFileSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8',windowsHide:true}).replace(/\s+/g,' ').trim();

async function destinations(pdf){const doc=await PDFDocument.load(pdf),names=doc.catalog.lookupMaybe(PDFName.of('Names'),PDFDict),tree=names?.lookupMaybe(PDFName.of('Dests'),PDFDict),result=[];const walk=dict=>{const pairs=dict.lookupMaybe(PDFName.of('Names'),PDFArray);if(pairs)for(let i=0;i<pairs.size();i+=2)result.push(pairs.get(i).decodeText());const kids=dict.lookupMaybe(PDFName.of('Kids'),PDFArray);if(kids)for(let i=0;i<kids.size();i++)walk(doc.context.lookup(kids.get(i),PDFDict));};if(tree)walk(tree);return {names:result.sort(),outlines:!!doc.catalog.get(PDFName.of('Outlines'))};}
test('Lecture flow keeps section writes and marks local while strict flow and full output retain their rules',{timeout:180000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 for(const hyperref of [false,true]){
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n'+(hyperref?'\\usepackage{hyperref}\n':'')+'\\AtEndDocument{\\typeout{FORBIDDEN_LECTURE_END}}\n\\begin{document}\n\\setcounter{section}{6}\n\nOld reference: \\ref{lec:new}.\n\n',region='Target paragraph.\n\n',suffix='\\typeout{FORBIDDEN_LECTURE_SUFFIX}\n\\refstepcounter{equation}\\label{lec:new}\nFollowing text.\\newpage\nUnchanged ending.\n\\end{document}\n',source=prefix+region+suffix,project={characterMapping:true},range={from:prefix.length,to:prefix.length+region.length};
 const prepared=await compiler.prepareRegion(source,range,signal(),60000,()=>{},project),original=await compiler.previewRegionFlow(source,range,signal(),15000,()=>{},project,true,undefined,true),compositor=await RegionCompositor.create(prepared.pdf,prepared.navigation,original),baselineText=text(prepared.pdf);
 assert.match(baselineText,/Old reference: 1/);
 const render=async(next,lecture=true)=>{const logs=[],out=await compiler.previewRegionFlow(prefix+next+suffix,{from:prefix.length,to:prefix.length+next.length},signal(),5000,s=>logs.push(s),project,true,undefined,lecture);assert.ok(out.timing.excludedSuffixBytes>50);assert.equal(out.timing.syntheticEnd,false);assert.equal(out.timing.documentComplete,false);assert.ok(!/FORBIDDEN_LECTURE_(SUFFIX|END)/.test(logs.join('')));return out;};
 const section=region+'\\section{First heading}\\label{lec:new}\n\nSome $x^2$.\n\n\\section{Second heading}\n\nMore words.\n\n',out=await render(section);
 assert.equal(out.fragment.lectureSideEffects,true);assert.match(text(out.pdf),/7 First heading.*8 Second heading/);assert.ok(!text(out.pdf).includes('Unchanged ending'));
 assert.equal(compositor.flow(out),undefined,'Default composition still rejects output side effects');assert.equal(compositor.flow(out,true).stateChanged,true,'Suffix navigation must not reuse state from before the sections');
 await assert.rejects(render(section,false),/broader layout/,'Document mode must not inherit the Lecture whitelist');
 const mark=await render(region+'\\markboth{Left}{Right}\n\nMore words.\n\n');assert.equal(mark.fragment.lectureSideEffects,true);assert.equal(compositor.flow(mark),undefined);assert.equal(compositor.flow(mark,true).stateChanged,true);
 for(const unsupported of ['A footnote\\footnote{Note}.\n\n','A special\\special{LECTURE_UNKNOWN_WHATSIT}.\n\n','\\newwrite\\LectureStream\\openout\\LectureStream=lecture-test.tmp\nText.\n\n'])await assert.rejects(render(region+unsupported),/broader layout/,'Unsupported node kinds retain full fallback');
 const tall=await render(region+'\\section{Tall section}\n\n'+('Long lecture material with $x^2$. '.repeat(30)+'\n\n').repeat(12));
 assert.ok(compositor.flow(tall,true));assert.equal((await PDFDocument.load(tall.pdf)).getPageCount(),1,'Growing lecture block has no internal PDF page breaks');assert.ok(tall.fragment.heightSp/65536>792,'The block grows beyond a normal page');
 const broken=region+'\\section{Unfinished\n\n';await assert.rejects(render(broken),/boundary|safe boundary/);
 const recovered=await compiler.compile(source,signal(),30000,()=>{},project);assert.equal(text(recovered),baselineText,'Deferred local writes and marks must not leak into later full output');assert.deepEqual(await destinations(recovered),await destinations(prepared.pdf),'Provisional destinations/bookmarks must not leak into full output');assert.equal(compiler.lastTiming.preambleRebuilt,false);
 }
});
