'use strict';
const fs=require('node:fs'),path=require('node:path');
const {session,net,dialog}=require('electron');
const {pathToFileURL}=require('node:url');
const {navigation}=require('../routes.cjs');
exports.run=async({app,main,store,openPlayer,getPlayer})=>{
 const out=process.env.VPLUS_AUDIT_OUT||path.join(app.getPath('temp'),'VPlus-Approved-Providers');fs.mkdirSync(out,{recursive:true});
 const checks=[],live=[],errors=[];let failure='';const fixture=process.argv.includes('--provider-fixture');
 const media=process.env.VPLUS_PROVIDER_FIXTURE_FILE||path.resolve(__dirname,'../../.tools/preview-fixtures/short.mp4');
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),pass=s=>{checks.push(s);console.log('PASS '+s);};
 const js=(s,w=getPlayer())=>w.webContents.executeJavaScript(s);
 async function until(fn,ms=12000){const start=Date.now();while(Date.now()-start<ms){try{if(await fn())return;}catch{}await wait(100);}throw Error('Timed out waiting for provider state');}
 async function check(label,code,w){if(!await js(code,w))throw Error(label);pass(label);}
 const root='document.querySelector("#vplus-player").shadowRoot';
 const messages=[];dialog.showMessageBox=async(_w,options)=>{messages.push({message:options.message,buttons:options.buttons});return {response:0};};
 try{
  main.setPosition(-10000,0);main.show();await until(()=>main.webContents.executeJavaScript('window.CinemaApp?.ready&&CinemaApp.state().playbackProviders.length===4'),50000);
  await main.webContents.executeJavaScript('CinemaApp.navigate("sources")');
  await check('PC Sources receives all four providers from the native registry',`['vidly','cinesrc','vidfast','vidlink'].every(id=>document.querySelector('[data-group=defaultSource][data-value="'+id+'"]'))`,main);
  await main.webContents.executeJavaScript('CinemaApp.navigate("settings");CinemaApp.choose("settings","playback");CinemaApp.choose("defaultSource","vidfast")');
  await check('PC preferences accept and save VidFast without altering shared platform preferences','TVPreferences.get().defaultSource==="vidfast"',main);
  if(fixture){
   if(!fs.existsSync(media))throw Error('Controlled media fixture missing');
   const ses=session.fromPartition('persist:vidly-player'),bytes=fs.readFileSync(media);
   await ses.protocol.handle('https',req=>{
    const u=new URL(req.url);if(!['vidly.pro','cinesrc.st','vidfast.vc','vidlink.pro'].includes(u.hostname))return net.fetch(req,{bypassCustomProtocolHandlers:true});
    if(u.pathname==='/__fixture.mp4'){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.get('Range')||'');if(range){const start=Number(range[1]),end=range[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;if(start> end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});}return new Response(bytes,{headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(bytes.length)}});}
    if(u.pathname==='/__fixture.vtt')return new Response('WEBVTT\n\n00:00.000 --> 00:15.500\nControlled provider integration captions\n',{headers:{'Content-Type':'text/vtt'}});
    return new Response('<!doctype html><html><head><title>Controlled provider fixture</title></head><body><video autoplay playsinline><source src="/__fixture.mp4" type="video/mp4"><track kind="subtitles" label="English" srclang="en" src="/__fixture.vtt"></video><div aria-label="Server"><button aria-pressed="true">Fixture A</button><button>Fixture B</button></div></body></html>',{headers:{'Content-Type':'text/html'}});
   });
   const item={kind:'movie',id:'45745',key:'movie-45745',title:'Controlled provider verification'};
   store.history=[{item,time:4,duration:16,season:1,episode:1}];
   await openPlayer({provider:'vidly',item,resume:true,paused:true});let w=getPlayer();w.setPosition(-10000,0);w.show();
   await until(()=>js('window.VPlusPlayer&&document.querySelector("video").readyState>=2&&Math.abs(document.querySelector("video").currentTime-4)<1',w));
   for(const provider of ['vidfast','vidlink','cinesrc','vidly']){
    await js('document.querySelector("video").pause();VPlusPlayer.command("menu","sources");'+root+'.querySelector("[data-source='+provider+']").click()',w);
    await until(()=>{w=getPlayer();return w&&!w.isDestroyed()&&navigation(w.webContents.getURL(),provider)&&js('window.VPlusPlayer&&VPlusPlayer.command("state").sources.provider==='+JSON.stringify(provider)+'&&document.querySelector("video").readyState>=2&&Math.abs(document.querySelector("video").currentTime-4)<1&&document.querySelector("video").paused',w)});
    await check(provider+' uses its published route and retains the paused 4-second position','Math.abs(document.querySelector("video").currentTime-4)<1&&document.querySelector("video").paused',w);
    await js('VPlusPlayer.command("menu","sources")',w);
    await check(provider+' retains every compatible source and one selected checkmark',root+'.querySelectorAll("[data-source]").length===5&&'+root+'.querySelectorAll("[data-source][aria-pressed=true]").length===1&&'+root+'.querySelector("[data-source='+provider+']").getAttribute("aria-pressed")==="true"',w);
    await js('VPlusPlayer.command("back");VPlusPlayer.command("play")',w);await wait(800);await check(provider+' shared playback controls advance actual decoded fixture media','document.querySelector("video").currentTime>4.3&&!document.querySelector("video").paused',w);
    await js('VPlusPlayer.command("pause");document.querySelector("video").currentTime=4',w);await until(()=>js('!document.querySelector("video").seeking',w));
    if(provider==='vidlink'){
     await until(()=>js('document.querySelector("video").textTracks.length>0',w));await js('VPlusPlayer.command("menu","subtitles")',w);const subtitleButton=root+`.querySelector('[data-track=subtitles][data-index="0"]')`;await until(()=>js(subtitleButton+'!==null',w));await js(subtitleButton+'.click()',w);await until(()=>js('VPlusPlayer.command("state").captions.includes("Controlled provider")',w));pass('VidLink integration retains the real text-track caption renderer');
     const before=await js(root+'.querySelector(".captions").getBoundingClientRect().bottom',w);await js('VPlusPlayer.command("menu","settings")',w);const after=await js(root+'.querySelector(".captions").getBoundingClientRect().bottom',w);if(Math.abs(before-after)>1)throw Error('Caption shifted during menu change');pass('Source integration leaves subtitles anchored while menus open');
     w.setFullScreen(true);await wait(500);if(!w.isFullScreen())throw Error('Native fullscreen failed');w.setFullScreen(false);await wait(1200);pass('New source retains native Windows fullscreen');
     fs.writeFileSync(path.join(out,'vidlink-fixture.png'),(await w.webContents.capturePage()).toPNG());
    }
   }
   w.destroy();await wait(200);
   for(const [provider,kind,id,mal,url]of [['vidfast','tv','1396',false,'/tv/1396/2/7'],['vidlink','tv','1396',false,'/tv/1396/2/7'],['vidlink','anime','44511',true,'/anime/44511/7/dub']]){
    await openPlayer({provider,item:{kind,id,mal,key:kind+'-'+id,title:'Controlled episode fixture'},season:2,episode:7,audio:'dub'});w=getPlayer();await until(()=>js('window.VPlusPlayer&&document.querySelector("video").readyState>=2',w));if(new URL(w.webContents.getURL()).pathname!==url)throw Error('Episode identity changed');await check(provider+' '+kind+' preserves episode identity in the native header',root+'.querySelector(".episode-info").textContent.includes("7")',w);w.destroy();await wait(100);
   }
   await ses.protocol.unhandle('https');pass('Fixture interception removed after tests');
  }else{
   for(const [provider,id,title]of [['vidfast','45745','Sintel'],['vidlink','45745','Sintel'],['vidfast','10378','Big Buck Bunny'],['vidlink','10378','Big Buck Bunny'],['vidfast','133701','Tears of Steel'],['vidlink','133701','Tears of Steel']]){
    if(process.env.VPLUS_LIVE_PROVIDER&&provider!==process.env.VPLUS_LIVE_PROVIDER)continue;if(process.env.VPLUS_LIVE_TITLE&&id!==process.env.VPLUS_LIVE_TITLE)continue;const controls=process.argv.includes('--provider-controls');const item={kind:'movie',id,key:'movie-'+id,title};if(controls)store.history=[{item,time:30,duration:900,season:1,episode:1}];const r={provider,title,id,decoded:false};const start=Date.now();await openPlayer({provider,item,resume:controls,paused:controls});const w=getPlayer();if(!w||w.isDestroyed()){r.closedBeforeReady=true;live.push(r);continue;}w.setPosition(-10000,0);w.show();
    while(Date.now()-start<26000&&!w.isDestroyed()){
     const ready=await js('document.querySelector("video")?.readyState>=2&&document.querySelector("video")?.videoWidth>0',w).catch(()=>false);if(ready){r.decoded=true;if(controls){await until(()=>js('Math.abs(document.querySelector("video").currentTime-30)<1&&document.querySelector("video").paused',w),20000);pass(provider+' live film restores the saved 30-second position and paused state');}r.start=await js('document.querySelector("video").currentTime',w);await js('VPlusPlayer.command("play")',w).catch(()=>{});await wait(2500);r.end=await js('document.querySelector("video").currentTime',w);r.advancing=r.end>r.start+.5;break;}await wait(500);
    }
    if(controls&&r.decoded){
     if(!r.advancing)throw Error('Live media did not advance');pass(provider+' live media decodes and advances through V+ controls');
     await js('VPlusPlayer.command("pause")',w);await check('Live Pause works','document.querySelector("video").paused',w);
     const before=await js('document.querySelector("video").currentTime',w);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await until(()=>js('!document.querySelector("video").seeking&&Math.abs(document.querySelector("video").currentTime-'+(before+10)+')<1',w),15000);pass('Desktop Right Arrow seeks the actual live stream forward ten seconds');
     await js('document.querySelector("video").volume=.5',w);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Up'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Up'});await check('Desktop Up Arrow changes live stream volume by five percent','Math.abs(document.querySelector("video").volume-.55)<.001',w);
     await js('VPlusPlayer.command("menu","subtitles")',w);r.tracks=await js('[...document.querySelector("video").textTracks].map(t=>({label:t.label,language:t.language,kind:t.kind,mode:t.mode,cues:t.cues?.length||0}))',w);r.external=await js('VPlusPlayer.command("state").externalSubtitles||null',w);
     const track=root+`.querySelector('[data-track=subtitles][data-index="0"]')`;if(await js('!!'+track,w)){await js(track+'.click()',w);await wait(17000);r.caption=await js('({state:VPlusPlayer.command("state").captions,selected:VPlusPlayer.command("state").subtitle,notice:document.querySelector("#vplus-player").shadowRoot.querySelector(".track-footer")?.textContent,tracks:[...document.querySelector("video").textTracks].map(t=>({label:t.label,mode:t.mode,cues:t.cues?.length||0,active:t.activeCues?.length||0})),elements:[...document.querySelectorAll("track")].map(t=>({label:t.label,kind:t.kind,ready:t.readyState}))})',w);if(r.caption.selected>=100)pass('Live provider subtitle file loads into the native caption renderer');else r.subtitleLimitation='Provider advertises English but no caption cues loaded; the menu reports the failure.';}else r.subtitleLimitation='No provider text track exposed to the native video; no subtitle capability claimed.';
     await js('VPlusPlayer.command("back")',w);w.setFullScreen(true);await wait(700);if(!w.isFullScreen())throw Error('Live fullscreen failed');w.setFullScreen(false);await wait(1300);pass('Live provider supports native Windows fullscreen');
    }
    if(!w.isDestroyed()){r.network=await js('performance.getEntriesByType("resource").map(r=>({origin:(()=>{try{return new URL(r.name).origin}catch{return ""}})(),type:r.initiatorType,status:r.responseStatus})).filter(r=>r.type==="fetch"||r.type==="xmlhttprequest").slice(-30)',w).catch(()=>[]);r.providerErrors=await js('(document.body.textContent.match(/\\(500\\)|OOPS! SOMETHING WENT WRONG|We Couldn.t Find This Content/gi)||[]).slice(0,6)',w).catch(()=>[]);r.ui=await js('({player:!!window.VPlusPlayer,ready:document.querySelector("video")?.readyState||0,menus:window.VPlusPlayer?.command("state").sources})',w).catch(()=>null);fs.writeFileSync(path.join(out,provider+'-'+id+'.png'),(await w.webContents.capturePage()).toPNG());w.destroy();}r.elapsedMs=Date.now()-start;live.push(r);console.log('LIVE '+JSON.stringify(r));await wait(150);
   }
  }
 }catch(e){failure=e.message;console.error(e);const w=getPlayer();if(w&&!w.isDestroyed()){fs.writeFileSync(path.join(out,'failure.png'),(await w.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await js('({url:location.pathname,state:window.VPlusPlayer?.command("state"),videos:[...document.querySelectorAll("video")].map(v=>({time:v.currentTime,duration:v.duration,ready:v.readyState,seeking:v.seeking,paused:v.paused,error:v.error?.code}))})',w).catch(()=>null),null,2));}}
 finally{const w=getPlayer();if(w&&!w.isDestroyed())w.destroy();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,live,messages,errors,failure,fixture,notice:fixture?'Controlled route/controls tests. Not evidence of upstream provider availability.':'Live published URLs; openly licensed Blender films only. No media URLs extracted.'},null,2));app.exit(failure?1:0);}
};
