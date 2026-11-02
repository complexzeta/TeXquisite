import * as path from 'node:path';
import type {BrowserWindow,NativeTheme} from 'electron';

type Theme=Pick<NativeTheme,'shouldUseDarkColors'|'shouldUseDarkColorsForSystemIntegratedUI'|'on'|'removeListener'>;
export function themeIconPath(theme:Theme,directory:string,platform=process.platform){
 // Windows can use a light app theme and a dark taskbar independently.
 const dark=platform==='win32'?theme.shouldUseDarkColorsForSystemIntegratedUI:theme.shouldUseDarkColors;
 return path.join(directory,`texquisite-icon-${dark?'dark':'light'}.${platform==='win32'?'ico':'png'}`);
}
export function followIconTheme(window:Pick<BrowserWindow,'setIcon'|'once'|'isDestroyed'>,theme:Theme,directory:string,platform=process.platform,dockIcon?:(icon:string)=>void){
 const update=()=>{if(!window.isDestroyed()){const icon=themeIconPath(theme,directory,platform);if(platform==='darwin')dockIcon?.(icon);else window.setIcon(icon);}};
 theme.on('updated',update);window.once('closed',()=>theme.removeListener('updated',update));update();
}
