const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const directory=path.resolve('.test-output','theme-icon-'+randomUUID()),profile=path.join(directory,'profile');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'session.json'),JSON.stringify({docs:[],root:'',active:'',onSave:false,liveVersion:2,engine:'pdflatex',latexmk:'latexmk'}));
 const app=await electron.launch({...(process.env.PERSISTENT_TEX_EXECUTABLE?{executablePath:process.env.PERSISTENT_TEX_EXECUTABLE,args:[]}:{args:['.']}),env:{...process.env,PERSISTENT_TEX_TEST_DATA:profile,PERSISTENT_TEX_TEST_HIDDEN:'1'}}),page=await app.firstWindow();
 try{
  const media=path.join(await app.evaluate(({app})=>app.getAppPath()),'media');
  const live=await app.evaluate(({nativeTheme,BrowserWindow,nativeImage},media)=>{
   const window=BrowserWindow.getAllWindows()[0],setIcon=window.setIcon.bind(window),calls=[];window.setIcon=icon=>{calls.push(icon.split(/[\\/]/).at(-1));setIcon(icon);};
   const key='shouldUseDarkColorsForSystemIntegratedUI',descriptor=Object.getOwnPropertyDescriptor(nativeTheme,key);let systemDark=true;
   const oldSource=nativeTheme.themeSource;nativeTheme.themeSource='light';Object.defineProperty(nativeTheme,key,{configurable:true,get:()=>systemDark});
   try{
    nativeTheme.emit('updated');const dark=calls.at(-1);systemDark=false;nativeTheme.emit('updated');const light=calls.at(-1);systemDark=true;nativeTheme.emit('updated');
    const files=['light','dark'].map(mode=>nativeImage.createFromPath(media+'/texquisite-icon-'+mode+'.ico').resize({width:32,height:32}).toBitmap()),a=files[0],b=files[1];let reversed=0;
    for(let i=0;i<a.length;i+=4)if(a[i+3]>250&&a[i]+a[i+1]+a[i+2]<120&&b[i]+b[i+1]+b[i+2]>645)reversed++;
    return {dark,light,appRemainsLight:!nativeTheme.shouldUseDarkColors,liveChanges:calls.length,reversedOpaquePixels:reversed};
   }finally{if(descriptor)Object.defineProperty(nativeTheme,key,descriptor);else delete nativeTheme[key];nativeTheme.themeSource=oldSource;nativeTheme.emit('updated');window.setIcon=setIcon;}
  },media);
  assert.equal(live.dark,'texquisite-icon-dark.ico');assert.equal(live.light,'texquisite-icon-light.ico');assert.equal(live.appRemainsLight,true);assert.ok(live.liveChanges>=3);assert.ok(live.reversedOpaquePixels>10);
  const favicon=[];
  for(const scheme of ['light','dark']){
   await page.emulateMedia({colorScheme:scheme});favicon.push(await page.evaluate(async scheme=>{
    const image=new Image();image.style.colorScheme=scheme;image.src='texapp://local/texquisite-emblem.svg?theme='+scheme;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,32,32);return {scheme,pixels:Array.from(ctx.getImageData(0,0,32,32).data)};
   },scheme));
  }
  let reversed=0;const a=favicon[0].pixels,b=favicon[1].pixels;for(let i=0;i<a.length;i+=4)if(a[i+3]>250&&a[i]+a[i+1]+a[i+2]<120&&b[i]+b[i+1]+b[i+2]>645)reversed++;assert.ok(reversed>10,'The SVG favicon must reverse its visible ink in dark mode');
  const result={passed:true,directory,...live,faviconReversedPixels:reversed};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
