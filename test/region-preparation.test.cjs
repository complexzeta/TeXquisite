const {test}=require('node:test'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident');
const signal=()=>new AbortController().signal;

test('Moving between paragraphs reuses a converged baseline and stops before the suffix',{timeout:120000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\AtEndDocument{\\typeout{PREP_END_HOOK}}\n\\begin{document}\n\n',paragraphs=Array.from({length:8},(_,i)=>'Paragraph '+i+' with math $\\sqrt{\\pi}$ and ordinary words.\n\n'),tail='\\typeout{PREP_SUFFIX_SENTINEL}\n'+Array.from({length:100},(_,i)=>'Tail '+i+'.\\newpage\n').join('')+'\\end{document}\n';
 let source=prefix+paragraphs.join('')+tail;
 const range=i=>({from:prefix.length+paragraphs.slice(0,i).join('').length,to:prefix.length+paragraphs.slice(0,i+1).join('').length});
 const project={characterMapping:true},measurements=[];
 let baseline;
 for(const i of [1,5,2,6,1]){
  const logs=[],prepared=await compiler.prepareRegion(source,range(i),signal(),60000,s=>logs.push(s),project),timing={...compiler.lastTiming};
  assert.ok(prepared.pdf.length>100);assert.ok(timing.anchorExcludedSuffixBytes>1000);
  assert.equal(timing.reusedBaseline,!!baseline);
  if(baseline){assert.deepEqual(prepared.pdf,baseline);assert.ok(!/PREP_SUFFIX_SENTINEL|PREP_END_HOOK/.test(logs.join('')));}
  else baseline=Buffer.from(prepared.pdf);
  const fragment=await compiler.previewRegionNodes(source,range(i),signal(),30000,()=>{},project);assert.ok(fragment.pdf.length>100);
  measurements.push({paragraph:i,...timing});
 }
 source=source.replace('ordinary words.','standard words.');
 await compiler.prepareRegion(source,range(1),signal(),60000,()=>{},project);assert.equal(compiler.lastTiming.reusedBaseline,false,'Changed source must reconverge');
 await compiler.prepareRegion(source,range(2),signal(),60000,()=>{},{...project,environmentKey:'changed'});assert.equal(compiler.lastTiming.reusedBaseline,false,'Changed environment must reconverge');
 const resourceProject={...project,resources:[['notes.txt',Buffer.from('new resource')]],resourceKey:'new resources'};
 await compiler.prepareRegion(source,range(2),signal(),60000,()=>{},resourceProject);assert.equal(compiler.lastTiming.reusedBaseline,false,'Changed resources must reconverge');
 compiler.stop();await compiler.prepareRegion(source,range(2),signal(),60000,()=>{},resourceProject);assert.equal(compiler.lastTiming.reusedBaseline,false,'A stopped compiler must rebuild its baseline');
 console.log('Preparation measurements: '+JSON.stringify(measurements));
});
