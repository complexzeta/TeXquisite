import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('desktop',{
  call:(method:string,...args:unknown[])=>ipcRenderer.invoke('desktop',method,...args),
  on:(callback:(message:unknown)=>void)=>{ipcRenderer.on('event',(_event,message)=>callback(message));}
});
