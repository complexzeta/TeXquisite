// A bounded native-only probe. No normal app/session or user source is opened.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {ResidentCompiler}=require('../dist/resident'),{RegionCompositor}=require('../dist/region-compositor');
(async()=>{
 const directory=require('./test-artifacts.cjs').testDirectory('lecture-flow-probe'),compiler=new ResidentCompiler(),signal=()=>new AbortController().signal;
 const extra=process.env.PERSISTENT_TEX_PROBE_HYPERREF==='1'?'\\usepackage{hyperref}\n':'';
 const prefix='\\documentclass{article}\n\\usepackage{amsmath}\n'+extra+'\\begin{document}\n\nBefore.\n\n',region='Target paragraph.\n\n',suffix='\\typeout{UNREAD_LECTURE_SUFFIX}\n'+('Following text with $x^2$.\n\n'.repeat(100))+'\\end{document}\n',source=prefix+region+suffix,project={characterMapping:true};
 const lecture=process.env.PERSISTENT_TEX_LECTURE_FLOW==='1'; const result={directory,lecture,hyperref:process.env.PERSISTENT_TEX_PROBE_HYPERREF==='1',freeMiBBefore:Math.round(os.freemem()/1048576),cases:[]};
 try{
  const range={from:prefix.length,to:prefix.length+region.length},base=await compiler.prepareRegion(source,range,signal(),60000,()=>{},project),original=await compiler.previewRegionFlow(source,range,signal(),15000,()=>{},project,true,undefined,lecture),compositor=await RegionCompositor.create(base.pdf,base.navigation,original);
  for(const [name,next] of [
   ['paragraphs','Target paragraph.\n\n'+('More text and $\\sqrt{\\pi}$.\n\n'.repeat(12))],
   ['section','Target paragraph.\n\n\\section{Lecture heading}\n\nBody with $x^2$.\n\n'],
   ['starred-section','Target paragraph.\n\n\\section*{Lecture heading}\n\nBody with $x^2$.\n\n'],
   ['formatted-heading','Target paragraph.\n\n{\\Large\\bfseries Lecture heading}\\par\n\nBody with $x^2$.\n\n'],
   ['section-label','Target paragraph.\n\n\\section{Lecture heading}\\label{sec:new}\n\nBody with $x^2$.\n\n'],
   ['display-math','Target paragraph.\n\n\\[x^2+\\sqrt{\\pi}\\]\n\nFollowing paragraph.\n\n']]){
   const logs=[],began=performance.now(),item={name};
   try{const out=await compiler.previewRegionFlow(prefix+next+suffix,{from:prefix.length,to:prefix.length+next.length},signal(),5000,s=>logs.push(s),project,true,undefined,lecture);item.nativeMs=Math.round(performance.now()-began);item.flow=!!compositor.flow(out,true);item.stateChanged=!!compositor.flow(out,true)?.stateChanged;item.excludedSuffixBytes=out.timing.excludedSuffixBytes;item.shapeTypes=[...new Set(out.fragment.shape.map(row=>row[0]))];item.suffixRead=logs.join('').includes('UNREAD_LECTURE_SUFFIX');item.text=cp.execFileSync('pdftotext',['-','-'],{input:out.pdf,encoding:'utf8',windowsHide:true}).trim();await fs.writeFile(path.join(directory,name+'.pdf'),out.pdf);}
   catch(error){item.nativeMs=Math.round(performance.now()-began);item.error=String(error);}
   result.cases.push(item);
  }
  const full=await compiler.compile(source,signal(),30000,()=>{},project);result.fullRecovered=full.length>100;result.preambleRetained=compiler.lastTiming?.preambleRebuilt===false;
 }finally{compiler.stop();result.freeMiBAfter=Math.round(os.freemem()/1048576);await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
