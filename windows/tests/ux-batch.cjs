'use strict';
const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main})=>{
 const out=process.env.VPLUS_AUDIT_OUT||path.join(app.getPath('temp'),'VPlus-UX-Batch');fs.mkdirSync(out,{recursive:true});const errors=[],checks=[],collectionRequests=[];require('electron').ipcMain.on('vidly:request',(event,m)=>{if(event.sender===main.webContents&&m.type==='collection')collectionRequests.push(m.id);});
 main.webContents.on('console-message',e=>{if(e.level==='error'&&!/net::ERR_|Failed to load resource/.test(e.message))errors.push(e.message);});
 const js=s=>main.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(s,ms=80000){const begin=Date.now();while(Date.now()-begin<ms){if(await js(s).catch(()=>false))return;await wait(250);}throw Error('Timeout '+s);}
 async function check(name,s){if(!await js(s))throw Error(name);checks.push(name);console.log('PASS '+name);}
 async function shot(name){fs.writeFileSync(path.join(out,name),(await main.webContents.capturePage()).toPNG());}
 let failure='';try{
  main.show();main.focus();await until('window.CinemaApp?.ready');await until('document.querySelectorAll(".discovery-shelf").length>3');
  await until('CinemaDiscovery.featured().length>=3');
  await check('Home features movies, series and anime independently','["movie","tv","anime"].every(k=>CinemaDiscovery.featured().some(t=>t.kind===k))');
  if(collectionRequests.some(id=>id.endsWith('-collection')))throw Error('Off-screen genre rows loaded eagerly');checks.push('Off-screen genre rows wait for scrolling');console.log('PASS Off-screen genre rows wait for scrolling');
  await check('Native title/menu bars removed and in-app search retained','!!document.querySelector(".search-trigger")&&getComputedStyle(document.querySelector(".topbar")).borderBottomWidth==="0px"');
  if(main.isMenuBarVisible())throw Error('Native menu bar visible');
  await check('Mixed genre rows use dedicated collection identities','!!document.querySelector("[data-collection=action-collection]")');
  await until('document.querySelector(".poster-row")?.scrollWidth>0');
  await check('Horizontal scrollbars hidden without disabling scrolling','getComputedStyle(document.querySelector(".poster-row")).scrollbarWidth==="none"');
  await js('document.querySelector(".hero [data-feature]").click();window.__lastFeature=CinemaApp.state().feature');
  await check('Manual previous wraps from first to last','CinemaApp.state().feature===CinemaDiscovery.featured().length-1');
  main.webContents.sendInputEvent({type:'mouseMove',x:35,y:75});await until('CinemaApp.state().feature===0',20000);
  await check('Featured carousel automatically loops to first title','CinemaApp.state().feature===0');
  await shot('home.png');
  for(const [route,kind] of [['movies','movie'],['series','tv'],['anime','anime']]){
   await js('CinemaApp.navigate('+JSON.stringify(route)+')');await until('CinemaDiscovery.featured().length>0');
   await check(route+' discovery has no large Search form and correct featured type','!document.querySelector("#search-form")&&CinemaDiscovery.featured().every(t=>t.kind==='+JSON.stringify(kind)+')');
  }
  await until('document.querySelector(".airing-results .airing-entry")');
  await check('Anime schedule uses timestamped real broadcast entries','!!document.querySelector(".airing-results time[datetime]")&&document.querySelectorAll("[data-schedule-period]").length===3');
  await shot('anime.png');
  await js('CinemaApp.navigate("home");CinemaDiscovery.quickOpen()');
  await check('Quick search opens without navigating away','!!document.querySelector("#quick-input")&&CinemaApp.state().route==="home"');
  await js('let input=document.querySelector("#quick-input");input.value="naruto";input.dispatchEvent(new Event("input",{bubbles:true}));input.value="dragon ball";input.dispatchEvent(new Event("input",{bubbles:true}))');
  await until('document.querySelectorAll("#quick-results [role=option]").length>0');
  await check('Quick live search keeps newest query and returns actual matches','document.querySelector("#quick-input").value==="dragon ball"&&document.querySelector("#quick-results").textContent.toLowerCase().includes("dragon")');
  await shot('quick-search.png');
  await js('document.querySelector("#quick-input").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
  await check('Quick suggestions support keyboard selection','document.querySelector("#quick-results [aria-selected=true]")?.dataset.quickIndex==="0"');
  await js('document.querySelector("#quick-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await check('Escape closes only quick search','!document.querySelector("#quick-search-panel")&&CinemaApp.state().route==="home"');
  await js('CinemaDiscovery.collection("popular-movies")');await until('document.querySelector("#collection-results .poster")');
  await check('Collection has its own URL and matching poster grid','location.hash==="#/collections/popular-movies"&&CinemaApp.state().route==="collection"&&!document.querySelector("#search-form")');
  main.webContents.reload();await until('CinemaApp?.ready&&document.querySelector("#collection-results .poster")');
  await check('Collection URL survives reload','CinemaApp.state().collectionId==="popular-movies"');
  await js('CinemaApp.navigate("search")');await check('Advanced Search preserved','!!document.querySelector("#search-form")');
  await js('document.querySelector("#search").value="dragon ball";document.querySelector("#search").dispatchEvent(new Event("input",{bubbles:true}))');
  await until('CinemaApp.state().activeQuery==="dragon ball"&&!CinemaApp.state().busy');
  await check('Typing triggers full-page live search','CinemaApp.state().liveItems.length>0');
  await js('CinemaApp.open({key:"anime-21",kind:"anime",id:"21",mal:true,title:"ONE PIECE"})');await until('!CinemaApp.state().detailBusy&&!CinemaApp.state().episodeBusy');
  await check('Details has four episode cards','document.querySelectorAll(".episode-preview .episode-card").length===4');
  await js('EpisodeUX.browse()');await until('document.querySelectorAll(".episode-browser .episode-card").length>0');
  await js('document.querySelector("#episode-jump").value=487;document.querySelector("[data-episode-jump]").click()');await until('[...document.querySelectorAll("[data-episode]")].some(e=>e.dataset.episode==="487")');
  await check('Direct jump to 487 uses bounded rendering','document.querySelectorAll(".episode-browser .episode-card").length<=50');
  await js('[...document.querySelectorAll("[data-mark-episode]")].find(e=>e.dataset.markEpisode==="487").click()');await until('EpisodeUX.record(487).state==="watched"');
  await check('Manual watch state stored per episode','EpisodeUX.record(487).state==="watched"');
  await shot('episodes.png');await js('EpisodeUX.back()');await until('!CinemaApp.state().episodeBrowser');
  await check('Episode browser Back returns to title details','CinemaApp.state().detail?.key==="anime-21"&&!!document.querySelector(".detail-hero")');
  await js('EpisodeUX.browse()');await until('[...document.querySelectorAll("[data-episode]")].some(e=>e.dataset.episode==="487")');
  await check('Episode browser remembers selected range','document.querySelector("#episode-range").value==="451"&&EpisodeUX.record(487).state==="watched"');
 }catch(e){failure=e.message;console.log('FAIL '+failure);await shot('failure.png').catch(()=>{});console.log(await js('JSON.stringify({route:CinemaApp.state().route,features:CinemaDiscovery.featured().map(t=>({title:t.title,kind:t.kind})),rows:[...document.querySelectorAll("[data-collection-row]")].map(e=>({id:e.dataset.collectionRow,hidden:e.hidden,text:e.querySelector(".row-body")?.textContent.slice(0,100)}))})').catch(()=>''));}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,failure},null,2));app.exit(failure||errors.length?1:0);}
};

