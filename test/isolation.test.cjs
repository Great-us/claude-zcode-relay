'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RelayClient}=require('../relay-client.cjs');
const {dependency}=require('../sdk.cjs');
const {createTempState,cleanupTempState}=require('./temp-state.cjs');
// Two relay stacks (e.g. Codex's and Claude's) must coexist: separate state dir = separate
// broker, pipe and worker namespace. Neither may block, replace or observe the other.
test('two stacks with different state dirs run side by side without interfering',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const base=path.resolve(__dirname,'..');
 const stateA=createTempState('stack-a'),stateB=createTempState('stack-b');
 const data=r=>r.structuredContent||JSON.parse(r.content[0].text);
 const open=async(role,state)=>{const c=new Client({name:'isolation-test',version:'1.0'});await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(base,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:'["*"]'},stderr:'pipe'}));return c;};
 const call=(c,name,args)=>c.callTool({name,arguments:args},undefined,{timeout:15000});
 const model={providerId:'transport-only',modelId:'GLM-fixture',effort:'low'};
 const clients=[];let brokerA,brokerB;
 try{
  const wA=await open('worker',stateA),wB=await open('worker',stateB),cA=await open('controller',stateA),cB=await open('controller',stateB);
  clients.push(wA,wB,cA,cB);
  // The very same workerId is legal in both stacks at once (no "only one can be open").
  for(const w of [wA,wB])assert.equal((await call(w,'register_worker',{workerId:'same-worker-id',model,profiles:[{name:'p',...model}]})).isError,undefined);
  const infoA=JSON.parse(fs.readFileSync(path.join(stateA,'broker-info.json'),'utf8')),infoB=JSON.parse(fs.readFileSync(path.join(stateB,'broker-info.json'),'utf8'));
  brokerA=infoA.pid;brokerB=infoB.pid;assert.notEqual(brokerA,brokerB);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(stateA,'relay.json'),'utf8')).endpoint,JSON.parse(fs.readFileSync(path.join(stateB,'relay.json'),'utf8')).endpoint);
  const workspace=fs.realpathSync(os.tmpdir());
  const recvA=call(wA,'receive_task',{workerId:'same-worker-id'}),recvB=call(wB,'receive_task',{workerId:'same-worker-id'});
  const tA=data(await call(cA,'zcode_spawn',{workspace,prompt:'A only',...model})),tB=data(await call(cB,'zcode_spawn',{workspace,prompt:'B only',...model}));
  const gA=data(await recvA),gB=data(await recvB);
  assert.equal(gA.taskId,tA.taskId);assert.equal(gA.prompt,'A only');
  assert.equal(gB.taskId,tB.taskId);assert.equal(gB.prompt,'B only');
  // Neither controller can see the other stack's tasks.
  assert.equal((await call(cA,'zcode_status',{taskId:tB.taskId})).isError,true);
  assert.equal((await call(cB,'zcode_status',{taskId:tA.taskId})).isError,true);
  // Killing stack A (its broker) leaves stack B fully working.
  process.kill(brokerA);await new Promise(r=>setTimeout(r,500));
  await call(wB,'report_result',{taskId:tB.taskId,lease:gB.lease,status:'completed',response:'B_SURVIVED'});
  assert.equal(data(await call(cB,'zcode_wait',{taskIds:[tB.taskId],timeoutMs:2000})).jobs[0].response,'B_SURVIVED');
 }finally{
  await Promise.allSettled(clients.map(c=>c.close()));
  for(const pid of [brokerA,brokerB])if(pid)try{process.kill(pid);}catch(e){}
  await new Promise(r=>setTimeout(r,300));
  cleanupTempState(stateA);cleanupTempState(stateB);
 }
});
