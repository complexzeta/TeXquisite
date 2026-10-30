const {test}=require('node:test'),assert=require('node:assert/strict');
const {paragraphAt}=require('../dist/local-preview'),{matchLocalRaster}=require('../dist/local-raster');
const {matchLocalPatchRaster}=require('../dist/local-raster');
test('TikZ blocks are not repeatedly expanded into adjacent paragraph preparation',()=>{
 const {flowWindowAt}=require('../dist/local-preview'),first='Ordinary text.\n\n',picture='\\begin{tikzpicture}\\node {Label};\\end{tikzpicture}\n\n',last='Following text.\n\n',source=first+picture+last;
 assert.deepEqual(flowWindowAt(source,2),{from:0,to:first.length});assert.deepEqual(flowWindowAt(source,first.length+10),{from:first.length,to:first.length+picture.length});
 const label='\\node {Separate label};\n\n',tail='\\draw (0,0)--(1,1);\n\n',head='\\begin{tikzpicture}\n\n',split=first+head+label+tail+'\\end{tikzpicture}\n\n'+last;
 assert.deepEqual(flowWindowAt(split,split.indexOf('Separate label')),{from:first.length+head.length,to:first.length+head.length+label.length});
});
test('Patch proof checks the exact displayed crop; unrelated copied-PDF pixels are never pasted',()=>{
 const width=40,height=40,rect={x:10,y:10,width:20,height:20},a=new Uint8ClampedArray(width*height*4).fill(255),b=new Uint8ClampedArray(a);
 for(let c=0;c<3;c++){a[(15*width+15)*4+c]=0;b[(15*width+15)*4+c]=0;b[(2*width+2)*4+c]=0;}
 assert.equal(matchLocalRaster(a,b,width,height,rect).ok,false);assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,true);
 for(let c=0;c<3;c++)b[(15*width+15)*4+c]=255;
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,false,'Missing ink inside the crop must still reject');
});
test('Baseline proof uses the same near-white threshold as fragment ink checking',()=>{
 const width=40,height=40,rect={x:5,y:5,width:25,height:25},a=new Uint8ClampedArray(width*height*4).fill(255),b=new Uint8ClampedArray(a),p=(20*width+20)*4;
 for(let c=0;c<3;c++)a[p+c]=251;
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,true);
 for(let c=0;c<3;c++)a[p+c]=249;
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,false);
 for(let c=0;c<3;c++)a[p+c]=251;a[p+3]=254;
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,false);
});
test('Local paragraph ranges preserve full paragraphs and reject incomplete or oversized regions',()=>{
 const source='Preamble\n\nFirst paragraph.\nContinued physical line.\n\nSecond paragraph.\n\n\\end{document}\n',at=source.indexOf('Continued');
 const range=paragraphAt(source,at);assert.equal(source.slice(range.from,range.to),'First paragraph.\nContinued physical line.\n\n');
 assert.equal(paragraphAt('No closing blank line',5),undefined);assert.equal(paragraphAt('x'.repeat(12001)+'\n\n',5),undefined);assert.equal(paragraphAt(source,-1),undefined);
 const blankRun='First paragraph.\n\n\nSecond paragraph.\n\n';
 for(const at of [16,17,18]){const r=paragraphAt(blankRun,at);assert.equal(blankRun.slice(r.from,r.to),'First paragraph.\n\n\n');}
 assert.equal(blankRun.slice(paragraphAt(blankRun,19).from,paragraphAt(blankRun,19).to),'Second paragraph.\n\n');
});
test('Raster verification allows only sparse stroke-edge coverage differences inside the region',()=>{
 const width=40,height=40,rect={x:5,y:5,width:25,height:25},a=new Uint8ClampedArray(width*height*4).fill(255),b=new Uint8ClampedArray(a);
 const set=(image,x,y,value)=>{for(let c=0;c<3;c++)image[(y*width+x)*4+c]=value;};
 set(a,10,10,0);set(b,10,10,0);set(a,11,10,200);set(b,11,10,215);
 assert.equal(matchLocalRaster(a,b,width,height,rect).ok,true);
 const lost=new Uint8ClampedArray(a);set(lost,10,10,255);assert.equal(matchLocalRaster(a,lost,width,height,rect).ok,false);
 const outside=new Uint8ClampedArray(a);set(outside,1,1,250);assert.equal(matchLocalRaster(a,outside,width,height,rect).ok,false);
 const background=new Uint8ClampedArray(a);set(background,25,25,245);assert.equal(matchLocalRaster(a,background,width,height,rect).ok,false);
 assert.equal(matchLocalRaster(a,a,width,height,{...rect,x:NaN}).ok,false);
});

test('Crop verification matches full verification for changes confined to its clipped integer rectangle',()=>{
 const width=90,height=70,a=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=2;y<height-2;y++)for(let x=4;x<width-4;x++)if(x%9<2&&y%8<6)for(let c=0;c<3;c++)a[(y*width+x)*4+c]=20;
 let seed=1234567;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let trial=0;trial<120;trial++){
  const rect={x:rand(100)-10+.3,y:rand(80)-10+.6,width:rand(40)+1.2,height:rand(35)+1.4},b=new Uint8ClampedArray(a);
  const left=Math.max(0,Math.floor(rect.x)),right=Math.min(width,Math.ceil(rect.x+rect.width)),top=Math.max(0,Math.floor(rect.y)),bottom=Math.min(height,Math.ceil(rect.y+rect.height));
  if(right>left&&bottom>top)for(let i=0;i<15;i++){const p=((top+rand(bottom-top))*width+left+rand(right-left))*4;for(let c=0;c<4;c++)b[p+c]=rand(256);}
  assert.deepEqual(matchLocalPatchRaster(a,b,width,height,rect),matchLocalRaster(a,b,width,height,rect));
 }
});

