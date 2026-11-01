'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {Cs3Transport}=require('./transport.cjs');
const METHODS=new Set(['open','search','details','links']);
function publicHttps(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!/^(localhost|.*\.localhost|.*\.local|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/i.test(u.hostname)?u.href:null;}catch{return null;}}
function mediaLinks(response){return (response?.links||[]).filter(l=>!l.drm&&['VIDEO','M3U8'].includes(l.type)&&publicHttps(l.url)).filter((l,i,all)=>all.findIndex(x=>x.url===l.url)===i).slice(0,30);}
class ExtensionService {
 constructor({java,jars,dataDir,pluginDir,registry,Transport=Cs3Transport}){this.config={java,jars,dataDir};this.pluginDir=pluginDir;this.registry=registry;this.Transport=Transport;this.engine=null;this.loaded=new Map();this.handles=new Map();this.detailCache=new Map();}
 available(){return [this.config.java,path.join(this.config.jars,'engine-jvm.jar'),this.pluginDir].every(p=>fs.existsSync(p));}
 async start(){if(!this.available())throw Error('The extension engine has not been installed on this device.');if(!this.engine){this.engine=new this.Transport(this.config);this.engine.on('event',e=>{if(e.event==='webRequest'&&e.rid!=null)this.engine?.request('webReply',{rid:e.rid}).catch(()=>{});});this.engine.on('stopped',()=>{this.engine=null;this.loaded.clear();});}return this.engine;}
 entry(id){const r=this.registry.providers.find(r=>r.id===id);if(!r)throw Error('Unknown extension.');const file=path.join(this.pluginDir,r.id.replace(':','-')+'.cs3');if(!fs.existsSync(file))throw Error('Extension file is missing.');const hash='sha256-'+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(hash!==r.hash)throw Error('Extension verification failed. Reinstall from its trusted repository.');return {record:r,file};}
 async load(id){if(this.loaded.has(id))return this.loaded.get(id);const work=(async()=>{const entry=this.entry(id),engine=await this.start();const value=await engine.request('loadPlugin',{path:entry.file},180000);return {...entry,providers:value.providers||[]};})();this.loaded.set(id,work);try{return await work;}catch(e){this.loaded.delete(id);throw e;}}
 remember(record){if(this.handles.size>=3000){const key=this.handles.keys().next().value;this.handles.delete(key);this.detailCache.delete(key);}const key=crypto.randomUUID();this.handles.set(key,record);return key;}
 item(raw,extensionId,provider){return {handle:this.remember({extensionId,provider,url:raw.url}),title:String(raw.name||'Untitled').slice(0,300),poster:publicHttps(raw.posterUrl)||'',year:raw.year||'',type:raw.type||'',provider};}
 async request(action,m){if(!METHODS.has(action))throw Error('Unknown extension action.');
  if(action==='open'||action==='search'){
   const ext=await this.load(m.extensionId);const provider=ext.providers.find(p=>p.name===m.provider)||ext.providers[0];if(!provider)return {providers:[],items:[],notice:'This extension registers tools or extractors, rather than a browsable catalogue.'};
   const params={plugin:ext.file,provider:provider.name,page:1};let result;
   if(action==='search'){const query=String(m.query||'').trim();if(!query||query.length>200)throw Error('Enter a search up to 200 characters.');result=await this.engine.request('search',{...params,query});}
   else if(provider.hasMainPage)result=await this.engine.request('mainPage',params);
   else result={items:[],notice:'Search this provider to find titles.'};
   const raw=result.items||(result.sections||result.lists||[]).flatMap(s=>s.items||s.list||[]);
   return {providers:ext.providers.map(p=>({name:p.name,language:p.lang,types:p.types})),provider:provider.name,items:raw.slice(0,200).map(i=>this.item(i,m.extensionId,provider.name)),notice:result.notice||((result.sections||[]).some(s=>s.error)?'Some shelves could not load. Try searching this provider.':''),hasNext:!!result.hasNext};
  }
  const record=this.handles.get(m.handle);if(!record)throw Error('This title has expired. Search the provider again.');const ext=await this.load(record.extensionId),params={plugin:ext.file,provider:record.provider};
  let detail=this.detailCache.get(m.handle);if(!detail){detail=await this.engine.request('load',{...params,url:record.url});this.detailCache.set(m.handle,detail);}
  if(action==='details'){return {handle:m.handle,title:detail.name,overview:detail.plot||'',year:detail.year||'',poster:publicHttps(detail.backgroundPosterUrl)||publicHttps(detail.posterUrl)||'',rating:detail.score,provider:record.provider,episodes:(detail.episodes||[]).map((e,index)=>({index,name:e.name||'Episode '+(e.episode||index+1),season:e.season||1,episode:e.episode||index+1,poster:publicHttps(e.posterUrl)||''}))};}
  let data=detail.dataUrl;if(detail.episodes?.length){if(!Number.isInteger(m.episodeIndex)||m.episodeIndex<0||m.episodeIndex>=detail.episodes.length)throw Error('Choose an episode.');data=detail.episodes[m.episodeIndex].data;}
  if(typeof data!=='string'||!data)throw Error('This provider returned no playable title.');
  const response=await this.engine.request('loadLinks',{...params,data,timeoutMs:30000});const links=mediaLinks(response);if(!links.length)throw Error('No supported video links were returned. This source may require its own browser or account.');
  return {title:detail.name,provider:record.provider,resumeKey:crypto.createHash('sha256').update(record.extensionId+'|'+record.provider+'|'+record.url+'|'+(m.episodeIndex??'movie')).digest('hex'),links,subtitles:(response.subtitles||[]).filter(s=>publicHttps(s.url)).slice(0,50)};
 }
 close(){this.engine?.close();this.engine=null;this.loaded.clear();this.handles.clear();this.detailCache.clear();}
}
module.exports={ExtensionService,publicHttps,mediaLinks};
