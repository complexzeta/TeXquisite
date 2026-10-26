process.env.PERSISTENT_TEX_COMPLETE_FONT_CACHE='0';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {FontBodyCache}=require('../dist/font-body-cache'),{ResidentCompiler}=require('../dist/resident'),{runProcess,hash}=require('../dist/core');
const signal=()=>new AbortController().signal;

test('Font bodies own exact inputs and payloads and evict within both bounds',()=>{
 const cache=new FontBodyCache(32,2),input=Buffer.from('font A glyphs ab'),output=Buffer.from('encrypted'),saved=Buffer.from(input),expected=Buffer.from(output);
 cache.put(input,output);input.fill(0);output.fill(0);assert.deepEqual(cache.get(saved),expected);assert.equal(cache.get(input),undefined);
 cache.put(Buffer.from('B'),Buffer.from('bodyB'));cache.put(Buffer.from('C'),Buffer.from('bodyC'));assert.equal(cache.get(saved),undefined);assert.ok(cache.retainedBytes<=32);
 cache.put(Buffer.alloc(33),Buffer.from('too large'));assert.ok(cache.retainedBytes<=32);const disabled=new FontBodyCache(32,0);disabled.put(saved,expected);assert.equal(disabled.get(saved),undefined);
});

test('Font reuse preserves PFA/PFB encoding syntax fallbacks and complete-font embedding',{timeout:120000},async t=>{
 const {execFileSync}=require('node:child_process'),font=await fs.readFile(execFileSync('kpsewhich',['cmr10.pfb'],{encoding:'utf8',windowsHide:true}).trim()),length=font.readUInt32LE(2),ascii=font.subarray(6,6+length).toString('latin1');
 assert.ok(ascii.includes('dup 32 ')&&ascii.includes('dup 65 '));const changed=Buffer.from(ascii.replace('dup 32 ','dup 040 ').replace('dup 65 ','dup\t65\t'),'latin1'),header=Buffer.from(font.subarray(0,6));header.writeUInt32LE(changed.length,2);const pfb=Buffer.concat([header,changed,font.subarray(6+length)]),parts=[];
 for(let at=0;at<pfb.length;){assert.equal(pfb[at],128);const type=pfb[at+1];if(type===3)break;const n=pfb.readUInt32LE(at+2),body=pfb.subarray(at+6,at+6+n);parts.push(type===1?body:Buffer.from(body.toString('hex').match(/.{1,64}/g).join('\n')+'\n'));at+=6+n;}
 const pfa=Buffer.concat(parts),dir=path.resolve('.test-output','font-input-'+randomUUID());await fs.mkdir(dir,{recursive:true});
 for(const [i,[name,data,include]]of [['probe.pfb',pfb,'<'],['probe.pfa',pfa,'<'],['probe.pfb',pfb,'<<']].entries()){
  const fast=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{fast.stop();strict.stop();});
  const prefix='\\documentclass{article}\n'+(include==='<<'?'\\pdfgentounicode=0\n':'')+'\\pdfmapline{=cmr10 CMR10 '+include+name+'}\n\\begin{document}\n\nBefore.\n\n',region='A Target words with space.\n\n',suffix='After.\n\\end{document}\n',source=prefix+region+suffix,r={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true,resources:[[name,data]]};
  await fast.prepareRegion(source,r,signal(),60000,()=>{},project);await strict.prepareRegion(source,r,signal(),60000,()=>{},project);
  for(let j=0;j<2;j++){
   const a=await fast.previewRegionFlow(source,r,signal(),30000,()=>{},project,true),b=await strict.previewRegionFlow(source,r,signal(),30000,()=>{},project,false);assert.equal(a.navigation,b.navigation);assert.deepEqual(a.fragment.shape,b.fragment.shape);
   if(j&&include==='<')assert.ok(a.timing.fontEncodingHits>0&&a.timing.fontBodyHits>0,'Both actual cache paths must run');
   for(const [kind,pdf]of [['fast',a.pdf],['strict',b.pdf]]){const stem=i+'-'+j+'-'+kind;await fs.writeFile(path.join(dir,stem+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',stem+'.pdf',stem],dir,30000,signal(),()=>{});}
   assert.equal(hash(await fs.readFile(path.join(dir,i+'-'+j+'-fast-1.png'))),hash(await fs.readFile(path.join(dir,i+'-'+j+'-strict-1.png'))));
  }
  fast.stop();strict.stop();
 }
});

test('Encrypted font-body reuse matches ordinary TeX output through glyph, encoding, style and math changes',{timeout:120000},async t=>{
 const dir=path.resolve('.test-output','font-body-'+randomUUID());await fs.mkdir(dir,{recursive:true});const fast=new ResidentCompiler(),strict=new ResidentCompiler();t.after(()=>{fast.stop();strict.stop();});
 const prefix='\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath}\n\\year=2020\\month=1\\day=1\\time=0\n\\begin{document}\n\nBefore with $\\sum_i x_i$.\n\n',region='Target text with \\textbf{bold} and \\textit{italic}, math $\\sqrt{\\pi}$.\n\n',suffix='After.\n\\end{document}\n',source=prefix+region+suffix,range={from:prefix.length,to:prefix.length+region.length},project={characterMapping:true};
 await fast.prepareRegion(source,range,signal(),60000,()=>{},project);await strict.prepareRegion(source,range,signal(),60000,()=>{},project);
 let hits=0,encodingHits=0;
 for(const [i,body]of [region,region,region.replace('Target','Glyphs QXYZ'),region.replace('\\pi','x^2+\\alpha'),region.replace('italic','\\`a \\ss{} \\ae{}'),region].entries()){
  const text=prefix+body+suffix,r={from:prefix.length,to:prefix.length+body.length},a=await fast.previewRegionFlow(text,r,signal(),30000,()=>{},project,true),b=await strict.previewRegionFlow(text,r,signal(),30000,()=>{},project,false);hits+=a.timing.fontBodyHits??0;encodingHits+=a.timing.fontEncodingHits??0;
  assert.deepEqual(a.fragment.shape,b.fragment.shape);assert.equal(a.navigation,b.navigation);
  for(const [kind,pdf]of [['fast',a.pdf],['strict',b.pdf]]){const name=i+'-'+kind;await fs.writeFile(path.join(dir,name+'.pdf'),pdf);await runProcess('pdftoppm',['-png','-r','100',name+'.pdf',name],dir,30000,signal(),()=>{});}
  assert.equal(hash(await fs.readFile(path.join(dir,i+'-fast-1.png'))),hash(await fs.readFile(path.join(dir,i+'-strict-1.png'))));fast.prepareNextRegionEdit();
 }
 assert.ok(hits>0,'The comparison must exercise actual font-body hits');assert.ok(encodingHits>0,'The comparison must exercise actual encoding hits');
 const broken=region.replace('Target','\\UndefinedFontProbe');await assert.rejects(fast.previewRegionFlow(prefix+broken+suffix,{from:range.from,to:prefix.length+broken.length},signal(),30000,()=>{},project,true));
 assert.ok((await fast.previewRegionFlow(source,range,signal(),30000,()=>{},project,true)).pdf.length>100);
 assert.ok((await fast.compile(source,signal(),60000,()=>{},project)).length>100,'A complete build must still succeed after speculative reuse');
});
