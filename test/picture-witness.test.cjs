const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{LocalPreview}=require('../dist/local-preview'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
const fixture=()=>{const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\AtEndDocument{\\typeout{END_ONLY_FULL}}\n\\begin{document}\n\nBefore café.\n\n',picture='\\begin{tikzpicture}\n\\typeout{PICTURE_CALCULATED}\n\\node at (1,2) {NodeQuartz};\n\\foreach \\i in {1,...,120}{\\draw (0,0)--({4*cos(\\i*3)},{2*sin(\\i*3)});}\n\\draw[domain=0:4,samples=180] plot (\\x,{sin(\\x*180)/2});\n\\end{tikzpicture}\n\n',source=prefix+picture+'After.\n\n\\end{document}\n';return {source,range:{from:prefix.length,to:prefix.length+picture.length},project:{characterMapping:true,jobName:'main'}};};

test('A full-build post-picture checkpoint proves the baseline without recalculating the picture; edited output still recalculates it',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),reference=new ResidentCompiler();t.after(()=>{c.stop();reference.stop();});const {source,range,project}=fixture(),dir=path.resolve('.test-output','picture-witness-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const full=await c.compile(source,signal(),30000,()=>{},project);assert.ok(full);assert.equal(c.lastTiming.pageWitnessCaptured,true);
 const prior=process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS;let originalFull;try{process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS='1';originalFull=await reference.compile(source,signal(),30000,()=>{},project);}finally{if(prior===undefined)delete process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS;else process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS=prior;}assert.equal(reference.lastTiming.pageWitnessCaptured,false);assert.equal(c.navigation,reference.navigation,'Capturing witnesses must not alter the full navigation');
 await c.prepareRegion(source,range,signal(),30000,()=>{},project);assert.ok(c.lastTiming.baselinePageCostMs>0);assert.equal(c.lastTiming.baselineCheckpointAvailable,true);
 const logs=[],fast=await c.previewRegionPage(source,range,1,signal(),15000,s=>logs.push(s),project,true,undefined,true);
 assert.equal(fast.timing.baselineCheckpointReused,true);assert.ok(fast.timing.baselineCheckpointOffset>=range.to);assert.ok(!logs.join('').includes('PICTURE_CALCULATED'));assert.ok(!logs.join('').includes('END_ONLY_FULL'));
 const slow=await c.previewRegionPage(source,range,1,signal(),15000,()=>{},project,true);assert.equal(slow.timing.baselineCheckpointReused,false);
 assert.deepEqual(fast.pageSpan,slow.pageSpan);assert.equal(fast.timing.continuation,slow.timing.continuation);assert.equal(fast.navigation,slow.navigation);
 const changed=source.replace('NodeQuartz','LatestQuartz'),editedLogs=[],edited=await c.previewRegionPage(changed,{from:range.from,to:range.to+2},1,signal(),15000,s=>editedLogs.push(s),project,true,undefined,true);
 assert.equal(edited.timing.baselineCheckpointReused,false,'Even a baseline-proof request cannot skip changed drawing source');assert.ok(editedLogs.join('').includes('PICTURE_CALCULATED'));
 const changedFull=await reference.compile(changed,signal(),30000,()=>{},project);assert.ok(changedFull);
 for(const [name,pdf]of [['full',full],['original-full',originalFull],['fast',fast.pdf],['slow',slow.pdf],['edited',edited.pdf],['edited-full',changedFull]]){const stem=path.join(dir,name);await fs.writeFile(stem+'.pdf',pdf);await runProcess('pdftoppm',['-r','100','-singlefile',stem+'.pdf',stem],dir,15000,signal(),()=>{});}
 const raster=async name=>hash(await fs.readFile(path.join(dir,name+'.ppm')));assert.equal(await raster('full'),await raster('original-full'));assert.equal(await raster('fast'),await raster('full'));assert.equal(await raster('slow'),await raster('full'));assert.equal(await raster('edited'),await raster('edited-full'));
 const outside=source.replace('Before café.','Outside now.');assert.notEqual(outside,source);
 await assert.rejects(c.previewRegionPage(outside,range,1,signal(),15000,()=>{},project,true,undefined,true),/outside the prepared region/);
});

test('A rejected fast raster proof retries the original checkpoint and keeps the measured drawing deadline',{timeout:60000},async t=>{
 const c=new ResidentCompiler(),{source,range,project}=fixture(),pdf=await c.compile(source,signal(),30000,()=>{},project),attempts=[],logs=[];
 const lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},m=>logs.push(m),async()=>{attempts.push(c.lastTiming.baselineCheckpointReused);return attempts.length>1;});t.after(()=>{lane.stop();c.stop();});
 lane.continuous=true;lane.basis={bundle:{id:'test-proof'},options:{root:'main.tex'},source,compilerSource:source,project,pdf,takeCompiler:()=>c};lane.cursor={file:'main.tex',at:source.indexOf('NodeQuartz')+4};
 await lane.arm();assert.deepEqual(attempts,[true,false]);assert.equal(lane.ready,true);assert.equal(lane.slot.pageReady,true);assert.ok(lane.slot.pageCostMs>=c.lastTiming.baselinePageCostMs);assert.ok(logs.some(m=>m.includes('retrying original checkpoint')));
});

