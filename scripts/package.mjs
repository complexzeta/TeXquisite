import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
const args=process.argv.slice(2);if(!args.some(a=>['--win','--mac','--linux'].includes(a)))args.unshift(process.platform==='darwin'?'--mac':process.platform==='win32'?'--win':'--linux');
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),...args,'--publish','never'],{stdio:'inherit'});
if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/archive-builds.ps1')],{stdio:'inherit',windowsHide:true});
