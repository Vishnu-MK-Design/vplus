(()=>{'use strict';
class TimelinePreviews {
 constructor(c){this.c=c;this.frames=new Map();this.decoded=new Map();this.pending=new Map();this.generation=null;this.target=null;this.requests=0;this.hits=0;this.latencies=[];this.openKey='';this.preparing=false;}
 prepare(){const c=this.c,v=c.video,source=c.config.previewSource||v?.currentSrc;if(!v||!Number.isFinite(v.duration)||v.duration<=0||!source||source.startsWith('blob:'))return;const key=(c.config.contentKey||c.config.title||'')+'|'+source+'|'+v.duration;if(key===this.openKey)return;this.openKey=key;this.frames.clear();this.decoded.clear();this.pending.clear();this.generation=null;this.preparing=true;c.emit({type:'NATIVE_PREVIEW_OPEN',duration:v.duration,currentTime:v.currentTime||0,streamIndex:c.config.streamIndex});}
 receive(data){if(!data||typeof data!=='object')return false;
  if(data.status==='reset'){this.generation=data.generation;this.failed=false;this.requested=null;this.count=data.count;this.step=data.step;this.frames.clear();this.decoded.clear();this.pending.clear();if(this.target)this.show(this.target.time);return true;}
  if(data.generation!==this.generation)return false;
  if(data.status==='frame'&&Number.isInteger(data.index)&&data.index>=0&&data.index<this.count&&typeof data.image==='string'&&data.image.length<100000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.image)){this.frames.set(data.index,{image:data.image,time:data.time});this.decode(data.index);return true;}
  if(['complete','unavailable'].includes(data.status)){this.preparing=false;this.failed=data.status==='unavailable';return true;}return false;
 }
 decode(index){if(this.decoded.has(index))return Promise.resolve(this.decoded.get(index));if(this.pending.has(index))return this.pending.get(index);const frame=this.frames.get(index);if(!frame)return Promise.resolve(null);const img=new Image();img.src=frame.image;const done=(img.decode?img.decode():new Promise((r,j)=>{img.onload=r;img.onerror=j;})).then(()=>{if(this.frames.get(index)!==frame)return null;this.decoded.set(index,img);while(this.decoded.size>240)this.decoded.delete(this.decoded.keys().next().value);if(this.target?.index===index)this.paint(img,frame.time);return img;}).catch(()=>null).finally(()=>this.pending.delete(index));this.pending.set(index,done);return done;}
 show(seconds,ratio){const c=this.c,v=c.video;if(!v||!Number.isFinite(v.duration)||v.duration<=0)return;this.prepare();this.requests++;const now=performance.now(),time=Math.max(0,Math.min(v.duration,seconds)),index=this.count?Math.min(this.count-1,Math.round(time/this.step)):null;this.target={time,index,started:now};const box=c.$('.preview'),width=c.timeline.getBoundingClientRect().width,half=box.offsetWidth/2||105;box.style.left=Math.max(half,Math.min(width-half,(ratio??time/v.duration)*width))+'px';box.querySelector('p').textContent=this.format(time);box.hidden=false;
  const cached=this.decoded.get(index);if(cached){this.hits++;this.decoded.delete(index);this.decoded.set(index,cached);this.paint(cached,this.frames.get(index).time);}
  else{box.classList.add('waiting','time-only');if(this.frames.has(index))this.decode(index);if(index!==this.requested&&this.generation&&!this.failed){this.requested=index;c.emit({type:'NATIVE_PREVIEW_PRIORITY',generation:this.generation,index});}}
 }
 paint(img,time){if(!this.target)return;const c=this.c,canvas=c.$('.preview canvas');canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);c.$('.preview').classList.remove('waiting','time-only');canvas.dataset.frameTime=String(time);this.latencies.push(performance.now()-this.target.started);if(this.latencies.length>500)this.latencies.shift();}
 hide(){this.target=null;this.c.$('.preview').hidden=true;}
 format(n){n=Math.max(0,Math.floor(n));return(n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(n>=3600?2:1,'0')+':'+String(n%60).padStart(2,'0');}
 state(){return{shown:!this.c.$('.preview').hidden,ready:!this.c.$('.preview').classList.contains('waiting'),time:this.target?.time||0,frameTime:Number(this.c.$('.preview canvas').dataset.frameTime)||0,prepared:this.frames.size,count:this.count||0,preparing:this.preparing,failed:!!this.failed,cacheHits:this.hits,requests:this.requests,latencyMs:this.latencies.slice(-100)};}
 dispose(){this.hide();this.frames.clear();this.decoded.clear();this.pending.clear();this.c.emit({type:'NATIVE_PREVIEW_CLOSE'});}
}
window.VPlusTimelinePreviews=TimelinePreviews;
})();
