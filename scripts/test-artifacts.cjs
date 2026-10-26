// New test projects and profiles belong on Kingston, not on the system drive.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
let cachedRoot;
function artifactRoot(){
 if(cachedRoot)return cachedRoot;
 if(process.env.PERSISTENT_TEX_TEST_ARTIFACTS){cachedRoot=path.resolve(process.env.PERSISTENT_TEX_TEST_ARTIFACTS);}
 else if(process.platform==='win32'){
  const output=execFileSync('powershell.exe',['-NoProfile','-Command',"@((Get-Volume | Where-Object { $_.FileSystemLabel -eq 'Kingston' -and $_.DriveLetter }) | ForEach-Object { $_.DriveLetter }) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}).trim();
  const drives=output?JSON.parse(output):[];const list=Array.isArray(drives)?drives:[drives];
  if(list.length>1)throw Error('Multiple Kingston volumes: choose PERSISTENT_TEX_TEST_ARTIFACTS explicitly.');
  if(list.length===1){if(!/^[A-Z]$/i.test(list[0]))throw Error('Invalid Kingston drive.');cachedRoot=path.join(list[0]+':\\','Persistent-TeX','test-runs');}
 }
 if(!cachedRoot){cachedRoot=path.resolve('.test-output','disposable');console.warn('Kingston absent: bounded local test only; remove this disposable run after recording its result.');}
 fs.mkdirSync(cachedRoot,{recursive:true});return cachedRoot;
}
function testDirectory(label){if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid test label.');const directory=path.join(artifactRoot(),label+'-'+randomUUID());fs.mkdirSync(directory);return directory;}
module.exports={artifactRoot,testDirectory};
