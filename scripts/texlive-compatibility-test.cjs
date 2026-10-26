// Real, explicitly selected TeX installations; all output goes to the artifact root.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {testDirectory}=require('./test-artifacts.cjs'),{inspectToolchain,toolEnvironment}=require('../dist/toolchain'),{generateInstalledFormat,fingerprintFiles,preparedFormat}=require('../dist/format-cache'),{formatFingerprint,FORMAT_FINGERPRINT_POLICY}=require('../dist/format-fingerprint'),{ResidentCompiler}=require('../dist/resident');
const hash=b=>createHash('sha256').update(b).digest('hex');
const fixtures={
 math:'\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nCompatibility prose. $\\sqrt{\\pi}+\\frac{1}{2}$.\n\\begin{align} a^2+b^2&=c^2\\\\ \\int_0^1 x\\,dx&=\\frac12\\end{align}\n\\end{document}\n',
 preamble:'\\documentclass[11pt]{article}\n\\usepackage[margin=22mm]{geometry}\n\\usepackage{xcolor,hyperref}\n\\newcommand{\\custom}[1]{\\textcolor{blue}{\\textbf{#1}}}\n\\begin{document}\n\\section{Preamble compatibility}\\custom{User macro}. \\href{https://example.org}{A link}.\n\\end{document}\n',
 tikz:'\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nDiagram compatibility.\n\\begin{tikzpicture}\n\\foreach \\i in {1,...,24}{\\draw[gray] (0,0)--({2*cos(\\i*15)},{2*sin(\\i*15)});}\n\\draw[blue,domain=-2:2,samples=50] plot (\\x,{sin(\\x*90)});\n\\node[draw] at (0,2.5) {Portable diagram};\n\\end{tikzpicture}\n\\end{document}\n'
};
async function main(){
 const bin=process.env.TEXQUISITE_TEST_TEX_BIN;assert.ok(bin&&path.isAbsolute(bin),'Set TEXQUISITE_TEST_TEX_BIN to an explicit installation bin folder');
 const directory=testDirectory('texlive-compatibility'),assets=path.resolve('engine/resident'),cache=path.join(directory,'formats'),result={passed:false,directory,year:process.env.TEXQUISITE_TEST_TEX_YEAR,fixtures:[]},env=toolEnvironment(bin);
 for(const key of Object.keys(env))if(/^(?:TEX|BIB|BST)/i.test(key))delete env[key];
 for(const name of ['TEXMFHOME','TEXMFCONFIG','TEXMFVAR']){env[name]=path.join(directory,name.toLowerCase());fs.mkdirSync(env[name]);}
 env.PATH=[bin,path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.dirname(process.execPath)].join(path.delimiter);
 const run=(name,args,cwd=directory)=>cp.execFileSync(path.join(bin,name+'.exe'),args,{cwd,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
 const version=run('pdflatex',['--version']);result.version=version.split(/\r?\n/)[0];if(result.year)assert.match(version,new RegExp('TeX Live '+result.year));
 const kpse=names=>run('kpsewhich',names).trim();result.selectedBin=bin;
 let resources,compiler,library;
 try{
  const report=await inspectToolchain({selected:bin,roots:[],metadata:path.join(assets,'format.json'),cache,env});assert.equal(report.selected.toLowerCase(),path.resolve(bin).toLowerCase());assert.ok(report.ready,JSON.stringify(report.issues));result.initialFast=report.fast;
  if(!report.fast.available){
   const files={},fingerprints={};for(const name of fingerprintFiles){files[name]=kpse([name]);fingerprints[name]=formatFingerprint(name,fs.readFileSync(files[name]),FORMAT_FINGERPRINT_POLICY);}
   const started=Date.now();try{const manifest=await generateInstalledFormat({assets,cache,installation:bin,root:kpse(['-var-value=TEXMFDIST']),files,fingerprints,env});result.preparation={passed:true,ms:Date.now()-started};
    assert.ok(preparedFormat(manifest,assets,bin,env));const again=await generateInstalledFormat({assets,cache,installation:bin,root:kpse(['-var-value=TEXMFDIST']),files,fingerprints,env});assert.equal(again,manifest);result.preparation.cacheReused=true;
   }catch(error){result.preparation={passed:false,ms:Date.now()-started,error:String(error)};}
  }
  const checked=await inspectToolchain({selected:bin,roots:[],metadata:path.join(assets,'format.json'),cache,env});result.fastAvailable=checked.fast.available;resources=checked.fast.resources;
  if(resources){compiler=new ResidentCompiler(resources);const {PDFiumLibrary}=require('@hyzyla/pdfium');library=await PDFiumLibrary.init();}
  // Child workers must see the same isolated TeX search environment.
  const prior={...process.env};for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
  try{for(const [name,source]of Object.entries(fixtures)){
   const folder=path.join(directory,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'main.tex'),source);
   for(let pass=0;pass<2;pass++)fs.writeFileSync(path.join(folder,'native-'+pass+'.log'),run('pdflatex',['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','main.tex'],folder));
   const native=fs.readFileSync(path.join(folder,'main.pdf')),sample={name,nativePassed:native.length>1000};assert.ok(sample.nativePassed);
   if(compiler){const started=Date.now(),pdf=await compiler.compile(source,new AbortController().signal,120000,()=>{},{characterMapping:true});assert.ok(pdf?.length>1000);sample.residentMs=Date.now()-started;fs.writeFileSync(path.join(folder,'resident.pdf'),pdf);
    const left=await library.loadDocument(native),right=await library.loadDocument(pdf);try{const a=[...left.pages()],b=[...right.pages()];assert.equal(a.length,b.length);sample.pages=a.length;sample.rasterParity=true;
     sample.exactRaster=true;sample.maxChannelDifference=0;sample.differentChannelFraction=0;sample.meanChannelDifference=0;
     for(let i=0;i<a.length;i++){const ar=await a[i].render({scale:1}),br=await b[i].render({scale:1});assert.deepEqual([ar.width,ar.height],[br.width,br.height]);assert.equal(a[i].getText().replace(/\s/g,''),b[i].getText().replace(/\s/g,''));if(hash(ar.data)!==hash(br.data)){sample.exactRaster=false;let different=0,maximum=0,total=0;for(let n=0;n<ar.data.length;n++){const delta=Math.abs(ar.data[n]-br.data[n]);if(delta)different++;maximum=Math.max(maximum,delta);total+=delta;}sample.differentChannelFraction=Math.max(sample.differentChannelFraction,different/ar.data.length);sample.maxChannelDifference=Math.max(sample.maxChannelDifference,maximum);sample.meanChannelDifference=Math.max(sample.meanChannelDifference,total/ar.data.length);
      // Distinct pdfTeX builds can round a glyph edge slightly differently.
      // Admit only sparse, low-amplitude antialiasing; text/page sizes stay exact.
      if(different/ar.data.length>0.0002||maximum>64||total/ar.data.length>0.01)sample.rasterParity=false;
     }a[i].close();b[i].close();}
    }finally{left.destroy();right.destroy();}
    if(!sample.rasterParity){result.fixtures.push(sample);assert.fail('Native/resident raster mismatch: '+name+' ('+sample.differentChannelFraction+')');}
   }
   result.fixtures.push(sample);console.log(JSON.stringify({fixture:sample}));
  }}finally{for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);}
  result.passed=result.fastAvailable&&result.fixtures.every(f=>f.nativePassed&&f.rasterParity);if(!result.fastAvailable)throw Error('Native compilation works, but fast-format preparation is unavailable for this installation.');
 }catch(error){result.error=String(error);throw error;}finally{compiler?.stop();library?.destroy();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
}
main().catch(error=>{console.error(String(error));process.exitCode=1});
