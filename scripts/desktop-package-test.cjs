const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
(async()=>{
 assert.equal(process.env.CI,'true');const directory=require('./test-artifacts.cjs').testDirectory('desktop-package-verification'),release=path.resolve('release'),result={passed:false,platform:process.platform,arch:process.arch,commit:process.env.GITHUB_SHA,assets:[]};
 const run=(exe,args,options={})=>cp.execFileSync(exe,args,{stdio:'inherit',...options});let mounted;
 try{
  const files=fs.readdirSync(release).filter(n=>process.platform==='darwin'?/\.(dmg|zip)$/.test(n):/\.(AppImage|deb)$/.test(n));assert.equal(files.length,2);
  for(const name of files){const file=path.join(release,name),hash=createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);result.assets.push({name,bytes:fs.statSync(file).size,sha256:hash.digest('hex')});}
  fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),result.assets.map(a=>a.sha256+'  '+a.name).join('\n')+'\n');let executable;
  if(process.platform==='darwin'){
   mounted=path.join(directory,'mounted');fs.mkdirSync(mounted);run('hdiutil',['attach',path.join(release,files.find(n=>n.endsWith('.dmg'))),'-readonly','-nobrowse','-mountpoint',mounted]);
   const bundle=path.join(mounted,'TeXquisite.app');run('codesign',['--verify','--deep','--strict',bundle]);executable=path.join(bundle,'Contents','MacOS','TeXquisite');result.adHocSignatureVerified=true;result.launchedFromDiskImage=true;
  }else{
   run('sudo',['apt-get','install','-y',path.join(release,files.find(n=>n.endsWith('.deb')))]);
   const installed=cp.execFileSync('dpkg',['-L','texquisite'],{encoding:'utf8'}).split('\n');executable=installed.find(n=>n.startsWith('/opt/')&&path.basename(n)==='texquisite');assert.ok(executable);
   const helper=installed.find(n=>path.basename(n)==='chrome-sandbox'),stat=fs.statSync(helper);assert.equal(stat.uid,0);assert.ok(stat.mode&0o4000,'Installed Chromium sandbox must have its required permissions');result.installedDeb=true;result.sandboxConfigured=true;
  }
  assert.ok(fs.existsSync(executable));run(process.execPath,['scripts/desktop-smoke-test.cjs'],{env:{...process.env,PERSISTENT_TEX_EXECUTABLE:executable}});result.packagedSmokePassed=true;result.passed=true;
 }catch(error){result.error=String(error);throw error;}
 finally{if(mounted)try{run('hdiutil',['detach',mounted]);}catch{}fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}));}
})().catch(e=>{console.error(String(e));process.exitCode=1;});
