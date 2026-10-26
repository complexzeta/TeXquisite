const {test}=require('node:test'),assert=require('node:assert/strict');
const {ResidentCompiler}=require('../dist/resident');

test('Temporary token reuse preserves literal and Unicode mappings after nested accents and TikZ',{timeout:90000},async t=>{
 const compiler=new ResidentCompiler();t.after(()=>compiler.stop());
 const prefix='\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{tikz}\n\\newcommand{\\wrap}[1]{\\textbf{#1}}\n\\begin{document}\n\\wrap{\\emph{café naïve Ångström}}\n\\begin{tikzpicture}\n\\foreach \\i in {1,...,30}{\\draw (0,0)--({2*cos(\\i*12)},{sin(\\i*12)});}\n\\node at (1,2){NodeQuartz};\n\\end{tikzpicture}\n\n';
 const paragraph='ZebraQuartz café.\n\n',source=prefix+paragraph+'Tail.\n\\end{document}\n',range={from:prefix.length,to:prefix.length+paragraph.length},signal=new AbortController().signal,project={characterMapping:true,jobName:'main'};
 const check=(navigation,text,marker)=>{
  const rows=navigation.trim().split('\n').map(JSON.parse).filter(r=>r.glyph).map(r=>r.glyph),offset=text.indexOf(marker),line=text.slice(0,offset).split('\n').length,column=Buffer.byteLength(text.slice(text.lastIndexOf('\n',offset-1)+1,offset));
  for(let i=0;i<marker.length;i++)assert.ok(rows.some(g=>g[0]==='main.tex'&&g[1]===line&&g[2]===column+i&&g[8]===marker.charCodeAt(i)&&g[9]===1),'Missing exact literal mapping for '+marker[i]);
  const accent=text.indexOf('café.',range.from),accentLine=text.slice(0,accent).split('\n').length,accentColumn=Buffer.byteLength(text.slice(text.lastIndexOf('\n',accent-1)+1,accent))+3;
  assert.ok(rows.some(g=>g[1]===accentLine&&g[2]===accentColumn&&g[9]===2),'The accent must retain its two-byte source span');
 };
 assert.ok(await compiler.compile(source,signal,30000,()=>{},project));check(compiler.navigation,source,'ZebraQuartz');check(compiler.navigation,source,'NodeQuartz');
 await compiler.prepareRegion(source,range,signal,30000,()=>{},project);
 for(const marker of ['ZebraQuarxz','ZebraQuartz']){
  const next=source.replace('ZebraQuartz',marker),output=await compiler.previewRegionFlow(next,range,signal,15000,()=>{},project,true);
  check(output.navigation,next,marker);compiler.prepareNextRegionEdit();
 }
 const broken=source.replace('ZebraQuartz','\\UndefinedTokenProbe');
 await assert.rejects(compiler.previewRegionFlow(broken,{from:range.from,to:range.to+broken.length-source.length},signal,15000,()=>{},project,true));
 const repaired=await compiler.previewRegionFlow(source,range,signal,15000,()=>{},project,true);check(repaired.navigation,source,'ZebraQuartz');
});
