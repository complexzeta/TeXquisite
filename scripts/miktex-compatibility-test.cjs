// Cloud-only real distribution checks. No user profiles or manuscripts.
const fs=require('node:fs/promises'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {inspectToolchain,discoverInstallations}=require('../dist/toolchain'),{ArtifactStore,BuildController,hash}=require('../dist/core'),{nativeForward,nativeBackward}=require('../dist/native-navigation');
(async()=>{
 assert.equal(process.env.CI,'true','This campaign must run in the cloud');
 const bin=process.env.TEXQUISITE_TEST_TEX_BIN,perl=process.env.TEXQUISITE_TEST_PERL_BIN,installRoot=process.env.TEXQUISITE_TEST_MIKTEX_ROOT;assert.ok(bin&&perl);
 const directory=require('./test-artifacts.cjs').testDirectory('miktex-native'),result={passed:false,fixtures:[]},logs=[];
 const env={...process.env};for(const key of Object.keys(env))if(/^(?:TEX|BIB|BST)/i.test(key)||key.toLowerCase()==='path')delete env[key];
 env.PATH=[bin,perl,path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.dirname(process.execPath)].join(path.delimiter);
 const run=(name,args,allowFailure=false)=>{const r=cp.spawnSync(path.join(bin,name+'.exe'),args,{cwd:directory,env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});logs.push((r.stdout??'')+(r.stderr??''));if(!allowFailure)assert.equal(r.status,0,name+' '+args.join(' ')+' '+(r.stderr??''));return r;};
 const prior={...process.env};for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
 let controller;
 try{
  const found=await discoverInstallations(undefined,env,[]);assert.equal(found.length,1);assert.equal(found[0].bin.toLowerCase(),bin.toLowerCase());result.pathDetection=true;
  const report=await inspectToolchain({selected:installRoot,roots:[],env,metadata:path.resolve('engine/resident/format.json')});assert.equal(report.distribution,'MiKTeX');assert.equal(report.ready,true,JSON.stringify(report.issues));assert.equal(report.fast.available,false);assert.match(report.fast.reason,/native compilation only/i);result.manualFolderDetection=true;result.nativeOnlyExplanation=report.fast.reason;
  const missingPerl=await inspectToolchain({selected:bin,roots:[],env:{...env,PATH:[bin,path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot].join(path.delimiter)},metadata:path.resolve('engine/resident/format.json')});result.withoutPerl={ready:missingPerl.ready,latexmk:missingPerl.tools.find(t=>t.name==='latexmk')};assert.equal(missingPerl.ready,false,'latexmk requires an external Perl runtime');assert.match(result.withoutPerl.latexmk.detail,/perl|script engine/i);
  // Explicitly enabled on-demand installation, confined to this runner.
  run('miktex',['packages','remove','cancel'],true);run('initexmf',['--set-config-value=[MPM]AutoInstall=0']);
  assert.equal(run('kpsewhich',['cancel.sty'],true).stdout.trim(),'');
  await fs.writeFile(path.join(directory,'auto.tex'),'\\documentclass{article}\\usepackage{cancel}\\begin{document}$\\cancel{x}$\\end{document}');
  const disabled=run('pdflatex',['--disable-installer','-interaction=nonstopmode','-halt-on-error','auto.tex'],true);assert.notEqual(disabled.status,0);assert.match(disabled.stdout+disabled.stderr,/cancel\.sty|not found/i);result.missingPackageFailsWithoutPrompt=true;
  run('initexmf',['--set-config-value=[MPM]AutoInstall=1']);run('pdflatex',['--enable-installer','-interaction=nonstopmode','-halt-on-error','auto.tex']);assert.ok(run('kpsewhich',['cancel.sty']).stdout.trim());run('initexmf',['--set-config-value=[MPM]AutoInstall=0']);result.onDemandPackageInstall=true;
  const source='\\documentclass{article}\n\\usepackage{amsmath,graphicx,tikz,hyperref}\n\\begin{document}\nFirstSentinel prose and $\\sqrt{\\pi}+\\frac12$.\n\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}\n\\newpage\nSecondSentinel words on page two.\n\\end{document}\n';
  const root=path.join(directory,'native.tex');await fs.writeFile(root,source);const store=new ArtifactStore(path.join(directory,'cache'));const issues=[];
  controller=new BuildController(store,{prepare:async()=>{},commit:()=>{},discard:()=>{},diagnostic:i=>issues.push(i)},()=>{},s=>logs.push(s));
  const build=async(text,id)=>{const started=Date.now();await controller.request({root,engine:'pdflatex',executable:path.join(bin,'latexmk.exe'),timeoutMs:120000,sourceText:text,characterMapping:true,editId:id});assert.ok(controller.current,logs.join('').slice(-2500));assert.equal(controller.current.sourceHash,hash(text));return Date.now()-started;};
  result.fixtures.push({name:'math-tikz-two-pages',ms:await build(source,'initial')});assert.equal(controller.current.pages,2);assert.ok(controller.current.synctex);const current=controller.current,nav=await store.navigation(current);assert.ok(nav?.nativeInputs?.[root]);
  const forward=await nativeForward(store.pdf(current),nav,root,7,1);assert.equal(forward?.[2],2,'Second-page forward navigation');const inverse=await nativeBackward(store.pdf(current),nav,2,forward[3]+1,forward[4]+forward[6]/2);assert.equal(inverse?.[0],root);assert.ok(inverse[1]>=6);result.twoWaySecondPageNavigation=true;
  const corrected=source.replace('FirstSentinel','EditedSentinel');result.fixtures.push({name:'ordinary-edit',ms:await build(corrected,'edit')});assert.equal(await fs.readFile(root,'utf8'),source,'Compilation never overwrites source');result.nativeEdit=true;
  result.passed=true;
 }catch(error){result.error=String(error);throw error;}finally{await controller?.dispose();run('initexmf',['--set-config-value=[MPM]AutoInstall=0'],true);for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);await fs.writeFile(path.join(directory,'failure.log'),logs.join('').slice(-200000));await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
