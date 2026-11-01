'use strict';
// Anime is a catalogue category; numeric playback identities retain their namespace.
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../cinematic/model.js');
const mal=(id,extra={})=>({key:'anime-'+id,id:String(id),kind:'anime',mal:true,isAnime:true,source:'jikan',title:'Anime '+id,mediaType:'tv',year:'2022',...extra});
const movie=(id,extra={})=>({key:'movie-'+id,id:String(id),kind:'movie',title:'Movie '+id,...extra});
const animeMovie=mal(48903,{title:'Dragon Ball Super: Super Hero',mediaType:'movie',titleEnglish:'Dragon Ball Super: Super Hero',aliases:['Dragon Ball Super: Super Hero']});

test('anime category helpers are available without replacing the shared model',()=>{
 for(const name of ['isAnime','categoryMatches','mergeAnimeSources'])assert.equal(typeof M[name],'function',name+' is available');
 for(const name of ['valid','matches','merge','filter','queryMatches'])assert.equal(typeof M[name],'function',name+' remains available');
});

test('explicit anime metadata includes movie and TV anime without changing playback kind',()=>{
 const rows=[mal(44511),movie(610150,{title:animeMovie.title,isAnime:true,year:'2022'}),{key:'tv-12609',id:'12609',kind:'tv',title:'Dragon Ball',isAnime:true}];
 for(const row of rows){assert.equal(M.isAnime(row),true);assert.equal(M.matches(row,{kind:'anime'}),true);assert.equal(M.matches(row,{kind:row.kind}),true);assert.equal(M.valid(row),true);}
 assert.equal(M.matches(rows[1],{kind:'tv'}),false);
 assert.equal(M.matches(rows[2],{kind:'movie'}),false);
 assert.equal(rows[0].key,'anime-44511');assert.equal(rows[1].key,'movie-610150');assert.equal(rows[2].key,'tv-12609');
});

test('animation genre and a Japanese language alone do not invent an anime classification',()=>{
 const pixar=movie(508947,{title:'Turning Red',genres:['Animation','Family'],genreIds:[16,10751],originalLanguage:'en',countries:['US']});
 const unknown=movie(999,{title:'Unknown animated film',genres:['Animation'],genreIds:[16],originalLanguage:'ja'});
 for(const row of [pixar,unknown,movie(1),null])assert.equal(M.isAnime(row),false);
 assert.equal(M.matches(pixar,{kind:'anime'}),false);assert.equal(M.matches(pixar,{kind:'movie',genre:'16'}),true);
});

test('verified exact title, known year and media type merge live anime into an existing movie identity',()=>{
 const tmdb=movie(610150,{title:animeMovie.title,year:'2022',poster:'art/db-super-hero.jpg',imdbId:'tt14614892'});
 const input=JSON.stringify([tmdb,animeMovie]);
 const rows=M.mergeAnimeSources([tmdb],[animeMovie]);
 assert.equal(rows.length,1);assert.equal(rows[0].key,tmdb.key);assert.equal(rows[0].kind,'movie');assert.equal(rows[0].id,'610150');
 assert.equal(M.isAnime(rows[0]),true);assert.equal(M.matches(rows[0],{kind:'anime'}),true);
 assert.equal(rows[0].poster,tmdb.poster);assert.equal(rows[0].imdbId,tmdb.imdbId);
 assert.equal(JSON.stringify([tmdb,animeMovie]),input,'Source objects remain unchanged');
 assert.equal(rows.some(t=>t.key==='anime-610150'),false,'A TMDB ID must never become a MAL route');
});

test('known bundled MAL identities win a verified join without interpreting a TMDB ID as MAL',()=>{
 const local=mal(44511,{title:'Chainsaw Man',poster:'art/chainsaw-man.jpg',year:'2022'});
 const tv={key:'tv-114410',id:'114410',kind:'tv',title:'Chainsaw Man',year:'2022'};
 const rows=M.mergeAnimeSources([local],[tv],[{...local,poster:'https://example.test/poster.jpg'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].key,'anime-44511');assert.equal(rows[0].id,'44511');assert.equal(rows[0].kind,'anime');assert.equal(rows[0].mal,true);
 assert.equal(rows[0].poster,local.poster);assert.equal(M.valid(rows[0]),true);
});

test('matching verified aliases handles localized titles while preserving exact type and year',()=>{
 const tmdb=movie(610150,{title:'Dragon Ball Super: Super Hero',year:'2022'});
 const localized={...animeMovie,title:'Dragon Ball Super: Super Hero (Japanese)',aliases:['Dragon Ball Super: Super Hero']};
 const rows=M.mergeAnimeSources([tmdb],[localized]);
 assert.equal(rows.length,1);assert.equal(rows[0].key,tmdb.key);assert.equal(M.isAnime(rows[0]),true);
});

test('ambiguous names, missing years and conflicting types never silently collapse playback identities',()=>{
 for(const other of [
  movie(2,{title:animeMovie.title,year:'2021'}),
  movie(3,{title:animeMovie.title}),
  {key:'tv-4',id:'4',kind:'tv',title:animeMovie.title,year:'2022'},
  movie(5,{title:'Dragon Ball Super',year:'2022'}),
 ]){
  const rows=M.mergeAnimeSources([other],[animeMovie]);assert.equal(rows.length,2,other.key+' remains distinct');
  assert.equal(rows.some(t=>t.key===other.key),true);assert.equal(rows.some(t=>t.key===animeMovie.key),true);
 }
});

test('merged anime pages deduplicate identities and retain verified classification on later detail updates',()=>{
 const a=mal(1,{title:'Cowboy Bebop',year:'1998'}),b=mal(2,{title:'Cowboy Bebop: The Movie',year:'2001',mediaType:'movie'});
 const page1=[a,b],page2=[{...a,rating:9.1},mal(3,{title:'Trigun',year:'1998'})];
 const rows=M.mergeAnimeSources(page1,page2);
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(t=>t.key)).size,3);assert.equal(rows.find(t=>t.key===a.key).rating,9.1);
 const classified=movie(610150,{isAnime:true,title:animeMovie.title,year:'2022'});
 const details=M.merge([classified],[{...classified,isAnime:undefined,overview:'Actual metadata update'}]);
 assert.equal(M.isAnime(details[0]),true,'A sparse detail response does not erase verified anime classification');
});

test('Anime search and filters form the same metadata intersection as other catalogue kinds',()=>{
 const good=mal(48903,{...animeMovie,genres:['Action','Adventure'],genreIds:[28,12],languages:['ja'],originalLanguage:'ja',countries:['JP'],rating:8.1});
 const rows=[good,mal(10,{...good,key:'anime-10',id:'10',year:'2021'}),mal(11,{...good,key:'anime-11',id:'11',countries:['US']}),movie(12,{title:'Turning Red',genres:['Animation'],genreIds:[16],year:'2022',languages:['ja'],countries:['JP']})];
 const f={kind:'anime',year:'2022',genre:'28',language:'ja',country:'JP'};
 assert.deepEqual(M.filter(rows,f).map(t=>t.key),['anime-48903']);
 assert.equal(M.queryMatches(good.title,'dragon ball'),true);assert.equal(M.matches(good,{kind:'all'}),true);
 assert.equal(M.matches(mal(13),{kind:'anime',country:'JP'}),false,'Unknown metadata does not pass an active country filter');
});
