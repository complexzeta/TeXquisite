const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {BuildController,ArtifactStore}=require('../dist/core'),{LocalPreview}=require('../dist/local-preview');
for(const outcome of ['reject','cancel','overshift','restore','restore-error'])test('Placement proposal retains visual proof and translation limits: '+outcome,{timeout:60000},async t=>{
 const dir=require('../scripts/test-artifacts.cjs').testDirectory('placement-proof'),root=path.join(dir,'source','main.tex'),source='\\documentclass{article}\n\\begin{document}\n\nBefore paragraph.\n\nTarget ordinary words.\n\n\\end{document}\n';await fs.mkdir(path.dirname(root),{recursive:true});await fs.writeFile(root,source);
 let entered,release,proposals=0,proofs=0,published=0;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r),logs=[];
 const positions=[];const lane=new LocalPreview(async(_basis,_pdf,_page,_fragmentPdf,_fragment,_footprint,calibration)=>{
  proofs++;positions.push(calibration.x);entered();await gate;if(outcome==='restore-error'&&proofs===1)throw Error('Proposed placement failed');return outcome==='overshift'?{dx:.009,dy:0}:outcome.startsWith('restore')&&proofs===2;
 },async()=>{published++;return true;},()=>{},()=>{},text=>logs.push(text),undefined,async()=>{proposals++;return {dx:outcome==='overshift'?.009:.001,dy:0,calibratedGlyphs:[]};});lane.setContinuous(true);lane.move(root,source.indexOf('Target'));
 const controller=new BuildController(new ArtifactStore(path.join(dir,'store')),{prepare:async()=>{},commit:()=>{},discard:()=>{},localBasis:b=>lane.setBasis(b)},()=>{},()=>{});
 t.after(async()=>{release();lane.stop();await controller.dispose();});
 await controller.request({root,sourceText:source,engine:'pdflatex',executable:'latexmk',timeoutMs:30000,characterMapping:true,focus:{line:4,column:0}});
 await Promise.race([began,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No visual proof: '+logs.join(''))),15000);timer.unref();})]);
 assert.equal(proposals,1);assert.equal(proofs,1);assert.equal(lane.ready,false,'Placement alone never makes editing ready');assert.equal(published,0);
 if(outcome==='cancel')lane.stop();release();
 for(let n=0;n<300&&outcome!=='cancel'&&!lane.ready&&!logs.some(s=>s.startsWith('Local preview unavailable'));n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(lane.ready,outcome.startsWith('restore'));assert.equal(published,0);assert.equal(proofs,outcome==='cancel'?1:outcome==='overshift'?3:2);
 if(outcome.startsWith('restore'))assert.ok(Math.abs(positions[0]-positions[1]-.001)<1e-8,'Original placement is restored before the successful proof');
 else if(outcome!=='cancel')assert.ok(logs.some(s=>s.startsWith('Local preview unavailable')),logs.join(''));
});
