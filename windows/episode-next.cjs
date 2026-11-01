'use strict';
// Episode order is provider metadata order, never an assumed season transition.
async function resolveNext(source,{anime,details,now=Date.now}) {
 const {item,season,episode}=source;
 if(item.kind==='anime'&&item.mal){const t=await anime.details(item.id),published=t.status==='FINISHED'?t.totalEpisodes:t.nextAiringEpisode?.episode?t.nextAiringEpisode.episode-1:0;return episode<published?{season,episode:episode+1}:null;}
 if(item.kind!=='tv')return null;
 const aired=e=>e.airDate&&Number.isFinite(Date.parse(e.airDate))&&Date.parse(e.airDate)<=now();
 const r=await details.episodes(item,season),same=r.episodes?.filter(e=>e.n>episode&&aired(e)).sort((a,b)=>a.n-b.n)[0];
 if(same)return {season,episode:same.n};
 const title=await details.details(item),following=(title.seasonsList||[]).filter(s=>Number(s.id)>season).sort((a,b)=>Number(a.id)-Number(b.id))[0];
 if(!following)return null;
 const next=await details.episodes(item,Number(following.id)),first=next.episodes?.filter(aired).sort((a,b)=>a.n-b.n)[0];
 return first?{season:Number(following.id),episode:first.n}:null;
}
module.exports={resolveNext};
