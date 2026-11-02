const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const signingInputs=['MAC_CERTIFICATE_P12_BASE64','MAC_CERTIFICATE_PASSWORD','MAC_SIGNING_IDENTITY','MAC_NOTARY_KEY_BASE64','MAC_NOTARY_KEY_ID','MAC_NOTARY_ISSUER'];
function missingSigningInputs(env){return signingInputs.filter(name=>!String(env[name]||'').trim());}
function requireSigningInputs(env){const missing=missingSigningInputs(env);if(missing.length)throw Error('Mac release is blocked. Configure these GitHub environment secrets: '+missing.join(', ')+'. Apple Developer membership is required. No unsigned fallback will be produced.');}
function configuration(base,{production,identity}){
 const config=structuredClone(base),entitlements='media/entitlements.mac-'+(production?'release':'rehearsal')+'.plist';
 if(production){if(!identity||identity==='-'||/[\r\n]/.test(identity))throw Error('A Developer ID Application signing identity is required.');identity=identity.replace(/^Developer ID Application: /,'');if(!identity||/^(?:Apple Development|Mac Developer|Developer ID Installer):/.test(identity))throw Error('A Developer ID Application signing identity is required.');}
 config.forceCodeSigning=true;config.mac={...config.mac,type:'distribution',identity:production?identity:'-',hardenedRuntime:true,entitlements,entitlementsInherit:entitlements,notarize:production,artifactName:'TeXquisite-${version}-macOS-${arch}-'+(production?'candidate':'rehearsal')+'.${ext}'};
 config.dmg={...config.dmg,sign:production};return config;
}
function mode(args){const flags=args.filter(a=>['--production','--rehearsal'].includes(a));if(flags.length!==1)throw Error('Choose exactly one of --production or --rehearsal.');return flags[0]==='--production';}
function decodeSecret(value,name){const text=String(value||'').replace(/\s/g,'');if(!text||text.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))throw Error('Invalid base64 encoding for '+name);return Buffer.from(text,'base64');}
function safeError(error,env){let text=String(error);for(const name of signingInputs){const value=String(env[name]||'');if(value)text=text.split(value).join('[redacted]');}return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted private key]');}
async function main(){
 const production=mode(process.argv.slice(2));if(production)requireSigningInputs(process.env);
 if(process.argv.includes('--preflight')){console.log(JSON.stringify({mode:production?'production':'rehearsal',ready:true}));return;}
 assert.equal(process.platform,'darwin','Mac release packaging requires a Mac cloud runner');assert.equal(process.env.CI,'true','Release candidates are built in CI');
 const arch=process.argv[process.argv.indexOf('--arch')+1];assert.ok(['arm64','x64'].includes(arch));assert.equal(arch,process.arch);
 const directory=require('./test-artifacts.cjs').testDirectory('mac-release'),report={passed:false,production,arch,hardenedRuntime:true,notarized:false,gatekeeperAccepted:false};let credentials;
 const exec=(name,args)=>cp.execFileSync(name,args,{encoding:'utf8',timeout:1800000});
 const display=(bundle,args)=>{const r=cp.spawnSync('codesign',['--display',...args,bundle],{encoding:'utf8',timeout:60000});assert.equal(r.status,0);return (r.stdout||'')+(r.stderr||'');};
 try{
  if(production){
   credentials=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'texquisite-signing-'));fs.chmodSync(credentials,0o700);
   const certificate=path.join(credentials,'signing.p12'),key=path.join(credentials,'notary.p8');fs.writeFileSync(certificate,decodeSecret(process.env.MAC_CERTIFICATE_P12_BASE64,'MAC_CERTIFICATE_P12_BASE64'),{mode:0o600});const privateKey=decodeSecret(process.env.MAC_NOTARY_KEY_BASE64,'MAC_NOTARY_KEY_BASE64');try{crypto.createPrivateKey(privateKey);}catch{throw Error('MAC_NOTARY_KEY_BASE64 must contain a valid private key.');}fs.writeFileSync(key,privateKey,{mode:0o600});
   process.env.CSC_LINK=certificate;process.env.CSC_KEY_PASSWORD=process.env.MAC_CERTIFICATE_PASSWORD;process.env.APPLE_API_KEY=key;process.env.APPLE_API_KEY_ID=process.env.MAC_NOTARY_KEY_ID;process.env.APPLE_API_ISSUER=process.env.MAC_NOTARY_ISSUER;
   // Prevent unrelated account/keychain settings from selecting another notarization method.
   for(const name of ['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','APPLE_KEYCHAIN','APPLE_KEYCHAIN_PROFILE'])delete process.env[name];
  }else{process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';}
  const base=require('../package.json').build,config=configuration(base,{production,identity:process.env.MAC_SIGNING_IDENTITY}),builder=require('electron-builder');
  await builder.build({targets:builder.Platform.MAC.createTarget(['dmg','zip'],builder.Arch[arch]),config,publish:'never'});
  const release=path.resolve(config.directories.output),bundles=fs.readdirSync(release).map(n=>path.join(release,n,'TeXquisite.app')).filter(n=>fs.existsSync(n));assert.equal(bundles.length,1);const bundle=bundles[0];
  exec('codesign',['--verify','--deep','--strict',bundle]);const signature=display(bundle,['--verbose=4']),entitlements=display(bundle,['--entitlements',':-']);assert.match(signature,/flags=.*runtime/);assert.match(entitlements,/com\.apple\.security\.cs\.allow-jit/);assert.ok(!entitlements.includes('com.apple.security.get-task-allow'));report.runtimeSignatureVerified=true;
  if(production){assert.match(signature,/Authority=Developer ID Application:/);assert.ok(!signature.includes('Signature=adhoc'));assert.ok(!entitlements.includes('disable-library-validation'));exec('xcrun',['stapler','validate',bundle]);
   const dmg=path.join(release,fs.readdirSync(release).find(n=>n.endsWith('.dmg'))),submission=JSON.parse(exec('xcrun',['notarytool','submit',dmg,'--key',process.env.APPLE_API_KEY,'--key-id',process.env.APPLE_API_KEY_ID,'--issuer',process.env.APPLE_API_ISSUER,'--wait','--output-format','json']));assert.equal(submission.status,'Accepted','Apple did not accept the DMG; no release artifact will be uploaded');exec('xcrun',['stapler','staple',dmg]);exec('xcrun',['stapler','validate',dmg]);
   exec('spctl',['--assess','--type','execute','--verbose=4',bundle]);exec('spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=4',dmg]);report.notarized=true;report.gatekeeperAccepted=true;
  }else{assert.match(signature,/Signature=adhoc/);assert.match(entitlements,/disable-library-validation/);report.adHocRehearsal=true;report.productionLibraryValidationTested=false;}
  const assets=fs.readdirSync(release).filter(n=>/\.(dmg|zip)$/.test(n));assert.equal(assets.length,2);report.assets=[];for(const name of assets){const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(path.join(release,name)))hash.update(part);report.assets.push({name,sha256:hash.digest('hex')});}fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),report.assets.map(a=>a.sha256+'  '+a.name).join('\n')+'\n');report.passed=true;
 }catch(error){report.error=safeError(error,process.env);throw Error(report.error);}
 finally{if(credentials)fs.rmSync(credentials,{recursive:true,force:true});fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
module.exports={missingSigningInputs,requireSigningInputs,configuration,mode,decodeSecret,safeError};
if(require.main===module)main().catch(error=>{console.error(safeError(error,process.env));process.exitCode=1;});
