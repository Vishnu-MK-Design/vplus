const fs=require('node:fs'),path=require('node:path');
exports.run=async({app,openPlayer,getPlayer})=>{
 const out=path.resolve(__dirname,'../../.tools/subtitle-provider-probe');fs.mkdirSync(out,{recursive:true});let w;
 try{await openPlayer({provider:'cinesrc',item:{id:'213375',key:'tv-213375',kind:'tv',title:'VisionQuest'},season:1,episode:5});w=getPlayer();w.show();w.focus();const js=s=>w.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<120;i++){if(await js('document.querySelector("video")?.readyState>=2').catch(()=>false))break;await wait(250);}
  const read=`(()=>{const v=document.querySelector('video'),r=document.querySelector('#vplus-player')?.shadowRoot;return {time:v?.currentTime,ready:v?.readyState,tracks:Array.from(v?.textTracks||[]).map(t=>({kind:t.kind,label:t.label,language:t.language,mode:t.mode,cues:t.cues?.length,active:Array.from(t.activeCues||[]).map(c=>({start:c.startTime,end:c.endTime,text:c.text?.slice(0,120)}))})),vplus:window.VPlusPlayer?.command('state'),captionNodes:[...document.querySelectorAll('[class*="caption"],[class*="subtitle"],[id*="caption"],[id*="subtitle"]')].slice(0,40).map(e=>({tag:e.tagName,cls:e.className,id:e.id,text:e.textContent?.slice(0,150),visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display})),buttons:[...document.querySelectorAll('button,[role=menuitemradio],[role=option]')].slice(0,70).map(e=>({tag:e.tagName,cls:e.className,label:e.getAttribute('aria-label'),role:e.getAttribute('role'),checked:e.getAttribute('aria-checked'),text:e.textContent?.slice(0,100)}))}})()`;
  fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(await js(read),null,2));
  if(!await js('document.querySelector("video")?.readyState>=2'))throw Error('The source did not reach media readiness.');
  await js('document.querySelector("video").currentTime=120;VPlusPlayer.command("menu","audio")');await wait(1000);
  fs.writeFileSync(path.join(out,'menu.json'),JSON.stringify(await js(read),null,2));
  await js(`(()=>{const root=document.querySelector('#vplus-player').shadowRoot;const b=[...root.querySelectorAll('[data-track=subtitles]')].find(b=>b.dataset.index!=='-1'&&/English/i.test(b.textContent));if(!b)throw Error('No English subtitle option');b.click();})()`);
  const samples=[];for(let i=0;i<40;i++){samples.push(await js(read));await wait(250);}fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify(samples,null,2));
  console.log(JSON.stringify(samples.map(s=>({time:s.time,tracks:s.tracks.map(t=>({mode:t.mode,active:t.active.length})),caption:s.vplus?.captions})).filter((s,i)=>i%4===0),null,2));
  fs.writeFileSync(path.join(out,'selection.png'),(await w.webContents.capturePage(undefined,{stayAwake:true})).toPNG());
 }catch(e){console.error(e.message);}finally{app.exit();}
};