test('A picture paragraph crossing a shipped page falls back to the original baseline path',{timeout:30000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\n',picture='\\begin{tikzpicture}\\node {Label};\\end{tikzpicture}\\newpage\n\n',source=prefix+picture+'Tail.\n\n\\end{document}\n',range={from:prefix.length,to:prefix.length+picture.length};
 await c.compile(source,signal(),15000,()=>{},{characterMapping:true});assert.equal(c.lastTiming.pageWitnessCaptured,false);
 await c.prepareRegion(source,range,signal(),15000,()=>{},{characterMapping:true});assert.equal(c.lastTiming.baselinePageCostMs,undefined);assert.equal(c.lastTiming.baselineCheckpointAvailable,false);
 const proof=await c.previewRegionPage(source,range,1,signal(),15000,()=>{},{characterMapping:true},true,undefined,true);assert.equal(proof.timing.baselineCheckpointReused,false);
});

test('Moving the cursor releases obsolete raster proof without discarding the warm compiler',{timeout:30000},async t=>{
 const c=new ResidentCompiler(),{source,project}=fixture(),pdf=await c.compile(source,signal(),20000,()=>{},project);let entered,release;
 const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{},async()=>{entered();return held;});
 t.after(()=>{release(true);lane.stop();c.stop();});lane.continuous=true;lane.basis={bundle:{id:'moving-proof'},options:{root:'main.tex'},source,compilerSource:source,project,pdf,takeCompiler:()=>c};lane.cursor={file:'main.tex',at:source.indexOf('NodeQuartz')};
 const preparing=lane.arm();lane.preparation=preparing;await started;lane.move('main.tex',source.indexOf('After.'));clearTimeout(lane.timer);
 await Promise.race([preparing,new Promise((_,reject)=>setTimeout(()=>reject(Error('Obsolete proof blocked the new cursor')),1000).unref())]);
 assert.equal(lane.ready,false);assert.equal(lane.warmCompiler,c);assert.equal(c.initialized,true);assert.equal(c.busy,false);release(true);await Promise.resolve();assert.equal(lane.ready,false,'A late obsolete proof must not arm the old cursor');
});

