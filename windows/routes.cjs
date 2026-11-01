'use strict';
const {supports,malId}=require('./playback-providers.cjs');
function playback(m){
 const item=m?.item;if(!item||!['movie','tv','anime'].includes(item.kind)||! /^[1-9][0-9]{0,11}$/.test(String(item.id)))throw Error('Invalid title.');
 const season=Number(m.season??1),episode=Number(m.episode??1);if(!Number.isInteger(season)||season<1||season>999||!Number.isInteger(episode)||episode<1||episode>99999)throw Error('Invalid episode.');
 const audio=m.audio||'sub';if(!['sub','dub'].includes(audio))throw Error('Invalid anime audio.');
 const provider=m.provider==='auto'||!m.provider?'vidly':m.provider;if(!supports(provider,item.kind,item))throw Error('This source does not support the title or its available identifiers.');
 const start=Number.isFinite(m.start)?Math.floor(Math.max(0,Math.min(604800,m.start))):0;
 const route=item.kind==='movie'?'movie/'+item.id:item.kind==='tv'?`tv/${item.id}/${season}/${episode}`:`anime/${item.mal?'mal/':''}${item.id}/${episode}/${audio}`;
 let url;
 if(provider==='vidly')url=`https://vidly.pro/${route}?autoplay=1&nextEpisode=0&audioPicker=1&t=${start}`;
 else if(provider==='cinesrc')url=`https://cinesrc.st/embed/${item.kind}/${item.id}?${item.kind==='tv'?`s=${season}&e=${episode}&`:''}autoplay=true&autonext=false&continueprompt=false&t=${start}`;
 else if(provider==='vidfast')url=`https://vidfast.vc/${item.kind==='movie'?'movie/'+item.id:`tv/${item.id}/${season}/${episode}`}?autoPlay=true&nextButton=false&autoNext=false&startAt=${start}`;
 else if(provider==='vidlink')url=`https://vidlink.pro/${item.kind==='anime'?`anime/${malId(item)}/${episode}/${audio}`:item.kind==='movie'?'movie/'+item.id:`tv/${item.id}/${season}/${episode}`}?autoplay=true&nextbutton=false&startAt=${start}`;
 return {item,season,episode,audio,provider,start,url};
}
function navigation(raw,provider){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;if(provider==='cinesrc')return u.hostname==='cinesrc.st'&&/^\/embed\/(movie|tv)\/[0-9]{1,12}\/?$/.test(u.pathname);const movieTv='movie/[1-9][0-9]{0,11}|tv/[1-9][0-9]{0,11}/[1-9][0-9]{0,2}/[1-9][0-9]{0,4}';if(provider==='vidfast')return u.hostname==='vidfast.vc'&&new RegExp('^/('+movieTv+')/?$').test(u.pathname);if(provider==='vidlink')return u.hostname==='vidlink.pro'&&new RegExp('^/('+movieTv+'|anime/[1-9][0-9]{0,11}/[1-9][0-9]{0,4}/(sub|dub))/?$').test(u.pathname);return provider==='vidly'&&u.hostname==='vidly.pro'&&/^\/(movie\/[0-9]{1,12}|tv\/[0-9]{1,12}\/[0-9]{1,3}\/[0-9]{1,5}|anime\/(mal\/)?[0-9]{1,12}\/[0-9]{1,5}\/(sub|dub))\/?$/.test(u.pathname);}catch{return false;}}
const adHosts=['doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com','adsystem.com','amazon-adsystem.com','popads.net','popcash.net','propellerads.com','adsterra.com','exoclick.com','exosrv.com','trafficjunky.net','juicyads.com','hilltopads.net','onclickads.net','a.cineflix.st','a2.cineflix.st'];
function matchesPlayback(raw,active){if(!active||!navigation(raw,active.provider))return false;try{const actual=new URL(raw),expected=new URL(active.url);return actual.origin===expected.origin&&actual.pathname===expected.pathname;}catch{return false;}}
function blocked(raw){try{const h=new URL(raw).hostname;return adHosts.some(d=>h===d||h.endsWith('.'+d));}catch{return true;}}
module.exports={playback,navigation,matchesPlayback,blocked};
