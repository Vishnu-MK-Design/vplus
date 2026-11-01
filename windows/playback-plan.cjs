'use strict';
const {PROVIDERS,providersFor}=require('./playback-providers.cjs');
function createPlan(mode='auto',kind='movie',lastWorking='',item){
 if(mode!=='auto'&&!PROVIDERS.some(p=>p.id===mode))throw Error('Unknown playback preference.');
 const compatible=providersFor(kind,item);
 const available=compatible.filter(p=>mode!=='auto'||p.automatic!==false||p.id===lastWorking).map(p=>p.id);
 if(!available.length||mode!=='auto'&&!available.includes(mode))throw Error('No supported playback source for this title type.');
 const sources=mode==='auto'?(available.includes(lastWorking)?[lastWorking,...available.filter(p=>p!==lastWorking)]:available):[mode];
 let index=0;return {automatic:mode==='auto',current:()=>sources[index],advance(){if(index+1>=sources.length)return false;index++;return true;},reset(){index=0;}};
}
module.exports={createPlan};
