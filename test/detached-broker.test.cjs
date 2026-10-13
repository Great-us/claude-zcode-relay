'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {RelayClient}=require('../relay-client.cjs');
const {createTempState,cleanupTempState}=require('./temp-state.cjs');
// A broker that is our child dies when the launching app's job object is closed.
test('on Windows the auto-started broker is not a child of the launching process',{skip:process.platform!=='win32'},async()=>{
 const state=createTempState('detached'),c=new RelayClient({state});
 try{
  await c.connect('worker');
  const info=JSON.parse(fs.readFileSync(path.join(state,'broker-info.json'),'utf8'));
  assert.equal(info.pid,c.startedBrokerPid);
  assert.notEqual(info.ppid,process.pid);
  assert.equal(info.ownerRole,'worker');
 }finally{
  await c.close();
  if(c.startedBrokerPid)try{process.kill(c.startedBrokerPid);}catch(e){if(e.code!=='ESRCH')throw e;}
  await new Promise(r=>setTimeout(r,300));
  cleanupTempState(state);
 }
});
