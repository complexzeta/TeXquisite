// Run bounded reliability workflows serially; preserve reports and clean successful fixtures.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const artifacts=require('./test-artifacts.cjs');
const suites=[
 ['units',['--test','--test-concurrency=1','test/saving.test.cjs','test/backups.test.cjs','test/document-root.test.cjs','test/diagnostics.test.cjs','test/test-artifacts.test.cjs']],
 ...['paste','conflict','close','close-active','backups','diagnostics','document-tabs','editing-session'].map(name=>[name,['scripts/'+name+'-test.cjs']])
];
async function main(){
 const args=process.argv.slice(2);assert.ok(args.length<=1&&(!args.length||args[0].startsWith('--only=')),'Usage: reliability-test.cjs [--only=units,backups,...]');
 const selected=args.length?args[0].slice(7).split(','):suites.map(([name])=>name);assert.ok(selected.length&&selected.every(name=>suites.some(([id])=>id===name)),'Unknown reliability suite');
 artifacts.artifactRoot({requireExternal:process.platform==='win32'&&!process.env.PERSISTENT_TEX_TEST_ARTIFACTS});
 const directory=artifacts.testDirectory('reliability'),tests=path.join(directory,'tests'),temporary=path.join(directory,'temporary');await fsp.mkdir(tests);await fsp.mkdir(temporary);
 const env={...process.env,PERSISTENT_TEX_TEST_ARTIFACTS:tests,TEMP:temporary,TMP:temporary,TMPDIR:temporary};
 const result={passed:false,directory,sourceVersion:JSON.parse(fs.readFileSync('package.json','utf8')).version,runtime:env.PERSISTENT_TEX_EXECUTABLE??'development runtime',selected,notRun:suites.map(([name])=>name).filter(name=>!selected.includes(name)),suites:[]};
 try{
  for(const [name,command]of suites){if(!selected.includes(name))continue;const log=path.join(directory,name+'.log'),handle=fs.openSync(log,'w'),started=Date.now();let exitCode;
   try{exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,command,{env:{...env,...(name==='editing-session'?{PERSISTENT_TEX_STRESS_CYCLES:'24',PERSISTENT_TEX_STRESS_PROSE:'1',PERSISTENT_TEX_STRESS_UNDO:'1',PERSISTENT_TEX_STRESS_REPAIR_EVERY:'12',PERSISTENT_TEX_STRESS_SWITCH_EVERY:'6',PERSISTENT_TEX_STRESS_UNICODE_PATH:'1'}:{})},stdio:['ignore',handle,handle],windowsHide:true});child.once('error',reject);child.once('close',code=>resolve(code??1));});}finally{fs.closeSync(handle);}
   const text=await fsp.readFile(log,'utf8'),skipped=name==='units'?Number(/(?:# |ℹ )skipped\s+(\d+)/.exec(text)?.[1]??0):undefined;result.suites.push({name,passed:exitCode===0,exitCode,elapsedMs:Date.now()-started,log,skipped});console.log(JSON.stringify(result.suites.at(-1)));
  }
  result.passed=result.suites.every(s=>s.passed);
  if(result.passed){
   const reports=path.join(directory,'reports');await fsp.mkdir(reports);
   for(const entry of await fsp.readdir(tests,{withFileTypes:true})){if(!entry.isDirectory())continue;const source=path.join(tests,entry.name),keep=path.join(reports,entry.name);for(const file of await fsp.readdir(source,{withFileTypes:true})){if(!file.isFile()||! /\.(json|log|cpuprofile|txt)$/.test(file.name))continue;await fsp.mkdir(keep,{recursive:true});const bytes=await fsp.readFile(path.join(source,file.name));await fsp.writeFile(path.join(keep,file.name),bytes);assert.deepEqual(await fsp.readFile(path.join(keep,file.name)),bytes,'Retained report copy differs');}}
   result.cleanup={removed:[],deferred:[]};for(const target of [tests,temporary]){const full=path.resolve(target);assert.equal(path.dirname(full),path.resolve(directory),'Cleanup must stay in the owned campaign');try{await fsp.rm(full,{recursive:true,force:true,maxRetries:5,retryDelay:100});result.cleanup.removed.push(full);}catch(error){result.cleanup.deferred.push({path:full,error:String(error)});}}
  }
 }finally{await fsp.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,directory,executed:result.suites.length,notRun:result.notRun,skipped:result.suites.reduce((n,s)=>n+(s.skipped??0),0),cleanup:result.cleanup??'Failed fixtures retained for diagnosis'}));}
 if(!result.passed)process.exitCode=1;
}
main().catch(error=>{console.error(String(error));process.exitCode=1;});
