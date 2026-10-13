'use strict';
const fs=require('node:fs');const path=require('node:path');const net=require('node:net');const crypto=require('node:crypto');const {spawn}=require('node:child_process');
class RelayClient {
  constructor({state}){if(!path.isAbsolute(state))throw Error('State path must be absolute');this.state=state;this.pending=new Map();this.socket=null;}
  log(event,fields={}){try{fs.appendFileSync(path.join(this.state,'lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,role:this.role,...fields})+'\n',{mode:0o600});}catch{process.stderr.write('Relay lifecycle logging failed.\n');}}
  async open(info){return new Promise((resolve,reject)=>{const socket=net.createConnection(info.endpoint);const fail=e=>{socket.destroy();reject(e);};socket.once('error',fail);socket.once('connect',()=>{socket.off('error',fail);resolve(socket);});});}
  // A broker spawned as our child dies with our process tree (Windows job objects used by
  // desktop apps kill children on exit), taking the shared relay and running tasks with it.
  // On Windows create it through WMI so it is parented outside any caller-owned job.
  async startDetachedWindows(role){
    const broker=path.join(__dirname,'relay-broker.cjs'),q=v=>'"'+String(v).replace(/"/g,'""')+'"';
    const commandLine=[q(process.execPath),q(broker),'serve','--state',q(this.state),'--owner',role].join(' ');
    const script="$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='"+commandLine.replace(/'/g,"''")+"'};if($r.ReturnValue -ne 0){exit 3};[Console]::Out.Write($r.ProcessId)";
    const out=await new Promise((resolve,reject)=>{const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','ignore']});let text='';ps.stdout.on('data',d=>text+=d);ps.once('error',reject);ps.once('exit',code=>code===0&&/^\d+$/.test(text.trim())?resolve(text.trim()):reject(Error('Detached broker launch failed')));});
    this.startedBrokerPid=Number(out);
    const file=path.join(this.state,'relay.json');const deadline=Date.now()+15000;
    while(Date.now()<deadline){try{const info=JSON.parse(fs.readFileSync(file,'utf8'));(await this.open(info)).destroy();return;}catch{await new Promise(r=>setTimeout(r,150));}}
    throw Error('Broker startup timeout');
  }
  async start(role='controller'){
    if(process.platform==='win32'&&process.env.ZCODE_RELAY_NO_DETACH!=='1'){try{return await this.startDetachedWindows(role);}catch(e){this.log('detached_start_failed',{message:e.message});}}
    await this.startChild(role);
  }
  async startChild(role){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,'relay-broker.cjs'),'serve','--state',this.state,'--owner',role],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});this.startedBrokerPid=child.pid;const timer=setTimeout(()=>{child.disconnect();child.unref();reject(Error('Broker startup timeout'));},15000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('message',m=>{clearTimeout(timer);child.disconnect();child.unref();m.ready?resolve():reject(Error('Broker startup failed'));});child.once('exit',code=>{if(code&&child.connected){clearTimeout(timer);reject(Error('Broker startup failed'));}});});}
  async connect(role){
    if(!['controller','worker'].includes(role))throw Error('Invalid relay role');if(this.socket)throw Error('Client already connected');this.role=role;const file=path.join(this.state,'relay.json');let info;let socket;
    try{info=JSON.parse(fs.readFileSync(file,'utf8'));socket=await this.open(info);}catch(e){if(!(e instanceof SyntaxError)&&!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;await this.start(role);info=JSON.parse(fs.readFileSync(file,'utf8'));socket=await this.open(info);}
    this.socket=socket;this.log('client_connected');let buffer='';socket.setEncoding('utf8');socket.on('data',chunk=>{buffer+=chunk;let split;while((split=buffer.indexOf('\n'))>=0){let message;try{message=JSON.parse(buffer.slice(0,split));}catch{this.log('client_invalid_json');socket.destroy();return;}buffer=buffer.slice(split+1);const pending=this.pending.get(message.id);if(!pending)continue;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(message.error.message)):pending.resolve(message.result);}});socket.on('error',e=>this.log('client_socket_error',{code:e.code||'UNKNOWN'}));socket.on('close',hadError=>{this.log('client_disconnected',{hadError});this.socket=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Relay disconnected'));}this.pending.clear();});
    try{return await this.request('hello',{token:info.token,role});}catch(e){await this.close();throw e;}
  }
  request(method,params={}, {timeoutMs=60000}={}){if(!this.socket)return Promise.reject(Error('Relay not connected'));const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=timeoutMs===0?null:setTimeout(()=>{this.pending.delete(id);reject(Error('Relay request timed out'));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.socket.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});});}
  async close(){if(!this.socket)return;this.log('client_close_requested');const socket=this.socket;await new Promise(resolve=>{socket.once('close',resolve);socket.destroy();});}
}
module.exports={RelayClient};
