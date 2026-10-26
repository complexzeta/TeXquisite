const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');

const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');

const signal=()=>new AbortController().signal;

test('An intra-line checkpoint preserves full paragraph pixels, navigation and state through tail edits and prefix fallback',{timeout:120000},async t=>{

 const dir=path.resolve('.test-output','prefix-checkpoint-'+randomUUID());await fs.mkdir(dir,{recursive:true});const fast=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{fast.stop();strict.stop();});

 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\nBefore.\n\n',region=('Earlier words with ordinary text. '.repeat(12))+'EDITPOINT text with $\\sqrt{\\pi}$.\n\n',suffix='Following.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};

 await fast.prepareRegion(source,range,signal(),60000,()=>{},project,source.indexOf('EDITPOINT'));assert.ok(fast.lastTiming.prefixCheckpointOffset>range.from,'The fixture must reach an intra-line checkpoint');

 await strict.prepareRegion(source,range,signal(),60000,()=>{},project);

 const originalFast=await fast.previewRegionFlow(source,range,signal(),30000,()=>{},project),originalStrict=await strict.previewRegionFlow(source,range,signal(),30000,()=>{},project);

 for(const [i,next]of [region,region.replace('EDITPOINT','Changed words'),region.replace('\\pi','x^2+1'),region.replace('EDITPOINT','New paragraph.\n\nThen'),region.replace('EDITPOINT','\\global\\advance\\count20 by1 Changed'),region.replace('Earlier words','Changed prefix words'),region].entries()){

  const text=prefix+next+suffix,r={from:prefix.length,to:prefix.length+next.length},a=await fast.previewRegionFlow(text,r,signal(),30000,()=>{},project),b=await strict.previewRegionFlow(text,r,signal(),30000,()=>{},project);

  assert.equal(a.timing.prefixReused,i!==5);assert.deepEqual(a.fragment.shape,b.fragment.shape);assert.equal(a.fragment.flowStateHash===originalFast.fragment.flowStateHash,b.fragment.flowStateHash===originalStrict.fragment.flowStateHash,'State equivalence must agree with each worker own baseline');assert.equal(a.navigation,b.navigation);

  for(const [name,pdf]of [['fast',a.pdf],['strict',b.pdf]]){const stem=i+'-'+name;await fs.writeFile(path.join(dir,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',stem+'.pdf',stem],dir,30000,signal(),()=>{});}

  assert.equal(hash(await fs.readFile(path.join(dir,i+'-fast-1.png'))),hash(await fs.readFile(path.join(dir,i+'-strict-1.png'))));fast.prepareNextRegionEdit();

 }

 const broken=region.replace('EDITPOINT','\\UndefinedPrefixProbe');await assert.rejects(fast.previewRegionFlow(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},signal(),30000,()=>{},project));

 const repaired=await fast.previewRegionFlow(source,range,signal(),30000,()=>{},project);assert.ok(repaired.timing.prefixReused);assert.ok(repaired.pdf.length>100);

});

test('Prefix reuse preserves UTF-8 and original endline semantics and refuses transformed, external or trimmed prefixes',{timeout:120000},async t=>{

 const dir=path.resolve('.test-output','prefix-edge-'+randomUUID());await fs.mkdir(dir,{recursive:true});

 const cases=[
  {body:('Earlier words. '.repeat(8))+'$a + MARK + \\sqrt{\\pi}$ tail.\n\n',reuse:true},

  {body:('Caf\u00e9 words with na\u00efve accents. '.repeat(8))+'MARK tail words.\n\n',reuse:true},
  {body:('Earlier words. '.repeat(8))+'\\endlinechar=-1 MARK TailWord\nNextWord.\\endlinechar=13\\par\n\n',reuse:true},

  {body:'\\rel^^61x '+('Earlier words. '.repeat(8))+'MARK tail.\n\n',reuse:false},
  {body:'^^41 '+('Earlier words. '.repeat(8))+'MARK tail.\n\n',reuse:true},

  {body:'\\input{snippet} '+('Earlier words. '.repeat(8))+'MARK tail.\n\n',reuse:false,resources:[['snippet.tex',Buffer.from('Included words. ')]]},

  {body:('Earlier words. '.repeat(8))+'MARK tail.\\par\n\n',reuse:true,trim:true}

 ];

 for(const [i,c]of cases.entries()){
  t.diagnostic('Prefix edge case '+i);

  const fast=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{fast.stop();strict.stop();});const prefix='\\documentclass{article}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\nBefore.\n\n',suffix='Following.\\par\n\\end{document}\n',source=prefix+c.body+suffix,range={from:prefix.length,to:prefix.length+c.body.length},project={characterMapping:true,resources:c.resources};

  await fast.prepareRegion(source,range,signal(),60000,()=>{},project,source.indexOf('MARK'));assert.equal(!!fast.lastTiming.prefixCheckpointOffset,c.reuse,'case '+i);

  const preparedOffset=fast.lastTiming.prefixCheckpointOffset;
  await strict.prepareRegion(source,range,signal(),60000,()=>{},project);
  const originalFast=await fast.previewRegionFlow(source,range,signal(),30000,()=>{},project),originalStrict=await strict.previewRegionFlow(source,range,signal(),30000,()=>{},project);

  const cut=preparedOffset-prefix.length,body=c.trim?c.body.slice(0,cut)+'\nTail after newline.\\par\n\n':c.body.replace('MARK','Changed'),text=prefix+body+suffix,r={from:range.from,to:prefix.length+body.length};

  const a=await fast.previewRegionFlow(text,r,signal(),30000,()=>{},project),b=await strict.previewRegionFlow(text,r,signal(),30000,()=>{},project);assert.equal(a.timing.prefixReused,c.reuse&&!c.trim);assert.equal(a.fragment.flowStateHash===originalFast.fragment.flowStateHash,b.fragment.flowStateHash===originalStrict.fragment.flowStateHash,'State equivalence must agree with each worker own baseline');assert.deepEqual(a.fragment.shape,b.fragment.shape);assert.equal(a.navigation,b.navigation);

  for(const [kind,pdf]of [['fast',a.pdf],['strict',b.pdf]]){const stem=i+'-'+kind;await fs.writeFile(path.join(dir,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',stem+'.pdf',stem],dir,30000,signal(),()=>{});}

  assert.equal(hash(await fs.readFile(path.join(dir,i+'-fast-1.png'))),hash(await fs.readFile(path.join(dir,i+'-strict-1.png'))));if(!c.reuse||c.trim)assert.ok((await fast.compile(text,signal(),60000,()=>{},project)).length>100);fast.stop();strict.stop();

 }

});

