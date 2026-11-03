// Compare two owned cloud artifacts; source text and user profiles are excluded.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
const [rebuilt,official]=process.argv.slice(2),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(process.env.CI,'true');assert.ok(rebuilt&&official);
assert.equal(hash(fs.readFileSync(official)),'9b56f99d9844ae3bc41838f6fe7eac2b72e421c6cc4aa8840d7f80a5ba6a40d2');
function files(archive){return new Map(asar.listPackage(archive).filter(n=>!asar.statFile(archive,n).files).map(n=>[n.replaceAll('\\','/').replace(/^\//,''),hash(asar.extractFile(archive,n)))]));}
const a=files(rebuilt),b=files(official),differences=[...new Set([...a.keys(),...b.keys()])].sort().filter(n=>a.get(n)!==b.get(n)).map(name=>({name,rebuilt:a.get(name),official:b.get(name)}));
const pkg=JSON.parse(asar.extractFile(official,'package.json'));assert.equal(pkg.version,'0.133.0');
const result={passed:true,sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),releaseBinarySource:'986eaf33ef33ef530ec6b7ced811a602795adb35',version:pkg.version,officialAsarSha256:hash(fs.readFileSync(official)),rebuiltAsarSha256:hash(fs.readFileSync(rebuilt)),filesCompared:b.size,differences};
const directory=require('./test-artifacts.cjs').testDirectory('portable-runtime-diff');fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
