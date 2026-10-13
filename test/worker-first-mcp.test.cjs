'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RelayClient}=require('../relay-client.cjs');
const {dependency}=require('../sdk.cjs');
const {createTempState,cleanupTempState}=require('./temp-state.cjs');
// The ZCode worker is opened first and unconditionally; the controller
// (Claude or Codex) attaches later with no manual broker step in between.
test('stdio worker registers with no broker, controller attaches later and completes a task',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const state=createTempState('worker-first'),base=path.resolve(__dirname,'..');
 let c,w;
 const data=r=>r.structuredContent||JSON.parse(r.content[0].text);
 async function open(role){
  const client=new Client({name:'worker-first-test',version:'1.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(base,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:'["*"]'},stderr:'pipe'}));
  return client;
 }
 const call=(client,name,args)=>client.callTool({name,arguments:args},undefined,{timeout:15000});
 try{
  assert.equal(fs.existsSync(state),false);
  w=await open('worker');
  const model={providerId:'transport-only',modelId:'GLM-fixture',effort:'low'};
  const registered=await call(w,'register_worker',{workerId:'early-worker',model,profiles:[{name:'fixture-profile',...model}]});
  assert.equal(registered.isError,undefined);assert.equal(data(registered).bridgeVersion,'0.4.0');
  const receiving=call(w,'receive_task',{workerId:'early-worker'});
  c=await open('controller');
  const models=data(await call(c,'zcode_models',{}));
  assert.equal(models.workers.length,1);assert.equal(models.hint,undefined);
  const workspace=fs.realpathSync(os.tmpdir());
  const task=data(await call(c,'zcode_spawn',{workspace,prompt:'Protocol fixture only.',...model}));
  const delivered=data(await receiving);assert.equal(delivered.taskId,task.taskId);
  await call(w,'report_result',{taskId:task.taskId,lease:delivered.lease,status:'completed',response:'WORKER_FIRST_OK'});
  assert.equal(data(await call(c,'zcode_wait',{taskIds:[task.taskId],timeoutMs:2000})).jobs[0].response,'WORKER_FIRST_OK');
 }finally{
  await Promise.allSettled([c?.close(),w?.close()]);
  const probe=new RelayClient({state});
  try{const info=JSON.parse(fs.readFileSync(path.join(state,'broker-info.json'),'utf8'));process.kill(info.pid);}catch(e){}
  cleanupTempState(state);
 }
});
test('controller with no worker online returns an actionable hint instead of failing',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const state=createTempState('no-worker'),base=path.resolve(__dirname,'..');
 let c;
 try{
  c=new Client({name:'no-worker-test',version:'1.0'});
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(base,'relay-mcp.cjs'),'controller'],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:'["*"]'},stderr:'pipe'}));
  const r=await c.callTool({name:'zcode_models',arguments:{}},undefined,{timeout:15000});
  const out=r.structuredContent||JSON.parse(r.content[0].text);
  assert.deepEqual(out.workers,[]);assert.match(out.hint,/zcode-start\.txt/);
 }finally{
  await Promise.allSettled([c?.close()]);
  try{const info=JSON.parse(fs.readFileSync(path.join(state,'broker-info.json'),'utf8'));process.kill(info.pid);}catch(e){}
  cleanupTempState(state);
 }
});
