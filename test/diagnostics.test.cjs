const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseDiagnostic}=require('../dist/diagnostics');
const inputs=[{file:'ROOT',aliases:['main.tex','/work/main.tex','C:/mirror/main.tex']},{file:'CHAPTER',aliases:['chapters/one.tex','/work/chapters/one.tex','C:/mirror/chapters/one.tex']},{file:'SPACES',aliases:['parts/two words.tex']}];
test('TeX diagnostics resolve current includes, closed include stacks and resumed root errors',()=>{
 assert.deepEqual(parseDiagnostic('(main.tex (chapters/one.tex\n! Undefined control sequence.\nl.4 \\broken\n',inputs),{kind:'tex',message:'Undefined control sequence.',file:'CHAPTER',line:4});
 assert.equal(parseDiagnostic('(main.tex (chapters/one.tex [1])\n! Missing $ inserted.\nl.9 x',inputs).file,'ROOT');
 assert.equal(parseDiagnostic('(main.tex (./a-wrapped-filename-\ncontinued.tex\n! Missing $ inserted.\nl.2 x',inputs).file,undefined);
 assert.equal(parseDiagnostic('! Missing } inserted.\nl.7 text',inputs).line,7);
 assert.equal(parseDiagnostic('(main.tex ("parts/two words.tex"\n! Missing $ inserted.\nl.2 x',inputs).file,'SPACES');
 assert.equal(parseDiagnostic('(main.tex (/tex/broken-package.sty\n! Undefined control sequence.\nl.8 x',inputs).file,undefined,'Unknown package paths must not invent a root location');
});
test('Native file-line diagnostics map only captured aliases, and generic failures stay compact',()=>{
 assert.deepEqual(parseDiagnostic('C:/mirror/chapters/one.tex:12: Undefined control sequence.\n',inputs),{kind:'tex',message:'Undefined control sequence.',file:'CHAPTER',line:12});
 assert.equal(parseDiagnostic('./chapters/one.tex:3: Missing $ inserted.',inputs).file,'CHAPTER');
 assert.deepEqual(parseDiagnostic('This is pdfTeX\n./slides.nav:1: Undefined control sequence.',inputs),{kind:'tex',message:'Undefined control sequence.'});
 assert.deepEqual(parseDiagnostic('C:/outside/secret.tex:8: a failure',inputs),{kind:'tex',message:'a failure'});
 assert.deepEqual(parseDiagnostic('Error: Injected raster failure\nLong log follows',inputs),{kind:'build',message:'Injected raster failure'});
 assert.equal(parseDiagnostic('! File ended while scanning use of \\frac.\n',inputs).file,undefined);
});


test('Real resident and native diagnostics retain captured chapter identity and leave the accepted PDF intact',{timeout:90000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
 const {ArtifactStore,BuildController,hash}=require('../dist/core');
 const directory=path.resolve('.test-output','diagnostic-build-'+randomUUID()),project=path.join(directory,'source');await fs.mkdir(project,{recursive:true});
 const root=path.join(project,'main.tex'),chapter=path.join(project,'chapter.tex'),source='\\documentclass{article}\n\\begin{document}\nRoot.\n\\input{chapter}\n\\end{document}\n';await fs.writeFile(root,source);await fs.writeFile(chapter,'Good chapter.');
 const issues=[],store=new ArtifactStore(path.join(directory,'resident')),controller=new BuildController(store,{prepare:async()=>{},commit:()=>{},discard:()=>{},diagnostic:issue=>issues.push(issue)},()=>{},()=>{});t.after(()=>controller.cancel());
 const options={root,sourceText:source,engine:'pdflatex',executable:'latexmk',automatic:true,timeoutMs:60000};await controller.request(options);const good=controller.current;assert.ok(good);
 const broken='Chapter.\n\\undefinedDiagnosticCommand\n';await controller.request({...options,sourceFiles:{[chapter]:broken},editId:'chapter-error'});
 assert.equal(controller.current.id,good.id);const issue=issues.at(-1);assert.equal(issue.file,chapter);assert.equal(issue.line,2);assert.equal(issue.sourceHash,hash(broken));assert.equal(issue.editId,'chapter-error');assert.equal(issue.kind,'tex');
 const nativeIssues=[],native=new BuildController(new ArtifactStore(path.join(directory,'native')),{prepare:async()=>{},commit:()=>{},discard:()=>{},diagnostic:issue=>nativeIssues.push(issue)},()=>{},()=>{});t.after(()=>native.cancel());
 await native.request({...options,sourceFiles:{[chapter]:broken},editId:'native-error',executable:process.platform==='win32'?'latexmk.exe':'/usr/bin/latexmk'});
 assert.equal(native.current,undefined);assert.equal(nativeIssues.at(-1).file,chapter);assert.equal(nativeIssues.at(-1).line,2);assert.equal(nativeIssues.at(-1).sourceHash,hash(broken));
 native.store.stage=async()=>{throw Error('PDF validation probe: invalid PDF');};
 await native.request({...options,sourceFiles:{[chapter]:'Repaired chapter.'},editId:'pdf-error',executable:process.platform==='win32'?'latexmk.exe':'/usr/bin/latexmk'});
 assert.equal(nativeIssues.at(-1).kind,'build');assert.equal(nativeIssues.at(-1).message,'PDF validation probe: invalid PDF');assert.equal(nativeIssues.at(-1).file,undefined);

});


test('Cancelling a captured build does not publish a compiler error diagnostic',{timeout:10000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{ArtifactStore,BuildController}=require('../dist/core');
 const directory=path.resolve('.test-output','cancel-diagnostic-'+randomUUID()),project=path.join(directory,'source');await fs.mkdir(project,{recursive:true});const root=path.join(project,'main.tex');await fs.writeFile(root,'Root');
 const issues=[],statuses=[];let started;const ready=new Promise(resolve=>started=resolve);
 const controller=new BuildController(new ArtifactStore(path.join(directory,'store')),{prepare:async()=>{},commit:()=>{},discard:()=>{},diagnostic:issue=>issues.push(issue)},s=>statuses.push(s),()=>{});t.after(()=>controller.cancel());
 controller.resident.compile=(_source,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Build cancelled.')),{once:true});started();});
 const build=controller.request({root,sourceText:'Root',engine:'pdflatex',executable:'latexmk',timeoutMs:30000});await ready;controller.cancel();await build;
 assert.deepEqual(issues,[]);assert.match(statuses.at(-1),/^Build cancelled/);
});


test('PSTricks format failures explain the required build option and preserve a captured source location',()=>{
 const issue=parseDiagnostic('./main.tex:5: Undefined control sequence.\n\\c@lor@to@ps ->\\PSTricks \n _Not_Configured_For_This_Format\n',inputs);assert.equal(issue.file,'ROOT');assert.equal(issue.line,5);assert.match(issue.message,/PSTricks is not configured/);assert.match(require('../dist/diagnostics').diagnosticAdvice(issue.message),/PostScript/);
});

test('Converter and bibliography failures identify the failed stage instead of the TeX version banner',()=>{
 const converter=parseDiagnostic('This is pdfTeX, Version 3\nOutput written on main.dvi\nError: /typecheck in --div--\nGPL Ghostscript 10.05.1: Unrecoverable error, exit code 1\n',inputs);assert.deepEqual(converter,{kind:'build',message:'PostScript conversion failed: /typecheck in --div--'});
 assert.deepEqual(parseDiagnostic("This is BibTeX\nI couldn't open style file custom.bst\n",inputs),{kind:'build',message:'Bibliography file not found: custom.bst'});
});
