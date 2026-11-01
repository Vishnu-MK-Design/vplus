'use strict';
const {app,BrowserWindow,ipcMain,protocol,net,session,Menu,safeStorage,dialog,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {playback,navigation,matchesPlayback,blocked}=require('./routes.cjs');
const {attachWindowControls}=require('./window-controls.cjs');
const {createPlan}=require('./playback-plan.cjs');
const {PROVIDERS,providersFor,supports,sourceOptionsFor,extensionOptions}=require('./playback-providers.cjs');
const {createSourceHealth}=require('./source-health.cjs');
const contentPolicy=require('./content-policy.cjs');
const {attachPreviews,registerPreviewScheme}=require('./preview-cache.cjs');registerPreviewScheme();
protocol.registerSchemesAsPrivileged([{scheme:'vidly',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const {ExtensionService}=require('./generated/engine/service.cjs');
const {openExtensionPlayer}=require('./extension-player.cjs');
const {chooseSubtitleFile,deliverSubtitles,fetchSubtitles}=require('./subtitles.cjs');
const {APP_ID,APP_ORIGIN,APP_URL,LEGACY_KEYS,trailerRequestOptions,sanitizeLegacyState,legacyPreferences}=require('./youtube-origin.cjs');
const {createTrailerFiles}=require('./trailer-files.cjs');
let extensionService,extensionGeneration=0,trailerFiles,collections,episodeTracker,segments;
async function assetResponse(req){const u=new URL(req.url);if(!((u.protocol==='vidly:'&&u.hostname==='app')||(u.protocol==='https:'&&u.hostname===APP_ID)))return new Response('Not allowed',{status:403});if(u.protocol==='https:'&&u.pathname.startsWith('/__trailers/'))return trailerFiles?trailerFiles.handleRequest(req):new Response('Not found',{status:404});if(req.method!=='GET')return new Response('Not allowed',{status:403});if(u.protocol==='vidly:'&&u.pathname==='/__cinematic-migrate.html')return new Response('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'"}});const base=path.join(__dirname,'generated/assets'),file=path.resolve(base,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(base+path.sep))return new Response('Not found',{status:404});try{return await net.fetch(pathToFileURL(file).href);}catch{return new Response('Not found',{status:404});}}
let main,player,store={},catalogue,tmdbFactory,lookup,currentPlayback,saveTimer,sourceCatalog,detailsService,sourceHealth,licensedTitleIdentity,animeCatalogue;
const smoke=(process.argv.includes('--mature-content-test')||process.argv.includes('--anime-categories-test')||process.argv.includes('--approved-providers-test')||process.argv.includes('--genre-navigation-test')||process.argv.includes('--window-hero-test')||process.argv.includes('--ux-player-test')||process.argv.includes('--ux-batch-test')||process.argv.includes('--anime-ux-test')||process.argv.includes('--cinematic-test')||process.argv.includes('--source-status-test')||process.argv.includes('--provider-audit-test')||process.argv.includes('--smoke-test')||process.argv.includes('--rebuild-test')||process.argv.includes('--engine-test')||process.argv.includes('--player-probe')||process.argv.includes('--player-update-test')||process.argv.includes('--player-platform-test')||process.argv.includes('--player-redesign-test')||process.argv.includes('--subtitle-provider-probe')||process.argv.includes('--subtitle-test')),verify=process.argv.includes('--verify-install');
// Keep the pre-rebrand profile so existing lists/history remain available.
if(!smoke&&!verify)app.setPath('userData',path.join(app.getPath('appData'),'VPlus-Source'));
if(smoke)app.setPath('userData',app.isPackaged?path.join(app.getPath('temp'),'VPlus-Subtitle-Verification','profile'):path.join(__dirname,'.build/smoke-profile'));
if(smoke&&process.argv.includes('--fresh-profile'))app.setPath('userData',fs.mkdtempSync(path.join(app.getPath('temp'),'VPlus-PC-044-')));
if(verify)app.setPath('userData',path.join(app.getPath('temp'),'vidly-package-verification'));
if(process.argv.includes('--engine-preview'))app.setPath('userData',path.join(app.getPath('appData'),'VPlus-Engine-Preview'));
function storePath(){return path.join(app.getPath('userData'),'library.json');}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.mkdirSync(app.getPath('userData'),{recursive:true});const tmp=storePath()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(store));fs.renameSync(tmp,storePath());}catch{send({type:'notice',message:'Your library could not be saved. Check free disk space.'});}},100);}
function token(){try{if(store.encryptedToken&&safeStorage.isEncryptionAvailable())return safeStorage.decryptString(Buffer.from(store.encryptedToken,'base64'));}catch{}return '';}
function send(data){if(main&&!main.isDestroyed())main.webContents.send('vidly:response',contentPolicy.response(data,store.preferences));}
function state(){send({type:'state',playbackProviders:PROVIDERS,saved:store.saved||[],history:store.history||[],preferences:store.preferences||null,audioIndex:store.audioIndex||[],connected:!!token(),extensionEngine:!!extensionService?.available(),clientState:sanitizeLegacyState(store.clientState)});}
function trusted(event){return main&&!main.isDestroyed()&&event.sender===main.webContents&&event.senderFrame===main.webContents.mainFrame&&event.senderFrame.url.split('#')[0]===APP_URL;}
function validItem(item){return item&&['movie','tv','anime'].includes(item.kind)&&/^[1-9][0-9]{0,11}$/.test(String(item.id))&&item.key===item.kind+'-'+item.id;}
async function supplementLicensedTitle(query,items,page){
 const identity=page===1?licensedTitleIdentity?.(query):null;if(!identity)return items;
 try{const row=await catalogue.details(identity.imdbId,identity.kind);if(row.key===identity.key&&row.imdbId===identity.imdbId&&row.title.toLocaleLowerCase()===identity.title.toLocaleLowerCase()&&String(row.year)===identity.year)return [row,...items.filter(t=>t.key!==row.key)];}catch{}
 return items;
}
function protect(w,allowed){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault();});w.webContents.on('will-redirect',(e,url)=>{if(!allowed(url))e.preventDefault();});w.webContents.on('will-attach-webview',e=>e.preventDefault());}
async function migrateLegacyOrigin(){
 if(store.desktopOriginMigration)return;
 let legacy,timer;
 try{
  legacy=new BrowserWindow({show:false,width:200,height:200,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  const url='vidly://app/__cinematic-migrate.html';protect(legacy,target=>target===url);
  const values=await Promise.race([(async()=>{await legacy.loadURL(url);return legacy.webContents.executeJavaScript('Object.fromEntries('+JSON.stringify(LEGACY_KEYS)+'.map(key=>[key,localStorage.getItem(key)]))');})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Migration timeout')),5000);})]);
  store.clientState={...sanitizeLegacyState(values),...sanitizeLegacyState(store.clientState)};
  store.preferences={...legacyPreferences(store.clientState),...store.preferences};
  store.desktopOriginMigration=true;save();
 }catch{ /* Retain the old origin and retry on a later launch if its storage is unavailable. */ }
 finally{clearTimeout(timer);if(legacy&&!legacy.isDestroyed())legacy.destroy();}
}
async function openPlayer(message){
 contentPolicy.assertVisible(message.item,store.preferences);
 const tracked=['anime','tv'].includes(message.item?.kind)?episodeTracker.get(message.item,Number(message.season||1),Number(message.episode||1)):null;const old=tracked?{time:tracked.position}:(store.history||[]).find(h=>h.item?.key===message.item?.key&&h.season===Number(message.season||1)&&h.episode===Number(message.episode||1));let plan=createPlan(message.provider||'auto',message.item?.kind,store.playerSources?.[message.item?.kind],message.item);
 playback({...message,provider:plan.current()});
 if(player&&!player.isDestroyed())player.close();
 let position=message.resume?old?.time||0:0,resumePaused=!!message.paused,active,generation=0,timer,failed=false;
 const language=['en','ta','hi','te','ml','kn','ja','ko','es','fr','de'].includes(message.audioLanguage)?message.audioLanguage:'auto';
 player=new BrowserWindow({width:1100,height:720,frame:false,thickFrame:true,titleBarStyle:'hidden',minWidth:600,minHeight:400,parent:main,backgroundColor:'#000000',title:message.item.title+' — V+',icon:path.join(__dirname,'icon.png'),webPreferences:{backgroundThrottling:false,preload:path.join(__dirname,'player-preload.cjs'),additionalArguments:['--vidly-audio='+language],partition:'persist:vidly-player',contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,autoplayPolicy:'no-user-gesture-required'}});
 const w=player;attachWindowControls({window:w,ipcMain,player:true,allowed:url=>navigation(url,active?.provider)});w.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();w.setFullScreen(!w.isFullScreen());}});protect(w,url=>navigation(url,active?.provider));
 w.__previews=attachPreviews({app,window:w,ipcMain,allowed:url=>navigation(url,active?.provider),source:()=>active?.previewSource?{url:active.previewSource,id:active.item.key+':'+active.season+':'+active.episode+':'+active.provider,fingerprint:active.previewFingerprint||'',type:active.previewType||'',headers:{Referer:w.webContents.getURL(),Origin:new URL(w.webContents.getURL()).origin,'User-Agent':w.webContents.getUserAgent()}}:null});
 const load=async()=>{clearTimeout(timer);failed=false;const id=++generation;w.__playbackConfigured=false;active=playback({...message,provider:plan.current(),start:position});currentPlayback=active;
  timer=setTimeout(async()=>{if(w.isDestroyed()||id!==generation)return;const ready=await w.webContents.executeJavaScript('!!document.querySelector("video")&&document.querySelector("video").readyState>=2').catch(()=>false);if(!ready)failure();},32000);
  await w.loadURL(active.url).catch(()=>{});
 };
 const failure=async()=>{if(failed||w.isDestroyed())return;failed=true;if(plan.automatic&&plan.advance()){await load();return;}clearTimeout(timer);w.webContents.stop();const others=providersFor(active.item.kind,active.item).filter(p=>p.automatic!==false&&p.id!==active.provider),label=PROVIDERS.find(p=>p.id===active.provider)?.name||'This provider';const result=await dialog.showMessageBox(w,{type:'warning',title:'Video unavailable',message:label+' did not return a playable video for this title.',detail:'Your place is saved. Provider availability varies by title and connection.',buttons:['Back to title','Retry',...(others.length?['Try another source']:[])],defaultId:0,cancelId:0});if(w.isDestroyed())return;if(result.response===1){plan.reset();load();}else if(result.response===2&&others.length){plan=createPlan('auto',active.item.kind,others[0].id,active.item);load();}else w.close();};
 const onEvent=async(e,data)=>{if(w.isDestroyed()||e.sender!==w.webContents||e.senderFrame!==w.webContents.mainFrame||!matchesPlayback(e.senderFrame.url,active)||!data||typeof data!=='object')return;
  if(data.type==='NATIVE_EPISODE_INFO'&&Number.isFinite(data.duration)&&data.duration>0){const own=generation,source=active;let nextEpisode=null;try{nextEpisode=await require('./episode-next.cjs').resolveNext(source,{anime:animeCatalogue,details:detailsService});}catch{}const found=await segments(source.item,source.episode,data.duration);if(own!==generation||w.isDestroyed())return;active.nextEpisode=nextEpisode;await w.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",'+JSON.stringify({segments:found,nextEpisode,autoPlayNext:store.preferences?.autoPlayNext!==false})+')').catch(()=>{});}
  else if(data.type==='NATIVE_NEXT_EPISODE'&&store.preferences?.autoPlayNext!==false&&active.nextEpisode){const next=active.nextEpisode;active.nextEpisode=null;const ended=await w.webContents.executeJavaScript('document.querySelector("video")?.ended===true').catch(()=>false);if(ended)await openPlayer({...message,...next,resume:false});}
  else if(data.type==='NATIVE_FULLSCREEN'){w.setFullScreen(!w.isFullScreen());}
  else if(data.type==='NATIVE_DISMISS_PROVIDER_MENU'){w.webContents.executeJavaScript('(()=>{const h=document.querySelector("#vplus-player"),s=h?.shadowRoot;if(!s)return null;for(const el of [s.querySelector(".sheet:not([hidden]) .sheet-head h2"),s.querySelector(".brand")]){if(!el)continue;const b=el.getBoundingClientRect(),x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2),hit=s.elementFromPoint(x,y);if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&document.elementFromPoint(x,y)===h&&(hit===el||el.contains(hit)))return{x,y};}return null})()').then(p=>{if(!p||w.isDestroyed())return;w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});}).catch(()=>{});}
  else if(data.type==='NATIVE_SUBTITLE_FILE')deliverSubtitles(w,chooseSubtitleFile(w),data.requestId);
  else if(data.type==='NATIVE_SUBTITLE'&&['vidfast','vidlink'].includes(active.provider)&&Number.isInteger(data.index)&&data.index>=100&&data.index<120){const own=generation,index=data.index-100;const promise=(async()=>{const track=await w.webContents.executeJavaScript('(()=>{const v=document.querySelector("video"),t=[...v.textTracks].filter(t=>t.kind==="subtitles"||t.kind==="captions")['+index+'];const el=[...v.querySelectorAll("track[src]")].find(el=>el.track===t);return el?{url:el.src,label:t.label||t.language||"Subtitles"}:null})()');if(!track)throw Error('This provider has not supplied a downloadable subtitle track.');const cues=await fetchSubtitles({...track,headers:{Referer:active.url,Origin:new URL(active.url).origin}});return own===generation?{cues,label:track.label,index:data.index}:null;})().catch(error=>{if(own===generation)throw error;return null;});deliverSubtitles(w,promise,data.requestId);}
  else if(data.type==='NATIVE_SERVER_CHANGED'){active.previewSource='';active.previewFingerprint='';w.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",{previewSource:"",segments:[]})').catch(()=>{});}
  else if(data.type==='NATIVE_SELECT_SOURCE'&&(data.provider==='auto'||supports(data.provider,active.item.kind,active.item))){if(Number.isFinite(data.currentTime)&&data.currentTime>=0&&data.currentTime<=604800)position=data.currentTime;resumePaused=data.paused===true;plan=createPlan(data.provider,active.item.kind,data.provider==='auto'?active.provider:'',active.item);if(plan.current()===active.provider)w.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",'+JSON.stringify({automatic:plan.automatic})+')').catch(()=>{});else load();}
  else if(data.type==='NATIVE_FAILURE')failure();
  else if(data.type==='NATIVE_SWITCH'){if(!plan.advance())plan=createPlan('auto',active.item.kind,providersFor(active.item.kind,active.item).find(p=>p.automatic!==false&&p.id!==active.provider)?.id||'',active.item);load();}
  else if(data.type==='NATIVE_PLAYING'){if(!await w.webContents.executeJavaScript('!!document.querySelector("video")&&document.querySelector("video").readyState>=2&&document.querySelector("video").videoWidth>0').catch(()=>false))return;store.playerSources={...store.playerSources,[active.item.kind]:active.provider};save();}
  else if(data.type==='NATIVE_EXIT')w.close();
  else if(data.type==='NATIVE_AUDIO'&&['en','ta','hi','te','ml','kn','ja','ko','es','fr','de'].includes(data.language)){store.preferences={...store.preferences,audioLanguage:data.language};save();}
  else if(data.type==='NATIVE_LANGUAGES'&&Array.isArray(data.languages)&&data.languages.length<=20){const languages=[...new Set(data.languages.filter(l=>['en','ta','hi','te','ml','kn','ja','ko','es','fr','de'].includes(l)))];if(languages.length){store.audioIndex=[{item:active.item,languages,provider:active.provider,verifiedAt:Date.now()},...(store.audioIndex||[]).filter(e=>e.item?.key!==active.item.key||e.provider!==active.provider)].slice(0,200);save();}}
  else if(data.type==='NATIVE_PROGRESS'&&w.__playbackConfigured&&Number.isFinite(data.currentTime)&&data.currentTime>=0&&data.currentTime<=604800&&Number.isFinite(data.duration)&&data.duration>0&&(data.currentTime>0||data.event==='ended')){position=data.event==='ended'?0:data.currentTime;}
 };
 ipcMain.on('vplus:player-event',onEvent);
 w.webContents.on('did-finish-load',async()=>{if(w.isDestroyed()||!navigation(w.webContents.getURL(),active?.provider))return;const id=generation;if(!await w.webContents.executeJavaScript('typeof window.Hls==="function"').catch(()=>false))await w.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'generated/assets/hls.min.js'),'utf8')).catch(()=>{});const script=fs.readFileSync(path.join(__dirname,'generated/assets/vplus-player.js'),'utf8');await w.webContents.executeJavaScript('window.__vplusPlatform="desktop";\n'+script).catch(()=>{});if(w.isDestroyed()||id!==generation)return;await w.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",'+JSON.stringify({...store.preferences,title:active.item.title,kind:active.item.kind,provider:active.provider,automatic:plan.automatic,audioLanguage:language,desktop:true,platform:'desktop',season:active.season,episode:active.episode,contentKey:active.item.key+':'+active.season+':'+active.episode,resumeAt:active.start,resumePaused,providerLabel:PROVIDERS.find(p=>p.id===active.provider)?.name,sourceOptions:sourceOptionsFor(active.item.kind,active.item),extensions:extensionOptions(extensionService?.registry,extensionService?.available()),previewSource:active.previewSource||''})+')').catch(()=>{});if(!w.isDestroyed()&&id===generation)w.__playbackConfigured=true;});
 const fullscreenState=()=>{if(!w.isDestroyed())w.webContents.executeJavaScript('window.VPlusPlayer?.command("fullscreen-state",'+w.isFullScreen()+')').catch(()=>{});};w.on('enter-full-screen',fullscreenState);w.on('leave-full-screen',fullscreenState);w.webContents.on('did-finish-load',()=>setTimeout(fullscreenState,300));
 w.setMenu(Menu.buildFromTemplate([{label:'Back to title',click:()=>w.close()},{label:'Playback',submenu:[{label:'Retry automatic playback',accelerator:'CmdOrCtrl+R',click:()=>{plan.reset();load();}},{label:'Fullscreen',accelerator:'F11',click:()=>w.setFullScreen(!w.isFullScreen())}]}]));
 w.setMenu(null);w.setMenuBarVisibility(false);w.setAutoHideMenuBar(true);w.on('closed',()=>{clearTimeout(timer);generation++;ipcMain.removeListener('vplus:player-event',onEvent);if(player===w){player=null;currentPlayback=null;}if(main&&!main.isDestroyed()){main.show();main.focus();state();}});
 w.webContents.on('did-fail-load',(_e,code,_desc,url,isMain)=>{if(isMain&&code!==-3&&navigation(url,active?.provider))failure();});
 await load();
}

async function request(event,m){
 if(!trusted(event)||!m||typeof m!=='object')return;
 let bytes;try{bytes=JSON.stringify(m).length;}catch{return;}if(bytes>150000)return;
 const requestId=Number.isSafeInteger(m.requestId)?m.requestId:0;
 try{
  switch(m.type){
   case 'hello':state();break;
   case 'trailer-state':if(typeof m.active==='boolean')main.__cinematicTrailerActive=m.active;break;
   case 'trailer-file':{if(!validItem(m.item))throw Error('Invalid title.');const trailer=await trailerFiles.choose(m.item);send({type:'trailer-file',requestId,key:m.item.key,trailer});break;}
   case 'extension-cancel':extensionGeneration++;break;
   case 'extension-request':{
    const generation=++extensionGeneration;
    try{const data=await extensionService.request(m.action,m);if(generation!==extensionGeneration)break;
     if(m.action==='links'){
      const opened=await openExtensionPlayer({parent:main,source:data,start:store.extensionResume?.[data.resumeKey]||0,onProgress:time=>{store.extensionResume={...store.extensionResume,[data.resumeKey]:time};const keys=Object.keys(store.extensionResume);if(keys.length>200)delete store.extensionResume[keys[0]];save();},onClose:()=>{if(main&&!main.isDestroyed()){main.show();main.focus();}}});
      if(generation!==extensionGeneration){opened.window.close();break;}
      if(player&&!player.isDestroyed())player.close();player=opened.window;currentPlayback=null;opened.window.on('closed',()=>{if(player===opened.window)player=null;});opened.session.protocol.handle('vidly',assetResponse);await opened.load();
      send({type:'extension-result',requestId,action:m.action,data:{playing:true}});
     }else send({type:'extension-result',requestId,action:m.action,data});
    }catch(e){if(generation===extensionGeneration)send({type:'extension-result',requestId,action:m.action,error:String(e.message||'Extension failed.').slice(0,300)});}break;
   }
   case 'metadata-credit':if(/^https:\/\/anilist\.co\/anime\/[1-9][0-9]{0,11}$/.test(String(m.url||''))||/^https:\/\/www\.tvmaze\.com\/shows\/[0-9]+(?:\/[a-z0-9-]+)?$/.test(String(m.url||''))||/^https:\/\/www\.imdb\.com\/title\/tt[0-9]{7,10}\/$/.test(String(m.url||''))||/^https:\/\/www\.themoviedb\.org\/(movie|tv)\/[1-9][0-9]{0,11}$/.test(String(m.url||''))||['https://www.netflix.com/tudum/articles/beverly-hills-cop-axel-f-release-date-plot','https://durian.blender.org/sharing/','https://creativecommons.org/licenses/by/3.0/'].includes(m.url))await shell.openExternal(m.url);break;
   case 'keyboard':case 'hideKeyboard':break;
   case 'preferences':if(m.preferences&&JSON.stringify(m.preferences).length<5000){store.preferences={...m.preferences,matureContent:m.preferences.matureContent===true};save();if(player&&!player.isDestroyed())player.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",'+JSON.stringify({autoPlayNext:store.preferences.autoPlayNext!==false})+')').catch(()=>{});}break;
   case 'saved':if(Array.isArray(m.entries)&&m.entries.length<=200){store.saved=m.entries.filter(validItem);save();}break;
   case 'clearHistory':store.history=[];save();state();break;
   case 'quit':main.close();break;
   case 'tools':send({type:'notice',message:'Enter an IMDb title ID in Search.'});break;
   case 'token':{const value=String(m.token||'').trim();if(value.length>4096||/[\r\n]/.test(value))throw Error('Invalid token format.');if(value&&!safeStorage.isEncryptionAvailable())throw Error('Secure credential storage is unavailable on this computer.');store.encryptedToken=value?safeStorage.encryptString(value).toString('base64'):'';save();state();send({type:'notice',message:value?'Token saved securely on this computer.':'TMDB disconnected.'});break;}
   case 'play':await openPlayer(m);break;
   case 'anime-catalogue':{const result=await animeCatalogue.browse(m);send({...result,type:'anime-catalogue',requestId});break;}
   case 'search-all':{const query=String(m.query||'').trim();if(!query||query.length>200)throw Error('Enter a search up to 200 characters.');await Promise.all(['cinemeta','streamflix','anime'].map(async source=>{try{let items,hasMore=false;const page=Number.isInteger(m.page)&&m.page>0&&m.page<=500?m.page:1;if(source==='anime'){const r=await animeCatalogue.browse({query,page});items=r.items;hasMore=r.hasMore;}else if(source==='cinemeta'){const r=await catalogue.browse({query,section:'search',kind:'movie',page});items=await supplementLicensedTitle(query,r.items,page);hasMore=!!r.hasMore;}else{const r=await Promise.all(['movie','tv'].map(kind=>sourceCatalog.browse({query,kind,page})));items=r.flatMap(v=>v.items);hasMore=r.some(v=>v.page<v.totalPages);}send({type:'search-group',requestId,source,items,hasMore});}catch{send({type:'search-group',requestId,source,items:[],error:'This catalogue could not be reached. Search again to retry.'});}}));break;}
   case 'sources-health':{try{send({type:'sources-health',...await sourceCatalog.health()});}catch(e){send({type:'sources-health',ok:false,error:e.message});}break;}
   case 'streamflix-status':{send(await sourceHealth.check());break;}
   case 'collections':send({type:'collections',requestId,...await collections.manifest()});break;
   case 'collection':{const id=String(m.id||''),d=(await collections.manifest()).collections.find(d=>d.id===id);if(d&&!contentPolicy.definitionVisible(d,store.preferences))throw Error('This collection is hidden. Enable Mature Content in Settings → Content to browse it.');send({type:'collection',requestId,...await collections.browse(id,m.page,{sort:m.sort})});break;}
   case 'anime-schedule':send({type:'anime-schedule',requestId,...await animeCatalogue.schedule(m.start,m.end,m.page)});break;
   case 'anime-episode-search':if(!validItem(m.item)||m.item.kind!=='anime'||!m.item.mal)throw Error('Invalid anime');send({type:'anime-episode-search',requestId,episodes:await animeCatalogue.findEpisodes(m.item.id,m.query)});break;
   case 'anime-relations':if(!validItem(m.item)||m.item.kind!=='anime'||!m.item.mal)throw Error('Invalid anime');send({type:'anime-relations',requestId,entries:await animeCatalogue.relations(m.item.id)});break;
   case 'episode-tracker':if(!validItem(m.item))throw Error('Invalid title');if(m.episodes)episodeTracker.mark(m.item,m.season,m.episodes,!!m.watched);save();send({type:'episode-tracker',requestId,records:episodeTracker.records});break;
   case 'home':{const result={type:'home',requestId};await Promise.all(['movie','tv'].map(async kind=>{try{result[kind]=(await catalogue.browse({kind,sort:'newest'})).items;}catch{result[kind+'Error']='New titles could not refresh. Retry.';}}));send(result);break;}
   case 'catalogue':{let result;if(m.source==='streamflix')result=await sourceCatalog.browse(m);else if(m.source==='tmdb'&&token()){try{result=await tmdbFactory(token()).browse(m);}catch{result=await catalogue.browse(m);result.notice='TMDB is unavailable. Showing the public catalogue.';}}else result=await catalogue.browse(m);if(result.source==='cinemeta')result.items=await supplementLicensedTitle(m.query,result.items,Number(m.page)||1);send({...result,type:'catalogue',requestId});break;}
   case 'imdb':{const id=lookup.normalizeImdb(m.id);let items=await catalogue.lookup(id);if(!items.length)items=await lookup.resolveImdb(id);send({type:'imdb',requestId,id,items});break;}
   case 'details':{if(!validItem(m.item))throw Error('Invalid title.');const i=m.item;const data=i.kind==='anime'&&i.mal?await animeCatalogue.details(i.id):await detailsService.details(i,{refresh:!!m.refresh});contentPolicy.assertVisible(data,store.preferences);const localTrailer=trailerFiles.lookup(i.key);send({type:'details',requestId,key:i.key,data:localTrailer?{...data,trailer:localTrailer}:data});break;}
   case 'episodes':{if(!validItem(m.item)||!Number.isInteger(m.season)||m.season<1||m.season>999)throw Error('Invalid season.');const i=m.item;let data;if(i.kind==='anime'&&i.mal)data=await animeCatalogue.episodes(i.id,m.page);else{try{try{data=await detailsService.episodes(i,m.season);}catch{data=(i.source==='cinemeta'||i.source==='streamflix')&&/^tt[0-9]{7,10}$/.test(i.imdbId||'')?await catalogue.episodes(i.imdbId,m.season):await tmdbFactory(token()).episodes(i.id,m.season);}}catch{const file=path.join(__dirname,'generated/assets/episodes',`${i.key}-${m.season}.json`);data=JSON.parse(fs.readFileSync(file,'utf8'));}}send({type:'episodes',requestId,key:i.key,season:m.season,data});break;}
  }
 }catch(error){send({type:m.type==='details'?'details-error':'error',key:m.item?.key,requestId,message:/token|credential/i.test(error.message)?'The connection could not be completed. Check the token in Settings.':String(error.message).slice(0,250)});}
}
app.whenReady().then(async()=>{
 try{store=JSON.parse(fs.readFileSync(storePath(),'utf8'));if(!store||typeof store!=='object')store={};}catch{store={};}
 trailerFiles=createTrailerFiles({directory:path.join(app.getPath('userData'),'trailers'),dialog,parent:()=>main,origin:APP_ORIGIN});
 animeCatalogue=(await import('./anime-catalogue.mjs')).createAnimeCatalogue();segments=(await import('./segments.mjs')).createSegments();
 episodeTracker=require('./episode-tracker.cjs').createTracker(store.episodes||{});episodeTracker.importHistory(store.history||[]);store.episodes=episodeTracker.records;
 if(!store.vplusPlaybackMigration){store.preferences={...store.preferences,defaultSource:'auto',resumeByDefault:true};store.vplusPlaybackMigration=true;save();}
 ({publicCatalog:catalogue}=await import('./generated/tools/public-catalog.mjs'));({createTmdbCatalog:tmdbFactory}=await import('./generated/tools/tmdb-catalog.mjs'));lookup=await import('./generated/tools/imdb-lookup.mjs');({sourceCatalog}=await import('./generated/tools/source-catalog.mjs'));const {createDetailsService}=await import('./generated/tools/details-service.mjs');const cinematicMetadata=await import('./cinematic-metadata.mjs');licensedTitleIdentity=cinematicMetadata.licensedTitleIdentity;detailsService=cinematicMetadata.createCinematicMetadata({detailsService:createDetailsService({catalogue,sourceCatalog,tmdb:()=>tmdbFactory(token())}),token});
 const {createCollections}=await import('./collections.mjs');const {normalizeTmdb}=await import('./generated/tools/tmdb-catalog.mjs');collections=createCollections({catalogue,anime:animeCatalogue,tmdb:{normalize:normalizeTmdb},token});
 protocol.handle('vidly',assetResponse);
 // A native, app-owned HTTPS origin supplies the identity required by official trailer embeds.
 // Other HTTPS traffic keeps normal network/TLS handling; no listener or DNS change is involved.
 session.defaultSession.protocol.handle('https',request=>new URL(request.url).hostname===APP_ID?assetResponse(request):net.fetch(request,trailerRequestOptions(request)));
 app.setAppUserModelId(APP_ID);
 await migrateLegacyOrigin();
 sourceHealth=createSourceHealth({catalogue:sourceCatalog});
 const engineRoot=app.isPackaged?path.join(app.getPath('userData'),'extension-engine'):path.resolve(__dirname,'../.tools');
 extensionService=new ExtensionService({java:path.join(engineRoot,'java/jdk-17.0.20.1+1/bin/java.exe'),jars:path.join(engineRoot,'cs3-engine-research/assets/engine'),dataDir:path.join(app.getPath('userData'),'extension-data'),pluginDir:path.join(engineRoot,'wavestream-review/plugins'),registry:JSON.parse(fs.readFileSync(path.join(__dirname,'generated/assets/source-registry.json'),'utf8'))});
 for(const s of [session.defaultSession,session.fromPartition('persist:vidly-player')]){s.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);s.webRequest.onBeforeRequest((details,cb)=>cb({cancel:blocked(details.url)}));s.on('will-download',(e)=>e.preventDefault());}
 session.fromPartition('persist:vidly-player').webRequest.onCompleted(details=>{
  if(!player||player.isDestroyed()||(details.webContentsId>0&&details.webContentsId!==player.webContents.id)||!currentPlayback||currentPlayback.previewSource||details.statusCode>=400)return;
  const mime=Object.entries(details.responseHeaders||{}).find(([k])=>k.toLowerCase()==='content-type')?.[1]?.join(' ')||'';
  if(!/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(details.url)&&!/(mpegurl|video\/(?:mp4|webm))/i.test(mime))return;
  try{const url=new URL(details.url);if(url.protocol!=='https:'||url.username||url.password)return;currentPlayback.previewSource=details.url;if(smoke)player.__previewSourceInfo={mime,extension:path.extname(url.pathname),queryKeys:[...url.searchParams.keys()]};currentPlayback.previewType=/mpegurl/i.test(mime)||/\.m3u8(?:[?#]|$)/i.test(details.url)?'M3U8':'VIDEO';currentPlayback.previewFingerprint=Object.entries(details.responseHeaders||{}).find(([k])=>/^(etag|last-modified)$/i.test(k))?.[1]?.join(' ')||'';player.webContents.executeJavaScript('window.VPlusPlayer?.command("configure",'+JSON.stringify({previewSource:details.url})+')').catch(()=>{});}catch{}
 });
 ipcMain.on('vidly:request',request);
 ipcMain.on('vidly:player-back',e=>{if(player&&e.sender===player.webContents)player.close();});
 ipcMain.on('vidly:progress',(e,m)=>{if(!player||e.sender!==player.webContents||e.senderFrame!==player.webContents.mainFrame||!matchesPlayback(e.senderFrame.url,currentPlayback)||!player.__playbackConfigured||!Number.isFinite(m?.time)||m.time<0||m.time>604800||!Number.isFinite(m.duration)||m.duration<=0||(m.time===0&&m.event!=='ended'))return;const r=currentPlayback;if(['anime','tv'].includes(r.item.kind))episodeTracker.observe(r.item,r.season,r.episode,{time:m.time,duration:m.duration,playing:m.playing,seeking:m.seeking,rate:m.rate,event:m.event});const time=m.event==='ended'?0:m.time;store.history=(store.history||[]).filter(h=>h.item?.key!==r.item.key);if(time>0)store.history.unshift({item:r.item,time,duration:Number.isFinite(m.duration)?m.duration:0,season:r.season,episode:r.episode,audio:r.audio,provider:r.provider});store.history=store.history.slice(0,50);save();});
 main=new BrowserWindow({width:1360,height:850,frame:false,thickFrame:true,titleBarStyle:'hidden',minWidth:720,minHeight:520,backgroundColor:'#111111',title:'V+',icon:path.join(__dirname,'icon.png'),show:!smoke&&!verify,webPreferences:{backgroundThrottling:false,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,autoplayPolicy:'no-user-gesture-required'}});
 attachWindowControls({window:main,ipcMain,allowed:url=>url.split('#')[0]===APP_URL});
 // A focused cross-origin trailer iframe cannot bubble Escape to the main DOM.
 // Only the trusted renderer's active-trailer flag enables this interception.
 let trailerEscapeHeld=false;
 main.webContents.on('before-input-event',(event,input)=>{
  if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();main.setFullScreen(!main.isFullScreen());return;}if(input.type==='keyDown'&&input.alt&&input.key==='ArrowLeft'){event.preventDefault();main.webContents.executeJavaScript('window.ClientNavigation?.back()').catch(()=>{});return;}if(input.key!=='Escape')return;
  if(input.type==='keyUp'){if(trailerEscapeHeld){event.preventDefault();trailerEscapeHeld=false;}return;}
  if(input.type!=='keyDown'||input.control||input.alt||input.meta)return;
  if(!input.isAutoRepeat)trailerEscapeHeld=false;
  if(!main.__cinematicTrailerActive&&!trailerEscapeHeld)return;
  event.preventDefault();trailerEscapeHeld=true;
  if(main.__cinematicTrailerActive){main.__cinematicTrailerActive=false;main.webContents.executeJavaScript('window.CinemaTrailer?.stop(true)').catch(()=>{});}
 });
 main.webContents.on('did-start-navigation',(_e,_url,_sameDocument,isMainFrame)=>{if(isMainFrame)main.__cinematicTrailerActive=false;});
 protect(main,url=>url.split("#")[0]===APP_URL);main.setMenu(Menu.buildFromTemplate([{label:'V+',submenu:[{label:'Back',accelerator:'Alt+Left',click:()=>main.webContents.executeJavaScript('window.ClientNavigation?.back()')},{type:'separator'},{role:'quit'}]},{label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));
 main.setMenu(null);main.setMenuBarVisibility(false);main.setAutoHideMenuBar(true);let closing=false,asking=false;
 main.on('close',e=>{if(!closing&&!smoke&&store.preferences?.confirmExit!==false){e.preventDefault();if(asking)return;asking=true;dialog.showMessageBox(main,{type:'question',title:'Exit V+?',message:'Close V+?',buttons:['Stay','Exit'],defaultId:0,cancelId:0}).then(r=>{asking=false;if(r.response===1){closing=true;main.close();}});return;}if(player&&!player.isDestroyed())player.close();});
 await main.loadURL(APP_URL);
 if(process.argv.includes('--engine-preview')){main.setTitle('V+ — Extension engine preview');main.webContents.on('page-title-updated',e=>e.preventDefault());await main.webContents.executeJavaScript('setTimeout(()=>window.CinemaApp?CinemaApp.navigate("sources"):document.querySelector("[data-tab=providers]")?.click(),500)');}
 if(verify){setTimeout(async()=>{let result;try{result=await main.webContents.executeJavaScript('({packaged:!!document.querySelector(".hero-actions"),cards:document.querySelectorAll(".card").length,bridge:!!window.VidlyDesktop,url:location.href})');}catch(e){result={error:e.message};}fs.writeFileSync(path.join(app.getPath('userData'),'result.json'),JSON.stringify(result));app.exit(result.packaged&&result.bridge?0:1);},8000);return;}
 if(smoke)require(process.argv.includes('--mature-content-test')?'./tests/mature-content.cjs':process.argv.includes('--anime-categories-test')?'./tests/anime-categories.cjs':process.argv.includes('--approved-providers-test')?'./tests/approved-providers.cjs':process.argv.includes('--genre-navigation-test')?'./tests/genre-navigation.cjs':process.argv.includes('--window-hero-test')?'./tests/window-hero.cjs':process.argv.includes('--ux-player-test')?'./tests/ux-player.cjs':process.argv.includes('--ux-batch-test')?'./tests/ux-batch.cjs':process.argv.includes('--anime-ux-test')?'./tests/anime-ux.cjs':process.argv.includes('--cinematic-test')?'./tests/cinematic.cjs':process.argv.includes('--source-status-test')?'./tests/source-status.cjs':process.argv.includes('--provider-audit-test')?'./tests/provider-audit.cjs':process.argv.includes('--player-update-test')?'./tests/player-update.cjs':process.argv.includes('--player-platform-test')?'./tests/player-platforms.cjs':process.argv.includes('--subtitle-test')?'./tests/subtitle-sustain.cjs':process.argv.includes('--subtitle-provider-probe')?'./tests/subtitle-provider-probe.cjs':process.argv.includes('--player-probe')?'./tests/player-probe.cjs':process.argv.includes('--player-redesign-test')?'./tests/player-redesign.cjs':process.argv.includes('--engine-test')?'./tests/extensions.cjs':process.argv.includes('--rebuild-test')?'./tests/rebuild.cjs':'./tests/smoke.cjs').run({app,main,store,storePath,openPlayer,getPlayer:()=>player,assetResponse,openExtensionPlayer,collections,animeCatalogue,catalogue,sourceCatalog});
});
// Legacy-origin migration briefly owns the only hidden window during startup.
// Its disposal must not terminate the app before the real main window exists.
app.on('window-all-closed',()=>{if(main)app.quit();});
app.on('before-quit',()=>extensionService?.close());
app.on('before-quit',()=>{clearTimeout(saveTimer);try{fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(storePath(),JSON.stringify(store));}catch{}});

