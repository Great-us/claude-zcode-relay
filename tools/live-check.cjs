'use strict';
// 真实环境检查：用 Claude Code 真实的 MCP 启动命令连上 broker，派一个很小的文件任务并核对结果。
// 用法：node tools/live-check.cjs
//   读取 ~/.claude.json 里的 mcpServers['zcode-claude']（按 README 注册的那一条）。
// 前提：ZCode 里的 Claude 路由会话已经在线（先用 tools/status.cjs 看）。任务只在 runtime/e2e/ 下写一个 who.txt。
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {dependency}=require('../sdk.cjs');
const def=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude.json'),'utf8')).mcpServers['zcode-claude'];
if(!def){console.error("~/.claude.json 里没有 mcpServers['zcode-claude']，先按 README 注册。");process.exit(2);}
const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
const workspace=path.resolve(__dirname,'..','runtime','e2e').replace(/\\/g,'/');
fs.mkdirSync(workspace,{recursive:true});
(async()=>{
  const t0=Date.now(),log=m=>console.log(((Date.now()-t0)/1000).toFixed(1).padStart(6)+'s '+m);
  const c=new Client({name:'live-check',version:'1'});
  await c.connect(new StdioClientTransport({command:def.command,args:def.args,env:{...process.env,...def.env},stderr:'pipe'}));
  const call=async(name,args)=>{const r=await c.callTool({name,arguments:args},undefined,{timeout:70000});if(r.isError)throw Error(name+': '+r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};
  const m=await call('zcode_models',{});log('bridgeVersion='+m.bridgeVersion+' worker='+(m.workers.map(w=>w.workerId).join(',')||'none'));
  if(!m.workers.length)throw Error('没有在线的 ZCode 路由：'+(m.hint||''));
  const task=await call('zcode_spawn',{workspace,providerId:'account:bigmodel-individual-coding-plan',modelId:'GLM-5.3-Flash',effort:'low',prompt:'只在当前工作目录创建文件 who.txt，内容为单行 CLAUDE_SIDE_OK。不要读写该目录之外的任何文件，不要联网。完成后用 report_result 上报，response 里写出文件内容。'});
  log('dispatched '+task.taskId.slice(0,8));
  for(let i=0;i<8;i++){const w=await call('zcode_wait',{taskIds:[task.taskId],timeoutMs:55000});if(w.jobs.length){const j=w.jobs[0];log('DONE '+j.status+' profile='+j.profile.name);break;}}
  await c.close();
  const file=path.join(workspace,'who.txt');log('who.txt = '+(fs.existsSync(file)?fs.readFileSync(file,'utf8').trim():'(missing)'));
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
