'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RelayClient}=require('../relay-client.cjs');
const {dependency}=require('../sdk.cjs');
const {createTempState,cleanupTempState}=require('./temp-state.cjs');
test('fresh stdio accepts an unrelated workspace and exact dynamically registered model',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const state=createTempState('universal-routing'),base=path.resolve(__dirname,'..');
 const bootstrap=new RelayClient({state});let c,w;
 const data=r=>r.structuredContent||JSON.parse(r.content[0].text);
 async function open(role){
  const client=new Client({name:'universal-routing-test',version:'1.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(base,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:'["*"]'},stderr:'pipe'}));
  return client;
 }
 const call=(client,name,args)=>client.callTool({name,arguments:args},undefined,{timeout:10000});
 try{
  await bootstrap.connect('controller');c=await open('controller');w=await open('worker');
  const model={providerId:'transport-only',modelId:'GLM-future-fixture',effort:'fixture-level'};
  await call(w,'register_worker',{workerId:'fixture-worker',model,profiles:[{name:'dynamic-fixture-profile',...model}]});
  const workspace=fs.realpathSync(os.tmpdir());
  assert.notEqual(workspace,base);
  const created=await call(c,'zcode_spawn',{workspace,prompt:'Protocol fixture only; no model inference.',...model});
  assert.equal(created.isError,undefined);
  const task=data(created),delivered=data(await call(w,'receive_task',{workerId:'fixture-worker'}));
  assert.equal(delivered.taskId,task.taskId);assert.equal(delivered.workspace,workspace);
  assert.equal(delivered.profile.name,'dynamic-fixture-profile');assert.deepEqual(delivered.model,model);
  const wrong=await call(c,'zcode_spawn',{workspace,prompt:'Must not silently change effort',...model,effort:'other-fixture-level'});
  assert.equal(wrong.isError,true);assert.match(wrong.content[0].text,/No online worker supports/);
  const report=await call(w,'report_result',{taskId:task.taskId,lease:delivered.lease,status:'completed',response:'TRANSPORT_ONLY_OK'});
  assert.equal(report.isError,undefined);
  const waited=data(await call(c,'zcode_wait',{taskIds:[task.taskId],timeoutMs:1000}));
  assert.equal(waited.jobs[0].response,'TRANSPORT_ONLY_OK');
 }finally{
  await Promise.allSettled([c?.close(),w?.close(),bootstrap.close()]);
  if(bootstrap.startedBrokerPid)try{process.kill(bootstrap.startedBrokerPid);}catch(e){if(e.code!=='ESRCH')throw e;}
  cleanupTempState(state);
 }
});
