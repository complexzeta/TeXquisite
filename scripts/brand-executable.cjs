// Resource editing uses the bundled local tool; no signing/download is needed.
const {execFileSync}=require('node:child_process'),path=require('node:path');
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')return;
 const exe=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
 execFileSync(path.resolve('node_modules/electron-winstaller/vendor/rcedit.exe'),[exe,'--set-icon',path.resolve('media/texquisite-icon.ico'),'--set-version-string','ProductName','TeXquisite','--set-version-string','FileDescription','TeXquisite','--set-product-version',context.packager.appInfo.version,'--set-file-version',context.packager.appInfo.version],{stdio:'inherit',windowsHide:true});
};
