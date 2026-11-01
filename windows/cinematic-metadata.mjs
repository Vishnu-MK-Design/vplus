import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=path.dirname(fileURLToPath(import.meta.url));
const FALLBACK=JSON.parse(fs.readFileSync(path.join(directory,'cinematic-fallback.json'),'utf8')).records;
const IMDB=/^tt[0-9]{7,10}$/;
const VIDEO=/^[A-Za-z0-9_-]{11}$/;
const text=value=>String(value||'').replace(/&(?:apos|#39);/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,6000);
const normalized=value=>text(value).toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
const IMAGE_HOSTS=new Set(['image.tmdb.org','static.tvmaze.com','m.media-amazon.com','images.metahub.space','live.metahub.space']);
const SINTEL=Object.freeze({key:'movie-45745',kind:'movie',id:'45745',imdbId:'tt1727587',title:'Sintel',year:'2010'});
export function licensedTitleIdentity(query){return String(query||'').trim().toLocaleLowerCase()==='sintel'?{...SINTEL}:null;}
export function licensedTrailerFor(item){
 if(item?.kind!==SINTEL.kind||String(item.id)!==SINTEL.id||item.key!==SINTEL.key||item.imdbId!==SINTEL.imdbId||normalized(item.title)!=='sintel'||String(item.year)!==SINTEL.year)return null;
 return {type:'video',url:'https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4',title:'Sintel trailer · Blender Foundation',publisher:'Blender Foundation',source:'https://durian.blender.org/download/',backgroundAllowed:true,credit:{name:'© copyright Blender Foundation | durian.blender.org',url:'https://durian.blender.org/sharing/',license:'CC BY 3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',adaptations:'Cover crop, looping and optional muted playback.'}};
}
export function safeCastPhoto(value){
 if(/^cinematic-media\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/.test(value||''))return value;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&IMAGE_HOSTS.has(u.hostname)?u.href:'';}catch{return '';}
}
export function sanitizeCast(rows){
 const used=new Set();return (Array.isArray(rows)?rows:[]).map(row=>typeof row==='string'?{name:row}:row||{}).map(row=>({name:text(row.name).slice(0,160),character:text(row.character).slice(0,250),photo:safeCastPhoto(row.photo)})).filter(row=>{const name=normalized(row.name);if(!name||used.has(name))return false;used.add(name);return true;}).slice(0,30);
}
export function youtubeTrailer(id,{title='',publisher='',source=''}={}){
 if(!VIDEO.test(id||''))return null;
 return {type:'youtube',youtubeId:id,title:text(title).slice(0,250)||'Trailer',source:'https://www.youtube.com/watch?v='+id,publisher:text(publisher).slice(0,160),backgroundAllowed:false};
}
export function normalizeTrailerCandidates(raw,sourceName='Cinemeta'){
 const rows=[...(Array.isArray(raw?.trailers)?raw.trailers.filter(t=>String(t.type||'Trailer').toLowerCase()==='trailer').map(t=>({id:t.source,title:t.title})):[]),...(Array.isArray(raw?.trailerStreams)?raw.trailerStreams.map(t=>({id:t.ytId,title:t.title})):[])];
 const used=new Set();return rows.map(row=>youtubeTrailer(row.id,{title:row.title||raw?.name||'Trailer',publisher:sourceName})).filter(row=>{if(!row||used.has(row.youtubeId))return false;used.add(row.youtubeId);return true;}).slice(0,8);
}
export function normalizeTmdbTrailers(raw){
 return (Array.isArray(raw?.results)?raw.results:[]).filter(r=>r.site==='YouTube'&&r.type==='Trailer').sort((a,b)=>Number(!!b.official)-Number(!!a.official)||Number(b.iso_639_1==='en')-Number(a.iso_639_1==='en')).map(r=>youtubeTrailer(r.key,{title:r.name,publisher:r.official?'TMDB official-trailer listing':'TMDB trailer listing'})).filter(Boolean).slice(0,8);
}
function validItem(item){return item&&['movie','tv','anime'].includes(item.kind)&&/^[1-9][0-9]{0,11}$/.test(String(item.id))&&item.key===item.kind+'-'+item.id;}
function validRaw(meta,item,imdb){
 if(!meta||!IMDB.test(imdb)||String(meta.imdb_id||meta.id)!==imdb)return false;
 if(item.kind==='anime')return normalized(meta.name)===normalized(item.title)&&String(meta.year||meta.releaseInfo||'').startsWith(item.year||'');
 return String(meta.moviedb_id||'')===String(item.id)&&(meta.type||'')===(item.kind==='tv'?'series':'movie');
}
export function createCinematicMetadata({detailsService,request=fetch,token=()=>'',now=Date.now,fallback=FALLBACK,photos=true}={}){
 if(!detailsService?.details)throw Error('A details service is required.');
 const cache=new Map(),pending=new Map(),people=new Map(),personPending=new Map();
 async function json(raw,{hosts,timeout=6000,headers={},limit=2000000}={}){
  let u=new URL(raw);const deadline=Date.now()+timeout;
  for(let hop=0;hop<3;hop++){
   if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname))throw Error('Unsupported metadata destination.');
   const remaining=deadline-Date.now();if(remaining<=0)throw Error('Metadata timed out.');
   const r=await request(u.href,{headers:{Accept:'application/json',...headers},redirect:'manual',signal:AbortSignal.timeout(remaining)});
   if([301,302,307,308].includes(r.status)){const next=r.headers.get('location');if(!next||hop===2)throw Error('Invalid metadata redirect.');u=new URL(next,u);continue;}
   if(!r.ok)throw Error('Metadata unavailable.');
   if(Number(r.headers.get('content-length'))>limit)throw Error('Metadata too large.');
   const reader=r.body?.getReader();if(!reader)throw Error('Metadata unavailable.');let total=0;const parts=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('Metadata too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
   return JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
  }
  throw Error('Metadata redirect failed.');
 }
 async function portrait(name){
  if(people.has(name))return people.get(name);if(personPending.has(name))return personPending.get(name);
  const work=(async()=>{try{const rows=await json('https://api.tvmaze.com/search/people?q='+encodeURIComponent(name),{hosts:['api.tvmaze.com'],timeout:2500,limit:250000});const exact=Array.isArray(rows)?rows.filter(r=>normalized(r.person?.name)===normalized(name)):[];return exact.length===1?safeCastPhoto(exact[0].person?.image?.medium||exact[0].person?.image?.original):'';}catch{return '';}})();
  personPending.set(name,work);try{const value=await work;if(people.size>=150)people.delete(people.keys().next().value);people.set(name,value);return value;}finally{personPending.delete(name);}
 }
 async function details(item,{refresh=false}={}){
  if(!validItem(item))throw Error('Invalid title.');const key=item.key,old=cache.get(key);
  if(!refresh&&old&&now()-old.at<old.ttl)return structuredClone(old.data);if(pending.has(key))return structuredClone(await pending.get(key));
  const work=(async()=>{
   const local=fallback[key],knownImdb=IMDB.test(item.imdbId||'')?item.imdbId:IMDB.test(local?.imdbId||'')?local.imdbId:'';
   let baseTimer,baseIncomplete=false;
   const baseWork=Promise.race([detailsService.details({...item,...(knownImdb?{imdbId:knownImdb}:{})}).catch(()=>({...item})),new Promise(resolve=>{baseTimer=setTimeout(()=>{baseIncomplete=true;resolve({...item,metadataNotice:'Some additional title details could not refresh. Retry to check again.'});},14000);})]).finally(()=>clearTimeout(baseTimer));
   const rawWork=knownImdb?json('https://v3-cinemeta.strem.io/meta/'+(item.kind==='movie'?'movie':'series')+'/'+knownImdb+'.json',{hosts:['v3-cinemeta.strem.io','cinemeta-catalogs.strem.io']}).then(j=>validRaw(j.meta,item,knownImdb)?j.meta:null).catch(()=>null):Promise.resolve(null);
   const value=String(token()||'');
   const tmdbWork=value&&item.kind!=='anime'?json('https://api.themoviedb.org/3/'+item.kind+'/'+item.id+'/videos?language=en-US',{hosts:['api.themoviedb.org'],headers:{Authorization:'Bearer '+value}}).then(normalizeTmdbTrailers).catch(()=>[]):Promise.resolve([]);
   const [base,firstRaw,tmdbTrailers]=await Promise.all([baseWork,rawWork,tmdbWork]);
   const imdb=knownImdb||base.imdbId;
   let raw=firstRaw;if(!raw&&!knownImdb&&IMDB.test(imdb||''))try{const j=await json('https://v3-cinemeta.strem.io/meta/'+(item.kind==='movie'?'movie':'series')+'/'+imdb+'.json',{hosts:['v3-cinemeta.strem.io','cinemeta-catalogs.strem.io']});if(validRaw(j.meta,item,imdb))raw=j.meta;}catch{}
   let cast=sanitizeCast(base.cast);if(!cast.length)cast=sanitizeCast(raw?.cast);if(!cast.length)cast=sanitizeCast(local?.cast);
   // Merge attributed local photos/roles only for the same numeric title and actor.
   const localCast=new Map(sanitizeCast(local?.cast).map(c=>[normalized(c.name),c]));
   cast=cast.map(c=>{const stored=localCast.get(normalized(c.name));return stored?{...c,character:c.character||stored.character,photo:c.photo||stored.photo}:c;});
   let photoCredit=false;
   if(photos&&item.kind==='movie')await Promise.all(cast.slice(0,3).map(async c=>{if(c.photo)return;const photo=await portrait(c.name);if(photo){c.photo=photo;photoCredit=true;}}));
   const candidates=[...(local?.trailer?[youtubeTrailer(local.trailer.youtubeId,local.trailer)]:[]),...tmdbTrailers,...normalizeTrailerCandidates(raw)];
   const seenTrailers=new Set(),trailers=candidates.filter(t=>{if(!t||seenTrailers.has(t.youtubeId))return false;seenTrailers.add(t.youtubeId);return true;});
   const castCredit=localCast.size&&cast.some(c=>localCast.has(normalized(c.name)))&&local?.castCredit?local.castCredit:base.metadataCredit||{name:base.source==='tmdb'?'TMDB':'Cinemeta',url:base.source==='tmdb'?'https://www.themoviedb.org/'+(item.kind==='movie'?'movie':'tv')+'/'+item.id:IMDB.test(imdb||'')?'https://www.imdb.com/title/'+imdb+'/':'',license:''};
   const result={...base,key:item.key,id:item.id,kind:item.kind,imdbId:IMDB.test(imdb||'')?imdb:base.imdbId||'',cast,castCredit:{...castCredit,...(photoCredit?{photoSource:'TVmaze',photoLicense:'CC BY-SA'}:{})},trailer:trailers[0]||null,trailerCandidates:trailers};
   const licensed=licensedTrailerFor(result);if(licensed){result.trailer=licensed;result.trailerCandidates=[licensed,...trailers];}
   if(!result.genres?.length&&local?.genres?.length)result.genres=local.genres;
   if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),ttl:!baseIncomplete&&(raw||cast.length)?3600000:60000,data:result});return result;
  })();pending.set(key,work);try{return structuredClone(await work);}finally{pending.delete(key);}
 }
 return {details,episodes:(...args)=>detailsService.episodes(...args)};
}
