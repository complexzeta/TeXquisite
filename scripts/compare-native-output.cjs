const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
function pages(file){
 const xml=execFileSync('pdftotext',['-raw','-bbox',file,'-'],{encoding:'utf8',windowsHide:true});
 return [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].map(page=>[...page[1].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g)].map(word=>({text:word[5],box:word.slice(1,5).map(Number)})));
}
const union=boxes=>[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
function geometry(a,b){
 let i=0,j=0,maximum=0,groups=0;
 while(i<a.length&&j<b.length){
  const left=[a[i++]],right=[b[j++]];let x=left[0].text,y=right[0].text;
  // Poppler may split one word at a font/position change in one PDF but not
  // the other. Align the exact character sequence before comparing its box.
  while(x!==y){
   if(x.startsWith(y)&&j<b.length){right.push(b[j++]);y+=right.at(-1).text;}
   else if(y.startsWith(x)&&i<a.length){left.push(a[i++]);x+=left.at(-1).text;}
   else assert.fail('Native and resident PDF text differ near '+x+' / '+y);
  }
  const p=union(left.map(v=>v.box)),q=union(right.map(v=>v.box));
  for(let k=0;k<4;k++)maximum=Math.max(maximum,Math.abs(p[k]-q[k]));groups++;
 }
 assert.equal(i,a.length);assert.equal(j,b.length);assert.ok(maximum<=0.011,'PDF text position differs by '+maximum+' points');return {groups,maxPositionDeltaPt:maximum};
}
function raster(a,b){
 const parse=file=>{const bytes=fs.readFileSync(file),header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.toString('ascii',0,64));assert.ok(header);return {width:Number(header[1]),height:Number(header[2]),data:bytes.subarray(header[0].length)};};
 const x=parse(a),y=parse(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);assert.equal(x.data.length,x.width*x.height*3);assert.equal(y.data.length,x.data.length);
 let count=0,maximum=0;for(let i=0;i<x.data.length;i+=3){let changed=false;for(let k=0;k<3;k++){const d=Math.abs(x.data[i+k]-y.data[i+k]);maximum=Math.max(maximum,d);if(d)changed=true;}if(changed)count++;}
 const fraction=count/(x.width*x.height);assert.ok(maximum<=64,'Unexpected raster intensity difference '+maximum);assert.ok(fraction<=0.002,'Unexpected raster difference fraction '+fraction);return {differentPixels:count,fraction,maxChannelDifference:maximum};
}
module.exports=function compareNativeOutput(native,resident,directory){
 const a=pages(native),b=pages(resident);assert.equal(a.length,b.length);
 return a.map((page,index)=>({page:index+1,...geometry(page,b[index]),...raster(path.join(directory,'native-'+(index+1)+'.ppm'),path.join(directory,'resident-'+(index+1)+'.ppm'))}));
};
