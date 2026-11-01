'use strict';
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const path=require('node:path');

// Private stdio transport: no listening port and no renderer-supplied executable.
class Cs3Transport extends EventEmitter {
 constructor({java, jars, dataDir, spawnProcess=spawn, timeoutMs=90000,memoryMb=2048}) {
  super();this.pending=new Map();this.nextId=0;this.buffer='';this.closed=false;this.timeoutMs=timeoutMs;
  if(![512,768,1024,1536,2048,3072].includes(memoryMb))throw Error('Unsupported extension memory limit.');
  this.child=spawnProcess(java,['-Xmx'+memoryMb+'m','-cp',path.join(jars,'*'),'dev.akash.cs3engine.jvm.MainKt','--stdio',dataDir],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>this.read(chunk));
  this.child.stdin.on('error',err=>this.fail(err));
  this.child.stderr.on('data',chunk=>this.emit('diagnostic',String(chunk)));
  this.child.on('error',err=>this.fail(err));
  this.child.on('exit',()=>this.fail(new Error('Extension engine stopped.')));
 }
 read(chunk){
  this.buffer+=chunk;
  if(Buffer.byteLength(this.buffer)>16*1024*1024){this.close(new Error('Extension response exceeds the size limit.'));return;}
  let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
   let msg;try{msg=JSON.parse(line);}catch{this.close(new Error('Invalid extension engine response.'));return;}
   if(msg.id!==undefined){const pending=this.pending.get(msg.id);if(!pending)continue;clearTimeout(pending.timer);this.pending.delete(msg.id);if(msg.error)pending.reject(Object.assign(new Error(msg.error.message||'Extension failed.'),{code:msg.error.type||'EXTENSION_ERROR',engineTrace:msg.error.trace}));else pending.resolve(msg.result);}
   else this.emit('event',msg);
  }
 }
 request(method,params={},timeoutMs=this.timeoutMs){
  if(this.closed)return Promise.reject(new Error('Extension engine is closed.'));
  if(this.pending.size>=32)return Promise.reject(new Error('Too many extension requests.'));
  const id=++this.nextId;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('Extension request timed out.'),{code:'TIMEOUT'}));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.child.stdin.write(JSON.stringify({id,method,params})+'\n',err=>{if(err){clearTimeout(timer);this.pending.delete(id);reject(err);}});
  });
 }
 fail(error){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('stopped',error);}
 close(error=new Error('Extension engine closed.')){this.fail(error);this.child.stdin.destroy();this.child.kill();}
}
module.exports={Cs3Transport};
