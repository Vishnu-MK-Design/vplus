const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('VidlyDesktop',{
 send:message=>ipcRenderer.send('vidly:request',message),
 windowAction:action=>{if(['state','minimize','maximize','close'].includes(action))ipcRenderer.send('vplus:window-action',action);},
 onWindowState:fn=>{ipcRenderer.on('vplus:window-state',(_event,state)=>fn(state));},
 onMessage:fn=>{ipcRenderer.on('vidly:response',(_event,message)=>fn(message));}
});
