// Runs against the affected source inside V+, using an isolated profile.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
exports.run=async({app,openPlayer,getPlayer})=>{
 const out=app.isPackaged?path.join(app.getPath('temp'),'VPlus-Subtitle-044','report'):path.resolve(__dirname,'../../deliverables/subtitle-checks-0.4.4/source');fs.mkdirSync(out,{recursive:true});
 const seconds=Math.max(60,Math.min(120,Number(process.argv.find(a=>a.startsWith('--subtitle-seconds='))?.split('=')[1])||70));
 const report=[],samples=[],distinct=new Set();let player,failure;const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const pass=s=>{report.push('PASS '+s);console.log(report.at(-1));};
 try{
  await openPlayer({provider:'cinesrc',item:{id:'213375',key:'tv-213375',kind:'tv',title:'VisionQuest'},season:1,episode:5});player=getPlayer();player.show();player.focus();
  const js=s=>player.webContents.executeJavaScript(s),until=async(s,ms=30000)=>{for(let n=0;n<ms/200;n++){if(await js(s))return;await wait(200);}throw Error('Timed out: '+s);};
  const root='document.querySelector("#vplus-player").shadowRoot';
  await until('document.querySelector("video")?.readyState>=2&&Array.from(document.querySelector("video").textTracks).some(t=>t.language==="en"&&t.cues?.length>10)');pass('Affected CineSrc episode reaches real video readiness with loaded English captions');
  await js('VPlusPlayer.command("menu","subtitles")');await js(`(()=>{const b=[...${root}.querySelectorAll('[data-track=subtitles]')].find(b=>b.dataset.index!=='-1'&&/English/i.test(b.textContent));if(!b)throw Error('English not offered');b.click();const v=document.querySelector('video'),t=[...v.textTracks].find(t=>t.language==='en'),cue=[...t.cues].find(c=>c.startTime>120&&c.endTime-c.startTime>.6)||t.cues[5];v.currentTime=cue.startTime+.15;v.play();})()`);
  await until('VPlusPlayer.command("state").subtitleSelection?.label==="English"&&VPlusPlayer.command("state").captions.length>0');pass('English stays selected with the source caption track hidden from native rendering');
  if(!await js(`getComputedStyle(${root}.querySelector('.captions span')).backgroundColor==='rgba(0, 0, 0, 0)'`))throw Error('Caption background box is present');pass('Subtitle text has a transparent background');
  const shot=async name=>{player.show();player.focus();await wait(500);fs.writeFileSync(path.join(out,name),(await player.webContents.capturePage(undefined,{stayAwake:true})).toPNG());};await shot('english-single-layer.png');
  const read=`(()=>{const v=document.querySelector('video'),t=[...v.textTracks].find(t=>t.language==='en'),r=${root},s=VPlusPlayer.command('state'),now=v.currentTime;const normalize=s=>s.replace(/\\s+/g,' ').trim();const expected=[...t.cues].filter(c=>c.startTime<=now&&c.endTime>now).map(c=>({text:c.getCueAsHTML().textContent,start:c.startTime,end:c.endTime}));const text=normalize(s.captions);const expectedText=normalize(expected.map(c=>c.text).join(' '));return {time:now,ready:v.readyState,seeking:v.seeking,paused:v.paused,mode:t.mode,selected:s.subtitleSelection?.label||'',menu:s.layer,controls:s.shown,cues:expected.length,expected:expectedText,caption:text,boundary:expected.some(c=>now-c.start<.18||c.end-now<.18),visible:!r.querySelector('.captions').hidden,nativeLayers:[...v.textTracks].filter(t=>t.mode==='showing').length,providerLayers:text?[...document.body.querySelectorAll('*')].filter(e=>e.children.length===0&&normalize(e.textContent||'')===text&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none').length:0};})()`;
  const start=Date.now();let closed=false,reopened=false,paused=false,resumed=false,forward=false,backward=false,matched=0,missing=0,gaps=0,selectionFailures=0,duplicates=0,pauseTime=0,seekSettledAt=0;
  while(Date.now()-start<seconds*1000){const elapsed=(Date.now()-start)/1000;
   if(elapsed>=10&&!closed){await js('VPlusPlayer.command("back")');closed=true;}
   if(elapsed>=20&&!reopened){await js('VPlusPlayer.command("menu","subtitles")');await until(`${root}.querySelector('[data-track=subtitles][aria-pressed=true]')?.textContent.includes('English')`);reopened=true;pass('Closing and reopening the subtitle menu retains English');}
   if(elapsed>=26&&!paused){await js('document.querySelector("video").pause()');pauseTime=await js('document.querySelector("video").currentTime');paused=true;}
   if(elapsed>=28&&!resumed){if(Math.abs(await js('document.querySelector("video").currentTime')-pauseTime)>.1)throw Error('Pause did not retain the media position');await js('document.querySelector("video").play()');resumed=true;pass('Pause and resume retain the English selection');}
   if(elapsed>=36&&!forward){await js('VPlusPlayer.command("seek",60)');forward=true;seekSettledAt=Date.now()+1000;}
   if(elapsed>=50&&!backward){await js('VPlusPlayer.command("seek",-30)');backward=true;seekSettledAt=Date.now()+1000;}
   const s=await js(read);if(s.selected!=='English')selectionFailures++;if(s.nativeLayers||s.providerLayers)duplicates++;
   if(!s.seeking&&s.ready>=2&&!s.boundary&&Date.now()>seekSettledAt){if(s.expected){if(s.visible&&s.caption===s.expected){matched++;distinct.add(crypto.createHash('sha256').update(s.expected).digest('hex'));}else missing++;}else if(!s.caption)gaps++;}
   samples.push({elapsed:Math.round(elapsed*1000)/1000,time:s.time,ready:s.ready,mode:s.mode,selected:s.selected,cues:s.cues,captionLength:s.caption.length,match:s.caption===s.expected,visible:s.visible,nativeLayers:s.nativeLayers,providerLayers:s.providerLayers});await wait(400);
  }
  if(selectionFailures||duplicates||missing)throw Error(`Sustained subtitle failures: lost selection ${selectionFailures}, duplicate layers ${duplicates}, missing cues ${missing}`);
  if(matched<15||distinct.size<4)throw Error('Too few distinct real caption cues were observed.');
  pass(`${seconds}s of affected-source playback: ${matched} matching cue samples, ${distinct.size} distinct cues, zero missing/duplicate layers`);pass('Forward and backward seeking preserve selection and return correctly timed captions');
  if(gaps)pass('Normal gaps clear caption text without switching the selection to Off');await shot('after-sustained-playback.png');
  await js(`VPlusPlayer.command('menu','subtitles');${root}.querySelector('[data-track=subtitles][data-index="-1"]').click()`);
  for(let i=0;i<10;i++){if(!await js(`(()=>{const s=VPlusPlayer.command('state');return !s.subtitleSelection&&!s.captions&&${root}.querySelector('.captions').hidden&&!Array.from(document.querySelector('video').textTracks).some(t=>t.mode==='showing')})()`))throw Error('Off did not remain off');await wait(400);}pass('Off remains off for four seconds without a late caption flash');
  report.push(`OBSERVED packaged=${app.isPackaged} version=${app.getVersion()} samples=${samples.length} matched=${matched} distinct=${distinct.size} missing=${missing} duplicates=${duplicates}`);
 }catch(e){failure=e;report.push('FAIL '+e.message);console.error(e);if(player&&!player.isDestroyed())fs.writeFileSync(path.join(out,'failure.png'),(await player.webContents.capturePage(undefined,{stayAwake:true})).toPNG());}
 finally{fs.writeFileSync(path.join(out,'report.txt'),report.join('\n')+'\n');fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify(samples,null,2));app.exit(failure?1:0);}
};
