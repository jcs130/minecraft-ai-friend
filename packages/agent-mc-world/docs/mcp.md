# MCP：从最少工具开始

通用 MC 核心提供一个游戏身体，不附带主模型或自主循环。Java 1.21.1 为主要目标，Node.js 22+。安装 Skill、MCP 工具发现、运行时启动、服务器认证和进入世界是不同结果。

## 配置与启动

按 [连接](../skills/minecraft-agent/references/connection.md) 准备自己的私有配置和已校验的核心包。在宿主的 MCP 配置里设置：

```json
{"mcpServers":{"minecraft":{"command":"node","args":["/absolute/install/node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs","/absolute/private/client.json"]}}}
```

路径须改为本机绝对路径；其他宿主按自己的配置格式填写同一 command/args。已有同账号身体时复用它，不再启动一个连接。默认用本地 stdio；stdout 留给 MCP，日志走 stderr。工具发现不连接游戏。

## 最小操作

下面是 MCP `tools/call` 的 name/arguments 示例。工具名以默认 `mc_` 前缀示意，以实际 tools/list 为准。

先查连接状态：

```json
{"name":"mc_connection","arguments":{"action":"status"}}
```

需要的工具按需展开，不把完整目录和全部 schema 反复送进上下文：

```json
{"name":"mc_tool_help","arguments":{"name":"mc_do"}}
```

获得当前账号的接入授权后，明确连接：

```json
{"name":"mc_connection","arguments":{"action":"connect"}}
```

`phase=started` 只说明运行时已启动。核对实际连接就绪、当前世界/出生位置和新事件；装有登录插件的服务器还须获得该插件的权威认证确认。`connection=null` 或过期观测是未知，不能推断已经登录或已经断线。凭据由私有登录配置处理，见 [登录生命周期](server-auth-lifecycle.md)。

读取本人现场及事件：

```json
{"name":"mc_protocol","arguments":{"protocol":"agent-mc/v1","action":"facts"}}
```

```json
{"name":"mc_events","arguments":{"after":0,"limit":16,"waitMs":0}}
```

后续读取同时传回上一页的真实 `run` 和 `nextCursor`（后者作为 after）。游标错误按回执给出的恢复查询读取；出现 gap 或 run 变化后重新核对现场，不借用旧连接的游标。

动作通过已有 `mc_do` 或当前身体明确提供的脚本工具。聊天步骤的形式如下；实际命令按目标服务器的帮助选择：

```json
{"name":"mc_do","arguments":{"steps":[{"skill":"chat","text":"/help"}]}}
```

这只证明命令提交；动作是否生效要等原 ID 的终态和服务器回执，并核对位置、物品或方块变化。超时/断线结果未知时先查原动作，不能换 ID 自动重放。较长动作运行时继续消费事件。

主动断开：

```json
{"name":"mc_connection","arguments":{"action":"disconnect"}}
```

## 三种帮助与状态

| 问题 | 入口 |
| --- | --- |
| 这个 MCP/SDK 身体连上了吗 | `mc_connection action:status`；SDK `status()` |
| 当前实际读到什么 | `mc_protocol action:facts`、对应观察工具与事件 |
| 工具参数怎么填 | `mc_tool_help name:工具名`，仅展开返回的子路径；full:true 查完整选中节点 |
| 原生动作、技能或脚本接口怎么用 | `mc_help`，或已提供的 `mc_script api:index` / routine list/read |
| 服务器有哪些玩法命令 | 该服务器自己的帮助；通用核心不预置千灯纪职业/公会规则 |

服务器技能提示文本与 MCP 工具 schema 是两层契约。服务器的 `--json` 不能加在 MCP arguments 之外，也不保证每个游戏命令都支持。原生协议和程序状态仍保留结构化数据；减少上下文靠按需查询，不靠删除结果身份、未知状态或失败证据。

## 屏障、回合与 SDK 区别

MCP 的 tools/list 含连接、事件和 `mc_protocol` 包装工具；原始 SDK `tools()` 是身体工具目录，不要求包含这些名字。SDK 对应 `connect/disconnect`、`events`、`currentFacts` 和 `beginTurn/endTurn/acknowledgeBarrier`。

遇到 barrierAfter，先读取回执，然后用 `mc_protocol` 的 `action:"ack_barrier"`、`protocol:"agent-mc/v1"` 和回执原 requestId 作为 id 明确确认。不要猜 ID。脚本 SDK 可显式选择 `autoAcknowledgeBarriers:true`；默认仍手动确认。`mc_stop` 和 disconnect 可用于停止，不受既有屏障拦截。

只有宿主实际开启的决策回合才使用 begin_turn/end_turn，RPC 完成不会自动结束它。等待请求取消与已受理身体动作停止不同；详见 [协议](protocol-v1.md)。

## 节省工具目录上下文

MCP 默认保持完整目录以兼容现有调用端。自己嵌入 MCP 服务的宿主可选择已有选项：

```ts
createMinecraftMcpServer(runtime, version, { catalog: 'compact' });
```

这会缩短初始工具说明，实际参数验证仍用原 schema；`mc_tool_help` 可按需取回原定义。该选项不隐藏工具、不改变身体权限，也不是 stdio 命令行参数。只读工具发现可离线验证；连上服务器、正确渲染和自主完成任务分别验收。

## 千灯纪适配

千灯纪在独立 Skill 里附加 `mc_qiandengji` 与可选 `mc_portal`。前者是本连接已收到数据包的历史缓存，后者是网站保存资料；两者都不主动刷新游戏现场或授予登录权限。具体入口见该 Skill 的 references/mcp.md 与 references/play.md。通用核心不会安装或假定这些扩展，也不要求用户更换 Agent 框架。
