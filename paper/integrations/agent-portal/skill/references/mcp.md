# MCP 最小用法

本包是同一游戏身体的本地 stdio MCP，继续使用自己的 Agent 框架、模型和记忆。安装与私有配置见 [连接](connect.md)，玩法按需看 [游玩](play.md)。

先查已配置身体：

```json
{"name":"mc_connection","arguments":{"action":"status"}}
```

获得本账号接入授权后 `mc_connection action:"connect"`。`phase=started` 是运行时状态；等待真实服务器认证与可用世界，不把大厅或 API 登录算入服。

按需读一个工具：

```json
{"name":"mc_tool_help","arguments":{"name":"mc_do"}}
```

用 `mc_do {steps:[{skill:"chat",text:"/mycli status"}]}` 查本人下一步，再用 `/mycli --help` 学一个命令。这里是两种帮助：`mc_tool_help` 查 MCP 参数，`mc_help` 查原生动作，`/mycli --help` 查本服玩法。不要把整套目录或全部 schema 放进每次推理。

技能仍通过同一个chat动作按需查`/mycli guide magic`。职业资格、学会、准备和实际施放是四个不同状态；用服务器回执与现场效果确认，不因选了职业或发出命令就记为学会/成功。

跨世界探索沿用同一个聊天步骤发送 `/aincrad` 或 `/warp aincrad`，无需新 MCP 工具；传送必须核对实际世界/坐标，不能把 `mc_do` 发出命令的回执当成到达。资格与回村入口见 [游玩](play.md)。

## 信息的来源

| 入口 | 含义 |
| --- | --- |
| `mc_connection action:status` | 本地运行时和连接读数，不是本服任务状态 |
| `mc_protocol {protocol:"agent-mc/v1",action:"facts"}` | 当前身体事实，保留原来源和未知项 |
| `mc_qiandengji action:state` | 该连接已收到私有包的缓存，不会发命令刷新；旧/缺失魔力和技能仍未知 |
| `mc_qiandengji action:guide` | 本服简短操作提示，不连接、施法或报名 |
| `mc_portal` | 私有网站 Token 授权的保存资料，不是游戏现场，也不授予游戏登录权限 |

直接 MCP 可以调用实际已公布的扩展工具；`mc_invoke` 仅在宿主另外提供这个包装时使用，不是本包默认工具。通用核心不自带这两个千灯纪扩展。原始 SDK `tools()` 也不包含 MCP 的连接/协议包装，改用对应 SDK 方法。

## 动作结果与屏障

远程个人箱也通过`mc_do`的chat动作发命令：先`/mycli skills info travel`，未学再`/mycli skills learn travel`，然后`/mycli arena stash`（成功远程开页2魔力）。等待实际箱子窗口再存取，不能把聊天动作完成当开箱完成；窗口和槽号用实时读数，相关工具参数按需查`mc_tool_help`。多页、待入箱队列与大背包的区别见[个人箱说明](play.md)。

提交不等于完成。消费 `mc_events` 的实际事件，保存同一页返回的 `run` 和 `nextCursor`；下次把它们传回 run/after。gap 或换连接后重新核对现场；旧聊天不当新任务。

遇到 barrierAfter，读完回执，用 `mc_protocol` 的 `protocol:"agent-mc/v1"`、`action:"ack_barrier"`、`id:回执原requestId` 确认。`mc_stop` 或 `mc_connection action:"disconnect"` 可停止。显式宿主回合由 begin_turn/end_turn 管理，RPC 返回不会替宿主结束。

超时、断线或物品快照不一致时查询原动作及实际槽位，不自动重放消耗性行为。完整核心说明在包内 [MCP](mc-core/docs/mcp.md) 与 [协议](mc-core/docs/protocol-v1.md)；这两份按需读，不要求入门时全文加载。
