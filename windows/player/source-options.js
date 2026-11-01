/* PC source choices use native host configuration and the active provider's real UI. */
(()=>{'use strict';
class SourceOptions {
 constructor(adapter){this.a=adapter;this.c=adapter.c;this.cache=[];this.key='';this.state='idle';this.epoch=0;}
 configured(){const key=(this.c.config.contentKey||'')+'|'+this.c.config.provider;if(key!==this.key){this.closeNative();this.clearRestore();clearTimeout(this.timer);this.epoch++;this.resolve?.([]);this.resolve=null;this.key=key;this.cache=[];this.state='idle';this.pending=null;}}
 read(){
  let rows;
  if(this.c.config.provider==='cinesrc')rows=[...document.querySelectorAll('button[aria-label^="Move "]')].map(handle=>{const label=handle.getAttribute('aria-label').slice(5);let parent=handle.parentElement,el;for(let depth=0;parent&&depth<4&&!el;depth++,parent=parent.parentElement)el=[...parent.querySelectorAll('button')].find(b=>b!==handle&&b.textContent.trim()===label);return el?{el,label,selected:!!el.querySelector('svg.lucide-check')}:null;}).filter(Boolean);
  else rows=[...document.querySelectorAll('[aria-label="Server"] button,[aria-label="Servers"] button')].map(el=>({el,label:(el.querySelector('.vp-opt-label')?.textContent||el.textContent||'').trim(),selected:el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-pressed')==='true'}));
  return rows.filter(r=>r.label&&r.label.length<100).filter((r,i,all)=>all.findIndex(t=>t.label===r.label)===i).map((r,i)=>({...r,i,engine:'dom'}));
 }
 rows(){this.configured();const rows=this.read();if(rows.length){this.cache=rows;this.state='ready';}return this.cache;}
 trigger(){return [...document.querySelectorAll('button.notflix-tool-button')].find(b=>!b.getAttribute('aria-label')&&!b.getAttribute('title'));}
 closeNative(force=false){
  if(this.disposed||!this.nativeOpen&&!force)return;clearTimeout(this.nativeCloseTimer);
  const exists=()=>!!document.querySelector('button[aria-label^="Move "]');if(!exists()){this.finishClose();return;}
  this.closeDeadline=this.closeDeadline||Date.now()+2500;
  this.c.show();this.c.emit({type:'NATIVE_DISMISS_PROVIDER_MENU'});
  if(!exists()){this.finishClose();return;}
  this.nativeOpen=Date.now()<this.closeDeadline;if(this.nativeOpen)this.nativeCloseTimer=setTimeout(()=>this.closeNative(),350);else this.closeDeadline=0;
 }
 discover(force=false,keepOpen=false){
  this.configured();if(this.c.config.direct)return Promise.resolve([]);if(this.pending)return this.pending;if(!force&&this.rows().length&&this.c.config.provider!=='cinesrc')return Promise.resolve(this.cache);
  const epoch=this.epoch;this.state='loading';
  if(this.c.config.provider!=='cinesrc')this.c.prime('quality');
  this.pending=new Promise(resolve=>{this.resolve=resolve;const started=Date.now(),poll=()=>{if(epoch!==this.epoch){resolve([]);return;}let rows=this.read();if(!rows.length&&this.c.config.provider==='cinesrc'&&!this.nativeOpen){const trigger=this.trigger();if(trigger){trigger.click();this.nativeOpen=true;rows=this.read();}}if(rows.length)this.cache=rows;if(rows.length||Date.now()-started>2000){this.pending=null;this.resolve=null;this.state=rows.length?'ready':'unavailable';if(!keepOpen)this.closeNative();if(['sources','servers','settings'].includes(this.c.panel))this.c.renderPanel();resolve(rows);return;}this.timer=setTimeout(poll,75);};this.timer=setTimeout(poll,25);});
  return this.pending;
 }
 async choose(index){
  const c=this.c,row=this.rows().find(r=>r.i===index),v=c.video,key=this.key;if(!row||!v)return;const time=v.currentTime,paused=v.paused,label=row.label;
  if(this.pending)await this.pending;if(!row.el.isConnected||c.config.provider==='cinesrc')await this.discover(true,true);if(this.key!==key)return;
  const actual=this.read().find(r=>r.label===label)||this.cache.find(r=>r.label===label);if(!actual?.el.isConnected)return;this.action='click '+label;
  this.clearRestore();c.config.resumeAt=time;this.a.restored=null;
  this.restore=event=>{const video=event.target;if(this.key!==key||video?.tagName!=='VIDEO'||video.readyState<1||!Number.isFinite(video.duration))return;try{if(Math.abs(video.currentTime-time)>2&&!video.seeking)video.currentTime=Math.min(time,Math.max(0,video.duration-.1));if(paused&&!video.paused)video.pause();if((event.type==='playing'||event.type==='seeked'&&!paused)&&Math.abs(video.currentTime-time)<2)this.clearRestore();}catch{}};
  for(const event of ['loadedmetadata','loadeddata','playing','seeked'])document.addEventListener(event,this.restore,true);this.restoreTimer=setTimeout(()=>this.clearRestore(),30000);
  c.config.previewSource='';this.a.previews.dispose();this.a.previews.openKey='';c.emit({type:'NATIVE_SERVER_CHANGED'});
  actual.el.click();this.cache=this.cache.map(r=>({...r,selected:r.label===label}));await new Promise(resolve=>setTimeout(resolve,220));if(this.key!==key||this.disposed){this.action='stale '+label;return;}this.action='close '+label;this.closeNative(true);c.closeProviderPanel();if(c.panel)c.renderPanel();
 }
 render(){
  const c=this.c,s=c.sheet,rows=[...new Map((c.config.sourceOptions||[]).map(p=>[String(p.id),p])).values()],servers=this.rows(),selected=c.config.automatic&&rows.some(r=>r.id==='auto')?'auto':String(c.config.selectedSource??c.config.provider),active=rows.find(p=>String(p.id)===String(c.config.selectedSource??c.config.provider))?.name||c.config.providerLabel||c.config.provider||'';
  const focused=s.contains(c.ui.activeElement)?c.ui.activeElement:null,focusSource=focused?.dataset.source,focusServer=focused?.dataset.server,focusExtensions=focused?.tagName==='SUMMARY';
  const expanded=s.querySelector('.source-extensions')?.open,scroll=s.scrollTop,extensions=c.config.extensions,entries=extensions?.entries||[],label=c.config.provider==='cinesrc'?'CineSrc':c.config.provider==='vidly'?'Vidly':c.config.providerLabel||'Current provider';
  s.classList.remove('media-sheet');
  s.innerHTML='<div class="sheet-head"><h2>Playback source</h2><button data-action="close-panel" aria-label="Close playback options">'+c.icons.close+'</button></div><p class="source-status">'+c.esc((selected==='auto'?'Automatic · ':'')+'Selected '+active+(c.video?.readyState>=2?' · Ready':' · Connecting'))+'</p><h3>'+c.esc(c.config.sourceGroupLabel||'Playback providers')+'</h3><div class="options">'+rows.map(p=>'<button data-source="'+c.esc(p.id)+'" aria-pressed="'+(selected===String(p.id))+'" '+(p.available===false?'disabled':'')+'><span>'+c.esc(p.name)+(p.reason?'<small class="source-reason">'+c.esc(p.reason)+'</small>':'')+'</span>'+(selected===String(p.id)?c.icons.check:'')+'</button>').join('')+'</div>'+
   (!c.config.direct?'<h3>'+c.esc(label)+' servers <small>'+servers.length+'</small></h3>'+(servers.length?'<div class="options source-server-options">'+servers.map(t=>'<button data-server="'+t.i+'" aria-pressed="'+t.selected+'">'+c.esc(t.label)+(t.selected?c.icons.check:'')+'</button>').join('')+'</div>':'<p class="empty" role="status">'+(this.state==='loading'?'Checking this provider’s server choices…':'No server choices were returned by this provider.')+'</p><button class="menu-row" data-source-retry>Check again</button>'):'')+
   (entries.length?'<details class="source-extensions" '+(expanded?'open':'')+'><summary>Extensions <span>'+entries.length+'</span></summary><p class="source-reason">'+c.esc(extensions.notice)+'</p><ul class="extension-status-list">'+entries.map(e=>'<li><span>'+c.esc(e.name)+'</span><small>'+c.esc((e.repositoryName?e.repositoryName+' · ':'')+'Not connected to this title')+'</small></li>').join('')+'</ul></details>':'')+
   (rows.length?'':'<p class="empty">This title has no advertised playback sources.</p>');
  s.scrollTop=scroll;if(focusSource!==undefined)c.focus([...s.querySelectorAll('[data-source]')].find(b=>b.dataset.source===focusSource));else if(focusServer!==undefined)c.focus([...s.querySelectorAll('[data-server]')].find(b=>b.dataset.server===focusServer));else if(focusExtensions)c.focus(s.querySelector('summary'));this.a.position();
 }
 finishClose(){this.nativeOpen=false;this.closeDeadline=0;if(this.c.panel&&this.a.keyboardFocus)this.c.focus(this.c.sheet.querySelector('.options button[aria-pressed=true]')||this.c.sheet.querySelector('.options button,.menu-row'));}
 clearRestore(){clearTimeout(this.restoreTimer);if(this.restore)for(const event of ['loadedmetadata','loadeddata','playing','seeked'])document.removeEventListener(event,this.restore,true);this.restore=null;}
 dispose(){this.disposed=true;clearTimeout(this.timer);this.clearRestore();this.epoch++;this.resolve?.([]);this.pending=null;this.closeNative();clearTimeout(this.nativeCloseTimer);}
}
window.VPlusSourceOptions=SourceOptions;
})();
