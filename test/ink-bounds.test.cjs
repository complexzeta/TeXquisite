const {test}=require('node:test'),assert=require('node:assert/strict');const {inkFitsRaster}=require('../dist/local-raster');
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
