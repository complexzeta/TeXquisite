const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SuccessfulSourceStore}=require('../dist/successful-source');
test('successful source keeps one current snapshot and survives a restart',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'successful-source-'));
 try{
  const store=new SuccessfulSourceStore(root),file=path.join(root,'main.tex');
  store.remember(file,'First good source');store.remember(file,'Newest good source');
  assert.equal(await store.read(file),'Newest good source');await store.flush();
  assert.equal((await fs.readdir(root)).length,1);
  assert.equal(await new SuccessfulSourceStore(root).read(file),'Newest good source');
  assert.equal(await store.read(path.join(root,'unknown.tex')),undefined);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
