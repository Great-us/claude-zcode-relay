# claude-zcode-relay

> English: an event-driven MCP relay that lets **Claude Code** delegate bounded tasks to ZCode desktop's GLM sub-agents. It is a second, fully independent stack that runs side by side with the Codex relay ([codex-zcode-relay](https://github.com/Great-us/codex-zcode-relay)): own state dir (own broker + named pipe), own worker id, own MCP name (`claude-relay`), and project-scoped agent profiles. Windows + ZCode desktop; verified on one machine in 2026-10.

让 Claude Code 把 ZCode 桌面里的 GLM 模型当子代理工厂。**和 [codex-zcode-relay](https://github.com/Great-us/codex-zcode-relay) 里的 Codex 那套是两套完全独立的服务，可以同时开、互不占用、互不干扰。** 协议与 Codex 那套的 0.3.0 相同，本仓库是 0.4.0。

## 两套服务并排运行

| | Codex 那套 | Claude 这套（本仓库） |
| --- | --- | --- |
| ZCode 里的 MCP | `codex-relay` | `claude-relay` |
| 主管端 MCP | `zcode-bridge` | `zcode-claude` |
| 状态目录（决定 broker 和管道） | 自行配置 `ZCODE_RELAY_STATE` | 另一个目录（如 `./relay-state`） |
| worker 名 | `zcode-desktop-worker` | `zcode-claude-worker` |
| 子 Agent profile | `~/.zcode/agents/codex-relay-*`（全局） | `router-project/.zcode/agents/claude-relay-*`（**项目级**） |
| ZCode 里的路由会话 | 一个 Codex 路由会话 | 项目 `router-project` 里的一个会话 |
| 启动提示词 | Codex 仓库的 `templates/worker-prompt.txt` | `claude-start.txt` |

不同状态目录 = 不同 broker、不同命名管道、不同 worker 命名空间，所以同名 worker、同时在线、一方崩溃不影响另一方都成立（`test/isolation.test.cjs`）。

### 为什么 profile 必须放项目级目录
ZCode 会把 `~/.zcode/agents` 里**新增的 profile 实时推给所有正在运行的会话**（会话里出现「New agent types are now available」）。早期把 `claude-relay-*` 装进全局目录，一个正在运行的 Codex 路由会话看到它们，以为是 `codex-relay-*` 被改名，把自己登记成了 claude-relay 档位，之后派给它的任务因「Required MCP server is not connected: claude-relay」失败。放进 `router-project/.zcode/agents/`（ZCode 引擎同时读取 `~/.zcode/agents` 和 `<工作目录>/.zcode/agents`）后，只有该项目的会话看得到。**不要把 claude-relay-\* 装进全局目录。**

## 安装

下面用 `<REPO>` 表示本仓库的绝对路径。

1. 依赖：仓库根目录执行 `npm install`（`@modelcontextprotocol/sdk`、`zod`；Node ≥ 24）。也可用环境变量 `ZCODE_BRIDGE_SDK_BASE` 指向另一个已装好它们的 `package.json`。
2. ZCode（`~/.zcode/cli/config.json` → `mcp.servers`）新增 `claude-relay`（不要改 `codex-relay`）：

```json
"claude-relay": {
  "type": "stdio",
  "command": "node",
  "args": ["<REPO>/relay-mcp.cjs", "worker"],
  "env": { "ZCODE_RELAY_STATE": "<REPO>/relay-state" },
  "timeoutMs": 2147483647
}
```

3. Claude Code：

```bash
claude mcp add -s user zcode-claude \
  -e ZCODE_RELAY_STATE="<REPO>/relay-state" \
  -e ZCODE_BRIDGE_ALLOWED_ROOTS='["<允许派发任务的工作目录>"]' \
  -- node "<REPO>/relay-mcp.cjs" controller
```

`ZCODE_BRIDGE_ALLOWED_ROOTS` 是路由范围，不是沙箱；填 `["*"]` 会放开所有已存在的目录，建议只列你实际要派活的目录。

4. profile 已随仓库提供在 `router-project/.zcode/agents/`。在 ZCode 里把 `<REPO>/router-project` 作为项目打开（「打开文件夹」）。
5. 不要提交 `relay-state/`（里面有 broker 的认证 token）和 `runtime/`，`.gitignore` 已排除。

## 先在 ZCode 里打开（不依赖 Claude / Codex）

ZCode 设置里的 MCP 开关只是让 `claude-relay` 进程可用，**不等于路由已就绪**：必须有一个模型会话执行 `register_worker` 并停在 `receive_task`，因为子 Agent 是由这个会话用 ZCode 原生 Agent 工具拉起的。所以「打开」= 在 ZCode 里开一个路由会话：

1. 新建任务 → 项目选 `router-project`；权限「完全访问」；模型 GLM-5.3-Flash；思考「低」。
2. 发送 `ZCode启动话术.txt` 里那一句话（把路径换成 `claude-start.txt` 的绝对路径）。
3. 它回「注册成功（bridgeVersion 0.4.0）」并显示 Receive task 转圈，就是开好了。之后不要再往这个会话里输入，也不要点「停止生成」（只会打断当前等待，轻量模型随后会自己重新登记）。
4. 随时用 `node tools/status.cjs` 查是否在线（只读，不会拉起任何东西）。
5. Claude 什么时候开都行：新开的 Claude 会话第一次调用 `zcode_models` 时自动连上。

路由被中断（重启电脑、断线）后，在该会话里明确说「再打开」即可重新核验并注册；broker 不在会被重新拉起。

## 使用

Claude 会话里：`zcode_models` 看在线 worker 和 profiles → `zcode_spawn(workspace, prompt, providerId, modelId, effort)` → `zcode_wait`（单次最长 55 秒，返回 `timedOut` 就继续等）→ 独立验收；返修用 `zcode_send`，取消用 `zcode_cancel`。

## 0.4.0 相对 Codex 仓库 0.3.0 的改动

- worker 可自己拉起 broker（不再要求主管先连）。`zcode_models` 没有 worker 时返回 `hint`。
- Windows 上 broker 通过 WMI 创建，父进程是 `WmiPrvSE`，不再是拉起它的应用的子进程。拿一个「关闭即杀子进程」的 job object 实测：旧写法的 broker 被一起杀，新写法存活。`ZCODE_RELAY_NO_DETACH=1` 可退回旧写法。
- broker 空闲 5 分钟（无客户端）退出，`ZCODE_RELAY_IDLE_MS` 可调。
- 协议未变，仍可被 0.3.0 控制器访问。

## 验证

- `npm test`（即 `node --test test/*.test.cjs`）：27 项，含真实 stdio MCP、named pipe、worker 先起 broker、broker 脱离启动者、两套栈互不干扰。
- `node tools/live-check.cjs`：用 Claude Code 真实的 MCP 启动命令派一个小任务并核对结果。
- 作者的 Windows 机器上，在真实 ZCode 桌面中验证过：Claude 和 Codex 两个路由会话同时在线；两侧同一秒派发、同时完成，各用各的 profile；杀掉 Claude 栈的 broker 后在路由会话说「再打开」，worker 自己拉起新 broker 并重新登记。这些是 2026-10 的本机实测，不代表 ZCode 升级后仍适用。

## 注意

- 目标环境：Windows、Node.js 24、已登录的 ZCode 桌面。WMI 脱离启动只在 Windows 生效，其它平台自动回退到普通子进程。
- 机器重启会带走所有 broker 和路由；ZCode 恢复旧会话后路由需「再打开」。
- 这是 Codex 仓库 0.3.0 代码的分支（同一协议）。Codex 那边在作者本机后续还有未并入仓库的加固改动，两边以后需要统一。
- 未做吞吐、并发上限、成本的量化评估。
