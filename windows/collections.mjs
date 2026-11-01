// Canonical collection definitions shared by rows, listings and featured candidates.
import {normalizePublic} from './generated/tools/public-catalog.mjs';
export const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const SHELF_TAGS=new Set(['Isekai','Iyashikei','Martial Arts','School','Historical','Shounen','Shoujo','Seinen','Josei']);
export function animeTaxonomy(raw={}){
 const genres=[...new Set((raw.genres||[]).filter(n=>typeof n==='string'&&n.trim()&&n!=='Hentai'))].map(name=>({id:name,name}));
 const tags=[...new Map((raw.tags||[]).filter(t=>!t.isAdult&&Number.isInteger(t.id)&&t.id>0&&typeof t.name==='string'&&t.name.trim()&&typeof t.category==='string').map(t=>[t.id,{id:t.id,name:t.name,category:t.category,navigationOnly:!SHELF_TAGS.has(t.name)&&!/demographic/i.test(t.category)}])).values()];
 return {genres,tags};
}
export function collectionDefinitions(taxonomy={movie:[],tv:[],anime:[],tags:[]}){
 const rows=[];const add=(id,title,kind,filters={},pages=[kind==='movie'?'movies':kind==='tv'?'series':'anime','home'])=>rows.push({id,title,kind,filters,pages});
 for(const [kind,name] of [['movie','Movies'],['tv','Series'],['anime','Anime']]){
  add('trending-'+slug(name),'Trending '+name,kind,{mode:'trending'});
  add('popular-'+slug(name),'Popular '+name,kind,{mode:'popular'});
  add('new-'+slug(name),'New '+name,kind,{mode:'newest',released:true});
  add('top-rated-'+slug(name),'Top Rated '+name,kind,{mode:'rating',released:true});
 }
 add('upcoming-movies','Upcoming Movies','movie',{mode:'newest',upcoming:true},['movies']);
 add('airing-series','Currently Airing Series','tv',{mode:'airing'},['series']);
 for(const [code,name] of [['ta','Tamil'],['hi','Hindi'],['te','Telugu'],['ml','Malayalam'],['kn','Kannada']]){
  add('new-'+slug(name)+'-movies','New '+name+' Movies','movie',{mode:'newest',language:code,released:true});
  add('popular-'+slug(name)+'-movies','Popular '+name+' Movies','movie',{mode:'popular',language:code,released:true});
 }
 add('new-indian-movies','New Indian Movies','movie',{mode:'newest',country:'IN',released:true});
 add('popular-indian-movies','Popular Indian Movies','movie',{country:'IN',mode:'popular',released:true});
 add('indian-action-movies','Indian Action Movies','movie',{country:'IN',genre:'28',genreName:'Action',mode:'popular',released:true});
 for(const [code,name] of [['IN','Indian'],['KR','Korean']])add(slug(name)+'-series',name+' Series','tv',{country:code,mode:'popular'});
 add('korean-dramas','Korean Dramas','tv',{country:'KR',genre:'18',genreName:'Drama',mode:'popular'});
 for(const [code,name] of [['ta','Tamil'],['hi','Hindi']])add(slug(name)+'-series',name+' Series','tv',{language:code,mode:'popular'});
 for(const kind of ['movie','tv','anime'])for(const g of taxonomy[kind]||[]){add(slug(g.name)+'-'+(kind==='movie'?'movies':kind==='tv'?'series':'anime'),g.name+' '+(kind==='movie'?'Movies':kind==='tv'?'Series':'Anime'),kind,{mode:'popular',genre:String(g.id),genreName:g.name},[kind==='movie'?'movies':kind==='tv'?'series':'anime']);if(kind==='anime'&&g.name==='Ecchi')rows.at(-1).navigationOnly=true;}
 const genres=new Map();for(const d of rows.filter(d=>d.filters.genreName&&!d.filters.country&&!d.navigationOnly)) {const g=d.filters.genreName;if(!genres.has(g))genres.set(g,[]);genres.get(g).push(d.id);}for(const [name,children] of genres)rows.push({id:slug(name)+'-collection',title:name,kind:'all',filters:{mode:'popular'},pages:['home'],children});
 for(const t of taxonomy.tags||[]){const base=slug(t.name)+'-anime',collision=rows.some(d=>d.id===base);if(collision&&rows.some(d=>d.id===base&&d.filters.genreName===t.name))continue;add(collision?'anime-tag-'+t.id:base,t.name+' Anime','anime',{mode:'popular',tag:t.name,tagId:t.id,category:t.category},['anime']);rows.at(-1).navigationOnly=!!t.navigationOnly;}
 add('currently-airing-anime','Currently Airing Anime','anime',{status:'RELEASING',mode:'popular'},['anime']);
 add('completed-anime','Completed Anime','anime',{status:'FINISHED',mode:'popular'},['anime']);
 add('anime-movies','Anime Movies','anime',{format:'MOVIE',mode:'popular'},['anime']);
 return [...new Map(rows.map(r=>[r.id,r])).values()];
}
export function eligible(item,definition,now=Date.now()){
 if(!item||item.kind!==definition.kind)return false;const f=definition.filters||{},rawDate=String(item.releaseDate||''),date=/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(rawDate)?rawDate.slice(0,10):'';
 const known=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date)),released=known&&Date.parse(date)<=now;
 if(f.released&&!released||f.upcoming&&(!known||released))return false;
 if(f.released&&f.mode==='newest'&&Date.parse(date)<now-366*86400000)return false;
 if(f.language&&item.originalLanguage!==f.language&&!item.languages?.includes(f.language))return false;
 if(f.country&&!item.countries?.includes(f.country))return false;
 if(f.genreName&&!(item.genres||[]).includes(f.genreName))return false;
 if(f.tag&&!item.tags?.some(t=>t.name===f.tag&&t.rank>=50))return false;
 return (!f.status||item.status===f.status)&&(!f.format||item.format===f.format);
}
export function selectFeatured(groups,kind='all',limit=10){
 const seen=new Set(),queues=groups.map(g=>g.filter(t=>t.backdrop&&t.overview&&t.year&&(kind==='all'||t.kind===kind)));
 const result=[];for(let n=0;result.length<limit&&queues.some(q=>q.length);n++)for(const q of queues){const t=q.shift();if(t&&!seen.has(t.key)){seen.add(t.key);result.push(t);}if(result.length===limit)break;}return result;
}
export function createCollections({catalogue,tmdb,anime,token=()=>'',request=fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let definitions=[];
 async function cached(key,fn){const old=cache.get(key);if(old&&old.expires>now())return structuredClone(old.data);if(pending.has(key))return structuredClone(await pending.get(key));const p=fn();pending.set(key,p);try{const data=await p;cache.set(key,{data,expires:now()+15*60000});while(cache.size>120)cache.delete(cache.keys().next().value);return structuredClone(data);}finally{pending.delete(key);}}
 async function tmdbJson(route){const secret=token();if(!secret)throw Error('TMDB is not configured.');const r=await request('https://api.themoviedb.org/3'+route,{headers:{Accept:'application/json',Authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('TMDB could not connect.');const text=await r.text();if(text.length>3000000)throw Error('Metadata response too large.');return JSON.parse(text);}
 async function publicJson(route){return cached('public:'+route,async()=>{let url='https://v3-cinemeta.strem.io'+route;for(let n=0;n<3;n++){const r=await request(url,{redirect:'manual',signal:AbortSignal.timeout(12000)});if([301,302,307,308].includes(r.status)){const next=new URL(r.headers.get('location'),url);if(next.protocol!=='https:'||next.username||next.password||!['v3-cinemeta.strem.io','cinemeta-catalogs.strem.io'].includes(next.hostname))throw Error('Unsupported metadata redirect.');url=next.href;continue;}if(!r.ok)throw Error('Public catalogue unavailable.');const text=await r.text();if(text.length>3000000)throw Error('Metadata response too large.');return JSON.parse(text);}throw Error('Metadata redirect did not complete.');});}
 async function manifest(){return cached('manifest',async()=>{
  const taxonomy={movie:[],tv:[],anime:[],tags:[]},limits=[];
  await Promise.all(['movie','tv'].map(async kind=>{try{taxonomy[kind]=(await tmdbJson('/genre/'+kind+'/list?language=en')).genres||[];}catch{try{const r=await publicJson('/manifest.json'),type=kind==='tv'?'series':'movie';taxonomy[kind]=(r.catalogs?.find(c=>c.type===type&&c.id==='top')?.extra?.find(e=>e.name==='genre')?.options||[]).map(name=>({id:name,name}));}catch{limits.push(kind+' taxonomy could not refresh.');}}}));
  try{const a=animeTaxonomy(await anime.taxonomy());taxonomy.anime=a.genres;taxonomy.tags=a.tags;}catch{limits.push('Anime taxonomy could not refresh.');}
  definitions=collectionDefinitions(taxonomy);return {collections:definitions,limits,unsupported:['Recently Added/Updated requires a reliable addition/update timestamp.','Personal recommendations require recommendation metadata.','Bollywood and web-series labels require industry/distribution evidence.','Filler classifications are not supplied by the current metadata adapters.']};
 });}
 async function browse(id,page=1,options={}){
  await manifest();const d=definitions.find(d=>d.id===id);if(!d)throw Error('Unknown collection.');page=Math.max(1,Math.min(500,Number(page)||1));
  const order=['trending','airing'].includes(d.filters.mode)?d.filters.mode:['popular','rating','newest'].includes(options.sort)?options.sort:d.filters.mode;return cached(id+':'+page+':'+order,async()=>{const f=d.filters;let result;
   if(d.children){const groups=await Promise.all(d.children.map(child=>browse(child,page,options).catch(()=>({items:[],hasMore:false}))));const seen=new Set(),items=[],queues=groups.map(g=>[...g.items]);while(queues.some(q=>q.length))for(const q of queues){const t=q.shift();if(t&&!seen.has(t.key)){seen.add(t.key);items.push(t);}}return {definition:d,items,page,hasMore:groups.some(g=>g.hasMore),source:'mixed'};}
   if(d.kind==='anime')result=await anime.browse({...f,genre:f.genreName||'',sort:order,page});
   else {try{const p=new URLSearchParams({page:String(page),include_adult:'false',language:'en-US'}),type=d.kind;let route='/discover/'+type;
    if(f.mode==='trending')route='/trending/'+type+'/week';else if(f.mode==='airing')route='/tv/on_the_air';
    else{p.set('sort_by',order==='newest'?(type==='movie'?'primary_release_date.desc':'first_air_date.desc'):order==='rating'?'vote_average.desc':'popularity.desc');if(order==='rating')p.set('vote_count.gte','100');if(f.language)p.set('with_original_language',f.language);if(f.country)p.set('with_origin_country',f.country);if(f.genre&&/^\d+$/.test(f.genre))p.set('with_genres',f.genre);const date=new Date(now()).toISOString().slice(0,10);p.set(type==='movie'?'primary_release_date.'+(f.upcoming?'gte':'lte'):'first_air_date.lte',date);}
    if(f.upcoming)p.set('sort_by','primary_release_date.asc');const raw=await tmdbJson(route+'?'+p),items=(raw.results||[]).map(r=>({...tmdb.normalize(r,type),genres:(r.genre_ids||[]).map(id=>definitions.find(d=>d.kind===type&&d.filters.genre===String(id))?.filters.genreName).filter(Boolean),voteCount:r.vote_count,popularity:r.popularity,countries:r.origin_country||(f.country?[f.country]:[])}));result={items,hasMore:page<Math.min(500,raw.total_pages||1),source:'tmdb'};
   }catch{if(['trending','airing'].includes(f.mode)||f.upcoming)return {definition:d,items:[],hasMore:false,unavailable:'This collection requires metadata unavailable from the current connection.'};if(f.genreName&&!f.language&&!f.country){const raw=await publicJson('/catalog/'+(d.kind==='tv'?'series':'movie')+'/'+(order==='rating'?'imdbRating':'top')+'/genre='+encodeURIComponent(f.genreName)+'&skip='+((page-1)*50)+'.json');result={items:(raw.metas||[]).map(t=>normalizePublic(t,d.kind==='tv'?'series':'movie')).filter(Boolean),hasMore:!!raw.hasMore,source:'cinemeta'};}else result=await catalogue.browse({kind:d.kind,page,sort:order||'popular',language:f.language||'',country:f.country||''});}}
   const items=result.items.filter(t=>eligible(t,d,now()));if(order==='newest')items.sort((a,b)=>String(b.releaseDate).localeCompare(String(a.releaseDate)));if(order==='rating')items.sort((a,b)=>(b.rating||0)-(a.rating||0));return {...result,definition:d,items,page};
  });
 }
 return {manifest,browse};
}
