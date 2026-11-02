// Cloud-only: test the exact packages downloaded from a previous successful run.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
(async()=>{
 const preview=require('../DESKTOP-PREVIEW.json');assert.equal(process.env.CI,'true');assert.ok(Number.isSafeInteger(preview.run)&&preview.run>0);assert.equal(process.env.TEXQUISITE_PACKAGE_RUN,String(preview.run));
 const directory=require('./test-artifacts.cjs').testDirectory('desktop-installation'),downloads=process.env.TEXQUISITE_DOWNLOADED_PACKAGES;assert.ok(downloads);
 const result={passed:false,platform:process.platform,arch:process.arch,testCommit:process.env.GITHUB_SHA,packageRun:Number(process.env.TEXQUISITE_PACKAGE_RUN),variants:[]};
 const run=(exe,args,options={})=>cp.execFileSync(exe,args,{stdio:'inherit',timeout:120000,...options});
 const capture=(exe,args)=>{const r=cp.spawnSync(exe,args,{encoding:'utf8',timeout:60000});return {status:r.status,signal:r.signal,output:((r.stdout||'')+(r.stderr||'')).slice(0,6000),...(r.error?{error:String(r.error)}:{})};};
 const manifests=new Map(fs.readFileSync('DESKTOP-PREVIEW-SHA256SUMS.txt','utf8').trim().split(/\r?\n/).map(l=>{const m=l.match(/^([a-f0-9]{64})  (TeXquisite-[^/\\]+)$/);assert.ok(m);return [m[2],m[1]];}));
 const files=fs.readdirSync(downloads).filter(n=>process.platform==='darwin'?/\.(dmg|zip)$/.test(n):/\.deb$/.test(n));assert.equal(files.length,process.platform==='darwin'?2:1);result.packageSourceCommit=preview.sourceCommit;
 try{
  for(const name of files){const h=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(downloads,name)))h.update(chunk);assert.equal(h.digest('hex'),manifests.get(name),'Downloaded package checksum: '+name);}
  result.downloadChecksumsVerified=true;
  for(const extension of process.platform==='darwin'?['zip','dmg']:['deb']){
   const variant={format:extension,passed:false},work=path.join(directory,extension);fs.mkdirSync(work);result.variants.push(variant);let mounted;
   try{
    const asset=path.join(downloads,files.find(n=>n.endsWith('.'+extension)));let executable,bundle;
    if(process.platform==='darwin'){
     let source;
     if(extension==='zip'){run('ditto',['-x','-k',asset,work]);source=path.join(work,'TeXquisite.app');}
     else{mounted=path.join(work,'mounted');fs.mkdirSync(mounted);run('hdiutil',['attach',asset,'-readonly','-nobrowse','-mountpoint',mounted]);source=path.join(mounted,'TeXquisite.app');}
     bundle=path.join('/Applications','TeXquisite-installation-'+extension+'.app');assert.ok(!fs.existsSync(bundle));run('ditto',[source,bundle]);
     run('codesign',['--verify','--deep','--strict',bundle]);variant.copiedToApplications=true;variant.signatureVerified=true;
     executable=path.join(bundle,'Contents','MacOS','TeXquisite');
     // Assess the freshly installed, quarantined bundle before its first launch.
     // Only this disposable test bundle is then approved for raw functional tests;
     // a successful smoke run must never be reported as Gatekeeper acceptance.
     run('xattr',['-w','com.apple.quarantine','0083;'+Math.floor(Date.now()/1000).toString(16)+';TeXquisiteInstallationTest;',bundle]);
     variant.quarantineApplied=true;variant.gatekeeperStatus=capture('spctl',['--status']);variant.gatekeeper=capture('spctl',['--assess','--type','execute','--verbose=4',bundle]);
     variant.stapledTicket=capture('xcrun',['stapler','validate',bundle]);variant.downloadAccepted=variant.gatekeeper.status===0;
     run('xattr',['-d','com.apple.quarantine',bundle]);variant.quarantineRemovedForFunctionalTest=true;
    }else{
     run('sudo',['apt-get','install','-y',asset]);const installed=cp.execFileSync('dpkg',['-L','texquisite'],{encoding:'utf8'}).split('\n');executable=installed.find(n=>n.startsWith('/opt/')&&path.basename(n)==='texquisite');assert.ok(executable);variant.installedDeb=true;
     const desktop=installed.find(n=>n.endsWith('/texquisite.desktop'));assert.ok(desktop);const text=fs.readFileSync(desktop,'utf8');assert.ok(text.includes(executable));assert.ok(!text.includes('--no-sandbox'));variant.desktopLauncherVerified=true;
    }
    const log=fs.openSync(path.join(work,'functional.log'),'w');let smoke;
    try{smoke=cp.spawnSync(process.execPath,['scripts/desktop-smoke-test.cjs'],{env:{...process.env,PERSISTENT_TEX_EXECUTABLE:executable,PERSISTENT_TEX_TEST_VARIANT:extension},stdio:['ignore',log,log],timeout:600000});}finally{fs.closeSync(log);}
    variant.functionalExit=smoke.status;assert.equal(smoke.status,0,extension+' functional test failed; see functional.log');variant.functionalPassed=true;
    variant.passed=true;
   }catch(error){variant.error=String(error);}
   finally{if(mounted)try{run('hdiutil',['detach',mounted]);}catch(error){variant.cleanupError=String(error);variant.passed=false;}}
  }
  result.passed=result.variants.every(v=>v.passed);result.readyForUnattendedDownload=process.platform==='darwin'?result.variants.every(v=>v.downloadAccepted&&/assessments enabled/i.test(v.gatekeeperStatus.output)):result.passed;
 }catch(error){result.error=String(error);}
 finally{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
 assert.equal(result.passed,true,'One or more installation paths failed');
})().catch(e=>{console.error(String(e));process.exitCode=1;});
