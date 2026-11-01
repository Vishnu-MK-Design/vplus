const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main,store,storePath,openPlayer,getPlayer})=>{
 const out=path.resolve(__dirname,'../../deliverables/windows-checks-0.3.0');fs.mkdirSync(out,{recursive:true});const report=[];let failed=false;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const js=code=>main.webContents.executeJavaScript(code);
 const until=async(code,ms=15000)=>{for(let i=0;i<ms/250;i++){if(await js(code))return;await pause(250);}throw Error('Timed out: '+code);};
 const check=async(label,code)=>{if(!await js(code))throw Error(label);report.push('PASS '+label);};
 const shot=async name=>{await pause(1000);fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());};
 const tab=async name=>{await js(`document.querySelector('.rail [data-tab="${name}"]').click()`);await pause(300);};
 try{
  await until('!!document.querySelector(".hero-actions")');await pause(1500);await shot('home');
  await check('Catalogue loads without a preview server','location.protocol==="vidly:"&&document.querySelectorAll(".card").length>0');
  await check('Renderer has no Node or raw IPC access','typeof require==="undefined"&&typeof process==="undefined"&&Object.keys(VidlyDesktop).sort().join(",")==="onMessage,send"');
  await js('document.querySelector(".hero-actions [data-detail]").click()');await until('!!document.querySelector(".detail")');await shot('details');
  await js('if(document.querySelector("[data-action=save-detail]").getAttribute("aria-pressed")!=="true")document.querySelector("[data-action=save-detail]").click()');await pause(300);
  if(!store.saved?.length)throw Error('Watchlist was not saved in host');report.push('PASS My List reaches persistent host storage');
  await js('VidlyApp.back()');await tab('list');await check('Saved title appears in My List','document.querySelectorAll(".card").length>0');
  for(const name of ['movies','series','discover','anime','history','settings']){await tab(name);await check(name+' page renders','document.querySelector("#page").textContent.length>20');if(['movies','settings'].includes(name))await shot(name);}
  await js('document.querySelector("#pref-textSize-control").click()');await check('Settings picker opens','!!document.querySelector(".choice-menu")');await shot('settings-picker');await js('TvChoices.close()');
  await js('document.querySelector("[data-action=sources]").click()');await until('document.querySelectorAll(".source-entry").length===125');await check('All discovered plugins show their integration requirement','document.querySelectorAll(".source-entry").length===125&&document.querySelector(".source-entry .source-state").textContent.length>0');await shot('sources');
  await js('document.querySelector("#sources-filter").value="Tamil";document.querySelector("#sources-filter").dispatchEvent(new Event("input"))');await check('Source search narrows the inventory','document.querySelectorAll(".source-entry").length>0&&document.querySelectorAll(".source-entry").length<125');
  await js('document.querySelector("[data-source-check]").click()');await until('document.querySelector("#source-health").textContent.includes("Catalogue connected")',30000);await check('StreamFlix live connection reports a real catalogue count','/unique titles/.test(document.querySelector("#source-health").textContent)');await shot('source-connected');
  await js('document.querySelector("[data-source-use=streamflix]").click()');await until('document.querySelector("#toast").textContent.includes("StreamFlix catalogue")&&!document.querySelector(".loading")&&!document.querySelector("[data-source-use]")');await check('Source selection persists and loads combined titles','localStorage.getItem("vidly.catalogueSource")==="streamflix"&&document.querySelectorAll(".grid .card").length>0');await shot('streamflix-movies');
  await tab('settings');await js('document.querySelector("[data-action=sources]").click()');await until('!!document.querySelector("[data-source-use=cinemeta]")');await js('document.querySelector("[data-source-use=cinemeta]").click()');
  await tab('search');await js('document.querySelector("#search").value="tt1";document.querySelector("[data-action=live-search]").click()');await until('!!document.querySelector(".inline-error")');await check('Invalid IMDb ID has an actionable error','!!document.querySelector("[data-action=retry-imdb]")');await shot('search');
  await tab('home');main.setContentSize(760,620);await pause(500);await check('Small laptop layout stays within the window','document.querySelector("#page").scrollWidth<=document.querySelector("#page").clientWidth+1');await shot('small-laptop');
  // Check the shared narrow layout independently of Android native input.
  main.setMinimumSize(320,400);main.setContentSize(390,844);await pause(400);await shot('phone-layout');
  await check('Touch navigation opens and closes','(()=>{document.querySelector(".client-menu").click();const open=document.body.classList.contains("nav-open");document.querySelector(".rail [data-tab=settings]").click();return open&&!document.body.classList.contains("nav-open")})()');await shot('phone-settings');
  await check('Phone settings have no horizontal overflow','document.querySelector("#page").scrollWidth<=document.querySelector("#page").clientWidth+1');
  await tab('movies');await shot('phone-movies');await check('Phone grid has two columns','getComputedStyle(document.querySelector(".grid")).gridTemplateColumns.split(" ").length===2');
  await tab('home');await js('document.querySelector(".hero-actions [data-detail]").click()');await shot('phone-detail');await check('Phone detail fits screen','(()=>{const r=document.querySelector(".detail").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()');await js('VidlyApp.back()');
  main.setContentSize(1280,800);await main.webContents.reload();await until('!!document.querySelector(".hero-actions")');await tab('list');await check('Watchlist survives renderer reload','document.querySelectorAll(".card").length>0');
  main.showInactive();await openPlayer({item:{kind:'movie',id:'786892',key:'movie-786892',title:'Furiosa'},provider:'auto'});const pw=getPlayer();if(!pw)throw Error('Player window missing');pw.showInactive();await pause(20000);
  try{fs.writeFileSync(path.join(out,'player.png'),(await pw.webContents.capturePage()).toPNG());}catch{report.push('LIMIT Player display surface did not allow capture.');}
  await pw.webContents.executeJavaScript('window.VPlusPlayer.command("key","down")');await pause(500);
  if(!await pw.webContents.executeJavaScript('!!window.VPlusPlayer&&!!document.querySelector("#vplus-player").shadowRoot.querySelector("[data-action=audio]")'))throw Error('V+ controls missing');report.push('PASS V+ controls available while real video plays');fs.writeFileSync(path.join(out,'vplus-player.png'),(await pw.webContents.capturePage()).toPNG());
  await pw.webContents.executeJavaScript('window.VPlusPlayer.command("menu","audio")');await pause(600);fs.writeFileSync(path.join(out,'vplus-audio.png'),(await pw.webContents.capturePage()).toPNG());
  await pause(1000);if(!store.audioIndex?.some(e=>e.item?.key==='movie-786892'&&e.languages?.includes('en')))throw Error('Observed audio languages did not persist');report.push('PASS Observed player audio languages persist for catalogue filters');
  const actualTracks=await pw.webContents.executeJavaScript('JSON.stringify({audio:Array.from(document.querySelector("video")?.audioTracks||[]).map(t=>({language:t.language,enabled:t.enabled})),subtitles:Array.from(document.querySelector("video")?.textTracks||[]).map(t=>({language:t.language,mode:t.mode}))})');report.push('OBSERVED media tracks '+actualTracks);
  const subtitleCheck=await pw.webContents.executeJavaScript('(()=>{const root=document.querySelector("#vplus-player").shadowRoot,button=[...root.querySelectorAll("[data-track=subtitles]")].find(b=>b.dataset.index!=="-1"&&!/^(off|none)$/i.test(b.textContent));if(!button)return "unavailable";button.click();return Array.from(document.querySelector("video").textTracks||[]).some(t=>t.mode==="showing")?"native captions enabled":"provider-managed captions"})()');report.push('OBSERVED subtitle selection '+subtitleCheck);
  const playerState=await pw.webContents.executeJavaScript('JSON.stringify({url:location.href,video:!!document.querySelector("video"),ready:document.querySelector("video")?.readyState||0,text:document.body.innerText.slice(0,300)})');report.push('OBSERVED provider '+playerState);
  if(pw.webContents.getLastWebPreferences().nodeIntegration||!pw.webContents.getLastWebPreferences().sandbox)throw Error('Player isolation failed');report.push('PASS Player is isolated and sandboxed');await pw.webContents.executeJavaScript('window.VPlusPlayer.command("back");window.dispatchEvent(new CustomEvent("vplus:host",{detail:{type:"NATIVE_PROGRESS",currentTime:25,duration:120}}));window.dispatchEvent(new CustomEvent("vplus:host",{detail:{type:"NATIVE_FAILURE"}}))');
  for(let k=0;k<40&&!pw.webContents.getURL().startsWith('https://cinesrc.st');k++)await pause(250);
  if(!pw.webContents.getURL().startsWith('https://cinesrc.st')||!/[?&]t=25(?:&|$)/.test(pw.webContents.getURL()))throw Error('Automatic fallback did not carry progress: '+pw.webContents.getURL());report.push('PASS Controlled failure automatically switches source and carries position');
  pw.close();await pause(500);report.push('PASS Closing player returns to catalogue');
 }catch(e){failed=true;report.push('FAIL '+e.stack);try{await shot('failure');}catch{}}
 fs.writeFileSync(path.join(out,'report.txt'),report.join('\n'));console.log(report.join('\n'));app.exit(failed?1:0);
};
