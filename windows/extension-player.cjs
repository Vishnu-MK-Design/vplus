'use strict';
const {BrowserWindow,ipcMain,Menu,session}=require('electron');
const {publicHttps}=require('./generated/engine/service.cjs');
const {fetchSubtitles,chooseSubtitleFile,deliverSubtitles}=require('./subtitles.cjs');
const {attachWindowControls}=require('./window-controls.cjs');
const {attachPreviews}=require('./preview-cache.cjs');
const PLAYER='vidly://app/extension-player.html';
const cleanHeaders=link=>Object.fromEntries(Object.entries({...link.headers,...(link.referer?{Referer:link.referer}:{})}).filter(([k,v])=>/^(referer|origin|user-agent|accept)$/i.test(k)&&typeof v==='string'&&!/[\r\n]/.test(v)));
async function checkLinks(links){const checked=await Promise.all(links.slice(0,8).map(async link=>{if(!publicHttps(link.url))return {error:'Unsupported source address.'};try{const response=await fetch(link.url,{method:'HEAD',headers:cleanHeaders(link),redirect:'manual',signal:AbortSignal.timeout(10000)});if(response.status===200||response.status===206||response.status===405)return {link};if(response.status>=300&&response.status<400){const next=new URL(response.headers.get('location'),link.url);if(publicHttps(next.href))return {link};}return {error:'Source returned HTTP '+response.status+'.'};}catch(e){return {error:e.cause?.code==='ENOTFOUND'?'The source hostname has no DNS record.':e.name==='TimeoutError'?'The source timed out.':'The source could not connect.'};}}));const good=checked.filter(x=>x.link).map(x=>x.link);if(!good.length)throw Error([...new Set(checked.map(x=>x.error))].join(' ')||'No sources returned.');return good;}
async function openExtensionPlayer({parent,source,onClose,onProgress,start=0}){
 const links=await checkLinks(source.links),partition='vplus-direct-'+Date.now(),s=session.fromPartition(partition);
 s.setPermissionRequestHandler((_w,_p,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);s.on('will-download',e=>e.preventDefault());
 s.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('vidly://app/')&&!d.url.startsWith('blob:vidly://app/')&&!publicHttps(d.url)}));
 s.webRequest.onBeforeSendHeaders((d,cb)=>{const link=links.find(l=>new URL(l.url).origin===new URL(d.url).origin);cb({requestHeaders:{...d.requestHeaders,...(link?cleanHeaders(link):{})}});});
 // Register the app's protocol on this isolated session; the host supplies its handler.
 const w=new BrowserWindow({parent,width:1100,height:720,frame:false,thickFrame:true,titleBarStyle:'hidden',minWidth:600,minHeight:400,title:source.title+' — V+',backgroundColor:'#000',webPreferences:{backgroundThrottling:false,preload:require('node:path').join(__dirname,'player-preload.cjs'),partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 attachWindowControls({window:w,ipcMain,player:true,allowed:url=>url===PLAYER});
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,url)=>{if(url!==PLAYER)e.preventDefault();});w.webContents.on('will-attach-webview',e=>e.preventDefault());
 const event=(e,d)=>{if(e.sender!==w.webContents||e.senderFrame!==w.webContents.mainFrame||e.senderFrame.url!==PLAYER)return;if(d?.type==='NATIVE_PREVIEW_OPEN'&&Number.isInteger(d.streamIndex)&&links[d.streamIndex])w.__previewSource=links[d.streamIndex].url;if(d?.type==='NATIVE_FULLSCREEN')w.setFullScreen(!w.isFullScreen());else if(d?.type==='NATIVE_SUBTITLE'&&Number.isInteger(d.index)&&source.subtitles?.[d.index])deliverSubtitles(w,fetchSubtitles(source.subtitles[d.index]).then(cues=>({index:d.index,cues})),d.requestId);else if(d?.type==='NATIVE_SUBTITLE_FILE')deliverSubtitles(w,chooseSubtitleFile(w),d.requestId);else if(d?.type==='NATIVE_EXIT')w.close();else if(d?.type==='NATIVE_PROGRESS'&&Number.isFinite(d.currentTime)&&d.currentTime>=0&&d.currentTime<=604800)onProgress?.(d.currentTime);};
 ipcMain.on('vplus:player-event',event);w.on('closed',()=>{ipcMain.removeListener('vplus:player-event',event);onClose?.();});
 w.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();w.setFullScreen(!w.isFullScreen());}});const full=()=>{if(!w.isDestroyed())w.webContents.executeJavaScript('window.VPlusPlayer?.command("fullscreen-state",'+w.isFullScreen()+')').catch(()=>{});};w.on('enter-full-screen',full);w.on('leave-full-screen',full);
 w.setMenu(null);w.setMenuBarVisibility(false);const previews=attachPreviews({app:require('electron').app,window:w,ipcMain,allowed:url=>url===PLAYER,source:()=>{const selected=links.find(l=>l.url===w.__previewSource)||links[0];return {url:selected.url,type:selected.type,id:source.title+':'+source.provider,headers:cleanHeaders(selected)};}});
 w.setMenu(null);
 return {window:w,session:s,previews,async load(){await w.loadURL(PLAYER);await w.webContents.executeJavaScript('window.VPlusDirect.configure('+JSON.stringify({title:source.title,provider:source.provider,contentKind:source.kind||source.contentKind||'',season:source.season,episode:source.episode,contentKey:source.contentKey||source.title+':'+(source.season||'')+':'+(source.episode||''),start,subtitleTracks:(source.subtitles||[]).map(t=>({label:t.lang||'Subtitles'})),streams:links.map(l=>({name:l.name,url:l.url,type:l.type,quality:l.quality}))})+')');}};
}
module.exports={openExtensionPlayer,checkLinks,cleanHeaders};

