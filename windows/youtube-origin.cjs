'use strict';
const APP_ID='com.vishnu.vidly.desktop';
const APP_ORIGIN='https://'+APP_ID;
const APP_URL=APP_ORIGIN+'/index.html';
const LEGACY_KEYS=Object.freeze(['vidly.catalogueSource','vidly.catalogueFilters','vidly.searchHistory','vidly.filterVersion','vidly.preferences','vidly.playerSource','vidly.audioPreference','vplus.playbackMigration']);
function trailerRequestOptions(request){
 const options={bypassCustomProtocolHandlers:true};let u;try{u=new URL(request.url);}catch{return options;}
 if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)&&u.pathname.startsWith('/embed/')){options.headers=new Headers(request.headers);options.headers.set('Referer',APP_ORIGIN+'/');options.referrer=APP_ORIGIN+'/';}
 return options;
}
function sanitizeLegacyState(input){const result={};for(const key of LEGACY_KEYS){const value=input?.[key];if(typeof value==='string'&&value.length<=20000)result[key]=value;}return result;}
function legacyPreferences(values){
 let raw={};try{raw=JSON.parse(values?.['vidly.preferences']||'{}');}catch{}if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
 const choices={uiScale:[80,90,100,110],textSize:[90,100,110,120],panelSize:['compact','standard','large'],density:['auto','compact','large'],screenMargin:[0,2,4],defaultSource:['auto','vidly','cinesrc'],audioLanguage:['auto','en','ta','hi','te','ml','kn','ja','ko','es','fr','de'],animeAudio:['sub','dub'],seekStep:[5,10,30],controlsTimeout:[0,3500,6500,10000]};
 const booleans=['reducedMotion','resumeByDefault','showRecommendations','showContinue','confirmExit'];const result={};
 for(const [key,allowed]of Object.entries(choices))if(allowed.includes(raw[key]))result[key]=raw[key];
 for(const key of booleans)if(typeof raw[key]==='boolean')result[key]=raw[key];return result;
}
module.exports={APP_ID,APP_ORIGIN,APP_URL,LEGACY_KEYS,trailerRequestOptions,sanitizeLegacyState,legacyPreferences};
