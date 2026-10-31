const {test}=require('node:test'),assert=require('node:assert/strict');const {inkFitsRaster}=require('../dist/local-raster');
const {flowInkBounds}=require('../dist/local-raster');
test('Pageless flow captures bounded right overhang without changing strict baseline proofs',()=>{
 const w=30,h=12,bounds={left:4,top:3,right:20,bottom:9};
 const image=(x,y)=>{const a=new Uint8Array(w*h*4).fill(255);a[(y*w+x)*4]=0;return a;};
 assert.deepEqual(flowInkBounds(image(19,4),w,h,bounds,6),bounds);
 const over=image(22,4);assert.equal(inkFitsRaster(over,w,h,bounds),false);const expanded=flowInkBounds(over,w,h,bounds,6);assert.ok(expanded.right>22&&expanded.right<=26);assert.equal(inkFitsRaster(over,w,h,expanded),true);assert.equal(expanded.left,bounds.left);assert.equal(expanded.top,bounds.top);assert.equal(expanded.bottom,bounds.bottom);
 for(const [x,y]of [[3,4],[22,2],[22,9],[27,4],[29,4]])assert.equal(flowInkBounds(image(x,y),w,h,bounds,6),undefined,`${x},${y}`);
 for(const allowance of [NaN,Infinity,-1,257])assert.equal(flowInkBounds(over,w,h,bounds,allowance),undefined);
});
test('Worker ink scanning matches the original complete pixel scan at fractional, clipped and off-page bounds',()=>{
 const width=11,height=9;
 const original=(data,b)=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<Math.floor(b.left)||x>=Math.ceil(b.right)||y<Math.floor(b.top)||y>=Math.ceil(b.bottom)){const at=4*(y*width+x);if(data[at]<250||data[at+1]<250||data[at+2]<250)return false;}return true;};
 const bounds=[{left:2,top:2,right:8,bottom:6},{left:2.01,top:1.99,right:8.00001,bottom:6.001},{left:-2,top:-3,right:4.5,bottom:5.5},{left:15,top:1,right:20,bottom:6},{left:-10,top:1,right:-1,bottom:6},{left:-1,top:-1,right:12,bottom:10}];
 for(const b of bounds)for(let p=0;p<width*height;p++)for(const level of [0,249,250,255]){const data=new Uint8Array(width*height*4).fill(255);data[p*4+(p%3)]=level;assert.equal(inkFitsRaster(data,width,height,b),original(data,b),JSON.stringify({b,p,level}));}
});
test('Malformed raster geometry is rejected instead of authorizing ink',()=>{
 const data=new Uint8Array(16).fill(255),b={left:0,top:0,right:2,bottom:2};assert.equal(inkFitsRaster(data,2,2,b),true);
 for(const [pixels,width,height,bounds]of [[data,0,2,b],[data,2.5,2,b],[data,2,3,b],[data,2,2,{...b,left:NaN}],[data,2,2,{...b,right:0}],[data,2,2,{...b,bottom:-1}]])assert.equal(inkFitsRaster(pixels,width,height,bounds),false);
});