test('A warm full build captures the changed second picture and does not reuse its state for the first picture',{timeout:30000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\n',first='\\begin{tikzpicture}\\typeout{FIRST_DRAWING}\\node {FirstQuartz};\\end{tikzpicture}\n\n',second='\\begin{tikzpicture}\\typeout{SECOND_DRAWING}\\node {SecondQuartz};\\end{tikzpicture}\n\n',source=prefix+first+second+'Tail.\n\n\\end{document}\n',project={characterMapping:true};
 await c.compile(source,signal(),15000,()=>{},project);const changed=source.replace('SecondQuartz','SecondQuartx'),range={from:prefix.length+first.length,to:prefix.length+first.length+second.length};
 await c.compile(changed,signal(),15000,()=>{},project);assert.equal(c.lastTiming.pageWitnessCaptured,true);
 await c.prepareRegion(changed,range,signal(),15000,()=>{},project);assert.ok(c.lastTiming.baselinePageCostMs!==undefined);
 const fastLogs=[],fast=await c.previewRegionPage(changed,range,1,signal(),15000,s=>fastLogs.push(s),project,true,undefined,true);assert.equal(fast.timing.baselineCheckpointReused,true);assert.ok(!fastLogs.join('').includes('SECOND_DRAWING'));
 const next=changed.replace('SecondQuartx','SecondQuarty'),editLogs=[],edited=await c.previewRegionPage(next,range,1,signal(),15000,s=>editLogs.push(s),project,true,undefined,true);assert.equal(edited.timing.baselineCheckpointReused,false);assert.ok(editLogs.join('').includes('SECOND_DRAWING'));assert.ok(!editLogs.join('').includes('FIRST_DRAWING'));
 const firstRange={from:prefix.length,to:prefix.length+first.length};await c.prepareRegion(changed,firstRange,signal(),15000,()=>{},project);assert.ok(c.lastTiming.baselinePageCostMs!==undefined,'The earlier picture retains its own exact-prefix checkpoint');
 const firstLogs=[];await c.previewRegionPage(changed,firstRange,1,signal(),15000,s=>firstLogs.push(s),project,true,undefined,true);assert.equal(c.lastTiming.baselineCheckpointReused,true);assert.ok(!firstLogs.join('').includes('FIRST_DRAWING'));
 const changedFirst=changed.replace('FirstQuartz','FirstQuartx'),firstEditLogs=[];await c.previewRegionPage(changedFirst,firstRange,1,signal(),15000,s=>firstEditLogs.push(s),project,true);assert.equal(c.lastTiming.baselineCheckpointReused,false);assert.ok(firstEditLogs.join('').includes('FIRST_DRAWING'));assert.ok(firstEditLogs.join('').includes('SECOND_DRAWING'),'An edited first picture must replay the remaining page');
});

