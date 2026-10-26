const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {generateInstalledFormat}=require('../dist/format-cache'),{testDirectory}=require('../scripts/test-artifacts.cjs');
test('A nonresponsive format worker times out without publishing a format',async()=>{
 const directory=testDirectory('format-timeout-unit'),assets=path.join(directory,'assets'),root=path.join(directory,'tex'),cache=path.join(directory,'cache');for(const p of [assets,root])fs.mkdirSync(p);
 fs.writeFileSync(path.join(assets,'pdftex.js'),'// No readiness message.');fs.writeFileSync(path.join(assets,'pdftex.wasm'),'fixture');fs.writeFileSync(path.join(root,'ls-R'),'');
 await assert.rejects(generateInstalledFormat({assets,cache,installation:directory,root,files:{},fingerprints:{},env:process.env,timeoutMs:10}),/timed out/);
 for(const name of fs.readdirSync(cache))assert.equal(fs.existsSync(path.join(cache,name,'manifest.json')),false);
});
