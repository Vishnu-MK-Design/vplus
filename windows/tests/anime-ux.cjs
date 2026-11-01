'use strict';
const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main,store,storePath,getPlayer})=>{
 const out=process.env.VPLUS_AUDIT_OUT||path.join(app.getPath('temp'),'VPlus-Anime-051');fs.mkdirSync(out,{recursive:true});
 const checks=[],observations=[],failures=[],limits=[],errors=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=s=>main.webContents.executeJavaScript(s),str=JSON.stringify;
 main.webContents.on('console-message',e=>{if(e.level==='error'&&!/net::ERR_|Failed to load resource/.test(e.message))errors.push(e.message);});
 async function until(code,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){if(await js(code).catch(()=>false))return;await wait(160);}throw Error('Timed out: '+code);}
 async function check(label,code){const ok=typeof code==='function'?await code():await js(code);checks.push({label,pass:!!ok});if(!ok)throw Error(label);console.log('PASS '+label);}
 async function shot(name){main.show();main.focus();await wait(180);await js('Promise.race([Promise.all([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight&&i.getBoundingClientRect().bottom>0).map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,1800))])');fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());}
 async function click(selector){await js(`document.querySelector(${str(selector)}).scrollIntoView({block:'nearest'})`);await wait(100);const p=await js(`(()=>{const e=document.querySelector(${str(selector)}),r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);main.show();main.focus();main.webContents.sendInputEvent({type:'mouseMove',...p});main.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});main.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await wait(120);}
 async function search(value){await js(`(()=>{const e=document.querySelector('#search');e.focus();e.value=${str(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await click('#search-form button[type=submit]');await until('!CinemaApp.state().busy');}
 async function phase(name,fn){try{await fn();}catch(e){failures.push({phase:name,error:e.message});console.log('FAIL '+name+': '+e.message);await shot('failure-'+name).catch(()=>{});}}
 let dragon;
 try{
  if(!/smoke|VPlus-|verification/i.test(app.getPath('userData')))throw Error('Verification profile required');main.setContentSize(1368,805);main.show();main.focus();await until('window.CinemaApp?.ready');
  await phase('live-browse',async()=>{
   await click('#navigation [data-route=anime]');await until('!CinemaApp.state().busy&&CinemaApp.state().page>=1');
   await check('Anime destination loads more than five live indexed titles','CinemaApp.state().kind==="anime"&&CinemaApp.state().liveItems.length>5');
   await check('Live entries carry verified MAL IDs rather than invented movie routes','CinemaApp.state().liveItems.every(t=>t.kind==="anime"&&t.mal&&t.isAnime&&t.key==="anime-"+t.id&&t.anilistId)');
   observations.push({name:'popular-page1',...await js('({count:CinemaApp.state().liveItems.length,titles:CinemaApp.state().liveItems.slice(0,8).map(t=>t.title)})')});
   await until('[...document.querySelectorAll(".poster img")].some(i=>i.src.includes("s4.anilist.co")&&i.complete&&i.naturalWidth>0)',20000);await check('New live artwork decodes in the actual native window','[...document.querySelectorAll(".poster img")].some(i=>i.src.includes("s4.anilist.co")&&i.complete&&i.naturalWidth>0)');await shot('01-live-anime');
   await js('window.__firstAnimeKeys=CinemaApp.state().liveItems.map(t=>t.key);document.querySelector(".poster-open").focus({preventScroll:true});window.__animeFocus=document.activeElement.dataset.detail;document.querySelector("#main").scrollTop=document.querySelector("#main").scrollHeight');await until('!CinemaApp.state().busy&&CinemaApp.state().page>=2');
   await check('Scrolling automatically requests page two and appends unique titles','(()=>{const r=CinemaApp.state().liveItems;return r.length>__firstAnimeKeys.length&&new Set(r.map(t=>t.key)).size===r.length&&__firstAnimeKeys.every(k=>r.some(t=>t.key===k))})()');
   await check('Automatic pagination preserves the focused card','document.activeElement.dataset.detail===window.__animeFocus');
   observations.push({name:'popular-page2',...await js('({page:CinemaApp.state().page,count:CinemaApp.state().liveItems.length})')});await shot('02-auto-page2');
  });
  await phase('anime-search',async()=>{
   await search('dragon ball');await check('Anime search finds live Dragon Ball films and series','(()=>{const r=CinemaApp.state().liveItems;return r.some(t=>t.mediaType==="movie")&&r.some(t=>t.mediaType==="tv")&&r.some(t=>t.id==="48903")})()');
   await check('Rendered Anime search includes Dragon Ball Z and Super Hero','document.querySelector("#search-results").textContent.includes("Dragon Ball Z")&&/SUPER HERO/i.test(document.querySelector("#search-results").textContent)');await shot('03-dragon-ball-anime');
   dragon=await js('CinemaApp.state().liveItems.find(t=>t.id==="813")');
   await js('CinemaApp.choose("kind","all")');await until('!CinemaApp.state().busy');
   await check('All Search receives the live anime index alongside existing catalogues','CinemaApp.state().groups.anime?.items.some(t=>t.id==="48903")');
   observations.push({name:'all-search-raw',rows:await js('CinemaApp.state().liveItems.map(t=>({key:t.key,title:t.title,year:t.year,mediaType:t.mediaType,isAnime:t.isAnime}))')});
   await check('All Search retains the same Dragon Ball titles without exact-match duplicates','(()=>{const r=CinemaModel.mergeAnimeSources(CinemaApp.state().liveItems);return r.some(t=>/dragon ball z$/i.test(t.title)&&CinemaModel.isAnime(t))&&r.filter(t=>/super hero/i.test(t.title)&&String(t.year)==="2022").length===1})()');
   observations.push({name:'general-search-groups',...await js('Object.fromEntries(Object.entries(CinemaApp.state().groups).map(([k,v])=>[k,{count:v.items.length,error:v.error}]))')});await shot('04-dragon-ball-all');
   await js('CinemaApp.choose("kind","anime")');await until('!CinemaApp.state().busy');
   await js('CinemaApp.choose("year","2022");CinemaApp.choose("genre","28");CinemaApp.choose("country","JP")');await until('!CinemaApp.state().busy');
   await check('Real country, genre and year filters intersect for the anime film','(()=>{const s=CinemaApp.state(),r=CinemaModel.filter(s.liveItems,{...s.filters,kind:"anime"});return r.length===1&&r[0].id==="48903"&&r[0].countries.includes("JP")&&r[0].genres.includes("Action")&&r[0].year==="2022"})()');
   await js('CinemaApp.choose("language","ja")');await until('!CinemaApp.state().busy');
   await check('Unknown language metadata never invents a Japanese audio claim','document.querySelectorAll("#search-results .poster").length===0');
   await click('[data-action=reset-filters]');await until('!CinemaApp.state().busy');
   await click('[data-detail=anime-48903]');await until('!CinemaApp.state().detailBusy');
   await check('Anime films open as films without fake seasons or episode lists','CinemaApp.state().detail.id==="48903"&&!document.querySelector(".episode-section")&&!/S01|E01/.test(document.querySelector(".hero [data-play]").textContent)');
  });
  await phase('nonbundled-detail-persistence',async()=>{
   if(!dragon)throw Error('Missing real Dragon Ball Z index entry');await js('CinemaApp.open('+str(dragon)+')');await until('!CinemaApp.state().detailBusy&&!CinemaApp.state().episodeBusy&&CinemaApp.state().episodes.length>0');
   await check('A non-bundled anime opens real synopsis and character metadata','CinemaApp.state().detail.id==="813"&&CinemaApp.state().detail.overview.length>50&&document.querySelectorAll(".cast-person").length>0');
   await check('Anime uses actual episode count with flat numbering instead of invented seasons','CinemaApp.state().detail.totalEpisodes===291&&CinemaApp.state().episodes.length===100&&!document.querySelector("[data-picker=season]")&&/E01/.test(document.querySelector(".hero [data-play]").textContent)');
   await click('[data-action=more-episodes]');await until('!CinemaApp.state().episodeBusy');await check('Long-series episode paging reaches 101–200 without duplicates','(()=>{const r=CinemaApp.state().episodes;return r.length===200&&r[100].n===101&&r[199].n===200&&new Set(r.map(e=>e.n)).size===200})()');
   await js('document.querySelector("#main").scrollTop=0');await shot('05-live-title');
   await click('.hero [data-save]');await wait(300);await check('New live anime saves its correct MAL identity in the native library',()=>store.saved?.some(t=>t.key==='anime-813'&&t.id==='813'&&t.mal));
   const reloaded=new Promise(r=>main.webContents.once('did-finish-load',r));main.webContents.reload();await reloaded;await until('CinemaApp?.ready');
   await check('Saved live anime survives a real renderer reload','CinemaApp.state().saved.some(t=>t.key==="anime-813"&&t.mal)');
   await js('CinemaApp.open("anime-813")');await until('!CinemaApp.state().detailBusy&&!CinemaApp.state().episodeBusy');
   await check('Reopened saved live anime refreshes actual details and episodes','CinemaApp.state().detail.source==="anilist"&&CinemaApp.state().episodes.length===100');
   await js('CinemaApp.choose("animeAudio","sub")');await click('[data-episode="3"]');for(let n=0;n<40&&(!getPlayer()||!getPlayer().webContents.getURL());n++)await wait(300);const w=getPlayer();observations.push({name:'native-player-route',url:w?.webContents.getURL(),selected:await js('({episode:CinemaApp.state().episode,detail:CinemaApp.state().detail.key})')});
   await check('Actual episode selection opens the MAL route with the selected episode',()=>!!w&&!w.isDestroyed()&&/^https:\/\/vidly\.pro\/anime\/mal\/813\/3\/sub\?/.test(w.webContents.getURL()));
   let ready=false;const start=Date.now();while(w&&!w.isDestroyed()&&Date.now()-start<20000){ready=await w.webContents.executeJavaScript('!!document.querySelector("video")&&document.querySelector("video").readyState>=2').catch(()=>false);if(ready)break;await wait(500);}
   observations.push({name:'external-anime-playback',route:'anime/mal/813/3/sub',videoReady:ready});if(!ready)limits.push('The correct MAL episode route opened, but the external Vidly video was not ready within 20 seconds. Catalogue success is not a stream availability guarantee.');if(w&&!w.isDestroyed())w.close();
   if(storePath)await check('Saved live anime is on disk, not only in renderer memory',()=>JSON.parse(fs.readFileSync(storePath(),'utf8')).saved.some(t=>t.key==='anime-813'));
  });
  await phase('regression-bounds',async()=>{for(const [w,h] of [[720,520],[1368,805]]){main.setContentSize(w,h);await js('CinemaApp.navigate("anime")');await until('!CinemaApp.state().busy');await check('Anime layout stays bounded at '+w+'×'+h,'document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector("#main").scrollWidth<=document.querySelector("#main").clientWidth+1');}await shot('06-final-anime');});
  if(errors.length)failures.push({phase:'runtime',error:errors.join('\n')});
 }catch(e){failures.push({phase:'harness',error:e.message});}
 finally{const report={packaged:app.isPackaged,version:app.getVersion(),checks,observations,limits,errors,failures};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:checks.filter(t=>t.pass).length,failed:failures.length,limits,out}));app.exit(failures.length?1:0);}
};
