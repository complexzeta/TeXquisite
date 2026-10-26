const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {hash}=require('../dist/core');
const {saveDocument}=require('../dist/saving');
test('A stale session adopts disk bytes already identical to the draft',async()=>{
 const dir=path.resolve('.test-output',randomUUID());await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,'main.tex');await fs.writeFile(file,'current draft\r\n');
 const doc={path:file,text:'current draft\n',eol:'\r\n',diskHash:hash('stale baseline'),dirty:true};
 await saveDocument(doc);assert.equal(doc.diskHash,hash('current draft\r\n'));assert.equal(doc.dirty,false);
});
test('Automatic save preserves CRLF and refuses to overwrite an external change',async()=>{
 const dir=path.resolve('.test-output',randomUUID());await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,'main.tex'),original='original\r\n';await fs.writeFile(file,original);
 const doc={path:file,text:'new\n',eol:'\r\n',diskHash:hash(original),dirty:true};
 await saveDocument(doc);assert.equal(await fs.readFile(file,'utf8'),'new\r\n');assert.equal(doc.dirty,false);
 await fs.writeFile(file,'external');doc.text='another edit';doc.dirty=true;
 await assert.rejects(saveDocument(doc),/changed outside/);assert.equal(await fs.readFile(file,'utf8'),'external');assert.equal(doc.dirty,true);
});
test('Typing during a save stays dirty rather than being lost or marked saved',async()=>{
 const dir=path.resolve('.test-output',randomUUID());await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,'main.tex');await fs.writeFile(file,'initial');
 const doc={path:file,text:'captured',eol:'\n',diskHash:hash('initial'),dirty:true};
 const saving=saveDocument(doc);doc.text='typed while saving';await saving;
 assert.equal(await fs.readFile(file,'utf8'),'captured');assert.equal(doc.text,'typed while saving');assert.equal(doc.dirty,true);
 await saveDocument(doc);assert.equal(await fs.readFile(file,'utf8'),'typed while saving');assert.equal(doc.dirty,false);
});
test('A temporary Windows file lock retries safely and rechecks external bytes',async()=>{
 const dir=path.resolve('.test-output',randomUUID());await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,'main.tex');await fs.writeFile(file,'original');
 const doc={path:file,text:'draft',eol:'\n',diskHash:hash('original'),dirty:true},rename=fs.rename;let calls=0;
 try{
  fs.rename=async(...args)=>{if(calls++===0)throw Object.assign(new Error('Temporary sharing violation'),{code:'EPERM'});return rename(...args);};
  await saveDocument(doc);assert.equal(await fs.readFile(file,'utf8'),'draft');assert.equal(doc.dirty,false);
  doc.text='newer draft';doc.dirty=true;calls=0;
  fs.rename=async(...args)=>{if(calls++===0){await fs.writeFile(file,'external edit during lock');throw Object.assign(new Error('Temporary sharing violation'),{code:'EPERM'});}return rename(...args);};
  await assert.rejects(saveDocument(doc),/changed outside/);assert.equal(await fs.readFile(file,'utf8'),'external edit during lock');assert.equal(doc.dirty,true);
 }finally{fs.rename=rename;}
});
