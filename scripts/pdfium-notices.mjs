import {mkdir,writeFile} from 'node:fs/promises';
// Save notices from the same upstream PDFium branch as wrapper 3.0.0's 8046d
// binary. These files are checked in; normal builds require no network access.
const root='https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/8046/';
async function get(url){
  for(let retry=0;retry<4;retry++){
    const response=await fetch(url);if(response.ok)return response;
    if(response.status<500||retry===3)throw new Error(url+' '+response.status);
    await new Promise(resolve=>setTimeout(resolve,250*(retry+1)));
  }
}
await mkdir('licenses/pdfium',{recursive:true});
const dirs=['agg23','bigint','cpu_features','dragonbox','fast_float','fp16','freetype','harfbuzz','highway','lcms','libopenjpeg','libtiff','llvm-libc'];
for(const dir of dirs){
  const response=await get(root+'third_party/'+dir+'/?format=JSON');
  const listing=JSON.parse((await response.text()).slice(4));
  const files=listing.entries.filter(e=>e.type==='blob'&&/^(license|copying|copyright|readme|ftl\.txt)/i.test(e.name));
  await Promise.all(files.map(async file=>{
    const url=root+'third_party/'+dir+'/'+file.name+'?format=TEXT';
    const result=await get(url);
    await writeFile('licenses/pdfium/'+dir+'-'+file.name,Buffer.from(await result.text(),'base64'));
  }));
  console.log(dir+': '+files.map(f=>f.name).join(', '));
}
