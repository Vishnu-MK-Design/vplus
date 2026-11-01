// Native application integration test; uses the app's own isolated renderer, no web preview server.
const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main,store,openPlayer,getPlayer})=>{
 const out=path.resolve(__dirname,'../../deliverables/rebuild-checks-0.6.0');fs.mkdirSync(out,{recursive:true});const report=[];let failed=false;
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>main.webContents.executeJavaScript(c);
 const until=async(c,ms=45000)=>{for(let n=0;n<ms/250;n++){if(await js(c))return;await wait(250);}throw Error('Timed out: '+c);};
 const check=async(label,c)=>{if(!await js(c))throw Error(label);report.push('PASS '+label);console.log(report.at(-1));};
 const shot=async name=>{await wait(600);fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());};
 const tab=async n=>{await js(`document.querySelector('.rail [data-tab="${n}"]').click()`);await wait(300);};
 try{
  main.showInactive();
  if(!process.argv.includes('--player-only')){
  main.setContentSize(1368,805);await until('!!document.querySelector(".hero-actions")');await wait(2500);await shot('windows-home');
  await check('Home contains portrait shelves and provider choices','document.querySelectorAll(".provider-strip [data-provider]").length===4&&getComputedStyle(document.querySelector(".card-art")).aspectRatio==="2 / 3"');
  await check('Desktop grid fits at least six poster cards','(()=>{const row=document.querySelector(".cards"),c=row.querySelector(".card");return row.clientWidth/c.getBoundingClientRect().width>=6})()');
  await tab('providers');await until('document.querySelectorAll(".extension-card").length===125');await shot('windows-providers');
  await check('All imported extensions state their actual adapter requirement','document.querySelectorAll(".extension-card").length===125&&!document.querySelector("#page").textContent.includes("needs a Vidly")');
  await js('document.querySelector("#sources-filter").value="Tamil";document.querySelector("#sources-filter").dispatchEvent(new Event("input"))');
  await check('Provider language search filters the inventory','document.querySelectorAll(".extension-card").length>0&&document.querySelectorAll(".extension-card").length<125');
  await js('document.querySelector("[data-provider=cinesrc]").click()');await wait(200);if(store.preferences.defaultSource!=='cinesrc')throw Error('Provider not persisted');report.push('PASS Chosen player persists in host preferences');
  await js('document.querySelector("[data-provider=auto]").click()');
  await tab('search');await shot('windows-search-empty');await js('document.querySelector("#search").value="Punisher";document.querySelector("[data-action=live-search]").click()');
  await until('document.querySelectorAll(".search-provider-group").length===2&&!document.querySelector(".loading")',60000);await shot('windows-search-results');
  await check('Search groups real catalogue results','document.querySelectorAll(".search-provider-group").length===2&&document.querySelectorAll(".search-provider-group .card").length>0');
  await until('!!document.querySelector("[data-detail=tv-67178]")');await js('document.querySelector("[data-detail=tv-67178]").click()');
  await until('document.querySelector(".cast-row")?.textContent.includes("Frank Castle")&&document.querySelectorAll(".cast-photo img").length>0',60000);await shot('windows-rich-details');
  await check('Exact-title cast includes real actor photos and character names','document.querySelectorAll(".cast-photo img").length>0&&document.querySelector(".cast-row").textContent.includes("Frank Castle")');
  await until(`!!document.querySelector('[data-season="2"]')`);await js(`document.querySelector('[data-season="2"]').click();document.querySelector('#episode-area').scrollIntoView({block:'start'})`);
  await until('document.querySelector(".episode-copy")?.textContent.includes("Roadhouse Blues")');await shot('windows-episodes');
  await check('Season 2 has thirteen source episodes with dates and rating','document.querySelectorAll(".episode").length===13&&document.querySelector(".episode-facts").textContent.includes("2019-01-18")&&document.querySelector(".episode-facts").textContent.includes("TVmaze")');
  await check('Detail panel fits viewport and retains Close','(()=>{const r=document.querySelector(".detail").getBoundingClientRect(),c=document.querySelector(".close-detail").getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0&&c.top>=r.top&&c.bottom<=r.bottom})()');
  await js('VidlyApp.back()');await tab('movies');await wait(1500);await shot('windows-movies');
  await tab('settings');await shot('windows-settings');await tab('home');main.setMinimumSize(320,400);main.setContentSize(390,844);await wait(400);await shot('phone-home');
  await check('Narrow Home does not overflow horizontally','document.querySelector("#page").scrollWidth<=document.querySelector("#page").clientWidth+1');main.setContentSize(1368,805);
  }
  store.playerSources={};
  await openPlayer({item:{kind:'movie',id:'786892',key:'movie-786892',title:'Furiosa'},provider:'auto'});const player=getPlayer();player.showInactive();
  for(let i=0;i<120;i++){if(player.isDestroyed())throw Error('Player closed');const ready=await player.webContents.executeJavaScript('!!window.VPlusPlayer&&!!document.querySelector("video")&&document.querySelector("video").readyState>=2').catch(()=>false);if(ready)break;await wait(250);}
  const pjs=c=>player.webContents.executeJavaScript(c);if(!await pjs('!!window.VPlusPlayer&&document.querySelector("video")?.readyState>=2')){fs.writeFileSync(path.join(out,'player-unavailable.png'),(await player.webContents.capturePage()).toPNG());report.push('OBSERVED '+await pjs('JSON.stringify({url:location.origin+location.pathname,controls:!!window.VPlusPlayer,video:!!document.querySelector("video"),ready:document.querySelector("video")?.readyState,error:document.querySelector("video")?.error?.code,text:document.body.innerText.slice(0,400)})'));throw Error('Live video did not become ready');}report.push('PASS Actual movie video loaded with V+ controls');
  await pjs('VPlusPlayer.command("key","down")');await wait(300);fs.writeFileSync(path.join(out,'windows-player.png'),(await player.webContents.capturePage()).toPNG());
  await pjs('document.querySelector("#vplus-player").shadowRoot.querySelector("[data-action=fullscreen]").click()');await wait(900);if(!player.isFullScreen())throw Error('Visible fullscreen control did not enter fullscreen');report.push('PASS Visible player button enters native Windows full screen');
  await pjs('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');await wait(900);if(player.isFullScreen()||player.isDestroyed())throw Error('Escape did not leave fullscreen safely');report.push('PASS Escape exits full screen without closing playback');
  await pjs('VPlusPlayer.command("menu","audio")');await wait(500);fs.writeFileSync(path.join(out,'windows-player-audio.png'),(await player.webContents.capturePage()).toPNG());
  await pjs('VPlusPlayer.command("back");VPlusPlayer.command("menu","sources")');await wait(300);fs.writeFileSync(path.join(out,'windows-player-providers.png'),(await player.webContents.capturePage()).toPNG());
  await pjs('window.dispatchEvent(new CustomEvent("vplus:host",{detail:{type:"NATIVE_PROGRESS",currentTime:25,duration:120}}));document.querySelector("#vplus-player").shadowRoot.querySelector("[data-source=cinesrc]").click()');
  for(let i=0;i<40&&!player.webContents.getURL().startsWith('https://cinesrc.st');i++)await wait(250);
  if(!player.webContents.getURL().startsWith('https://cinesrc.st')||!player.webContents.getURL().includes('t=25'))throw Error('Selected source did not preserve playback position');report.push('PASS In-player provider selection carries current position');player.close();await tab('home');await shot('windows-final');
 }catch(e){failed=true;report.push('FAIL '+e.stack);try{await shot('failure');}catch{}}
 fs.writeFileSync(path.join(out,process.argv.includes('--player-only')?'player-report.txt':'report.txt'),report.join('\n'));console.log(report.join('\n'));app.exit(failed?1:0);
};
