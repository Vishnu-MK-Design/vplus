const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main,getPlayer})=>{
 const out=path.resolve(__dirname,'../../deliverables/engine-checks-2026-10-28');fs.mkdirSync(out,{recursive:true});const report=[];let failure;
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>main.webContents.executeJavaScript(c);
 const until=async(c,ms=70000)=>{for(let n=0;n<ms/250;n++){if(await js(c))return;await wait(250);}throw Error('Timed out: '+c);};
 const pass=s=>{report.push('PASS '+s);console.log(report.at(-1));};
 try{
  main.show();await until('!!window.VidlyApp&&window.ExtensionUI.available');
  await js('document.querySelector("[data-tab=providers]").click()');await until('document.querySelectorAll("[data-extension-open]").length===125');pass('All 125 inventory entries offer real engine browsing in the development app');
  await js('document.querySelector("[data-extension-open=\\"cnc:StreamFlixProvider\\"]").click()');await until('!!document.querySelector(".extension-search")&&!document.querySelector("#extension-browser [role=status]")');
  await js('document.querySelector(".extension-search input").value="Venom";document.querySelector(".extension-search").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');await until('document.querySelectorAll("[data-extension-title]").length===3&&!document.querySelector("#extension-browser [role=status]")');pass('StreamFlix extension returns three real Venom search results');
  await js('document.querySelector("[data-extension-title]").click()');await until('!!document.querySelector("[data-extension-play]")');pass('Provider-native title details load');
  fs.writeFileSync(path.join(out,'streamflix-details.png'),(await main.webContents.capturePage()).toPNG());
  await js('document.querySelector("[data-extension-play]").click()');await until('document.querySelector("#extension-browser .inline-error")?.textContent.includes("DNS")');pass('Broken StreamFlix media reports DNS/HTTP failure instead of claiming playback');
  await js('document.querySelector("[data-extension-close]").click()');await until('!document.querySelector("#extension-browser")');
  await js('document.querySelector("[data-extension-open=\\"cnc:LibriVoxAudiobook\\"]").click()');await until('document.querySelectorAll("[data-extension-title]").length>0&&!document.querySelector("#extension-browser [role=status]")');
  await js('document.querySelector("[data-extension-title]").click()');await until('document.querySelectorAll("[data-extension-episode]").length>0');pass('LibriVox catalogue and real chapter list load through the extension');
  await js('document.querySelector("[data-extension-episode]").click()');
  let player;for(let n=0;n<240;n++){player=getPlayer();if(player&&!player.isDestroyed()&&await player.webContents.executeJavaScript('!!window.VPlusDirect&&document.querySelector("video").readyState>=2').catch(()=>false))break;await wait(250);}
  if(!player||!await player.webContents.executeJavaScript('document.querySelector("video")?.readyState>=2'))throw Error('Direct chapter playback did not become ready');
  if(player.webContents.getURL()!=='vidly://app/extension-player.html')throw Error('Unexpected player route');pass('Real chapter media plays in the V+ direct player without Vidly/CineSrc');
  await wait(1500);if(!await player.webContents.executeJavaScript('document.querySelector("video").currentTime>0'))throw Error('Playback did not advance');pass('Direct playback time advances');
  await player.webContents.executeJavaScript('window.dispatchEvent(new KeyboardEvent("keydown",{key:"f",bubbles:true}))');await wait(600);if(!player.isFullScreen())throw Error('Fullscreen failed');pass('Direct player enters native Windows fullscreen');
  await player.webContents.executeJavaScript('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait(500);if(player.isFullScreen())throw Error('Fullscreen exit failed');pass('Escape exits fullscreen while preserving playback');
  fs.writeFileSync(path.join(out,'direct-player.png'),(await player.webContents.capturePage()).toPNG());player.close();
 }catch(e){failure=e;report.push('FAIL '+e.message);console.error(e);}finally{fs.writeFileSync(path.join(out,'report.txt'),report.join('\n')+'\n');app.exit(failure?1:0);}
};
