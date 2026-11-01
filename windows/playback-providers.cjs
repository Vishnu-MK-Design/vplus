'use strict';
// Native integrations, not an invented list of the extension inventory or servers.
const PROVIDERS=Object.freeze([
 Object.freeze({id:'vidly',name:'Vidly',kinds:['movie','tv','anime'],automatic:true,description:'Movie, series and anime player integration.'}),
 Object.freeze({id:'cinesrc',name:'CineSrc',kinds:['movie','tv'],automatic:true,description:'An alternative movie and series player.'}),
 Object.freeze({id:'vidfast',name:'VidFast',kinds:['movie','tv'],automatic:false,description:'Published movie and series player. Availability is checked when you play.'}),
 Object.freeze({id:'vidlink',name:'VidLink',kinds:['movie','tv','anime'],automatic:false,animeIdentifier:'mal',description:'Published movie, series and MAL anime player. Availability varies by title.'})
]);
const positiveId=v=>/^[1-9][0-9]{0,11}$/.test(String(v??''));
const malId=item=>item?.mal===true&&positiveId(item.id)?String(item.id):positiveId(item?.malId)?String(item.malId):null;
const supports=(id,kind,item)=>PROVIDERS.some(p=>p.id===id&&p.kinds.includes(kind)&&!(p.animeIdentifier==='mal'&&kind==='anime'&&item&&!malId(item)));
const providersFor=(kind,item)=>PROVIDERS.filter(p=>supports(p.id,kind,item)).map(({id,name,automatic})=>({id,name,automatic,available:true}));
const sourceOptionsFor=(kind,item)=>{const rows=providersFor(kind,item);return rows.length?[{id:'auto',name:'Automatic',available:true,reason:'Use a working provider automatically'},...PROVIDERS.map(p=>({id:p.id,name:p.name,available:supports(p.id,kind,item),...(!p.kinds.includes(kind)?{reason:'Not supported for '+kind+' titles'}:p.animeIdentifier==='mal'&&kind==='anime'&&item&&!malId(item)?{reason:'A verified MyAnimeList ID is needed'}:p.automatic===false?{reason:'Manual selection · availability varies by title'}:{})}))]:[];};
const extensionOptions=(registry,installed)=>({installed:!!installed,notice:installed?'These extensions use their own catalogues. No extension streams have been resolved for this title.':'The optional extension engine is not installed in this app. These catalogue entries cannot play this title.',entries:(registry?.providers||[]).map(({id,name,repository})=>({id,name,...(repository?{repositoryName:registry.repositories?.find(r=>r.id===repository)?.name||repository}:{})}))});
module.exports={PROVIDERS,providersFor,supports,sourceOptionsFor,extensionOptions,malId};