test('Neighboring pages retain their own geometry-only witnesses through later warm builds and match full pixels',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),reference=new ResidentCompiler();t.after(()=>{c.stop();reference.stop();});
 const picture=name=>'\\begin{tikzpicture}\n\\def\\Radius'+name+'{2.00}\n\\typeout{GEOMETRY_'+name+'}\n\\foreach \\i in {1,...,24}{\\draw (0,0)--({\\Radius'+name+'*cos(\\i*15)},{sin(\\i*15)});}\n\n\\node at (0,0) {'+name+'Quartz};\n\n\\end{tikzpicture}\n\n';
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\n',project={characterMapping:true};let source=prefix+picture('Alpha')+'\\newpage\n\n'+picture('Beta')+'Tail.\n\n\\end{document}\n';
 await c.compile(source,signal(),30000,()=>{},project);
 for(const label of ['BetaQuartx','BetaQuarty']){source=source.replace(/BetaQuart./,label);await c.compile(source,signal(),30000,()=>{},project);}
 const dir=path.resolve('.test-output','neighbor-picture-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'baseline.pdf'),await reference.compile(source,signal(),30000,()=>{},project));
 for(const [name,page]of [['Alpha',1],['Beta',2]]){
  const range=require('../dist/local-preview').paragraphAt(source,source.indexOf('Radius'+name)),prepared=await c.prepareRegion(source,range,signal(),30000,()=>{},project,range.from,undefined,false,true);
  assert.ok(c.lastTiming.baselinePageCostMs!==undefined,'Geometry-only blocks on either page need their own witness');const first=c.lastTiming.baselinePage;assert.ok(first<=page&&first>=page-1);assert.ok(c.lastTiming.regionCacheBytes<=128*1024*1024);
  const proofLogs=[],proof=await c.previewRegionPage(source,prepared.familyRange??range,first,signal(),30000,s=>proofLogs.push(s),project,true,undefined,true);assert.equal(proof.timing.baselineCheckpointReused,true);assert.ok(!proofLogs.join('').includes('GEOMETRY_'+name));if(first!==page)assert.deepEqual(proof.pageSpan,{first:1,last:2},'The pending page break needs a complete two-page baseline proof');
  await fs.writeFile(path.join(dir,'proof.pdf'),proof.pdf);for(let p=proof.pageSpan.first;p<=proof.pageSpan.last;p++){for(const kind of ['proof','baseline'])await runProcess('pdftoppm',['-r','96','-f',String(p),'-l',String(p),'-singlefile',kind+'.pdf',kind],dir,30000,signal(),()=>{});assert.equal(hash(await fs.readFile(path.join(dir,'proof.ppm'))),hash(await fs.readFile(path.join(dir,'baseline.ppm'))),'Fast baseline proof must include exact leading and edited-page pixels');}
  const changed=source.replace('Radius'+name+'{2.00}','Radius'+name+'{2.25}'),logs=[],partial=await c.previewRegionPage(changed,prepared.familyRange??range,first,signal(),30000,s=>logs.push(s),project,true),full=await reference.compile(changed,signal(),30000,()=>{},project);
  assert.ok(logs.join('').includes('GEOMETRY_'+name),'Edited geometry must execute its own picture');assert.equal(partial.timing.baselineCheckpointReused,false);
  for(const [kind,pdf]of [['partial',partial.pdf],['full',full]]){await fs.writeFile(path.join(dir,kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-f',String(page),'-l',String(page),'-singlefile',kind+'.pdf',kind],dir,30000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,'partial.ppm'))),hash(await fs.readFile(path.join(dir,'full.ppm'))));
  const labelChanged=source.replace(name+'Quart',name+'Spark'),labelOutput=await c.previewRegionPage(labelChanged,prepared.familyRange??range,first,signal(),30000,()=>{},project,true),labelFull=await reference.compile(labelChanged,signal(),30000,()=>{},project);
  for(const [kind,pdf]of [['partial',labelOutput.pdf],['full',labelFull]]){await fs.writeFile(path.join(dir,kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-f',String(page),'-l',String(page),'-singlefile',kind+'.pdf',kind],dir,30000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,'partial.ppm'))),hash(await fs.readFile(path.join(dir,'full.ppm'))),'The later family checkpoint must preserve edited label pixels');
 }
});

test('Cursor hints select a geometry-only block between blank lines and the baseline skips the complete picture tail',{timeout:60000},async t=>{
 const c=new ResidentCompiler(),reference=new ResidentCompiler();t.after(()=>{c.stop();reference.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n\\begin{tikzpicture}\n\n',block='\\draw[red,thick] (0,0)--(1,1);\n\n',tail='\\typeout{LATER_DRAWING}\n\\foreach \\i in {1,...,80}{\\draw[gray] (0,0)--({4*cos(\\i*4)},{2*sin(\\i*4)});}\n\n\\end{tikzpicture}\n\n\\end{document}\n',source=prefix+block+tail,range={from:prefix.length,to:prefix.length+block.length},at=range.from+20,lines=source.slice(0,at).split('\n'),project={characterMapping:true,focus:{line:lines.length,column:lines.at(-1).length}};
 await c.compile(source,signal(),20000,()=>{},project);
 // An earlier prose edit makes the first changed byte an unsuitable hint.
 const changed=source.replace('Before.','Earlier').replace('--(1,1)','--(1,2)'),full=await c.compile(changed,signal(),20000,()=>{},project);assert.ok(full);assert.equal(c.lastTiming.pageWitnessCaptured,true);
 const attempts=[],lane=new LocalPreview(async()=>true,async()=>true,()=>{},()=>{},()=>{},async()=>{attempts.push(c.lastTiming.baselineCheckpointReused);return true;});t.after(()=>lane.stop());
 c.previewRegionFlow=async()=>{throw Error('A recorded picture page must bypass exploratory paragraph rendering');};
 lane.continuous=true;lane.basis={bundle:{id:'geometry-proof'},options:{root:'main.tex'},source:changed,compilerSource:changed,project,pdf:full,takeCompiler:()=>c};lane.cursor={file:'main.tex',at};await lane.arm();
 assert.equal(lane.ready,true);assert.equal(lane.slot.pageMode,true);assert.deepEqual(attempts,[true]);assert.equal(lane.slot.sourcePages.first,1);lane.cancelIdle();await c.prepareRegion(changed,range,signal(),15000,()=>{},project);
 const logs=[],baseline=await c.previewRegionPage(changed,range,1,signal(),15000,s=>logs.push(s),project,true,undefined,true);assert.equal(baseline.timing.baselineCheckpointReused,true);assert.ok(!logs.join('').includes('LATER_DRAWING'),'The unchanged expensive tail must not be recalculated for baseline proof');
 const next=changed.replace('--(1,2)','--(2,2)'),editLogs=[],edited=await c.previewRegionPage(next,range,1,signal(),15000,s=>editLogs.push(s),project,true,undefined,true);assert.equal(edited.timing.baselineCheckpointReused,false);assert.ok(editLogs.join('').includes('LATER_DRAWING'));
 const complete=await reference.compile(next,signal(),20000,()=>{},project),dir=path.resolve('.test-output','picture-geometry-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 for(const [name,pdf]of [['local',edited.pdf],['full',complete]]){const stem=path.join(dir,name);await fs.writeFile(stem+'.pdf',pdf);await runProcess('pdftoppm',['-r','100','-singlefile',stem+'.pdf',stem],dir,15000,signal(),()=>{});}
 assert.equal(hash(await fs.readFile(path.join(dir,'local.ppm'))),hash(await fs.readFile(path.join(dir,'full.ppm'))));
});

test('A label after expensive geometry retains the nearest full-build checkpoint when earlier edits shift source offsets',{timeout:60000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore.\n\n\\begin{tikzpicture}\n\\foreach \\i in {1,...,100}{\\draw[gray] (0,0)--({4*cos(\\i*3)},{2*sin(\\i*3)});}\n\\typeout{EARLY_DRAWING_FINISHED}\n\\relax\n\n',label='\\node at (1,2) {NodeQuartz};\n\n',source=prefix+label+'\\end{tikzpicture}\n\n\\end{document}\n';
 const point=text=>{const lines=text.slice(0,text.indexOf('NodeQuartz')+4).split('\n');return {line:lines.length,column:lines.at(-1).length};};
 await c.compile(source,signal(),20000,()=>{},{characterMapping:true,focus:point(source)});
 const changed=source.replace('Before.','BeforeABC.'),range={from:prefix.length+3,to:prefix.length+3+label.length},project={characterMapping:true,focus:point(changed)};await c.compile(changed,signal(),20000,()=>{},project);
 assert.equal(c.lastTiming.pageWitnessCaptured,true);await c.prepareRegion(changed,range,signal(),20000,()=>{},project);
 const before=c.lastTiming.checkpointOffset,afterGeometry=Buffer.byteLength(changed.slice(0,changed.indexOf('\\relax\n\n')));assert.ok(before>=afterGeometry,'The baseline shortcut must not force later labels to recompile their unchanged expensive prefix');
 const next=changed.replace('NodeQuartz','NodeQuartx'),logs=[],edited=await c.previewRegionPage(next,range,1,signal(),15000,s=>logs.push(s),project,true);assert.equal(edited.timing.baselineCheckpointReused,false);assert.ok(!logs.join('').includes('EARLY_DRAWING_FINISHED'));
});

test('Nearby TikZ paragraphs share a bounded full-build checkpoint family and preserve their own geometry prefixes',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),reference=new ResidentCompiler();t.after(()=>{c.stop();reference.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore café.\n\n\\begin{tikzpicture}\n\n',geometry='\\typeout{EARLY_GEOMETRY}\n\\foreach \\i in {1,...,80}{\\draw[gray] (0,0)--({3*cos(\\i*4)},{2*sin(\\i*4)});}\n\\relax\n\n',label='\\typeout{LABEL_BLOCK}\n\\node at (1,2) {Quartz};\n\n',coordinate='\\typeout{COORDINATE_BLOCK}\n\\draw[red] (0,0)--(2,1);\n\n',source=prefix+geometry+label+coordinate+'\\end{tikzpicture}\n\nTail.\n\n\\end{document}\n';
 const ranges=[{from:prefix.length,to:prefix.length+geometry.length},{from:prefix.length+geometry.length,to:prefix.length+geometry.length+label.length},{from:prefix.length+geometry.length+label.length,to:prefix.length+geometry.length+label.length+coordinate.length}];
 const lines=source.slice(0,source.indexOf('Quartz')+3).split('\n'),project={characterMapping:true,focus:{line:lines.length,column:lines.at(-1).length}};
 await c.compile(source,signal(),30000,()=>{},project);assert.ok(c.lastTiming.pageWitnessCount>=3);assert.ok(c.lastTiming.pageWitnessCount<=6);
 for(const range of [ranges[1],ranges[2],ranges[0],ranges[1]]){
  await c.prepareRegion(source,range,signal(),15000,()=>{},project);assert.ok(c.lastTiming.baselinePageCostMs!==undefined);
  const logs=[],proof=await c.previewRegionPage(source,range,1,signal(),15000,s=>logs.push(s),project,true,undefined,true);assert.equal(proof.timing.baselineCheckpointReused,true);assert.ok(!/EARLY_GEOMETRY|LABEL_BLOCK|COORDINATE_BLOCK/.test(logs.join('')));
 }
 const edits=[{source:source.replace('Quartz','QuartzNew'),range:{from:ranges[1].from,to:ranges[1].to+3},replaysGeometry:false},{source:source.replace('--({3*cos','--({4*cos'),range:ranges[0],replaysGeometry:true}];
 const dir=path.resolve('.test-output','picture-family-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 for(let i=0;i<edits.length;i++){
  const e=edits[i],originalRange=ranges[i===0?1:0];await c.prepareRegion(source,originalRange,signal(),15000,()=>{},project);
  const logs=[],local=await c.previewRegionPage(e.source,e.range,1,signal(),15000,s=>logs.push(s),project,true,undefined,true);assert.equal(local.timing.baselineCheckpointReused,false);assert.equal(logs.join('').includes('EARLY_GEOMETRY'),e.replaysGeometry);
  const full=await reference.compile(e.source,signal(),30000,()=>{},project);
  for(const [name,pdf]of [['local',local.pdf],['full',full]]){const stem=path.join(dir,i+'-'+name);await fs.writeFile(stem+'.pdf',pdf);await runProcess('pdftoppm',['-r','100','-singlefile',stem+'.pdf',stem],dir,15000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,i+'-local.ppm'))),hash(await fs.readFile(path.join(dir,i+'-full.ppm'))));
 }
});

test('Continuous picture edits move between blocks without a full-build handoff and always replay the earliest changed prefix',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),reference=new ResidentCompiler(),frames=[],logs=[];let delivered;
 const lane=new LocalPreview(async()=>true,async frame=>{frames.push(frame);delivered?.();return true;},()=>{throw Error('Picture edits must remain local');},()=>{},s=>logs.push(s),async()=>true);t.after(()=>{lane.stop();c.stop();reference.stop();});
 const prefix='\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\nBefore café.\n\n\\begin{tikzpicture}\n\n',geometry='\\foreach \\i in {1,...,80}{\\draw[gray] (0,0)--({3*cos(\\i*4)},{2*sin(\\i*4)});}\n\\relax\n\n',label='\\node at (1,2) {Quartz};\n\n',coordinate='\\draw[red] (0,0)--(2,1);\n\n',source=prefix+geometry+label+coordinate+'\\end{tikzpicture}\n\nTail.\n\n\\end{document}\n',project={characterMapping:true};
 const pdf=await c.compile(source,signal(),30000,()=>{},project);lane.continuous=true;lane.basis={bundle:{id:'family-live'},options:{root:'main.tex'},source,compilerSource:source,project,pdf,takeCompiler:()=>c};lane.cursor={file:'main.tex',at:source.indexOf('Quartz')+3};await lane.arm();assert.equal(lane.ready,true);assert.ok(lane.slot.range.from<=prefix.length);assert.ok(lane.slot.range.to>=prefix.length+geometry.length+label.length+coordinate.length);const key=lane.slot.regionKey;
 const dir=path.resolve('.test-output','picture-family-live-'+randomUUID());await fs.mkdir(dir,{recursive:true});let changed=source;
 for(const [before,after]of [['Quartz','QuartzNew'],['--(2,1)','--(2,2)'],['{3*cos','{4*cos']]){
  const at=changed.indexOf(before)+2;lane.move('main.tex',at);assert.equal(lane.ready,true);assert.equal(lane.slot.regionKey,key);
  changed=changed.replace(before,after);const display=new Promise(resolve=>delivered=resolve);assert.equal(lane.request('main.tex',changed,'family-'+frames.length),true);await Promise.race([display,new Promise((_,reject)=>setTimeout(()=>reject(Error('No family frame')),15000).unref())]);
  const frame=frames.at(-1);assert.equal(frame.sourceHash,hash(changed));assert.equal(frame.pageOutput,true);assert.ok(frame.timing.familyCheckpointOffset!==undefined);
  if(before==='Quartz')assert.ok(frame.timing.familyCheckpointOffset>=Buffer.byteLength(prefix+geometry.slice(0,geometry.indexOf('\\relax'))),'Late label edits must retain expensive earlier geometry');
  if(before==='{3*cos')assert.ok(frame.timing.familyCheckpointOffset<=Buffer.byteLength(prefix),'An earlier geometry edit must invalidate all later checkpoints');
  const full=await reference.compile(changed,signal(),30000,()=>{},project),i=frames.length;
  for(const [name,data]of [['local',frame.pdf],['full',full]]){const stem=path.join(dir,i+'-'+name);await fs.writeFile(stem+'.pdf',data);await runProcess('pdftoppm',['-r','100','-singlefile',stem+'.pdf',stem],dir,15000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,i+'-local.ppm'))),hash(await fs.readFile(path.join(dir,i+'-full.ppm'))));
 }
 assert.ok(!logs.some(s=>/Broader layout required|returned the idle warm compiler/.test(s)));
});


test('A recently visited drawing is re-proved after an earlier edit and its returned edit matches full pages',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),fresh=new ResidentCompiler(),reference=new ResidentCompiler();const f=fixture(),source=f.source,project=f.project,full=await c.compile(source,signal(),30000,()=>{},project),messages=[],frames=[],fallbacks=[];
 let borrowed=false;const lane=new LocalPreview(async()=>true,async x=>{frames.push(x);return true;},id=>fallbacks.push(id),()=>{},m=>messages.push(m),async()=>true);t.after(()=>{lane.stop();c.stop();fresh.stop();reference.stop();});
 const until=async fn=>{for(let i=0;i<2000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out preparing recent picture: '+JSON.stringify({messages,visits:lane.visits,active:lane.slot&&{from:lane.slot.range.from,to:lane.slot.range.to,ready:lane.slot.ready},parked:lane.parked.map(s=>({from:s.range.from,to:s.range.to}))}));};
 lane.setContinuous(true);lane.setBasis({source,compilerSource:source,pdf:full,project,bundle:{id:'drawing-before'},options:{root:'main.tex'},takeCompiler:()=>borrowed?undefined:(borrowed=true,c)});lane.move('main.tex',source.indexOf('NodeQuartz')+4);await until(()=>lane.ready);lane.move('main.tex',source.indexOf('After.')+3);await until(()=>lane.ready);
 const next=source.replace('Before café.','Before a verified earlier edit.'),verified=await fresh.compile(next,signal(),30000,()=>{},project);let taken=false;
 lane.setBasis({...lane.basis,source:next,compilerSource:next,pdf:verified,bundle:{id:'drawing-after'},takeCompiler:()=>taken?undefined:(taken=true,fresh)});lane.move('main.tex',next.indexOf('After.')+3);
 await until(()=>lane.parked.some(s=>next.slice(s.range.from,s.range.to).includes('NodeQuartz')));const cached=lane.parked.find(s=>next.slice(s.range.from,s.range.to).includes('NodeQuartz'));assert.equal(cached.basis.bundle.id,'drawing-after');assert.equal(cached.pageReady,true);assert.ok(messages.includes('Local recent region prepared.\n'));
 lane.move('main.tex',next.indexOf('NodeQuartz')+4);assert.equal(lane.ready,true);assert.equal(lane.slot,cached);lane.cancelIdle();
 const edited=next.replace('NodeQuartz','NodeReturned');assert.equal(lane.request('main.tex',edited,'returned-drawing'),true);await until(()=>frames.length);assert.equal(frames[0].sourceHash,hash(edited));assert.equal(frames[0].pageOutput,true);assert.deepEqual(fallbacks,[]);
 const strict=await reference.compile(edited,signal(),30000,()=>{},project),dir=path.resolve('.test-output','recent-drawing-'+randomUUID());await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'local.pdf'),frames[0].pdf);await fs.writeFile(path.join(dir,'full.pdf'),strict);
 const span=frames[0].pageSpan;for(let page=span.first;page<=span.last;page++){for(const [name,index]of [['local',page-span.first+1],['full',page]])await runProcess('pdftoppm',['-r','96','-f',String(index),'-l',String(index),'-singlefile',name+'.pdf',name],dir,30000,signal(),()=>{});assert.equal(hash(await fs.readFile(path.join(dir,'local.ppm'))),hash(await fs.readFile(path.join(dir,'full.ppm'))),'Returned drawing must match strict full-build page pixels');}
});