test('Placement calibration tolerates isolated glyph metric outliers but still requires strong finite consensus',()=>{
 const {placementCorrection}=require('../dist/local-raster'),offsets=Array.from({length:32},()=>({x:56.06004,y:397.363}));offsets[15]={x:56.05008,y:397.363};
 const correction=placementCorrection(offsets,{x:56.06,y:397.362});assert.ok(correction);assert.ok(Math.abs(correction.dx-.00004)<1e-8);assert.ok(Math.abs(correction.dy-.001)<1e-8);
 for(let i=0;i<4;i++)offsets[i]={x:56.05,y:397.363};assert.equal(placementCorrection(offsets,{x:56.06,y:397.362}),false,'A weak consensus cannot propose a translation');
 assert.equal(placementCorrection([{x:1,y:1},{x:1,y:1}],{x:1,y:1}),false);assert.equal(placementCorrection([{x:1,y:1},{x:1,y:1},{x:NaN,y:1}],{x:1,y:1}),false);
 assert.equal(placementCorrection(Array.from({length:8},()=>({x:1,y:1})),{x:0,y:0}),false,'Large translations reject');
});

test('Calibrated glyph geometry permits only eight opaque grayscale coverage pixels per existing glyph',()=>{
 const width=60,height=40,rect={x:1,y:1,width:58,height:38},a=new Uint8ClampedArray(width*height*4).fill(255),set=(im,x,y,v)=>{for(let c=0;c<3;c++)im[(y*width+x)*4+c]=v;};
 for(let x=10;x<20;x++)set(a,x,9,0);for(let x=10;x<19;x++)set(a,x,10,186);
 const b=new Uint8ClampedArray(a),glyphs=[{x:9,y:8,width:12,height:5}];for(let x=10;x<18;x++)set(b,x,10,126);
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect).ok,false,'The default proof remains strict');
 assert.equal(matchLocalRaster(a,b,width,height,rect).ok,false,'The complete-page proof remains strict');
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs).ok,true);
 const rejected=(edit,label,masks=glyphs)=>{const c=new Uint8ClampedArray(b);edit(c);assert.equal(matchLocalPatchRaster(a,c,width,height,rect,masks).ok,false,label);};
 rejected(c=>set(c,18,10,126),'Nine larger pixels reject');rejected(c=>set(c,10,10,105),'Differences beyond 80 reject');rejected(c=>set(c,10,10,255),'Missing ink rejects');
 rejected(c=>{c[(10*width+10)*4+1]=125;},'Color changes reject');rejected(c=>{c[(10*width+10)*4+3]=254;},'Alpha changes reject');
 rejected(()=>{},'Wrong glyph location rejects',[{x:30,y:20,width:2,height:2}]);rejected(()=>{},'Unbounded glyph masks reject',[{x:0,y:0,width:257,height:40}]);
 const flatA=new Uint8ClampedArray(width*height*4).fill(255),flatB=new Uint8ClampedArray(flatA);set(flatA,10,10,186);set(flatB,10,10,126);assert.equal(matchLocalPatchRaster(flatA,flatB,width,height,rect,glyphs).ok,false,'Geometry without a dark/light stroke in both images rejects');
});

test('Independent matched glyphs share a capped coverage allowance without hiding a changed glyph',()=>{
 const width=1100,height=900,rect={x:1,y:1,width:1098,height:898},a=new Uint8ClampedArray(width*height*4).fill(255),b=new Uint8ClampedArray(a),glyphs=[];
 const set=(im,x,y,v)=>{for(let c=0;c<3;c++)im[(y*width+x)*4+c]=v;};
 const add=index=>{const left=10+index*20;glyphs.push({x:left-1,y:8,width:12,height:5});for(let x=left;x<left+8;x++){set(a,x,9,0);set(b,x,9,0);set(a,x,10,186);set(b,x,10,126);}};
 add(0);add(1);const two=matchLocalPatchRaster(a,b,width,height,rect,glyphs);assert.equal(two.ok,true);assert.equal(two.metricPixels,16);
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs.slice(0,1)).ok,false,'Every glyph still needs its independent geometry');
 for(let i=2;i<8;i++)add(i);assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs).ok,true);
 add(8);assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs).ok,false,'The patch-wide cap remains 64 even for a large page');
});

test('High-DPI matched glyph coverage scales with resolution while retaining bounded ink checks',()=>{
 const width=80,height=40,rect={x:1,y:1,width:78,height:38},a=new Uint8ClampedArray(width*height*4).fill(255),set=(im,x,y,v)=>{for(let c=0;c<3;c++)im[(y*width+x)*4+c]=v;};
 for(let x=10;x<33;x++){set(a,x,9,0);set(a,x,10,186);}const b=new Uint8ClampedArray(a),glyphs=[{x:9,y:8,width:25,height:5}];for(let x=10;x<30;x++)set(b,x,10,126);
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs).ok,false,'1x still caps one glyph at eight pixels');
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs,1.5).ok,false,'1.5x caps one glyph at eighteen pixels');
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs,2.5).ok,true);
 set(b,30,10,126);assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs,2.5).ok,true,'Coverage grows with pixel density while geometry stays independently matched');
 set(b,10,10,255);assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs,4).ok,false,'High DPI cannot hide missing ink');
 assert.equal(matchLocalPatchRaster(a,b,width,height,rect,glyphs,Infinity).ok,false);
});
