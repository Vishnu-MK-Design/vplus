'use strict';
// Runs inside the real native application, in its isolated verification profile.
// Real publisher/media observations and controlled UI cases are reported separately.
const fs=require('node:fs'),path=require('node:path');

exports.run=async({app,main,store,storePath,openPlayer,getPlayer})=>{
 const out=process.env.VPLUS_AUDIT_OUT|| (app.isPackaged?path.join(app.getPath('temp'),'VPlus-Cinematic-050'):path.resolve(__dirname,'../../deliverables/cinematic-checks-0.5.0/source'));
 fs.mkdirSync(out,{recursive:true});
 const checks=[],observations=[],limits=[],consoleErrors=[],failures=[];
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const js=code=>main.webContents.executeJavaScript(code);
 const safe=value=>JSON.stringify(value);
 main.webContents.on('console-message',event=>{if(event.level==='error')consoleErrors.push(event.message);});
 async function until(code,ms=30000,target=main){const start=Date.now();while(Date.now()-start<ms){if(target.isDestroyed())throw Error('Window closed while waiting');if(await target.webContents.executeJavaScript(code).catch(()=>false))return;await wait(120);}throw Error('Timed out: '+code);}
 async function check(id,label,code){const ok=typeof code==='string'?await js(code):await code();if(!ok)throw Error(id+' '+label);checks.push({id,label,pass:true});console.log('PASS '+id+' '+label);}
 async function phase(name,fn){try{await fn();}catch(error){failures.push({phase:name,error:error.message});console.log('FAIL '+name+' '+error.message);await shot('failure-'+name.replace(/[^a-z0-9]+/gi,'-')).catch(()=>{});}}
 async function shot(name,target=main){if(target.isDestroyed())return;target.show();target.focus();await wait(300);if(target===main)await js('Promise.race([Promise.all([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight&&i.getBoundingClientRect().bottom>0).map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,1200))])');fs.writeFileSync(path.join(out,name+'.png'),(await target.webContents.capturePage(undefined,{stayAwake:true})).toPNG());}
 async function navigate(route){await js('CinemaApp.navigate('+safe(route)+')');await wait(140);}
 async function choose(group,value){await js('CinemaApp.choose('+safe(group)+','+safe(value)+')');await wait(100);}
 async function click(selector){await js('(()=>{const e=document.querySelector('+safe(selector)+');if(!e)throw Error("Missing control "+'+safe(selector)+');e.scrollIntoView({block:"nearest",inline:"nearest"})})()');await wait(80);await js('document.querySelector('+safe(selector)+').click()');await wait(120);}
 async function key(code,target=main){target.show();target.focus();target.webContents.sendInputEvent({type:'keyDown',keyCode:code});if(code==='Return')target.webContents.sendInputEvent({type:'char',keyCode:'\r'});target.webContents.sendInputEvent({type:'keyUp',keyCode:code});await wait(100);}
 const bounds=`(()=>{const m=document.querySelector('#main'),p=document.querySelector('#page'),s=document.querySelector('.sidebar');return document.documentElement.scrollWidth<=innerWidth+1&&m.scrollWidth<=m.clientWidth+1&&p.scrollWidth<=m.clientWidth+1&&(!s||(()=>{const r=s.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})())})()`;
 const movie={kind:'movie',id:'280180',key:'movie-280180',title:'Beverly Hills Cop: Axel F',imdbId:'tt3083016',year:'2024'};
 const series={kind:'tv',id:'100088',key:'tv-100088',title:'The Last of Us',imdbId:'tt3581920',year:'2023'};
 async function windowAudit(){
  for(const [width,height] of [[1368,805],[1100,760],[720,520]]){main.setContentSize(width,height);await wait(150);for(const route of ['home','search','library','history','sources','settings']){await navigate(route);await check('F07-'+route+'-'+width,route+' fits '+width+'×'+height,bounds);}await js('CinemaApp.open('+safe(movie.key)+')');await check('F07-title-'+width,'Movie detail fits '+width+'×'+height,bounds);}
  await navigate('settings');await choose('textSize',120);await check('F07-large-text','Larger text remains bounded at the minimum desktop size',bounds);await shot('10-small-settings');await click('[data-picker=textSize]');await check('F07-small-picker','A visible option menu stays inside the minimum desktop viewport','(()=>{const e=document.querySelector("#glide-popup"),r=e.getBoundingClientRect();return !e.hidden&&r.height>80&&r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1})()');await key('Escape');await check('F07-small-picker-escape','Closing the small-window picker preserves Settings and trigger focus','CinemaApp.state().route==="settings"&&document.querySelector("#glide-popup").hidden&&document.activeElement?.dataset.picker==="textSize"');await click('#browse-trigger');await check('F07-small-browse','Browse remains bounded and scrollable in the smallest window','(()=>{const n=document.querySelector("#browse-nav"),r=n.getBoundingClientRect();return !n.hidden&&r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1})()');await shot('10-small-browse');await key('Escape');await choose('textSize',100);main.setContentSize(1368,805);
 }

 try{
  main.setPosition(70,40);main.setContentSize(1368,805);main.show();main.focus();
  await until('!!window.CinemaApp?.ready&&!!document.querySelector(".hero-actions")');
  if(!/smoke|VPlus-|verification|Cinematic/i.test(app.getPath('userData')))throw Error('Refusing to mutate a normal user profile in verification');
  if(process.argv.includes('--cinematic-layout-only'))await phase('window-bounds',windowAudit);
  if(process.argv.includes('--cinematic-audio-pref-only'))await phase('audio-preference',async()=>{await navigate('settings');await choose('settings','audio');await choose('audioLanguage','ta');await wait(350);await check('F06-A1','Settings audio selection updates the preference rather than a catalogue filter','CinemaApp.state().prefs.audioLanguage==="ta"&&CinemaApp.state().filters.audioLanguage===""');await check('F06-A2','Selected audio preference is persisted by the native host',()=>store.preferences?.audioLanguage==='ta');});
  if(!process.argv.includes('--cinematic-media-only')&&!process.argv.includes('--cinematic-audio-pref-only')&&!process.argv.includes('--cinematic-layout-only')){
   await phase('shell',async()=>{
    await check('F01-H1','Native app uses the real narrow desktop bridge without Node access','!!window.VidlyDesktop&&typeof require==="undefined"&&typeof process==="undefined"&&Object.keys(VidlyDesktop).sort().join(",")==="onMessage,send"');
    await check('F01-H2','Sidebar exists and all navigation controls have accessible names','!!document.querySelector(".sidebar")&&[...document.querySelectorAll(".sidebar button")].every(b=>b.getAttribute("aria-label")||b.textContent.trim())');
    await check('F01-H3','Search is positioned at top-right, outside the icon sidebar','(()=>{const e=document.querySelector(".search-trigger"),r=e?.getBoundingClientRect();return !!e&&!e.closest(".sidebar")&&r.top>=0&&r.top<100&&r.right>innerWidth*.6})()');
    await check('F01-H4','The shell has actual local catalogue cards','document.querySelectorAll(".poster,.landscape-card,.card").length>=4');
    await shot('01-home');
    main.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control']});main.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['control']});await wait(150);
    await check('F01-H5','Ctrl+K opens Search and focuses the text field','document.activeElement?.id==="search"');await navigate('home');
   });
   await phase('detail-and-cast',async()=>{
    await js('CinemaApp.open('+safe(movie.key)+')');await until('document.querySelectorAll(".cast-person").length>0',45000);
    await check('F02-H1','Requested real movie renders sourced cast names','[...document.querySelectorAll(".cast-person")].some(e=>e.textContent.includes("Eddie Murphy"))');
    await check('F02-H2','Movie title has one primary Play and no invented episode label','document.querySelectorAll(".hero [data-play]").length===1&&!/S0[0-9] E[0-9]/.test(document.querySelector(".hero [data-play]").textContent)');
    await check('F02-H3','Artwork is large and all three actions are on the actual title page','document.querySelector(".detail-hero").getBoundingClientRect().height>=500&&!!document.querySelector(".hero [data-save]")&&!!document.querySelector(".hero [data-trailer]")');
    await until('document.querySelector(".detail-hero .hero-picture")?.complete&&document.querySelector(".detail-hero .hero-picture")?.naturalWidth>0',15000);
    observations.push({name:'movie-artwork',...await js('(()=>{const i=document.querySelector(".detail-hero .hero-picture");return {naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,bounds:i.getBoundingClientRect().toJSON(),hidden:i.hidden,visibility:getComputedStyle(i).visibility}})()')});
    await check('F02-H6','The larger artwork has decoded into the actual title hero','(()=>{const i=document.querySelector(".detail-hero .hero-picture"),r=i.getBoundingClientRect(),h=i.closest(".hero").getBoundingClientRect();return !i.hidden&&i.naturalWidth>0&&r.width>=h.width-1&&r.height>=h.height-1})()');
    await shot('02-title');await js('document.querySelector(".cast-section").scrollIntoView({block:"center"})');await shot('03-cast');
    await js('CinemaApp.open('+safe(series.key)+')');await until('document.querySelectorAll(".episode-card").length>0',45000);
    await check('F02-H4','Series uses actual episode metadata and stills or an honest fallback','document.querySelectorAll(".episode-card").length>0&&[...document.querySelectorAll(".episode-card h3")].every(e=>e.textContent.trim())');
    await choose('season',2);await until('CinemaApp.state().season===2&&document.querySelectorAll(".episode-card").length>0',45000);
    await check('F02-H5','Switching season updates the primary episode action','/S02/.test(document.querySelector(".hero [data-play]").textContent)');await shot('04-series');
   });
   await phase('library-persistence',async()=>{
    await js('CinemaApp.open('+safe(movie.key)+')');await until('!!document.querySelector(".hero [data-save]")');
    await js('if(!CinemaApp.state().saved.some(i=>i.key==="movie-280180"))document.querySelector(".hero [data-save]").click()');await wait(350);
    await check('F03-H1','My List save reaches the native persistent store',()=>Array.isArray(store.saved)&&store.saved.some(item=>item.key===movie.key));
    await navigate('library');await check('F03-H2','Saved real title appears in Library','document.querySelector("#page").textContent.includes("Beverly Hills Cop")');await shot('05-library');
    await choose('textSize',120);await wait(350);await check('F03-H3','Text size reaches native preferences',()=>store.preferences?.textSize===120);
    const reloaded=new Promise(resolve=>main.webContents.once('did-finish-load',resolve));main.webContents.reload();await reloaded;await until('!!window.CinemaApp?.ready');await navigate('library');
    await check('F03-H4','A real renderer reload retains the saved title and preference','CinemaApp.state().saved.some(i=>i.key==="movie-280180")&&CinemaApp.state().prefs.textSize===120');
    if(storePath)await check('F03-H5','Native JSON store contains the saved entry',()=>JSON.parse(fs.readFileSync(storePath(),'utf8')).saved.some(item=>item.key===movie.key));await choose('textSize',100);
   });
   await phase('search-and-filters',async()=>{
    await navigate('search');await until('!!document.querySelector("#search")');
    await js('document.querySelector("#search").focus();document.querySelector("#search").value="Punisher";document.querySelector("#search").setSelectionRange(3,3);document.querySelector("#search").dispatchEvent(new Event("input",{bubbles:true}))');await key('Return');
    await until('CinemaApp.state().query==="Punisher"&&CinemaApp.state().activeQuery==="Punisher"',5000);await until('!CinemaApp.state().busy',45000);
    await check('F04-H1','Typed query remains in the native app search field','document.querySelector("#search").value==="Punisher"');
    await check('F04-H5','Actual form submission and async results preserve focus and caret','CinemaApp.state().activeQuery==="Punisher"&&document.activeElement?.id==="search"&&document.querySelector("#search").selectionStart===3&&document.querySelector("#search").selectionEnd===3');
    let response;try{response=await js('CinemaApp.request("catalogue",{kind:"tv",query:"Punisher",page:1,sort:"popular",source:"cinemeta"})');observations.push({name:'live-query',count:response?.items?.length||0});if(response?.items?.length)checks.push({id:'F04-L1',label:'Real public catalogue query returns numeric mapped titles',pass:response.items.every(i=>/^[1-9][0-9]*$/.test(String(i.id))&&i.key===i.kind+'-'+i.id)});else limits.push('Public query returned no titles during this run.');}catch(error){limits.push('Public query unavailable: '+error.message);}
    let filtered;try{filtered=await js('CinemaApp.request("catalogue",{kind:"movie",language:"en",country:"US",page:1,sort:"popular",source:"cinemeta"})');}catch(error){limits.push('Public language/country index could not complete: '+error.message);}
    if(filtered){const rows=filtered.items||[];observations.push({name:'live-language-country',source:filtered.source,index:filtered.index,count:rows.length,items:rows.slice(0,5).map(t=>({key:t.key,title:t.title,languages:t.languages,countries:t.countries}))});if(rows.length)await check('F04-L3','Real English/US catalogue response contains only matching language/country metadata',()=>rows.every(t=>t.languages?.includes('en')&&t.countries?.includes('US')));else limits.push('English/US public language index returned zero titles; the filter intersection is separately covered by model tests.');}
    await choose('country','US');await choose('language','en');
    await check('F04-H2','Country and language controls retain their combined selections','CinemaApp.state().filters.country==="US"&&CinemaApp.state().filters.language==="en"');
    await choose('year','2024');await check('F04-H3','Year combines with country/language without clearing them','CinemaApp.state().filters.year==="2024"&&CinemaApp.state().filters.country==="US"&&CinemaApp.state().filters.language==="en"');await shot('06-search-filters');
    await check('F04-H4','Visible filtered result cards obey the actual selected metadata intersection','[...document.querySelectorAll("#search-results [data-detail]")].every(b=>CinemaModel.matches(CinemaApp.getItem(b.dataset.detail),{...CinemaApp.state().filters,kind:CinemaApp.state().kind},CinemaApp.state().audioIndex))');
    await choose('country','');await choose('language','');await choose('year','');
    let exact;try{exact=await js('CinemaApp.request("imdb",{id:"tt22084616"})');}catch(error){limits.push('Exact IMDb service could not complete: '+error.message);}
    if(exact){observations.push({name:'exact-imdb',items:(exact.items||[]).map(i=>({key:i.key,id:i.id,title:i.title}))});await check('F04-L2','Exact requested IMDb ID resolves to a numeric player title',()=>!!exact.items?.some(i=>i.imdbId==='tt22084616'&&/^[1-9][0-9]*$/.test(String(i.id))));}
   });
   await phase('automatic-paging',async()=>{
    await navigate('movies');await until('!CinemaApp.state().busy',45000);const before=await js('({page:CinemaApp.state().page,count:CinemaApp.state().liveItems.length,hasMore:CinemaApp.state().hasMore})');
    if(!before.hasMore){limits.push('Current movie catalogue advertised no additional page; automatic paging was not exercised.');return;}
    await js('document.querySelector("#search").focus({preventScroll:true});document.querySelector("#main").scrollTop=document.querySelector("#main").scrollHeight');await until('CinemaApp.state().page>'+before.page+'&&!CinemaApp.state().busy',45000);const after=await js('({page:CinemaApp.state().page,count:CinemaApp.state().liveItems.length})');observations.push({name:'real-automatic-paging',before,after});
    await check('F04-P1','Scrolling automatically loads the next real catalogue batch without a button click',()=>after.page>before.page&&after.count>=before.count);
    await check('F04-P2','Automatic paging deduplicates titles and does not steal focus into the sidebar','(()=>{const s=CinemaApp.state(),ids=s.liveItems.map(i=>i.key);return new Set(ids).size===ids.length&&!document.activeElement.closest(".sidebar")})()');
   });
   await phase('sources-and-settings',async()=>{
    await navigate('sources');await choose('sources','extensions');await until('document.querySelectorAll(".extension-item,.extension-card").length===125');
    await check('F05-H1','All 125 actual extension records are visible with truthful status','document.querySelectorAll(".extension-item,.extension-card").length===125&&!document.querySelector("#page").textContent.includes("needs a Vidly")');await shot('07-extensions');
    await choose('sources','catalogues');await check('F05-H2','Catalogue role is distinct from movie playback','/catalogue/i.test(document.querySelector("#page").textContent)&&/not connected|unavailable|metadata|not a playback/i.test(document.querySelector("#page").textContent)');await shot('08-sources');
    await navigate('settings');for(const group of ['appearance','playback','audio','library','about','connections']){await choose('settings',group);await check('F06-'+group,'Settings '+group+' section renders actual content','document.querySelector("#page").textContent.trim().length>30');}
    await choose('settings','audio');await choose('audioLanguage','ta');await wait(350);await check('F06-A1','Settings audio selection updates the preference rather than a catalogue filter','CinemaApp.state().prefs.audioLanguage==="ta"&&CinemaApp.state().filters.audioLanguage===""');await check('F06-A2','Selected audio preference is persisted by the native host',()=>store.preferences?.audioLanguage==='ta');await choose('audioLanguage','auto');await choose('settings','appearance');await shot('09-settings');
   });
   await phase('menus-and-keyboard',async()=>{
    await navigate('settings');await choose('settings','appearance');await click('[data-picker=textSize]');
    await check('F06-K1','Desktop preference menu opens as an actual accessible listbox','!document.querySelector("#glide-popup").hidden&&!!document.querySelector("#glide-popup [role=option]")');await key('End');await key('Return');
    await check('F06-K2','Keyboard selection changes the real text-size preference','CinemaApp.state().prefs.textSize===120&&document.querySelector("#glide-popup").hidden');await choose('textSize',100);
    await click('[data-picker=density]');await key('Escape');await check('F06-K3','Escape closes the picker and restores its trigger focus','document.querySelector("#glide-popup").hidden&&document.activeElement?.dataset.picker==="density"');
    await click('#browse-trigger');await check('F06-K4','Browse opens real destinations in a bounded panel','(()=>{const n=document.querySelector("#browse-nav"),r=n.getBoundingClientRect();return !n.hidden&&n.querySelectorAll(".nav-card").length===3&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()');await key('Escape');await check('F06-K5','Escape closes Browse and restores the Browse trigger','document.querySelector("#browse-nav").hidden&&document.activeElement?.id==="browse-trigger"');
   });
   await phase('window-bounds',windowAudit);
   await phase('trailers',async()=>{
    await js('CinemaApp.open('+safe(movie.key)+')');await until('!!document.querySelector("[data-trailer]:not([disabled])")',45000);await click('[data-trailer]');
    await until('window.CinemaTrailer?.state().status==="playing"&&CinemaTrailer.state().time>5',40000);
    const trailer=await js('CinemaTrailer.state()');observations.push({name:'real-trailer',state:trailer});
    await check('F08-L1','Official trailer genuinely advances in the native app','CinemaTrailer.state().time>5');
    await check('F08-H1','Trailer frame has a real visible playback surface','(()=>{const r=document.querySelector(".official-video-stage iframe,.video-trailer video")?.getBoundingClientRect();return !!r&&r.width>350&&r.height>200&&r.left>=0&&r.right<=innerWidth+1})()');await shot('11-trailer');
    await navigate('home');await check('F08-H2','Navigating away destroys the active trailer','!CinemaTrailer.state().active&&!document.querySelector(".official-video-stage iframe")');
   });
   await phase('real-permitted-background',async()=>{
    await navigate('search');await js('document.querySelector("#search").focus();document.querySelector("#search").value="Sintel";document.querySelector("#search").dispatchEvent(new Event("input",{bubbles:true}))');await key('Return');await until('!CinemaApp.state().busy&&!!CinemaApp.getItem("movie-45745")',45000);
    await check('F08-R1','Actual Search finds the verified Sintel catalogue identity','CinemaApp.getItem("movie-45745").imdbId==="tt1727587"');await js('CinemaApp.open("movie-45745")');await until('CinemaApp.state().detail?.trailer?.type==="video"',45000);await click('[data-trailer]');
    await until('CinemaTrailer.state().status==="playing"&&CinemaTrailer.state().time>5&&document.querySelector(".video-trailer video")?.readyState>=2',40000);
    await check('F08-R2','Permitted official remote trailer really plays as a clean background','(()=>{const v=document.querySelector(".video-trailer video"),t=CinemaApp.state().detail.trailer;return v.currentTime>5&&!v.loop&&v.muted&&!v.controls&&t.backgroundAllowed===true&&new URL(v.currentSrc).hostname==="download.blender.org"})()');
    await check('F08-R3','Actual background covers the hero behind visible title and actions','(()=>{const h=document.querySelector(".detail-hero"),v=h.querySelector(".video-trailer video"),c=h.querySelector(".hero-copy"),b=v.getBoundingClientRect(),r=h.getBoundingClientRect(),s=getComputedStyle(c);return b.width>=r.width-1&&b.height>=r.height-1&&s.visibility!=="hidden"&&Number(s.opacity)>0&&!!c.querySelector("[data-play]")&&!!c.querySelector("[data-save]")})()');await shot('11-sintel-permitted-background');
    await js('document.querySelector(".video-trailer video").currentTime=document.querySelector(".video-trailer video").duration-.35');await until('!CinemaTrailer.state().active',10000);await wait(250);await check('F08-R4','Actual permitted trailer restores artwork at the natural end','!document.querySelector(".video-trailer video")');await navigate('home');await check('F08-R5','Leaving the title cancels the remote background decoder','!CinemaTrailer.state().active&&!document.querySelector(".video-trailer video")');
   });
   await phase('local-trailer-fixture',async()=>{
    const {dialog}=require('electron'),fixture=path.join(process.argv.find(v=>v.startsWith('--fixtures-dir='))?.slice(15)||path.resolve(__dirname,'../../.tools/preview-fixtures'),'short.mp4');
    if(!fs.existsSync(fixture))throw Error('Real local test fixture missing; provide --fixtures-dir.');
    await js('CinemaApp.open('+safe(movie.key)+')');await until('!!document.querySelector("[data-local-trailer]")');
    const previous=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
    try{await click('[data-local-trailer]');await until('CinemaApp.state().detail?.trailer?.type==="video"',15000);}finally{dialog.showOpenDialog=previous;}
    if(!await js('CinemaTrailer.state().active'))await click('[data-trailer]');
    await until('CinemaTrailer.state().status==="playing"&&CinemaTrailer.state().time>1&&document.querySelector(".video-trailer video")?.readyState>=2',20000);
    await check('F08-F1','A selected local fixture really decodes with muted, control-free playback','(()=>{const v=document.querySelector(".video-trailer video");return !!v&&!v.loop&&v.muted&&!v.controls&&v.currentTime>1&&[...v.textTracks].every(t=>t.mode==="disabled")})()');
    await check('F08-F2','Local video covers the artwork while title content and actions remain visible','(()=>{const h=document.querySelector(".detail-hero"),v=h.querySelector(".video-trailer video"),c=h.querySelector(".hero-copy"),r=h.getBoundingClientRect(),b=v.getBoundingClientRect(),s=getComputedStyle(c);return b.width>=r.width-1&&b.height>=r.height-1&&s.visibility!=="hidden"&&Number(s.opacity)>0&&!!c.querySelector("[data-play]")&&!!c.querySelector("[data-save]")&&h.querySelector(".video-trailer").getBoundingClientRect().top>=r.top-1})()');
    await shot('12-local-trailer-fixture');
    const before=await js('(()=>{const v=document.querySelector(".video-trailer video");v.currentTime=v.duration-.35;return {duration:v.duration,seek:v.currentTime}})()');
    await until('(()=>{const v=document.querySelector(".video-trailer video");return !!v&&!v.seeking&&v.currentTime<2&&v.currentTime>.03})()',5000);
    const after=await js('document.querySelector(".video-trailer video").currentTime');await check('F08-F3','The actual local video naturally wraps at its end and continues playing','!document.querySelector(".video-trailer video").paused');observations.push({name:'local-fixture-loop',fixture:'short.mp4',classification:'decoder fixture, not an official title trailer',before,after});
    const reloaded=new Promise(resolve=>main.webContents.once('did-finish-load',resolve));main.webContents.reload();await reloaded;await until('!!CinemaApp?.ready');await js('CinemaApp.open('+safe(movie.key)+')');
    await check('F08-F4','The selected local trailer survives a real application reload','CinemaApp.state().detail?.trailer?.type==="video"&&CinemaApp.state().detail?.trailer?.backgroundAllowed===true');await navigate('home');
    await check('F08-F5','Local trailer decoder is removed when leaving the title page','!CinemaTrailer.state().active&&!document.querySelector(".video-trailer video")');
   });
  }
  if(!process.argv.includes('--cinematic-ui-only')&&!process.argv.includes('--cinematic-audio-pref-only')&&!process.argv.includes('--cinematic-layout-only')){
   await phase('real-full-player',async()=>{
    await navigate('home');await js('CinemaApp.open("movie-76341")');await click('.hero [data-play]');let player;for(let n=0;n<40;n++){player=getPlayer();if(player)break;await wait(100);}if(!player)throw Error('The real title-page Play action did not open the native player');player.setPosition(110,70);player.show();player.focus();
    const pjs=code=>player.webContents.executeJavaScript(code);await until('!!window.VPlusPlayer&&document.querySelector("video")?.readyState>=2',65000,player);
    await pjs('document.querySelector("video").play()');const start=await pjs('document.querySelector("video").currentTime');await wait(1500);const end=await pjs('document.querySelector("video").currentTime');
    await check('F09-L1','A real full-title source advances video time',()=>end>start+.25);observations.push({name:'full-player',originPath:await pjs('location.origin+location.pathname'),from:start,to:end});
    await check('F09-H1','Player retains DesktopPlayer and distinct Audio/Subtitles controls',async()=>await pjs('(()=>{const r=document.querySelector("#vplus-player").shadowRoot;return VPlusPlayer.command("state").platform==="desktop"&&!!r.querySelector("[data-action=audio]")&&!!r.querySelector("[data-action=subtitles]")})()'));
    await pjs('document.querySelector("#vplus-player").shadowRoot.querySelector("[data-action=fullscreen]").click()');await wait(450);await check('F09-H2','Actual fullscreen control enters native Windows fullscreen',()=>player.isFullScreen());await key('Escape',player);await wait(450);await check('F09-H3','Escape leaves fullscreen without closing playback',()=>!player.isDestroyed()&&!player.isFullScreen());
    await pjs('document.querySelector("video").currentTime=120');await wait(6500);await check('F09-H4','Actual playback progress reaches the native history store',()=>store.history?.some(h=>h.item?.key==='movie-76341'&&h.time>=118));
    const savedTime=store.history.find(h=>h.item?.key==='movie-76341')?.time;player.webContents.sendInputEvent({type:'mouseMove',x:450,y:200});await shot('12-real-player',player);player.close();await wait(450);await check('F09-H5','Closing playback returns to the existing browsing window',()=>!main.isDestroyed()&&main.isVisible()&&!getPlayer());
    await until('CinemaApp.state().history.some(h=>h.item.key==="movie-76341"&&h.time>=18)');await click('.hero [data-play]');for(let n=0;n<40;n++){player=getPlayer();if(player)break;await wait(100);}if(!player)throw Error('Resume Play did not reopen the native player');
    await until('!!window.VPlusPlayer&&document.querySelector("video")?.readyState>=2',65000,player);const resumed=await player.webContents.executeJavaScript('document.querySelector("video").currentTime');await check('F09-H6','The real Resume action restores the saved playback position',()=>resumed>=Math.max(0,savedTime-3));observations.push({name:'real-resume',savedTime,resumed});player.close();await wait(250);
   });
  }
 }catch(error){failures.push({phase:'bootstrap',error:error.message});console.log('FAIL bootstrap '+error.message);await shot('failure-bootstrap').catch(()=>{});}
 finally{
  const appErrors=consoleErrors.filter(message=>!/^Permissions policy violation: compute-pressure is not allowed in this document\.?$/.test(message));
  const result={version:'0.5.0',packaged:app.isPackaged,checks,passed:checks.filter(c=>c.pass).length,failed:failures.length+checks.filter(c=>!c.pass).length+appErrors.length,failures,observations,limits,consoleErrors};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'report.txt'),checks.map(c=>(c.pass?'PASS ':'FAIL ')+c.id+' '+c.label).concat(failures.map(f=>'FAIL '+f.phase+' '+f.error),limits.map(l=>'LIMIT '+l)).join('\n')+'\n');
  console.log(JSON.stringify({out,passed:result.passed,failed:result.failed,limits,consoleErrors}));app.exit(result.failed?1:0);
 }
};
