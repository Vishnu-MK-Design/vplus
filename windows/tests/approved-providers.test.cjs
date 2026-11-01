'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {playback,navigation,matchesPlayback}=require('../routes.cjs');
const {sourceOptionsFor}=require('../playback-providers.cjs');
const {createPlan}=require('../playback-plan.cjs');
test('approved movie and TV providers keep exact content, episode and resume identity',()=>{
 for(const provider of ['vidfast','vidlink'])for(const kind of ['movie','tv']){
  const r=playback({provider,item:{kind,id:'45745'},season:2,episode:7,start:125.8});
  const u=new URL(r.url);assert.equal(u.host,provider==='vidfast'?'vidfast.vc':'vidlink.pro');assert.equal(u.pathname,kind==='movie'?'/movie/45745':'/tv/45745/2/7');assert.equal(u.searchParams.get('startAt'),'125');assert.equal(navigation(r.url,provider),true);assert.equal(navigation(r.url,provider==='vidfast'?'vidlink':'vidfast'),false);
 }
});
test('MAL and AniList identities cannot be silently interchanged for VidLink anime',()=>{
 assert.throws(()=>playback({provider:'vidlink',item:{kind:'anime',id:'151807',mal:false}}));
 const r=playback({provider:'vidlink',item:{kind:'anime',id:'151807',malId:'44511'},episode:4,audio:'dub',start:35});assert.equal(new URL(r.url).pathname,'/anime/44511/4/dub');assert.equal(r.item.id,'151807');
 assert.equal(new URL(playback({provider:'vidlink',item:{kind:'anime',id:'44511',mal:true},episode:3}).url).pathname,'/anime/44511/3/sub');
 assert.equal(sourceOptionsFor('anime',{kind:'anime',id:'151807'}).find(p=>p.id==='vidlink').available,false);
 assert.equal(sourceOptionsFor('anime',{kind:'anime',id:'44511',mal:true}).find(p=>p.id==='vidlink').available,true);
 assert.throws(()=>playback({provider:'vidfast',item:{kind:'anime',id:'44511',mal:true}}));
});
test('new native navigation stays on the exact published domains and valid playback paths',()=>{
 for(const [p,host]of [['vidfast','vidfast.vc'],['vidlink','vidlink.pro']])for(const url of [`http://${host}/movie/1`,`https://${host}.evil/movie/1`,`https://user@${host}/movie/1`,`https://${host}:444/movie/1`,`https://${host}/ads`,`https://${host}/movie/0`,`https://${host}/tv/1/0/2`,`https://${host}/tv/1/1/0`,`https://${host}/movie/1/../../ads`,`https://${host}/anime/1/1/fake`])assert.equal(navigation(url,p),false,url);
 assert.equal(navigation('https://vidlink.pro/anime/44511/3/dub','vidlink'),true);
});
test('late events from another title or episode cannot update the current playback',()=>{
 const active=playback({provider:'vidlink',item:{kind:'tv',id:'1396'},season:2,episode:7});
 assert.equal(matchesPlayback(active.url,active),true);assert.equal(matchesPlayback('https://vidlink.pro/tv/1396/2/7?startAt=120',active),true);
 for(const raw of ['https://vidlink.pro/tv/1396/2/6','https://vidlink.pro/tv/1399/2/7','https://vidfast.vc/tv/1396/2/7'])assert.equal(matchesPlayback(raw,active),false);
});
test('episode inputs are validated before making a provider request',()=>{
 for(const provider of ['vidfast','vidlink'])for(const [season,episode]of [[0,1],[1,0],[-1,2],[1,1.5],[1000,1],[1,100000]])assert.throws(()=>playback({provider,item:{kind:'tv',id:'1396'},season,episode}));
 assert.equal(new URL(playback({provider:'vidfast',item:{kind:'movie',id:'1'},start:Infinity}).url).searchParams.get('startAt'),'0');
});
test('new manual choices do not silently expand automatic fallback until actual playback was remembered',()=>{
 const initial=createPlan('auto','movie');const old=[];do{old.push(initial.current())}while(initial.advance());assert.deepEqual(old,['vidly','cinesrc']);
 for(const provider of ['vidfast','vidlink']){const manual=createPlan(provider,'movie');assert.equal(manual.current(),provider);assert.equal(manual.advance(),false);const remembered=createPlan('auto','movie',provider);const order=[];do{order.push(remembered.current())}while(remembered.advance());assert.deepEqual(order,[provider,'vidly','cinesrc']);}
 assert.throws(()=>createPlan('vidlink','anime','',{kind:'anime',id:'1',mal:false}));
});
