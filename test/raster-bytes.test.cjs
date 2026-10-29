const {test}=require('node:test'),assert=require('node:assert/strict'),{rasterBytesEqual}=require('../dist/local-raster');
test('Packed raster equality matches the byte reference for aligned, unaligned and partial views',()=>{
 for(let length=0;length<80;length++)for(let aOffset=0;aOffset<5;aOffset++)for(let bOffset=0;bOffset<5;bOffset++){
  const a=new Uint8ClampedArray(length+aOffset+3).subarray(aOffset,aOffset+length),b=new Uint8Array(length+bOffset+3).subarray(bOffset,bOffset+length);for(let i=0;i<length;i++)a[i]=b[i]=(i*71+length)%256;
  assert.equal(rasterBytesEqual(a,b),true);
  for(let i=0;i<length;i++){b[i]^=1;assert.equal(rasterBytesEqual(a,b),false,`${length}/${aOffset}/${bOffset}/${i}`);b[i]^=1;}
  assert.equal(rasterBytesEqual(a,b.subarray(1)),length===0);
 }
});
test('Exact equality includes alpha and high channel bits on large RGBA pages',()=>{
 const a=new Uint8ClampedArray(4*1024*1024).fill(255),b=new Uint8Array(a);assert.equal(rasterBytesEqual(a,b),true);
 for(const at of [0,1,2,3,1023,b.length-4,b.length-1]){b[at]=127;assert.equal(rasterBytesEqual(a,b),false);b[at]=255;}assert.equal(rasterBytesEqual(a,b),true);
});
