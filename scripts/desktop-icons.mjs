// Extract the PNG images already embedded in our ICO assets.
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
export async function desktopIcons(){
 for(const theme of ['light','dark']){
  const bytes=await readFile(`media/texquisite-icon-${theme}.ico`);if(bytes.readUInt16LE(2)!==1)throw Error('Invalid source icon');
  const entries=Array.from({length:bytes.readUInt16LE(4)},(_,i)=>{const at=6+16*i;return {size:bytes[at]||256,length:bytes.readUInt32LE(at+8),offset:bytes.readUInt32LE(at+12)};}).sort((a,b)=>b.size-a.size);
  const largest=entries[0],png=bytes.subarray(largest.offset,largest.offset+largest.length);if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.length!==largest.length)throw Error('Expected a PNG-backed icon');
  await writeFile(`media/texquisite-icon-${theme}.png`,png);
 }
 if(process.platform==='darwin'){
  const temporary=await mkdtemp(path.join(os.tmpdir(),'texquisite-icons-')),iconset=path.join(temporary,'TeXquisite.iconset');
  try{await mkdir(iconset);for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('sips',['-z',String(size*scale),String(size*scale),path.resolve('media/texquisite-icon-light.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
   execFileSync('iconutil',['-c','icns',iconset,'-o',path.resolve('media/texquisite-icon.icns')],{stdio:'inherit'});
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
}
