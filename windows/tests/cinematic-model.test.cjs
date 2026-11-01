'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../cinematic/model.js');
const title=(id,extra={})=>({key:'movie-'+id,id:String(id),kind:'movie',title:'Title '+id,...extra});

test('TV genre families preserve the actual TMDB television mapping',()=>{
 const tv={key:'tv-9',id:'9',kind:'tv',genres:['Action & Adventure','Sci-Fi & Fantasy'],genreIds:[10759,10765]};
 assert.equal(M.matches(tv,{genre:'28'}),true);
 assert.equal(M.matches(tv,{genre:'12'}),true);
 assert.equal(M.matches(tv,{genre:'878'}),true);
 assert.equal(M.matches(tv,{genre:'14'}),true);
 assert.equal(M.matches(tv,{genre:'35'}),false);
 assert.equal(M.matches({...tv,genres:[],genreIds:[]},{genre:'28'}),false);
});

test('title matching accepts punctuation and accents without returning unrelated results',()=>{
 assert.equal(M.queryMatches('Spider-Man: Across the Spider-Verse','spider man'),true);
 assert.equal(M.queryMatches('Amélie','amelie'),true);
 assert.equal(M.queryMatches('தமிழ் திரைப்படம்','தமிழ்'),true);
 assert.equal(M.queryMatches('Interstellar','Sintel'),false);
 assert.equal(M.queryMatches('Unrelated title','தமிழ்'),false);
});

test('numeric playback identity rejects IMDb identifiers and mismatched keys',()=>{
 assert.equal(M.valid(title(12)),true);
 for(const value of [null,{},title('tt22084616'),title(0),title(-1),title('1/2'),title('1234567890123'),title(12,{key:'movie-13'}),title(12,{kind:'documentary'})])assert.equal(M.valid(value),false);
 assert.equal(M.valid({key:'tv-100088',id:'100088',kind:'tv'}),true);
 assert.equal(M.valid({key:'anime-44511',id:'44511',kind:'anime'}),true);
});

test('bundled and live titles merge by identity, retain local artwork and update known metadata',()=>{
 const bundled=title(12,{poster:'art/movie-12.jpg',backdrop:'art/movie-12-backdrop.jpg',overview:'Existing synopsis',imdbId:'tt1234567'});
 const live=title(12,{poster:'https://image.tmdb.org/new.jpg',backdrop:'',overview:'',imdbId:'',rating:8,cast:[{name:'Actor'}]});
 const rows=M.merge([bundled],[live,title(13)], [{kind:'movie',id:'tt1234567',key:'movie-tt1234567'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].poster,bundled.poster);assert.equal(rows[0].backdrop,bundled.backdrop);
 assert.equal(rows[0].overview,bundled.overview);assert.equal(rows[0].imdbId,bundled.imdbId);assert.equal(rows[0].rating,8);assert.deepEqual(rows[0].cast,[{name:'Actor'}]);
 assert.notEqual(rows[0],bundled);
});

test('country, language, year, genre and type form an intersection; unknown values never pass active filters',()=>{
 const match=title(1,{year:'2024',genres:['Drama'],languages:['en'],countries:['US']});
 const rows=[match,title(2,{year:'2024',genres:['Drama'],languages:['fr'],countries:['US']}),title(3,{year:'2024',genres:['Drama'],languages:['en'],countries:['GB']}),title(4,{year:'2023',genres:['Drama'],languages:['en'],countries:['US']}),title(5,{year:'2024',genres:['Comedy'],languages:['en'],countries:['US']}),title(6),{...match,kind:'tv',key:'tv-1'}];
 assert.deepEqual(M.filter(rows,{kind:'movie',year:'2024',genre:'18',language:'en',country:'US'}).map(t=>t.key),['movie-1']);
 assert.equal(M.matches(title(7),{country:'US'}),false);assert.equal(M.matches(title(7),{language:'en'}),false);assert.equal(M.matches(title(7),{genre:'18'}),false);
 assert.equal(M.matches(title(7,{originalLanguage:'en'}),{language:'en'}),true);
 assert.equal(M.matches(title(7,{genreIds:[18]}),{genre:'18'}),true);
 assert.equal(M.matches(title(7,{year:2024}),{year:'2024'}),true);
 assert.equal(M.filter(rows,{}).length,rows.length);
});

test('verified audio filter requires a recent observed track for the exact title',()=>{
 const a=title(1),b=title(2),now=Date.now();
 const observations=[{item:a,languages:['en','ta','ta'],verifiedAt:now},{item:b,languages:['ta'],verifiedAt:now-31*86400000},{item: title(3),languages:['ta'],verifiedAt:now}];
 assert.deepEqual(M.knownAudio(a,observations),['en','ta']);assert.deepEqual(M.knownAudio(b,observations),[]);
 assert.deepEqual(M.filter([a,b],{audioLanguage:'ta'},observations),[a]);
 assert.equal(M.matches(a,{language:'ta'},observations),false,'Observed audio is not evidence of the original title language');
});

test('sorting uses real metadata without mutating the source order',()=>{
 const rows=[title(1,{rating:6,year:'2024'}),title(2,{rating:9,year:'2023'}),title(3,{rating:7,releaseDate:'2025-01-02'})];
 assert.deepEqual(M.filter(rows,{sort:'rating'}).map(t=>t.id),['2','3','1']);
 assert.deepEqual(M.filter(rows,{sort:'newest'}).map(t=>t.id),['3','1','2']);
 assert.deepEqual(rows.map(t=>t.id),['1','2','3']);
});

test('IMDb search accepts an exact title identity and rejects arbitrary URLs or partial IDs',()=>{
 for(const raw of ['tt22084616',' TT22084616 ','https://www.imdb.com/title/tt22084616/','https://m.imdb.com/title/tt22084616/?ref_=test'])assert.equal(M.imdb(raw),'tt22084616');
 for(const raw of ['tt1','22084616','https://example.com/title/tt22084616/','https://imdb.com.evil.test/title/tt22084616/','https://user:password@imdb.com/title/tt22084616/','https://imdb.com/name/tt22084616/','https://imdb.com/title/tt22084616/extra','https://imdb.com:444/title/tt22084616/'])assert.throws(()=>M.imdb(raw));
});
