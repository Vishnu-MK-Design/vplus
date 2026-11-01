(()=>{
 'use strict';
 if(location.origin!=='https://vidly.pro'||window.VidlyRemote)return;
 let port=null,lastVideo=null,focused=null,currentLayer=null,lastTop=null,lastBottom=null,shown=false,hideTimer=null,settleTimer=null,backUntil=0,closingFallback=false,controlsTimeout=6500,seekStep=10;
 const returns=new WeakMap();
 const root=()=>document.querySelector('.vp-root');
 const video=()=>document.querySelector('video');
 const label=el=>el?.getAttribute('aria-label')||el?.textContent?.trim()||'';
 function visible(el){
  if(!el||!el.isConnected||el.disabled||el.closest('[inert],[aria-hidden="true"],[hidden]'))return false;
  const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
  for(let node=el;node&&node!==document.body;node=node.parentElement){const s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}
  return true;
 }
 function layers(){
  // Settings is a sheet, not the Quality/Audio popover. Its hidden dialog stays in the DOM.
  const all=Array.from(document.querySelectorAll('.vp-sheet.is-open,.vp-panel.is-open,[role="dialog"],[role="menu"]')).filter(el=>el.matches('.vp-sheet.is-open,.vp-panel.is-open')?!el.closest('[inert],[aria-hidden="true"],[hidden]'):visible(el));
  return all.filter(el=>!all.some(other=>other!==el&&other.contains(el)));
 }
 function layer(){const all=layers();return all.find(el=>el.matches('.vp-sheet.is-open'))||all[all.length-1]||null;}
 function controls(scope=layer()||root()){
  if(!scope)return[];
  return Array.from(scope.querySelectorAll('button,[role="menuitemradio"],[role="menuitem"],[role="switch"],input[type="range"],[role="slider"]')).filter(visible);
 }
 function playerButton(name){return Array.from(root()?.querySelectorAll('.vp-bottom button,.vp-top button')||[]).find(el=>label(el)===name&&visible(el));}
 function playButton(){return playerButton('Pause')||playerButton('Play');}
 function focus(el){
  if(focused&&focused!==el)focused.removeAttribute('data-tv-focus');
  focused=el||null;
  if(el){if(!layer()){if(el.id==='tv-player-back'||el.closest('.vp-top'))lastTop=el;else if(el.closest('.vp-bottom')&&!el.matches('[role="slider"]'))lastBottom=el;}el.setAttribute('data-tv-focus','yes');el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});}
 }
 function armHide(){
  clearTimeout(hideTimer);
  if(shown&&controlsTimeout&&!layer()&&video()&&!video().paused)hideTimer=setTimeout(()=>{if(!layer())hide();},controlsTimeout);
 }
 function wake(){const r=root();if(!r)return;r.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:Math.round(innerWidth/2),clientY:Math.round(innerHeight/2)}));if(typeof PointerEvent!=='undefined')r.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:Math.round(innerWidth/2),clientY:Math.round(innerHeight/2)}));}
 function show(){shown=true;root()?.setAttribute('data-tv-controls','visible');wake();armHide();}
 function hide(){shown=false;root()?.setAttribute('data-tv-controls','hidden');focus(null);document.activeElement?.blur();clearTimeout(hideTimer);}
 function findReturn(entry){
  if(visible(entry?.el))return entry.el;
  return controls().find(el=>label(el)===entry?.name)||playButton()||controls()[0];
 }
 function reconcile(){
  const r=root();if(!r)return;
  if(!r.querySelector('#tv-player-back')){
   const button=document.createElement('button');button.id='tv-player-back';button.type='button';button.textContent='← Back';button.setAttribute('aria-label','Back to titles');
   button.onclick=e=>{e.stopPropagation();if(layer())back();else port?.postMessage(JSON.stringify({type:'NATIVE_EXIT'}));};r.appendChild(button);
   r.setAttribute('data-tv-controls',shown?'visible':'hidden');
  }
  const next=layer();r.setAttribute('data-tv-panel',next?'open':'closed');
  if(next!==currentLayer){
   const previous=currentLayer;
   if(next&&!returns.has(next))returns.set(next,visible(focused)?{el:focused,name:label(focused)}:returns.get(previous)||{el:focused,name:label(focused)});
   currentLayer=next;
   if(next){show();const target=controls(next).find(el=>el.matches('[aria-checked="true"],[aria-pressed="true"]'))||controls(next)[0];focus(target);}
   else if(previous){show();focus(findReturn(returns.get(previous)));returns.delete(previous);}
  }else if(shown&&(!focused||!visible(focused))){const options=controls();focus(options.find(el=>el.matches('[aria-checked="true"],[aria-pressed="true"]'))||options[0]);}
 }
 function settle(){clearTimeout(settleTimer);settleTimer=setTimeout(reconcile,40);}
 function seek(delta){const v=video();if(!v)return false;v.currentTime=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:604800,v.currentTime+delta));emit('seek');return true;}
 function adjust(el,direction){
  if(el.matches('.vp-seek,[role="slider"]:not(input)'))return seek(direction*seekStep);
  if(!el.matches('input[type="range"]'))return false;
  const min=Number(el.min||0),max=Number(el.max||100),step=Number(el.step)||1;
  const value=Math.max(min,Math.min(max,Number((Number(el.value)+direction*step).toFixed(4))));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;
 }
 function move(direction){
  reconcile();
  if(!shown&&!layer()){show();focus(direction==='up'?playerButton('Quality & Server')||playButton():playButton()||controls()[0]);if(direction==='up')setTimeout(()=>{if(shown&&!layer())focus(playerButton('Quality & Server')||playButton());},80);return true;}
  show();const all=controls();if(!all.includes(focused)){focus(playButton()||all[0]);return true;}
  if((direction==='left'||direction==='right')&&adjust(focused,direction==='left'?-1:1)){armHide();return true;}
  if(layer()?.matches('.vp-sheet.is-open')){
   const firstField=all.find(el=>el.closest('.vp-sheet-body'));
   const close=all.find(el=>el.closest('.vp-sheet-head')&&el.matches('.vp-sheet-close'));
   if((focused.matches('.vp-sheet-tab,.vp-sheet-close')&&direction==='right')||(focused===close&&direction==='down')){focus(firstField||all[0]);return true;}
   if(focused===firstField&&direction==='up'){focus(close||all[0]);return true;}
  }
  if(!layer()){
   // The TV player has three stable rows. Wide Seek geometry must not skip buttons below it.
   const top=all.filter(el=>el.id==='tv-player-back'||el.closest('.vp-top')).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
   const bottom=all.filter(el=>el.tagName==='BUTTON'&&el.closest('.vp-bottom')).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
   const seekControl=all.find(el=>el.matches('.vp-seek'));
   if(focused===seekControl&&(direction==='up'||direction==='down')){focus(direction==='up'?(visible(lastTop)?lastTop:playerButton('Quality & Server')):(visible(lastBottom)?lastBottom:playButton()));return true;}
   const row=top.includes(focused)?top:bottom.includes(focused)?bottom:null;
   if(row){
    if(direction==='left'||direction==='right'){const index=row.indexOf(focused)+(direction==='left'?-1:1);if(row[index])focus(row[index]);return true;}
    if((row===top&&direction==='down')||(row===bottom&&direction==='up'))focus(seekControl||playButton());return true;
   }
  }
  const a=focused.getBoundingClientRect();const cx=a.x+a.width/2,cy=a.y+a.height/2,horizontal=direction==='left'||direction==='right';
  const candidates=all.filter(el=>el!==focused).map(el=>{const b=el.getBoundingClientRect();const x=b.x+b.width/2-cx,y=b.y+b.height/2-cy;const overlap=horizontal?Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)):Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));return{el,x,y,overlap};})
   .filter(p=>direction==='left'?p.x< -4:direction==='right'?p.x>4:direction==='up'?p.y< -4:p.y>4)
   .sort((a,b)=>{const score=p=>(horizontal?Math.abs(p.x):Math.abs(p.y))+(p.overlap>0?0:(horizontal?Math.abs(p.y)*5:Math.abs(p.x)*4)+120);return score(a)-score(b);});
  if(candidates[0])focus(candidates[0].el);armHide();return true;
 }
 function activate(){
  reconcile();if(!shown&&!layer()){show();focus(playButton()||controls()[0]);return true;}
  show();const all=controls();if(!all.includes(focused)){focus(all[0]);return true;}
  if(focused.matches('input[type="range"],[role="slider"]'))return true;
  const before=focused;before.click();settle();armHide();return true;
 }
 function closeLayer(open){
  const close=Array.from(open.querySelectorAll('button')).find(el=>!el.disabled&&(/^close(?:\s|$)/i.test(label(el))||el.matches('.vp-sheet-close,.vp-panel-close')));
  if(close)close.click();else{
   const expanded=Array.from(root()?.querySelectorAll('button[aria-expanded="true"]')||[]).find(visible);
   if(expanded)expanded.click();else{closingFallback=true;try{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));}finally{closingFallback=false;}}
  }
  // Never let the Activity exit just because an unknown provider panel could not close.
  settle();
 }
 function back(){
  reconcile();const open=layer();
  if(open){backUntil=Date.now()+250;closeLayer(open);return 'handled';}
  if(Date.now()<backUntil)return 'handled';
  if(shown){hide();backUntil=Date.now()+200;return 'handled';}
  return 'exit';
 }
 function menu(name){
  show();const wanted=name==='quality'?'Quality & Server':name==='audio'?'Audio & Subtitles':'Settings';const button=playerButton(wanted);if(!button)return false;focus(button);button.click();settle();return true;
 }

 let preferredLanguage='auto',languageAttempted=false,languageRequestedAt=0,lastLanguages='';
 const audioNames={en:'English',ta:'Tamil',hi:'Hindi',te:'Telugu',ml:'Malayalam',kn:'Kannada',ja:'Japanese',ko:'Korean',es:'Spanish',fr:'French',de:'German'};
 function audioCode(text){text=String(text).trim().toLowerCase();if(/subbed|subtitled|subtitles?/.test(text))return '';return Object.keys(audioNames).find(k=>text===k||text===audioNames[k].toLowerCase()||text.startsWith(audioNames[k].toLowerCase()+' '))||'';}
 function languageTick(){const options=Array.from(document.querySelectorAll('[aria-label="Audio"] button,[aria-label="Audio language"] button'));const languages=[...new Set(options.map(e=>audioCode(e.querySelector('.vp-opt-label')?.textContent||e.textContent)).filter(Boolean))];if(port&&languages.length&&lastLanguages!==languages.join(',')){lastLanguages=languages.join(',');port.postMessage(JSON.stringify({type:'NATIVE_LANGUAGES',languages,provider:'vidly'}));}if(preferredLanguage==='auto'||languageAttempted)return;const v=video();if(!v||v.readyState<1)return;const selected=options.find(e=>audioCode(e.querySelector('.vp-opt-label')?.textContent||e.textContent)===preferredLanguage);if(selected){languageAttempted=true;selected.click();if(layer())closeLayer(layer());v.play().catch(()=>{});return;}if(!options.length&&Date.now()-languageRequestedAt<18000){if(!layer())menu('audio');return;}languageAttempted=true;const note=document.createElement('div');note.id='tv-audio-notice';note.textContent='Preferred audio is not confirmed on this source. Open Audio & Subtitles or choose another source.';note.style.cssText='position:fixed;top:20px;left:15%;right:15%;padding:18px;background:#111e;color:white;z-index:1000;font:16px Arial;text-align:center;border-radius:8px';document.body.appendChild(note);setTimeout(()=>note.remove(),7000);show();}

 function emit(event){const v=video();if(!port||!v||!Number.isFinite(v.currentTime))return;port.postMessage(JSON.stringify({type:'NATIVE_PROGRESS',event,currentTime:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:0}));}
 const style=document.createElement('style');style.textContent=`
  [data-tv-focus="yes"]{outline:none!important;box-shadow:0 0 0 2px #dedede!important}
  .vp-root[data-tv-controls="visible"] .vp-top,.vp-root[data-tv-controls="visible"] .vp-bottom{opacity:1!important;visibility:visible!important;transform:none!important;pointer-events:auto!important;transition:none!important}
  .vp-root[data-tv-controls="hidden"] .vp-top,.vp-root[data-tv-controls="hidden"] .vp-bottom{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:none!important}
  .vp-root .vp-center{display:none!important}
  .vp-root .vp-panel,.vp-root .vp-panel-box,.vp-root .vp-sheet,.vp-root .vp-sheet-box{transition:none!important}
  .vp-root button[aria-label="Fullscreen"]{display:none!important}
  .vp-root .vp-volume-range{display:none!important}
  #tv-player-back{position:absolute;left:24px;top:22px;z-index:30;border:1px solid #ffffff50;border-radius:7px;padding:11px 18px;min-height:42px;background:#111b;color:#fff;font:600 15px Arial;cursor:pointer}
  .vp-root[data-tv-controls="hidden"] #tv-player-back{visibility:hidden;pointer-events:none}
  .vp-root .vp-top .vp-titles{padding-left:115px}
  .vp-root[data-tv-panel="open"] #tv-player-back{visibility:hidden;pointer-events:none}
 `;document.head.appendChild(style);
 window.addEventListener('message',e=>{if(e.source===null&&e.data==='VIDLY_NATIVE_PORT'&&e.ports.length===1){if(port)port.close();port=e.ports[0];emit('ready');}});
 window.VidlyRemote={command(name,arg){try{
  if(name==='preferences'){if([0,3500,6500,10000].includes(arg?.controlsTimeout))controlsTimeout=arg.controlsTimeout;if([5,10,30].includes(arg?.seekStep))seekStep=arg.seekStep;armHide();return true;}
  if(name==='language'){preferredLanguage=audioNames[arg]?arg:'auto';languageAttempted=false;languageRequestedAt=Date.now();return true;}
  if(name==='back')return back();
  if(name==='key'){if(arg==='ok')return activate();if(arg==='back')return back();if(arg==='menu')return menu('settings');return move(arg);}
  if(name==='move')return move(arg);
  if(name==='select')return activate();
  if(name==='menu')return menu(arg);
  if(name==='seek')return seek(Number(arg)||0);
  if(name==='state')return{shown,layer:layer()?.className||null,focus:label(focused)};
  const v=video();if(!v)return false;
  if(name==='toggle'){if(v.paused)v.play().catch(()=>{});else v.pause();}
  else if(name==='play')v.play().catch(()=>{});
  else if(name==='pause')v.pause();else return false;
  return true;
 }catch{return name==='back'?'handled':false;}}};
 new MutationObserver(()=>{settle();root()?.setAttribute('data-tv-panel',layer()?'open':'closed');}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-hidden','aria-expanded','inert']});
 // The host consumes keys too. This also prevents provider keyboard handlers from firing twice.
 window.addEventListener('keydown',e=>{if(closingFallback)return;const keys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'ok',Escape:'back',BrowserBack:'back'};if(keys[e.key]){e.preventDefault();e.stopImmediatePropagation();window.VidlyRemote.command('key',keys[e.key]);}},true);
 setInterval(()=>{
  if(shown&&!layer())wake();reconcile();languageTick();const v=video();if(v&&v!==lastVideo){lastVideo=v;['play','pause','ended','seeked'].forEach(name=>v.addEventListener(name,()=>{emit(name);if(name==='pause'&&!layer()){show();focus(playButton()||controls()[0]);}if(name==='play')armHide();}));}
  if(v&&!v.paused)emit('timeupdate');
 },1500);
 reconcile();
})();
