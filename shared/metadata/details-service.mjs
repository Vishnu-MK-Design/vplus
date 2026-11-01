import {tvmaze} from './tvmaze.mjs';
export function createDetailsService({catalogue,sourceCatalog,tmdb}){
 const identities=new Map();
 async function identify(item){if(/^tt[0-9]{7,10}$/.test(item.imdbId||''))return item;if(identities.has(item.key))return {...item,...identities.get(item.key)};const r=await catalogue.browse({section:'search',query:item.title,kind:item.kind,page:1});const match=r.items.find(t=>t.key===item.key);if(!match)throw Error('No exact title mapping.');identities.set(item.key,match);return {...item,...match};}
 return {async details(item){let base={...item};try{base={...base,...(item.source==='streamflix'?await sourceCatalog.details(item.id,item.kind):item.imdbId?await catalogue.details(item.imdbId,item.kind):await catalogue.details((await identify(item)).imdbId,item.kind))};}catch{}
  if(tmdb)try{base={...base,...await tmdb().details(item.id,item.kind)};}catch{}
  if(item.kind==='tv')try{base=await identify(base);const rich=await tvmaze.details(base.imdbId);const {episodes,...fields}=rich;base={...base,...fields,seasons:rich.seasonsList.length||base.seasons};}catch{base.metadataNotice='Some additional title information is unavailable. Retry later.';}
  return base;
 },async episodes(item,season){if(item.kind==='tv')try{const mapped=await identify(item);const result=await tvmaze.episodes(mapped.imdbId,season);if(result.episodes.length)return result;}catch{}if(item.imdbId)return catalogue.episodes(item.imdbId,season);throw Error('Episode metadata unavailable.');}};
}
