const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,main,assetResponse,openExtensionPlayer})=>{
 const out=path.resolve(__dirname,'../../deliverables/subtitle-checks-0.4.3/regression');fs.mkdirSync(out,{recursive:true});const report=[];let player,error;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const pass=s=>{report.push('PASS '+s);console.log(report.at(-1));};
 try{
  const opened=await openExtensionPlayer({parent:main,source:{title:'V+ player verification · Oceans sample',provider:'Video.js public sample',links:[{name:'MP4',type:'VIDEO',url:'https://vjs.zencdn.net/v/oceans.mp4',quality:720}],subtitles:[{lang:'English',url:'https://raw.githubusercontent.com/videojs/video.js/v8.23.4/docs/examples/shared/example-captions.vtt'}]}});player=opened.window;opened.session.protocol.handle('vidly',assetResponse);await opened.load();player.show();
  const js=c=>player.webContents.executeJavaScript(c),until=async(c,ms=45000)=>{for(let n=0;n<ms/200;n++){if(await js(c))return;await wait(200);}throw Error('Timed out: '+c);};
  const shot=async name=>{player.show();player.focus();await wait(700);fs.writeFileSync(path.join(out,name),(await player.webContents.capturePage(undefined,{stayAwake:true})).toPNG());};
  await until('document.querySelector("video").readyState>=2');await until('document.querySelector("video").currentTime>0');pass('Real MP4 video decodes and advances in the Windows player');
  const root='document.querySelector("#vplus-player").shadowRoot';
  if(!await js(`(()=>{const r=${root};return [...r.querySelectorAll('.buttons button')].every(b=>b.querySelector('svg')&&b.getAttribute('aria-label'))&&!r.querySelector('.long')})()`))throw Error('Icon control semantics failed');pass('Controls use icons with accessible labels');
  await js('document.querySelector("video").pause();document.querySelector("video").currentTime=12');await wait(700);
  const rect={x:150,y:160,width:120,height:100};const before=(await player.webContents.capturePage(rect)).toBitmap();
  await js('VPlusPlayer.command("menu","settings")');await wait(500);const after=(await player.webContents.capturePage(rect)).toBitmap();
  const brightness=b=>{let sum=0;for(let i=0;i<b.length;i+=4)sum+=b[i]+b[i+1]+b[i+2];return sum/(b.length/4*3);};
  if(brightness(after)<brightness(before)*.96)throw Error('Opening settings darkened the video');pass('Opening settings preserves picture brightness outside the menu');
  if(!await js(`(()=>{const r=${root},s=r.querySelector('.sheet'),b=s.getBoundingClientRect();return b.width<=360&&b.right<=innerWidth&&b.bottom<=innerHeight&&Number(getComputedStyle(s).zIndex)>Number(getComputedStyle(r.querySelector('.chrome')).zIndex)})()`))throw Error('Settings panel sizing/stacking failed');pass('Settings are compact, inside the window and above the chrome');
  await shot('windows-settings.png');
  await js(`(()=>{const r=${root};r.querySelector('[data-menu=speed]').click();r.querySelector('[data-speed="1.5"]').click()})()`);if(!await js('document.querySelector("video").playbackRate===1.5'))throw Error('Speed did not change');pass('Settings submenu changes playback speed');
  await js('VPlusPlayer.command("back");VPlusPlayer.command("back");document.querySelector("video").playbackRate=1;VPlusPlayer.command("preview",{time:24,ratio:.5})');
  await until('VPlusPlayer.command("state").preview.ready',45000);if(!await js('Math.abs(document.querySelector("video").currentTime-12)<.5'))throw Error('Hover preview sought the playing video');pass('Timeline shows a decoded frame at the preview time without seeking the main video');
  await shot('windows-timeline-preview.png');
  await js('VPlusPlayer.command("menu","subtitles")');await js(`${root}.querySelector('[data-external-subtitle="0"]').click()`);await until('VPlusPlayer.command("state").subtitle===0');await js('document.querySelector("video").currentTime=1.2');await until('VPlusPlayer.command("state").captions.includes("Captions describe")');pass('Real external WebVTT is fetched, parsed and displayed at its cue time');
  await shot('windows-subtitles.png');
  await js(`${root}.querySelector('[data-track=subtitles][data-index="-1"]').click()`);if(!await js(`${root}.querySelector('.captions').hidden`))throw Error('Captions did not turn off');pass('Subtitle Off clears the active caption');
  await js('VPlusPlayer.command("back")');await js(`${root}.querySelector('[data-action=fullscreen]').click()`);await wait(600);if(!player.isFullScreen())throw Error('Fullscreen failed');await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait(600);if(player.isFullScreen()||player.isDestroyed())throw Error('Fullscreen exit failed');pass('Icon fullscreen and Escape preserve the player window');
  await js('window.VPlusDirect.configure({title:"V+ HLS verification · Apple sample",provider:"Apple developer sample",streams:[{name:"HLS",type:"M3U8",url:"https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",quality:0}]})');
  await until('document.querySelector("video").readyState>=2&&window.__vplusHls?.subtitleTracks.length>0',60000);pass('Real HLS video loads with a published subtitle rendition');
  await js('VPlusPlayer.command("menu","subtitles")');await js(`${root}.querySelector('[data-track=subtitles][data-index="0"]').click()`);
  await until('window.__vplusHls.subtitleTrack===0&&!window.__vplusHls.subtitleDisplay&&Array.from(document.querySelector("video").textTracks).some(t=>t.mode==="hidden"&&t.activeCues?.length>0)',45000);pass('HLS loads actual cues with native rendering hidden and V+ owning display');
  await until(`${root}.querySelector('.captions').hidden===false&&${root}.querySelector('.captions span').textContent.length>0`);pass('Native HLS cue text renders above the controls and gradient');
  await js('document.querySelector("video").currentTime=6.2');await until('!document.querySelector("video").seeking&&document.querySelector("video").readyState>=2');await shot('windows-hls-subtitles.png');
  await js(`${root}.querySelector('[data-track=subtitles][data-index="-1"]').click()`);if(!await js('window.__vplusHls.subtitleTrack===-1&&!window.__vplusHls.subtitleDisplay'))throw Error('HLS subtitle Off failed');pass('HLS subtitle Off disables the actual rendition');
  await js('VPlusPlayer.command("back");VPlusPlayer.command("menu","quality")');await js(`${root}.querySelector('[data-quality="0"]').click()`);await until('window.__vplusHls.currentLevel===0',15000);pass('Quality selection operates the actual HLS video level');
  await js('VPlusPlayer.command("back");VPlusPlayer.command("back");VPlusPlayer.command("preview",{time:24,ratio:.5})');await until('VPlusPlayer.command("state").preview.ready',45000);pass('Timeline preview also decodes frames from an HLS stream');
 }catch(e){error=e;report.push('FAIL '+e.message);console.error(e);if(player&&!player.isDestroyed())fs.writeFileSync(path.join(out,'failure.png'),(await player.webContents.capturePage()).toPNG());}
 finally{fs.writeFileSync(path.join(out,'report.txt'),report.join('\n')+'\n');app.exit(error?1:0);}
};
