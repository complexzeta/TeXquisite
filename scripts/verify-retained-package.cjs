// Check the exact cloud-built portable payload before offering it for a trial.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict'),asar=require('@electron/asar');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fileHash(file){const digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))digest.update(bytes);return digest.digest('hex');}
(async()=>{
 const archive=path.resolve(process.argv[2]??''),directory=require('./test-artifacts.cjs').testDirectory('package-verification');assert.equal(path.basename(archive),'app.asar');
 const files=['dist/pdf-work-queue.js','dist/local-raster.js','dist/preview-recovery.js','dist/core.js','dist/main.js','dist/local-preview.js','dist/retained-navigation.js','dist/navigation-query.js','dist/region-compositor.js','dist/preload.js','dist/retained-layout.js','dist/performance-report.js','media/renderer.js','media/pdf-worker.js','media/index.html','media/app.css','engine/resident/pdftex.wasm','engine/resident/pdftex.js'];
 for(const file of files)assert.equal(hash(asar.extractFile(archive,path.normalize(file))),hash(fs.readFileSync(file)),file);
 const entries=asar.listPackage(archive).map(p=>p.replace(/^[/\\]/,'').replaceAll('\\','/'));assert.deepEqual(entries.filter(p=>/^(src|scripts|test|tests|projects|profile|\.test-output)\//.test(p)||/^(dist|media)\/.*\.map$/.test(p)),[]);
 for(const file of entries){if(asar.statFile(archive,path.normalize(file)).files)continue;const bytes=asar.extractFile(archive,path.normalize(file));for(const encoding of ['utf8','utf16le'])assert.equal(/[A-Za-z]:[/\\]+Users[/\\]+/i.test(bytes.toString(encoding)),false,'Private host path in '+file);}
 const pkg=JSON.parse(asar.extractFile(archive,'package.json')),source=JSON.parse(fs.readFileSync('package.json'));for(const key of ['name','version','license','main','description','productName','dependencies'])assert.deepEqual(pkg[key],source[key],key);assert.equal(pkg.license,'AGPL-3.0-only');
 const root=path.resolve(cp.execFileSync('git',['-C',process.cwd(),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim());assert.equal(root.toLowerCase(),path.resolve(process.cwd()).toLowerCase(),'Run package verification from the source checkout root');
 const portable=path.resolve(path.dirname(archive),'../..','TeXquisite-'+pkg.version+'-Windows.exe'),result={passed:true,version:pkg.version,sourceCommit:cp.execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeAssets:files.length,privatePathsAbsent:true,developmentFilesExcluded:true,asarSha256:await fileHash(archive),portableBytes:fs.statSync(portable).size,portableSha256:await fileHash(portable)};
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(String(error));process.exitCode=1;});
