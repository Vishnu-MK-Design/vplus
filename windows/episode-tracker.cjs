'use strict';
const identity=(item,season,episode)=>{if(!item||!['anime','tv'].includes(item.kind)||item.key!==item.kind+'-'+item.id||!/^\d{1,12}$/.test(String(item.id))||!Number.isInteger(season)||season<1||!Number.isInteger(episode)||episode<1)throw Error('Invalid episode identity');return `${item.key}:${item.kind==='anime'?'absolute':season}:${episode}`;};
function coverage(intervals){return intervals.reduce((n,[a,b])=>n+b-a,0);}
function addInterval(intervals,a,b){const out=[];for(const r of [...intervals,[a,b]].sort((x,y)=>x[0]-y[0])){const last=out.at(-1);if(last&&r[0]<=last[1]+.5)last[1]=Math.max(last[1],r[1]);else out.push([...r]);}return out.slice(-2000);}
function createTracker(records={},now=Date.now){const last=new Map();return {
 records,
 observe(item,season,episode,{time,duration,playing=true,seeking=false,rate=1,event=''}={}){const key=identity(item,season,episode);if(!Number.isFinite(time)||time<0||!Number.isFinite(duration)||duration<=0)return null;
 const t=now(),previous=last.get(key),r=records[key]||{key,itemKey:item.key,season,episode,state:'not-started',position:0,intervals:[]};const delta=previous?(t-previous.at)/1000:0,advance=previous?time-previous.time:0;
 if(previous&&playing&&previous.playing&&!seeking&&delta>0&&delta<12&&advance>0&&advance<=delta*Math.min(4,Math.max(.25,rate))+1)r.intervals=addInterval(r.intervals||[],previous.time,Math.min(time,duration));
 r.duration=duration;r.position=Math.min(time,duration);r.updatedAt=t;if(r.state!=='watched')r.state=coverage(r.intervals||[])/duration>=.9?'watched':r.position>0?'in-progress':'not-started';if(event==='ended')r.position=0;records[key]=r;last.set(key,{time,at:t,playing:playing&&!seeking});return r;},
 mark(item,season,episodes,watched){if(!Array.isArray(episodes)||episodes.length>10000||episodes.some(n=>!Number.isInteger(n)||n<1))throw Error('Invalid episode range');for(const n of episodes){const key=identity(item,season,n),r=records[key]||{key,itemKey:item.key,season,episode:n,position:0,intervals:[]};r.state=watched?'watched':r.position>0?'in-progress':'not-started';r.manual=!!watched;if(!watched)r.intervals=[];r.updatedAt=now();records[key]=r;last.delete(key);}},
 get:(item,season,episode)=>records[identity(item,season,episode)]||null,
 importHistory(history=[]){for(const h of history){try{const key=identity(h.item,Number(h.season||1),Number(h.episode||1));if(records[key]||!Number.isFinite(h.time)||h.time<=0)continue;records[key]={key,itemKey:h.item.key,season:Number(h.season||1),episode:Number(h.episode||1),position:h.time,duration:Number(h.duration)||0,state:'in-progress',intervals:[],updatedAt:0,imported:true};}catch{}}},
 resetSession(){last.clear();}
};}
module.exports={identity,coverage,addInterval,createTracker};
