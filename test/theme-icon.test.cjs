const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{EventEmitter}=require('node:events');
const {themeIconPath,followIconTheme}=require('../dist/theme-icon');
test('Windows taskbar icons follow the system theme independently of the app theme and update live',()=>{
 const theme=new EventEmitter();Object.assign(theme,{shouldUseDarkColors:false,shouldUseDarkColorsForSystemIntegratedUI:true});const window=new EventEmitter(),icons=[];window.setIcon=icon=>icons.push(path.basename(icon));window.isDestroyed=()=>false;
 followIconTheme(window,theme,'/icons');assert.equal(icons.at(-1),'texquisite-icon-dark.ico');theme.shouldUseDarkColorsForSystemIntegratedUI=false;theme.shouldUseDarkColors=true;theme.emit('updated');assert.equal(icons.at(-1),'texquisite-icon-light.ico');
 assert.equal(path.basename(themeIconPath(theme,'/icons','darwin')),'texquisite-icon-dark.ico');const count=icons.length;window.emit('closed');theme.emit('updated');assert.equal(icons.length,count);assert.equal(theme.listenerCount('updated'),0);
});
