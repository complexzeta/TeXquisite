const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;

test('Full verification resumes unchanged picture execution prefixes and matches independent full pages and navigation',{timeout:120000},async t=>{
 const compiler=new ResidentCompiler(),reference=new ResidentCompiler(),dir=path.resolve('.test-output','full-picture-resume-'+randomUUID());await fs.mkdir(dir,{recursive:true});t.after(()=>{compiler.stop();reference.stop();});
 const picture=name=>'\\begin{tikzpicture}\n\\typeout{GEOMETRY_'+name+'}\n\\foreach \\i in {1,...,24}{\\draw (0,0)--({2*cos(\\i*15)},{sin(\\i*15)});}\n\n\\node at (0,0) {'+name+'Quartz};\n\n\\end{tikzpicture}\n\n';
 let source='\\documentclass{article}\n\\usepackage{tikz}\n\\AtEndDocument{\\typeout{FULL_END_RAN}}\n\\begin{document}\n\nBefore café.\n\n'+picture('Alpha')+'\\newpage\n\n'+picture('Beta')+'Tail.\n\n\\end{document}\n';const project={characterMapping:true};
 await compiler.compile(source,signal(),30000,()=>{},project);assert.ok(compiler.lastTiming.pageWitnessCaptured);
 // Create an independent reference worker with all witness shortcuts disabled.
 const prior=process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS;try{process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS='1';await reference.compile(source,signal(),30000,()=>{},project);}finally{if(prior===undefined)delete process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS;else process.env.PERSISTENT_TEX_DISABLE_PAGE_WITNESS=prior;}
 for(const [index,before,after,skipped]of [[0,'AlphaQuartz','AlphaSpark','Alpha'],[1,'BetaQuartz','BetaShine','Beta'],[2,'Before café.','Changed prefix.','']]){
  source=source.replace(before,after);const logs=[],actual=await compiler.compile(source,signal(),30000,s=>logs.push(s),project),navigation=compiler.navigation;
  assert.ok(logs.join('').includes('FULL_END_RAN'),'The full document must really finish');
  if(skipped){assert.equal(compiler.lastTiming.fullWitnessReused,true);assert.ok(!logs.join('').includes('GEOMETRY_'+skipped),'Unchanged expensive geometry must not execute again');}
  else assert.ok(logs.join('').includes('GEOMETRY_Alpha'),'An earlier change must invalidate all later picture snapshots');
  const expected=await reference.compile(source,signal(),30000,()=>{},project);assert.equal(navigation,reference.navigation,'Full navigation must retain preceding pages and exact revised source positions');
  for(const [kind,pdf]of [['actual',actual],['expected',expected]]){const stem=index+'-'+kind;await fs.writeFile(path.join(dir,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96',stem+'.pdf',stem],dir,30000,signal(),()=>{});}
  const files=await fs.readdir(dir),actualPages=files.filter(n=>n.startsWith(index+'-actual-')&&n.endsWith('.ppm')),expectedPages=files.filter(n=>n.startsWith(index+'-expected-')&&n.endsWith('.ppm'));assert.equal(actualPages.length,2);assert.equal(expectedPages.length,2);
  for(const name of actualPages)assert.equal(hash(await fs.readFile(path.join(dir,name))),hash(await fs.readFile(path.join(dir,name.replace('-actual-','-expected-')))),'Every completed page must have exact full-build pixels');
 }
 // A body resource can have been consumed before the saved checkpoint.
 source=source.replace('Changed prefix.','\\input{body.tex}');
 const resources=text=>({...project,resourceKey:hash(text),resources:[['body.tex',Buffer.from(text)]]});
 await compiler.compile(source,signal(),30000,()=>{},resources('Original resource.'));
 const logs=[];await compiler.compile(source,signal(),30000,s=>logs.push(s),resources('Changed resource.'));assert.equal(compiler.lastTiming.fullWitnessReused,false);assert.ok(logs.join('').includes('GEOMETRY_Alpha'),'Changed captured inputs must invalidate all picture checkpoints');
 await compiler.compile(source,signal(),30000,()=>{},resources('Changed resource.'));
 await compiler.compile(source,signal(),30000,()=>{},{...resources('Changed resource.'),characterMapping:false});assert.equal(compiler.lastTiming.fullWitnessReused,false,'Mapping changes cannot reuse earlier glyph history');
 const crossReference=source.replace('Tail.','Tail. \\label{new-marker} Reference \\ref{new-marker}.');
 await compiler.compile(crossReference,signal(),30000,()=>{},{...resources('Changed resource.'),characterMapping:false});assert.ok(compiler.lastTiming.passes>=2,'New cross references must converge normally');assert.equal(compiler.lastTiming.fullWitnessReused,false,'An auxiliary rerun must discard preceding picture state');
});
