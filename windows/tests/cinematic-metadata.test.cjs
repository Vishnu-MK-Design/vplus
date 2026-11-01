'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {APP_ID,APP_URL,APP_ORIGIN,LEGACY_KEYS,trailerRequestOptions,sanitizeLegacyState,legacyPreferences}=require('../youtube-origin.cjs');
const moduleReady=import('../cinematic-metadata.mjs');
const title={key:'movie-99999',id:'99999',kind:'movie',imdbId:'tt1234567',title:'A real catalogue title',year:'2023'};
const raw={imdb_id:title.imdbId,id:title.imdbId,type:'movie',moviedb_id:title.id,name:title.title,year:'2023',cast:['First Actor','Second Actor'],trailers:[{source:'aBcDefGh_12',type:'Trailer'}],trailerStreams:[{ytId:'aBcDefGh_12',title:'Trailer'},{ytId:'https://bad.invalid',title:'bad'}]};
const response=j=>new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}});

test('native trailer identity uses the existing app ID, not a third-party referrer',()=>{
 assert.equal(APP_ID,'com.vishnu.vidly.desktop');assert.equal(APP_URL,APP_ORIGIN+'/index.html');
 const options=trailerRequestOptions({url:'https://www.youtube.com/embed/aBcDefGh_12',headers:new Headers()});
 assert.equal(options.headers.get('Referer'),APP_ORIGIN+'/');assert.equal(options.bypassCustomProtocolHandlers,true);
});
test('identity injection applies only to official embed endpoints',()=>{
 for(const url of ['https://www.youtube.com/watch?v=aBcDefGh_12','https://evil.invalid/embed/aBcDefGh_12','https://www.youtube.com.evil.invalid/embed/aBcDefGh_12'])assert.equal(trailerRequestOptions({url}).headers,undefined);
 assert.equal(trailerRequestOptions({url:'https://www.youtube-nocookie.com/embed/aBcDefGh_12',headers:{}}).referrer,APP_ORIGIN+'/');
});
test('legacy migration allowlist excludes tokens, saved lists, arbitrary keys and oversized values',()=>{
 const input={'vidly.catalogueSource':'streamflix','vidly.searchHistory':'["Dune"]','vidly.preferences':'{}','vidly.saved':'private','vidly.tmdbToken':'secret','vplus.random':'no','vidly.catalogueFilters':'x'.repeat(20001)};
 const clean=sanitizeLegacyState(input);assert.deepEqual(Object.keys(clean).sort(),['vidly.catalogueSource','vidly.preferences','vidly.searchHistory'].sort());assert.equal(LEGACY_KEYS.length,8);
});
test('legacy preferences retain only known values and fill gaps without replacing native choices',()=>{
 const migrated=legacyPreferences({'vidly.preferences':JSON.stringify({textSize:120,density:'compact',audioLanguage:'ta',defaultSource:'cinesrc',reducedMotion:true,token:'never migrate',arbitrary:'no'})});
 assert.deepEqual({...migrated,defaultSource:'auto'},{textSize:120,density:'compact',audioLanguage:'ta',defaultSource:'auto',reducedMotion:true});assert.equal(legacyPreferences({'vidly.preferences':'not json'}).token,undefined);
});
test('cast normalization removes unsafe photos, duplicate names and markup',async()=>{
 const {sanitizeCast}=await moduleReady;assert.deepEqual(sanitizeCast([{name:'<b>Actor</b>',photo:'http://static.tvmaze.com/a.jpg'},{name:'Actor',photo:'https://evil.invalid/a.jpg'},{name:'Next',photo:'cinematic-media/next.jpg',character:'<i>Role</i>'}]),[{name:'Actor',character:'',photo:''},{name:'Next',character:'Role',photo:'cinematic-media/next.jpg'}]);
 assert.equal(sanitizeCast([{name:'Lupita Nyong&apos;o'}])[0].name,"Lupita Nyong'o");
});
test('trailer normalizers accept actual IDs and explicitly disallow iframe-background assumptions',async()=>{
 const {normalizeTrailerCandidates,normalizeTmdbTrailers}=await moduleReady;
 const rows=normalizeTrailerCandidates(raw);assert.equal(rows.length,1);assert.equal(rows[0].youtubeId,'aBcDefGh_12');assert.equal(rows[0].backgroundAllowed,false);assert.equal(rows[0].type,'youtube');
 assert.equal(normalizeTmdbTrailers({results:[{site:'Vimeo',type:'Trailer',key:'aBcDefGh_12'},{site:'YouTube',type:'Clip',key:'aBcDefGh_12'},{site:'YouTube',type:'Trailer',key:'bBcDefGh_12',official:true}]}).length,1);
});
test('live title outside bundled collection gets real cast and trailer metadata',async()=>{
 const {createCinematicMetadata}=await moduleReady;let requests=0;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,request:async()=>{requests++;return response({meta:raw});}});
 const result=await service.details(title);assert.equal(requests,1);assert.equal(result.cast[0].name,'First Actor');assert.equal(result.trailer.youtubeId,'aBcDefGh_12');assert.equal(result.castCredit.url,'https://www.imdb.com/title/tt1234567/');
});
test('numeric/IMDb mismatches cannot supply another title cast or trailer',async()=>{
 const {createCinematicMetadata}=await moduleReady;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,request:async()=>response({meta:{...raw,moviedb_id:'42'}})});
 const result=await service.details(title);assert.deepEqual(result.cast,[]);assert.equal(result.trailer,null);
});
test('requests coalesce, cached objects are cloned, and explicit refresh revalidates',async()=>{
 const {createCinematicMetadata}=await moduleReady;let calls=0;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,request:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return response({meta:raw});}});
 const [first,second]=await Promise.all([service.details(title),service.details(title)]);assert.equal(calls,1);first.cast[0].name='Changed';assert.equal(second.cast[0].name,'First Actor');assert.equal((await service.details(title)).cast[0].name,'First Actor');assert.equal(calls,1);await service.details(title,{refresh:true});assert.equal(calls,2);
});
test('unsupported network redirects are refused without forwarding credentials',async()=>{
 const {createCinematicMetadata}=await moduleReady;const destinations=[];
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,token:()=> 'test-token',request:async url=>{destinations.push(url);return new Response(null,{status:302,headers:{location:'https://evil.invalid/capture'}});}});
 const result=await service.details(title);assert.equal(result.trailer,null);assert.ok(destinations.every(u=>!u.startsWith('https://evil.invalid')));
});
test('response byte limits and network failures retain the known title without false metadata',async()=>{
 const {createCinematicMetadata}=await moduleReady;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,request:async()=>new Response('{}',{headers:{'content-length':'2000001'}})});
 const result=await service.details(title);assert.equal(result.key,title.key);assert.deepEqual(result.cast,[]);assert.equal(result.trailer,null);
});
test('movie photos require one exact person match and preserve metadata attribution',async()=>{
 const {createCinematicMetadata}=await moduleReady;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},request:async url=>url.startsWith('https://api.tvmaze.com/')?response([{person:{name:url.includes('First')?'First Actor':'Second Actor',image:{medium:'https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg'}}}]):response({meta:raw})});
 const result=await service.details(title);assert.equal(result.cast[0].photo,'https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg');assert.equal(result.castCredit.photoSource,'TVmaze');assert.equal(result.castCredit.photoLicense,'CC BY-SA');
});
test('ambiguous person names keep initials instead of guessing a photo',async()=>{
 const {createCinematicMetadata}=await moduleReady;
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},request:async url=>url.startsWith('https://api.tvmaze.com/')?response([{person:{name:'First Actor',image:{medium:'https://static.tvmaze.com/a.jpg'}}},{person:{name:'First Actor',image:{medium:'https://static.tvmaze.com/b.jpg'}}}]):response({meta:raw})});
 assert.equal((await service.details(title)).cast[0].photo,'');
});
test('the 23 source identities retain attributed fallback cast without bundled commercial portraits',async()=>{
 const fallback=JSON.parse(fs.readFileSync(path.join(__dirname,'../cinematic-fallback.json'),'utf8')).records;
 assert.equal(Object.keys(fallback).length,23);for(const [key,row]of Object.entries(fallback)){assert.equal(key,row.key);assert.ok(row.cast.length);assert.match(row.imdbId,/^tt\d{7,10}$/);for(const c of row.cast)assert.ok(!c.photo||c.photo.startsWith('https://')); }
});
test('known official trailer wins over a duplicate catalogue listing and works offline with attributed cast',async()=>{
 const {createCinematicMetadata}=await moduleReady;const item={key:'movie-280180',kind:'movie',id:'280180',title:'Beverly Hills Cop: Axel F',year:'2024'};
 const service=createCinematicMetadata({detailsService:{details:async item=>item},photos:false,request:async()=>{throw Error('offline');}});
 const result=await service.details(item);assert.equal(result.trailer.youtubeId,'KoxhkE_U3Ww');assert.equal(result.trailer.title,'Official trailer · Netflix');assert.equal(result.cast[0].character,'Axel Foley');assert.equal(result.cast[0].photo,'');assert.match(result.castCredit.url,/netflix.com/);
});
test('invalid title identities are rejected before any request',async()=>{
 const {createCinematicMetadata}=await moduleReady;const service=createCinematicMetadata({detailsService:{details:async item=>item},request:()=>assert.fail('No request allowed')});
 for(const item of [{...title,id:'../bad'},{...title,key:'movie-1'},{...title,kind:'arbitrary'}])await assert.rejects(service.details(item),/Invalid title/);
});
test('licensed background trailer is restricted to the verified Sintel identity',async()=>{
 const {licensedTitleIdentity,licensedTrailerFor}=await moduleReady;const sintel=licensedTitleIdentity(' Sintel ');assert.equal(sintel.key,'movie-45745');assert.equal(sintel.imdbId,'tt1727587');
 const trailer=licensedTrailerFor(sintel);assert.equal(trailer.type,'video');assert.equal(trailer.backgroundAllowed,true);assert.equal(trailer.url,'https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4');assert.equal(trailer.credit.license,'CC BY 3.0');assert.equal(trailer.credit.name,'© copyright Blender Foundation | durian.blender.org');
 for(const changed of [{...sintel,key:'movie-693134'},{...sintel,id:'693134'},{...sintel,imdbId:'tt15239678'},{...sintel,title:'Dune: Part Two'},{...sintel,year:'2024'}])assert.equal(licensedTrailerFor(changed),null);
 for(const query of ['Dune','Sintel 2','Interstellar',''])assert.equal(licensedTitleIdentity(query),null);
});
test('actual Sintel metadata chooses the licensed direct trailer ahead of YouTube candidates',async()=>{
 const {createCinematicMetadata,licensedTitleIdentity}=await moduleReady;const sintel=licensedTitleIdentity('Sintel');
 const service=createCinematicMetadata({detailsService:{details:async item=>item},fallback:{},photos:false,request:async()=>response({meta:{...raw,imdb_id:sintel.imdbId,id:sintel.imdbId,moviedb_id:sintel.id,name:sintel.title,year:sintel.year}})});
 const result=await service.details(sintel);assert.equal(result.trailer.type,'video');assert.equal(result.trailerCandidates[0].credit.license,'CC BY 3.0');assert.ok(result.trailerCandidates.some(c=>c.type==='youtube'));
});
