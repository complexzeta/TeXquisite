const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ResidentCompiler}=require('../dist/resident'),{RegionCompositor,sameSingleLinePlacement}=require('../dist/region-compositor'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;
test('Taller text preserves exact baseline placement and the complete rendered page',{timeout:120000},async t=>{
 const directory=path.resolve('.test-output','paragraph-baseline-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const local=new ResidentCompiler(),full=new ResidentCompiler();t.after(()=>{local.stop();full.stop();});
 const prefix='\\documentclass{amsart}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\nBefore text.\n\n',region='Testing testing testing\n\n',suffix='Following material must stay exactly in place.\n\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 const prepared=await local.prepareRegion(source,range,signal(),60000,()=>{},project),original=await local.previewRegionNodes(source,range,signal(),30000,()=>{},project),compositor=await RegionCompositor.create(prepared.pdf,prepared.navigation,original);
 const nextRegion=region.replace('testing\n','testing ordinarywords\n'),next=prefix+nextRegion+suffix,output=await local.previewRegionNodes(next,{from:prefix.length,to:prefix.length+nextRegion.length},signal(),30000,()=>{},project);
 assert.notEqual(output.fragment.heightSp,original.fragment.heightSp,'Exercise the formerly slow taller-letter case');assert.equal(sameSingleLinePlacement(original.fragment,output.fragment),true);assert.equal(compositor.compatible(output),true);
 const composed=await compositor.compose(output),complete=await full.compile(next,signal(),60000,()=>{},project);
 for(const [name,pdf]of [['local',composed.pdf],['full',complete]]){await fs.writeFile(path.join(directory,name+'.pdf'),pdf);await runProcess('pdftoppm',['-r','144','-f','1','-l','1',name+'.pdf',name],directory,30000,signal(),()=>{});}
 assert.equal(hash(await fs.readFile(path.join(directory,'local-1.ppm'))),hash(await fs.readFile(path.join(directory,'full-1.ppm'))),'All page pixels, including following text, must match a full build');
 for(const change of [f=>f.shape[0][1]++,f=>f.depthSp++,f=>f.shape[1][4]++,f=>f.stateHash+='changed',f=>f.shape.push([12,100])]){const changed=structuredClone(output);change(changed.fragment);assert.equal(compositor.compatible(changed),false);}
});
