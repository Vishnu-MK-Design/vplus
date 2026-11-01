// Windows-only live anime index. MAL IDs remain MAL; movie/TV identities are never rewritten.
import contentPolicy from './content-policy.cjs';
const ENDPOINT='https://graphql.anilist.co';
const FIELDS=`id idMal type isAdult title { romaji english native } synonyms format description(asHtml:false)
 startDate { year month day } episodes duration averageScore popularity trending status nextAiringEpisode { episode airingAt } genres countryOfOrigin tags { id name rank category isAdult isMediaSpoiler isGeneralSpoiler }
 coverImage { extraLarge large } bannerImage trailer { id site }`;
const BROWSE=`query($page:Int,$search:String,$sort:[MediaSort],$genre:String,$tag:String,$format:MediaFormat,$status:MediaStatus,$after:FuzzyDateInt,$before:FuzzyDateInt,$country:CountryCode){Page(page:$page,perPage:24){pageInfo{currentPage hasNextPage} media(type:ANIME,isAdult:false,search:$search,sort:$sort,genre:$genre,tag:$tag,format:$format,status:$status,startDate_greater:$after,startDate_lesser:$before,countryOfOrigin:$country){${FIELDS}}}}`;
const DETAIL=`query($id:Int){Media(idMal:$id,type:ANIME,isAdult:false){${FIELDS} streamingEpisodes { title thumbnail } characters(perPage:18,sort:ROLE){edges{role node{name{full} image{large}}}}}}`;
const GENRES={'16':'Animation','35':'Comedy','18':'Drama','9648':'Mystery','28':'Action','12':'Adventure','27':'Horror','878':'Sci-Fi','53':'Thriller','10749':'Romance','14':'Fantasy'};
const clean=(s,max=6000)=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
const id=n=>Number.isInteger(Number(n))&&Number(n)>0&&Number(n)<1e12?Number(n):null;
const image=raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['s4.anilist.co','cdn.myanimelist.net','img1.ak.crunchyroll.com'].includes(u.hostname)?u.href:'';}catch{return '';}};
export function normalizeAnime(raw){
 if(!raw||raw.type&&raw.type!=='ANIME'||raw.isAdult||!id(raw.idMal))return null;
 const malId=String(raw.idMal),date=raw.startDate||{},titles=[raw.title?.english,raw.title?.romaji,raw.title?.native,...(raw.synonyms||[])].map(v=>clean(v,250)).filter(Boolean);
 if(!titles.length)return null;
 const trailer=raw.trailer?.site==='youtube'&&/^[\w-]{11}$/.test(raw.trailer.id||'')?{type:'youtube',youtubeId:raw.trailer.id,title:titles[0]+' trailer',publisher:'AniList trailer listing',source:'https://www.youtube.com/watch?v='+raw.trailer.id,backgroundAllowed:false}:null;
 return {matureContent:contentPolicy.mature(raw),key:'anime-'+malId,kind:'anime',id:malId,mal:true,isAnime:true,anilistId:raw.id,title:titles[0],alternateTitles:[...new Set(titles)],year:date.year?String(date.year):'',releaseDate:date.year&&date.month&&date.day?[date.year,String(date.month).padStart(2,'0'),String(date.day).padStart(2,'0')].join('-'):'',overview:clean(raw.description),rating:raw.averageScore?raw.averageScore/10:0,popularity:raw.popularity,trending:raw.trending,status:raw.status,nextAiringEpisode:raw.nextAiringEpisode,tags:raw.tags||[],poster:image(raw.coverImage?.extraLarge||raw.coverImage?.large),backdrop:image(raw.bannerImage),genres:[...new Set(['Animation',...(raw.genres||[]).map(g=>clean(g,80))])],mediaType:raw.format==='MOVIE'?'movie':'tv',format:raw.format||'',knownEpisodes:raw.status==="RELEASING"&&raw.nextAiringEpisode?.episode?Math.max(0,raw.nextAiringEpisode.episode-1):raw.status==="FINISHED"?(raw.episodes||0):0,totalEpisodes:Number.isInteger(raw.episodes)&&raw.episodes>0?raw.episodes:0,runtime:raw.duration||0,countries:/^[A-Z]{2}$/.test(raw.countryOfOrigin||'')?[raw.countryOfOrigin]:[],languages:[],source:'anilist',seasonsList:[],seasons:0,trailer,metadataCredit:{name:'AniList',url:'https://anilist.co/anime/'+raw.id}};
}
export function createAnimeCatalogue({request=fetch,now=Date.now,spacing=2100,ttl=15*60*1000}={}){
 const cache=new Map(),pending=new Map();let chain=Promise.resolve(),last=0,blockedUntil=0;
 async function query(key,document,variables){
  const hit=cache.get(key);if(hit&&hit.expires>now())return structuredClone(hit.value);
  if(pending.has(key))return pending.get(key).then(structuredClone);
  if(pending.size>=12)throw Error('Please wait for the current anime requests to finish.');
  const run=chain.catch(()=>{}).then(async()=>{
   if(blockedUntil>now())throw Error('The anime index is busy. Please retry in a minute.');
   const delay=Math.max(0,last+spacing-now());if(delay)await new Promise(r=>setTimeout(r,delay));last=now();
   const r=await request(ENDPOINT,{method:'POST',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({query:document,variables}),signal:AbortSignal.timeout(12000)});
   if(r.status===429){blockedUntil=now()+60000;throw Error('The anime index is busy. Please retry in a minute.');}
   if(!r.ok)throw Error('The anime index could not be reached. Retry to refresh it.');
   if(Number(r.headers.get('content-length'))>3000000)throw Error('Anime response exceeded its size limit.');
   const reader=r.body?.getReader();if(!reader)throw Error('Empty anime response.');const parts=[];let size=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>3000000)throw Error('Anime response exceeded its size limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
   const text=new TextDecoder().decode(Buffer.concat(parts));const json=JSON.parse(text);if(json.errors?.length||!json.data)throw Error('The anime index could not complete this request. Retry later.');
   cache.delete(key);cache.set(key,{value:json.data,expires:now()+ttl});while(cache.size>100)cache.delete(cache.keys().next().value);return json.data;
  });chain=run;pending.set(key,run);
  try{return structuredClone(await run);}finally{pending.delete(key);}
 }
 async function browse(options={}){
  const page=Math.max(1,Math.min(500,Math.floor(Number(options.page)||1))),search=String(options.query||'').trim().slice(0,200),genre=GENRES[options.genre]||(/^[A-Za-z -]{2,50}$/.test(options.genre||'')?options.genre:null),year=/^(19|20)\d{2}$/.test(String(options.year||''))?Number(options.year):null;
  if(options.genre&&!genre)return {source:'anilist',items:[],page,hasMore:false,notice:'This genre is not indexed by the anime catalogue. Clear the genre to browse anime.'};
  const variables={page,sort:[options.sort==='trending'?'TRENDING_DESC':options.sort==='rating'?'SCORE_DESC':options.sort==='newest'?'START_DATE_DESC':'POPULARITY_DESC']};
  if(options.tag)variables.tag=String(options.tag).slice(0,80);if(['MOVIE','TV','OVA','ONA','SPECIAL'].includes(options.format))variables.format=options.format;if(['RELEASING','FINISHED','NOT_YET_RELEASED'].includes(options.status))variables.status=options.status;
  if(search)variables.search=search;if(genre&&genre!=='Animation')variables.genre=genre;if(year){variables.after=year*10000;variables.before=(year+1)*10000;}if(options.released){const asDate=t=>Number(new Date(t).toISOString().slice(0,10).replaceAll('-',''));variables.before=Math.min(variables.before||Infinity,asDate(now()+86400000));if(options.sort==='newest')variables.after=Math.max(variables.after||0,asDate(now()-366*86400000));}if(/^[A-Z]{2}$/.test(options.country||''))variables.country=options.country;
  const data=await query('browse:'+JSON.stringify(variables),BROWSE,variables),rows=(data.Page?.media||[]).map(normalizeAnime).filter(Boolean);
  return {source:'anilist',items:rows,page,hasMore:!!data.Page?.pageInfo?.hasNextPage,...(options.language?{notice:'The anime index does not verify original audio language. Titles without that metadata are excluded by your language filter.'}:{})};
 }
 async function rawDetails(malId){const numeric=id(malId);if(!numeric)throw Error('Invalid anime ID.');const data=await query('details:'+numeric,DETAIL,{id:numeric});if(!data.Media||Number(data.Media.idMal)!==numeric)throw Error('No matching anime details were returned.');return data.Media;}
 async function details(malId){const raw=await rawDetails(malId),t=normalizeAnime(raw);t.cast=(raw.characters?.edges||[]).filter(c=>c.node?.name?.full).map(c=>({name:clean(c.node.name.full,160),character:clean(c.role,80).toLowerCase()+' character',photo:image(c.node.image?.large)}));return t;}
 async function episodes(malId,page=1){
  const raw=await rawDetails(malId),count=Math.min(10000,raw.status==="RELEASING"&&raw.nextAiringEpisode?.episode?Math.max(0,raw.nextAiringEpisode.episode-1):raw.status==="NOT_YET_RELEASED"?0:Number.isInteger(raw.episodes)?raw.episodes:0),indexed=new Map();
  for(const e of raw.streamingEpisodes||[]){const match=/^(?:Episode\s+)?(\d+)\s*(?:[-.:]|$)/i.exec(e.title||'');if(match)indexed.set(Number(match[1]),{title:clean(e.title,250),still:image(e.thumbnail)});}
  const n=Math.max(1,Math.min(100,Math.floor(Number(page)||1))),total=count||Math.max(0,...indexed.keys()),end=Math.min(total,n*100),episodes=[];
  for(let i=(n-1)*100+1;i<=end;i++)episodes.push({n:i,title:indexed.get(i)?.title||'Episode '+i,still:indexed.get(i)?.still||'',overview:'',runtime:raw.duration||0});
  return {episodes,page:n,hasMore:end<total,totalEpisodes:count,seasons:[],notice:!count&&!indexed.size?'Episode counts are not yet published for this title.':''};
 }
 async function taxonomy(){const d=await query('taxonomy','query { GenreCollection MediaTagCollection { id name category isAdult } }',{});return {genres:d.GenreCollection||[],tags:d.MediaTagCollection||[]};}
 async function schedule(start,end,page=1){page=Math.max(1,Math.min(100,Number(page)||1));const from=Math.floor(Number(start)/1000),to=Math.floor(Number(end)/1000);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>15*86400)throw Error('Invalid schedule interval.');const d=await query('schedule:'+from+':'+to+':'+page,`query($from:Int,$to:Int,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){id episode airingAt media{${FIELDS}}}}}`,{from,to,page});return {page,entries:(d.Page?.airingSchedules||[]).map(e=>({...e,media:normalizeAnime(e.media)})).filter(e=>e.media),hasMore:!!d.Page?.pageInfo?.hasNextPage};}
 async function relations(malId){const d=await query('relations:'+malId,`query($id:Int){Media(idMal:$id,type:ANIME){relations{edges{relationType node{${FIELDS}}}}}}`,{id:id(malId)});return (d.Media?.relations?.edges||[]).map(e=>({relation:e.relationType,item:normalizeAnime(e.node)})).filter(e=>e.item);}
 async function findEpisodes(malId,search){const q=String(search||'').trim().toLowerCase().slice(0,160);if(q.length<2)return [];const raw=await rawDetails(malId),indexed=(raw.streamingEpisodes||[]).map(e=>{const m=/^(?:Episode\s+)?(\d+)\s*(?:[-.:]|$)/i.exec(e.title||'');return m?{n:Number(m[1]),title:clean(e.title,250),still:image(e.thumbnail),runtime:raw.duration||0}:null;}).filter(Boolean);if(/^\d+$/.test(q)){const n=Number(q),published=raw.status==='RELEASING'&&raw.nextAiringEpisode?.episode?raw.nextAiringEpisode.episode-1:raw.episodes||0;if(n>0&&n<=published)return [indexed.find(e=>e.n===n)||{n,title:'Episode '+n,still:'',runtime:raw.duration||0}];}return indexed.filter(e=>e.title.toLowerCase().includes(q)).slice(0,100);}
 return {browse,details,episodes,taxonomy,schedule,relations,findEpisodes};
}
