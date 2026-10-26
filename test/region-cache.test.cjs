const {test}=require('node:test'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident');
const {paragraphAt}=require('../dist/local-preview');
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{hash,runProcess}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('Resident region cache switches exact checkpoints, rejects stale edits and enforces entry/byte caps',{timeout:90000},async t=>{
 const c=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{c.stop();full.stop();});const source='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\n'+Array.from({length:7},(_,i)=>'Region '+i+' with $x_'+i+'$.\n\n').join('')+'\\newpage\nTail.\\end{document}',project={characterMapping:true},regions=[];
 for(let i=0;i<5;i++){const range=paragraphAt(source,source.indexOf('Region '+i)),prepared=await c.prepareRegion(source,range,signal(),60000,()=>{},project);regions.push({range,key:prepared.regionKey});assert.ok(c.lastTiming.regionCacheEntries<=4);assert.ok(c.lastTiming.regionCacheBytes<=128*1024*1024);}
 assert.equal(c.hasRegion(regions[0].key),false);c.useRegion(regions[0].key);await assert.rejects(c.previewRegionFlow(source,regions[0].range,signal(),10000,()=>{},project,true),/evicted/);
 const b=regions[2],prepared=await c.prepareRegion(source,b.range,signal(),30000,()=>{},project);assert.equal(c.lastTiming.regionCacheHit,true);assert.equal(prepared.regionKey,b.key);
 c.useRegion(regions[4].key);await c.previewRegionFlow(source,regions[4].range,signal(),10000,()=>{},project,true);
 c.useRegion(b.key);const changed=source.replace('Region 2','Changed region 2'),output=await c.previewRegionFlow(changed,{from:b.range.from,to:b.range.to+8},signal(),10000,()=>{},project,true);assert.ok(output.navigation.includes('main.tex'));assert.equal(output.documentComplete,false);
 const dir=path.resolve('.test-output','region-cache-pixels-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 const page=await c.previewRegionPage(changed,{from:b.range.from,to:b.range.to+8},1,signal(),30000,()=>{},project),complete=await full.compile(changed,signal(),30000,()=>{},project);
 for(const [kind,pdf]of [['cached',page.pdf],['full',complete]]){await fs.writeFile(path.join(dir,kind+'.pdf'),pdf);await runProcess('pdftoppm',['-r','96','-f','1','-l','1','-singlefile',kind+'.pdf',kind],dir,30000,signal(),()=>{});}
 assert.equal(hash(await fs.readFile(path.join(dir,'cached.ppm'))),hash(await fs.readFile(path.join(dir,'full.ppm'))),'Switching cached region states must preserve full page pixels');
 await assert.rejects(c.previewRegionFlow(source.replace('Before.','Earlier'),b.range,signal(),10000,()=>{},project,true),/outside/);
 await c.compile(source,signal(),30000,()=>{},project);c.useRegion(b.key);await assert.rejects(c.previewRegionFlow(source,b.range,signal(),10000,()=>{},project,true),/evicted/);
});

test('Cached included checkpoints distinguish full paths and accept chapter offsets beyond root length',{timeout:90000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const root='\\documentclass{article}\n\\begin{document}\n\n\\input{one/chapter.tex}\n\\newpage\n\\input{two/chapter.tex}\n\\newpage\nTail.\\end{document}',prefix='Earlier '+('ordinary words '.repeat(35))+'.\n\n',a=prefix+'Target first.\n\n',b=prefix+'Target second.\n\n',inputs=[{file:'one/chapter.tex',text:a},{file:'two/chapter.tex',text:b}],project={characterMapping:true,resourceKey:'chapters',resources:inputs.map(i=>[i.file,Buffer.from(i.text)])},ranges=inputs.map(i=>({from:prefix.length,to:i.text.length})),keys=[];
 assert.ok(prefix.length>root.length);
 for(let i=0;i<2;i++){const p=await c.prepareRegion(root,ranges[i],signal(),60000,()=>{},project,undefined,inputs[i]);keys.push(p.regionKey);}
 for(let i=0;i<2;i++){c.useRegion(keys[i]);const out=await c.previewRegionFlow(root,ranges[i],signal(),30000,()=>{},project,true,inputs[i]);assert.ok(out.navigation.includes(inputs[i].file));assert.equal(out.fragment.page,i+1);}
 const changed={...project,resourceKey:'changed',resources:[[inputs[0].file,Buffer.from(a)],[inputs[1].file,Buffer.from(b+'% changed\n')]]};c.useRegion(keys[0]);await assert.rejects(c.previewRegionFlow(root,ranges[0],signal(),30000,()=>{},changed,true,inputs[0]),/project inputs/);
});
test('Idle preparation refuses a cold or stale baseline without discarding the usable cached region',{timeout:60000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const source='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\nTarget.\n\n\\newpage\nTail.\\end{document}',range=paragraphAt(source,source.indexOf('Target'));
 await assert.rejects(c.prepareRegion(source,range,signal(),30000,()=>{},{},undefined,undefined,true),/current converged baseline/);
 const p=await c.prepareRegion(source,range,signal(),30000,()=>{},{});const changed=source.replace('Before.','Earlier');await assert.rejects(c.prepareRegion(changed,range,signal(),30000,()=>{},{},undefined,undefined,true),/current converged baseline/);
 c.useRegion(p.regionKey);assert.ok((await c.previewRegionFlow(source,range,signal(),30000,()=>{},{},true)).pdf.length>100);
});

test('Idle cache pressure cannot evict the active region it is preparing around',{timeout:60000},async t=>{
 const c=new ResidentCompiler();t.after(()=>c.stop());const source='\\documentclass{article}\n\\begin{document}\n\nBefore.\n\n'+Array.from({length:7},(_,i)=>'Protected region '+i+'.\n\n').join('')+'\\newpage\nTail.\\end{document}',project={characterMapping:true},range=i=>paragraphAt(source,source.indexOf('Protected region '+i)),active=await c.prepareRegion(source,range(0),signal(),30000,()=>{},project);
 c.protectRegion(active.regionKey);
 for(let i=1;i<7;i++){await c.prepareRegion(source,range(i),signal(),30000,()=>{},project,undefined,undefined,true);assert.ok(c.hasRegion(active.regionKey));assert.ok(c.lastTiming.regionCacheEntries<=4);assert.ok(c.lastTiming.regionCacheBytes<=128*1024*1024);}
 c.protectRegion();c.useRegion(active.regionKey);assert.ok((await c.previewRegionFlow(source,range(0),signal(),10000,()=>{},project,true)).pdf.length>100);
});
