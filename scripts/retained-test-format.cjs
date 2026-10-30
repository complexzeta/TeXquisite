// Optional fixture-only setup for a fresh TeX Live installation. Never uses a
// user's app profile and never substitutes or weakens format fingerprints.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
function nativeResources(){const file=process.env.PERSISTENT_TEX_TEST_RESOURCE_FILE;if(!file)return;const resources=JSON.parse(fs.readFileSync(file,'utf8'));assert.ok(resources.root&&resources.files&&resources.formatManifest);assert.ok(require('../dist/format-cache').preparedFormat(resources.formatManifest,path.resolve('engine/resident')),'Prepared test format no longer matches its inputs');return resources;}
function seedProfile(profile){
 const resources=nativeResources();if(!resources)return;const directory=path.dirname(resources.formatManifest),key=path.basename(directory);assert.match(key,/^[a-f0-9]{64}$/);const target=path.join(path.resolve(profile),'formats',key);assert.equal(path.dirname(path.dirname(target)),path.resolve(profile));fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(directory,target,{recursive:true,errorOnExist:true});
}
async function prepare(){
 const cache=process.env.PERSISTENT_TEX_TEST_FORMAT_CACHE;assert.ok(cache&&path.isAbsolute(cache),'Choose an explicit disposable format cache');const assets=path.resolve('engine/resident'),{fingerprintFiles,generateInstalledFormat}=require('../dist/format-cache'),{formatFingerprint,FORMAT_FINGERPRINT_POLICY}=require('../dist/format-fingerprint'),query=args=>cp.execFileSync('kpsewhich',args,{encoding:'utf8',windowsHide:true,timeout:10000}).trim(),root=query(['-var-value=TEXMFDIST']),files={},fingerprints={};
 for(const name of fingerprintFiles){files[name]=query([name]);fingerprints[name]=formatFingerprint(name,fs.readFileSync(files[name]),FORMAT_FINGERPRINT_POLICY);}files['pdftex.map']=query(['pdftex.map']);const bin=query(['-var-value=SELFAUTOLOC']);
 const manifest=await generateInstalledFormat({assets,cache,installation:bin,root,files,fingerprints,env:process.env});fs.writeFileSync(path.join(cache,'resources.json'),JSON.stringify({root,files,formatManifest:manifest}));const result={passed:true,selfTest:true,preparedKey:path.basename(path.dirname(manifest))};fs.writeFileSync(path.join(cache,'format-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
module.exports={nativeResources,seedProfile};if(require.main===module)prepare().catch(error=>{console.error(String(error));process.exitCode=1;});
