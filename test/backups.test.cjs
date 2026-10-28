const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {BackupStore}=require('../dist/backups');
const {diagnosticAdvice}=require('../dist/diagnostics');
const doc=(file,text,eol='\n')=>({path:file,text,eol,dirty:true,diskHash:''});
async function fixture(t,options){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tex-backup-unit-'));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tex-backup-unit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,store:new BackupStore(path.join(dir,'backups'),options)};}
test('backups capture exact LF and CRLF buffers, deduplicate, survive restart and snapshot inputs immediately',async t=>{
 const {dir,store}=await fixture(t),root=path.join(dir,'main.tex'),docs=[doc(root,'draft\n'),doc(path.join(dir,'chapter.tex'),'equation\n','\r\n')];
 const pending=store.capture(root,docs);docs[0].text='later';const first=await pending;assert.equal(first.saved,true);let snapshots=await store.list();assert.equal(snapshots.length,1);assert.equal((await store.read(first.id,0)).bytes.toString(),'draft\n');assert.equal((await store.read(first.id,1)).bytes.toString(),'equation\r\n');
 assert.equal((await store.capture(root,[doc(root,'draft\n'),docs[1]])).saved,false);await Promise.all([store.capture(root,docs),store.capture(root,[doc(root,'latest')])]);snapshots=await new BackupStore(path.join(dir,'backups')).list();assert.equal(snapshots.length,3);assert.equal((await store.read(snapshots[0].id,0)).bytes.toString(),'latest');assert.equal(await fs.stat(root).catch(()=>null),null);
});
test('backup retention caps count and bytes, preserving unrelated files',async t=>{
 let now=Date.now();const {dir,store}=await fixture(t,{maxSnapshots:3,maxBytes:5000,now:()=>now++}),root=path.join(dir,'main.tex');await fs.mkdir(path.join(dir,'backups'));await fs.writeFile(path.join(dir,'backups','user-document.tex'),'untouched');
 for(let i=0;i<10;i++)await store.capture(root,[doc(root,'version '+i)]);const list=await store.list();assert.equal(list.length,3);assert.ok(list.reduce((n,s)=>n+s.size,0)<=5000);assert.equal((await store.read(list[0].id,0)).bytes.toString(),'version 9');assert.equal(await fs.readFile(path.join(dir,'backups','user-document.tex'),'utf8'),'untouched');
});
test('corrupted payloads and invalid selections fail without touching original source',async t=>{
 const {dir,store}=await fixture(t),root=path.join(dir,'main.tex');await fs.writeFile(root,'original');const result=await store.capture(root,[doc(root,'recoverable')]);await assert.rejects(store.read('../main.tex',0),/Invalid/);await assert.rejects(store.read(result.id,-1),/selection/);
 const file=path.join(dir,'backups',result.id),bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);await assert.rejects(store.read(result.id,0),/checksum/);assert.equal(await fs.readFile(root,'utf8'),'original');
});
test('oversized buffers and full corrupt stores preserve existing bytes',async t=>{
 const {dir,store}=await fixture(t,{maxBytes:700}),root=path.join(dir,'main.tex');await assert.rejects(store.capture(root,[doc(root,'x'.repeat(33*1024*1024))]),/32 MiB/);
 await fs.mkdir(path.join(dir,'backups'),{recursive:true});const id='a'.repeat(32)+'.'+Date.now()+'.00000000-0000-0000-0000-000000000000.ptbackup';await fs.writeFile(path.join(dir,'backups',id),Buffer.alloc(800));await assert.rejects(store.capture(root,[doc(root,'new')]),/limit/);assert.equal((await fs.stat(path.join(dir,'backups',id))).size,800);
});
test('retention preserves hourly and daily history beyond twenty recent copies',async t=>{
 let now=Date.now()-13*86400000;const {dir,store}=await fixture(t,{now:()=>now}),root=path.join(dir,'main.tex');for(let i=0;i<13;i++){await store.capture(root,[doc(root,'day '+i)]);now+=86400000;}for(let i=0;i<23;i++){await store.capture(root,[doc(root,'recent '+i)]);now+=1000;}const list=await store.list();assert.ok(list.length>20&&list.length<=36);assert.ok(list.some(s=>s.created<now-10*86400000));
});
test('diagnostic advice is specific and keeps unknown errors unmodified',()=>{
 assert.match(diagnosticAdvice('Undefined control sequence.'),/spelling/);assert.match(diagnosticAdvice('Missing $ inserted.'),/math delimiters/);assert.match(diagnosticAdvice('Extra }, or forgotten $.'),/brace/);assert.match(diagnosticAdvice('Missing \\right. inserted.'),/invisible/);assert.match(diagnosticAdvice('File `foo.sty\' not found.'),/package/);assert.equal(diagnosticAdvice('Unknown unusual message'),undefined);
});
test('a damaged newest snapshot cannot suppress a fresh backup of unchanged source',async t=>{
 const {dir,store}=await fixture(t),root=path.join(dir,'main.tex'),docs=[doc(root,'protect this')],first=await store.capture(root,docs),file=path.join(dir,'backups',first.id),bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);const next=await store.capture(root,docs);assert.equal(next.saved,true);assert.equal((await store.read(next.id,0)).bytes.toString(),'protect this');
});
test('symlink snapshots are refused and never pruned as ordinary backups',async t=>{
 const {dir,store}=await fixture(t,{maxSnapshots:1}),root=path.join(dir,'main.tex');await fs.writeFile(root,'outside');await store.capture(root,[doc(root,'first')]);const id='b'.repeat(32)+'.'+Date.now()+'.00000000-0000-0000-0000-000000000000.ptbackup',link=path.join(dir,'backups',id);try{await fs.symlink(root,link,'file');}catch(e){if(e.code==='EPERM')return t.skip('OS does not permit creating test symlinks');if(process.platform==='win32'&&e.code==='EISDIR'){const drive=path.parse(dir).root;if(/^[a-z]:\\$/i.test(drive)){const format=require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command','(Get-Volume -DriveLetter '+drive[0]+').FileSystem'],{encoding:'utf8',windowsHide:true}).trim();if(format==='exFAT')return t.skip('The selected exFAT artifact filesystem cannot create file symlinks; portable rejection coverage runs separately');}}throw e;}await assert.rejects(store.read(id,0),/ordinary file/);await store.capture(root,[doc(root,'second')]);assert.equal((await fs.lstat(link)).isSymbolicLink(),true);assert.equal(await fs.readFile(root,'utf8'),'outside');
});


test('symbolic-link metadata is rejected by backup reads and retention on every filesystem',async t=>{
 const {dir,store}=await fixture(t,{maxSnapshots:1}),root=path.join(dir,'main.tex');await fs.writeFile(root,'outside source');const first=await store.capture(root,[doc(root,'first draft')]),file=path.join(dir,'backups',first.id),bytes=await fs.readFile(file),lstat=fs.lstat;
 try{fs.lstat=async(...args)=>{const stat=await lstat(...args);if(path.resolve(String(args[0]))===path.resolve(file))stat.isSymbolicLink=()=>true;return stat;};await assert.rejects(store.read(first.id,0),/ordinary file/);await store.capture(root,[doc(root,'second draft')]);assert.deepEqual(await fs.readFile(file),bytes,'A nonordinary entry must never be pruned');assert.equal(await fs.readFile(root,'utf8'),'outside source');}finally{fs.lstat=lstat;}
});
