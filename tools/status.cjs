'use strict';
// 只读状态检查：两套中继的 broker 在不在、有哪些 ZCode 路由已登记。不会拉起 broker，不改任何状态。
// 用法：node tools/status.cjs
//   CLAUDE_RELAY_STATE  Claude 这套的状态目录（默认 ./relay-state）
//   CODEX_RELAY_STATE   Codex 那套的状态目录（不设则不检查）
const fs=require('node:fs');const path=require('node:path');const net=require('node:net');
const stacks=[['Claude 这套',process.env.CLAUDE_RELAY_STATE||path.resolve(__dirname,'..','relay-state')]];
if(process.env.CODEX_RELAY_STATE)stacks.push(['Codex 那套',process.env.CODEX_RELAY_STATE]);
function ask(state){
  return new Promise(resolve=>{
    let info;
    try{info=JSON.parse(fs.readFileSync(path.join(state,'relay.json'),'utf8'));}catch{return resolve({broker:false});}
    const socket=net.createConnection(info.endpoint);
    const timer=setTimeout(()=>{socket.destroy();resolve({broker:false});},3000);
    const pending=new Map();let buffer='',n=0;
    const send=(method,params)=>new Promise(r=>{const id='s'+(++n);pending.set(id,r);socket.write(JSON.stringify({id,method,params})+'\n');});
    socket.setEncoding('utf8');
    socket.on('error',()=>{clearTimeout(timer);resolve({broker:false});});
    socket.on('data',chunk=>{buffer+=chunk;let k;while((k=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,k);buffer=buffer.slice(k+1);try{const m=JSON.parse(line),r=pending.get(m.id);if(r){pending.delete(m.id);r(m);}}catch{}}});
    socket.on('connect',async()=>{
      const hello=await send('hello',{token:info.token,role:'controller'});
      if(hello.error){clearTimeout(timer);socket.destroy();return resolve({broker:true,workers:[]});}
      const workers=await send('workers',{});
      clearTimeout(timer);socket.destroy();resolve({broker:true,workers:workers.result||[]});
    });
  });
}
(async()=>{
  for(const [name,state] of stacks){
    const r=await ask(state);
    if(!r.broker){console.log(`${name}：ZCode 路由未开（broker 没运行）`);continue;}
    if(!r.workers.length){console.log(`${name}：broker 在线，但还没有 ZCode 路由登记`);continue;}
    for(const w of r.workers)console.log(`${name}：ZCode 路由在线 ✔  ${w.workerId}（${w.model.modelId}/${w.model.effort}，${w.profiles.length} 个 profile）`);
  }
})();
