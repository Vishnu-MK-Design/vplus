'use strict';
const ACTIONS=new Set(['state','minimize','maximize','close']);
function applyWindowAction(window,action){if(!ACTIONS.has(action)||window.isDestroyed())return false;if(action==='minimize')window.minimize();else if(action==='maximize'){if(window.isFullScreen())window.setFullScreen(false);else if(window.isMaximized())window.unmaximize();else window.maximize();}else if(action==='close')window.close();return true;}
function attachWindowControls({window,ipcMain,allowed,player=false}){
 const channel=player?'vplus:player-event':'vplus:window-action';
 const publish=()=>{if(window.isDestroyed())return;const state={maximized:window.isMaximized(),fullscreen:window.isFullScreen()};if(player)window.webContents.executeJavaScript('window.VPlusPlayer?.command("window-state",'+JSON.stringify(state)+')').catch(()=>{});else window.webContents.send('vplus:window-state',state);};
 const handler=(event,message)=>{if(window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!allowed(event.senderFrame.url))return;const action=player?(message?.type==='NATIVE_WINDOW_CONTROL'?message.action:null):message;if(applyWindowAction(window,action)&&action!=='close')publish();};
 ipcMain.on(channel,handler);for(const event of ['maximize','unmaximize','enter-full-screen','leave-full-screen','restore'])window.on(event,publish);window.webContents.on('did-finish-load',publish);window.once('closed',()=>ipcMain.removeListener(channel,handler));return {publish};
}
module.exports={attachWindowControls,applyWindowAction};
