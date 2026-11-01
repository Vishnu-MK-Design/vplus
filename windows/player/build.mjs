import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export async function buildDesktopPlayer(out){
 let core=await fs.readFile(path.join(dir,'../../shared/assets/player/shared-player.js'),'utf8');
 const replace=(from,to)=>{if(!core.includes(from))throw Error('Shared player contract changed: '+from.slice(0,80));core=core.replace(from,to);};
 replace("function arm(){clearTimeout(hideTimer);const timeout=config.controlsTimeout??6500;if(shown&&timeout&&!panel&&!seeking&&!adapter?.isInteracting?.()&&video&&!video.paused)hideTimer=setTimeout(hide,timeout);}","function arm(){adapter?.arm();}");
 replace("$('.chrome').classList.remove('hide');arm();","$('.chrome').classList.remove('hide');adapter?.chrome(true);arm();");
 replace("$('.chrome').classList.add('hide');ui.activeElement?.blur();clearTimeout(hideTimer);","$('.chrome').classList.add('hide');adapter?.chrome(false);clearTimeout(hideTimer);");
 replace('function renderPanel(){updateCaptions();','function renderPanel(){');
 replace('adapter?.closed?.();updateCaptions();show();','adapter?.closed?.();show();');
 replace("if(!panel)return;const titles=", "if(!panel)return;if(panel==='sources'){adapter.renderSources();return;}const titles=");
 replace("function openPanel(kind,keyboard=true){", "function openPanel(kind,keyboard=true){");
 const start=core.indexOf(' function hidePreview()'),end=core.indexOf(' function closePanel(',start);
 if(start<0||end<0)throw Error('Preview boundary missing');
 core=core.slice(0,start)+" function hidePreview(){adapter?.previews.hide();$('.preview').hidden=true;}\n function previewAt(seconds,ratio){previewTarget=seconds;adapter?.previews.show(seconds,ratio);}\n"+core.slice(end);
 const pvStart=core.indexOf(" const pv=$('.preview video');"),pvEnd=core.indexOf(" const style=document.createElement('style');",pvStart);
 if(pvStart<0||pvEnd<0)throw Error('Preview listener boundary missing');core=core.slice(0,pvStart)+core.slice(pvEnd);
 replace('<video muted playsinline preload="metadata" aria-hidden="true"></video><span class="preview-note">Loading preview…</span>','<canvas width="240" height="135" aria-hidden="true"></canvas>');
 core=core.replaceAll('.preview video','.preview canvas').replaceAll('.preview.waiting video','.preview.waiting canvas');
 replace("video=next;reported=false;","video=next;adapter?.mediaAttached(next);reported=false;");
 replace("if(name==='configure'){", "if(name==='window-state'){adapter.windowState(arg);return true;}if(name==='preview-data')return adapter.previews.receive(arg);if(name==='dialog'){adapter.dialogOpen=!!arg;show();return true;}if(name==='configure'){");
 replace("$('.name').textContent=config.title||'V+ Player';", "$('.name').textContent=config.title||'V+ Player';adapter?.configured();");
 replace("config.fullscreen=!!arg;", "config.fullscreen=!!arg;adapter?.resize();");
 replace("if(arg.title&&config.title&&arg.title!==config.title)","if((arg.contentKey&&config.contentKey&&arg.contentKey!==config.contentKey)||(arg.title&&config.title&&arg.title!==config.title))");
 replace("provider:b.dataset.source});", "provider:b.dataset.source,currentTime:video?.currentTime||0,paused:!!video?.paused});");
 replace("if(video.paused&&video.readyState>=1)video.play()", "if(video.paused&&video.readyState>=1&&!config.resumePaused)video.play()");
 // Published HTML subtitle files use the existing bounded native text loader.
 // Send only the selected index; the host reads its URL from the trusted active page.
 replace("if(!t)return;", "if(!t)return;if(['vidfast','vidlink'].includes(config.provider)&&t.engine==='media'&&[...video.querySelectorAll('track[src]')].some(el=>el.track===t.track&&(el.readyState===3||new URL(el.src).origin!==location.origin))){const index=100+t.i;if(subtitleCueCache.has(index))command('subtitle-cues',subtitleCueCache.get(index));else{subtitleError='Loading subtitles…';const requestId=++subtitleRequestId;renderPanel();emit({type:'NATIVE_SUBTITLE',index,requestId});}return;}");
 replace("selectedExternal<0&&subtitleChoice?.engine==='media'&&chosenCaptionTrack()===t", "selectedExternal===100+i||selectedExternal<0&&subtitleChoice?.engine==='media'&&chosenCaptionTrack()===t");
 replace("serverRows().find(t=>t.i===Number(b.dataset.server))?.el?.click();closeProviderPanel();renderPanel();", "adapter.chooseServer(Number(b.dataset.server));");
 replace("video.style.setProperty('object-fit',b.dataset.fit,'important');renderPanel();", "video.style.setProperty('object-fit',b.dataset.fit,'important');adapter.layoutCaptions();renderPanel();");
 replace("preview:{shown:!$('.preview').hidden,ready:!$('.preview').classList.contains('waiting'),time:previewTarget}","preview:adapter.previews.state()");
 replace("preview:adapter.previews.state()", "sources:{automatic:!!config.automatic,provider:config.provider,status:adapter.sources.state,count:adapter.sources.cache.length,live:adapter.sources.read().length,action:adapter.sources.action,lastClose:adapter.sources.lastClose},preview:adapter.previews.state()");
 replace("sources:{automatic:","resume:{target:config.resumeAt,paused:!!config.resumePaused},sources:{automatic:");
 replace("hidePreview,trackButtons,", "hidePreview,trackButtons,serverRows,prime,closeProviderPanel,renderPanel,");
 replace('function serverRows(){return domRows(\'[aria-label="Server"] button,[aria-label="Servers"] button\');}', 'function serverRows(){return adapter?.sources?.rows()||[];}');
 replace("if(b.dataset.mediaTab){", "if(b.dataset.sourceRetry!==undefined){adapter.sources.discover(true);}else if(b.dataset.mediaTab){");
 replace("$('.captions span').textContent=text;", "if($('.captions span').textContent!==text)$('.captions span').textContent=text;");
 const chunks=await Promise.all(['preview-client.js','source-options.js','episode-features.js','desktop-player.js'].map(f=>fs.readFile(path.join(dir,f),'utf8')));
 await fs.writeFile(path.join(out,'vplus-player.js'),'/* PC bundle: windows/player/build.mjs. Android/phone sources are read-only. */\n'+chunks.join('\n')+'\n'+core);
}
