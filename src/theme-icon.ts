import * as path from 'node:path';
import type {BrowserWindow,NativeTheme} from 'electron';

type Theme=Pick<NativeTheme,'shouldUseDarkColors'|'shouldUseDarkColorsForSystemIntegratedUI'|'on'|'removeListener'>;
export function themeIconPath(theme:Theme,directory:string,platform=process.platform){
 // Windows can use a light app theme and a dark taskbar independently.
 const dark=platform==='win32'?theme.shouldUseDarkColorsForSystemIntegratedUI:theme.shouldUseDarkColors;
 return path.join(directory,dark?'texquisite-icon-dark.ico':'texquisite-icon-light.ico');
}
export function followIconTheme(window:Pick<BrowserWindow,'setIcon'|'once'|'isDestroyed'>,theme:Theme,directory:string){
 const update=()=>{if(!window.isDestroyed())window.setIcon(themeIconPath(theme,directory));};
 theme.on('updated',update);window.once('closed',()=>theme.removeListener('updated',update));update();
}
