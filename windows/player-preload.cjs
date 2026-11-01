const {ipcRenderer}=require('electron');
let last=0;const language=process.argv.find(v=>v.startsWith('--vidly-audio='))?.split('=')[1]||'auto';
function report(event='timeupdate'){
 const v=document.querySelector('video');if(!v||v.readyState<1||!Number.isFinite(v.currentTime)||!Number.isFinite(v.duration)||v.duration<=0)return;
 if(language!=='auto'&&v.audioTracks){const tracks=v.audioTracks;for(let i=0;i<tracks.length;i++)if(tracks[i].language?.split('-')[0]===language){for(let n=0;n<tracks.length;n++)tracks[n].enabled=n===i;break;}}
 ipcRenderer.send('vidly:progress',{time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:0,playing:!v.paused,seeking:v.seeking,rate:v.playbackRate,event});
}
document.addEventListener('timeupdate',()=>{if(Date.now()-last>4000){last=Date.now();report();}},true);
document.addEventListener('pause',()=>report('pause'),true);document.addEventListener('ended',()=>report('ended'),true);


// Narrow event forwarding only; no IPC or Node API is exposed to provider pages.
window.addEventListener('vplus:host',e=>{const d=e.detail;if(!d||!['NATIVE_WINDOW_CONTROL','NATIVE_EPISODE_INFO','NATIVE_NEXT_EPISODE','NATIVE_PREVIEW_OPEN','NATIVE_PREVIEW_PRIORITY','NATIVE_PREVIEW_ACTIVITY','NATIVE_PREVIEW_CLOSE','NATIVE_EXIT','NATIVE_FAILURE','NATIVE_SWITCH','NATIVE_PLAYING','NATIVE_AUDIO','NATIVE_LANGUAGES','NATIVE_PROGRESS','NATIVE_FULLSCREEN','NATIVE_SERVER_CHANGED','NATIVE_DISMISS_PROVIDER_MENU','NATIVE_SELECT_SOURCE','NATIVE_SUBTITLE','NATIVE_SUBTITLE_FILE'].includes(d.type))return;let raw;try{raw=JSON.stringify(d);}catch{return;}if(raw.length<4096)ipcRenderer.send('vplus:player-event',JSON.parse(raw));});
