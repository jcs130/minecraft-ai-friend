# MCP 最小用法

优先用 `/mycli status`、`tasks status`、`skills status` 获取精炼文本与当前一步；大版本变化先 `/mycli intro`，按需逐层 `--help`，不用预加载另一套命令表。`skill_retired` 表示旧技能已停用，转本人技能目录，不重复尝试。副本的 `active` 只表示是否已有场次，不能当作是否开放。命令发出、API返回或菜单打开，都不等于已开场、施法生效或奖励入箱；错误先按原因核对，不重放消耗动作。

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

技能仍通过同一个chat动作按需查`/mycli skills --help`。通用技能无需学习，初始职业主动技选职后可用；learn 花点学习节点，prepare 设置武器点击技，cast 才是施放。是否可用、当前点击技和实际施放效果分别核对，不因发出命令就记为成功。原生任务查 `tasks status`，旧公会/专项分区查 `progress guild/training`；目录与下一页从实际回执复制，不猜ID。

失败回执的 `nextCommand` 用于核对或补齐条件，不能把冷却、等级/点数不足、无目标或待确认统一当作可立即重试。组队接受邀请与副本参战是两次独立动作。成功后仍核对实际经验、余额、伤害/治疗或槽位，详情按需看 [原生RPG](rpg-native.md)。

Vortex仍使用同一个chat动作，不增加另一套MCP工具。核对实际 `status` / `profession list` 后按需读[原生RPG参考](rpg-native.md)；初始主动技可用不等于天赋已学会，通用技能无需重学。准入失败按缺项和nextCommand整备，不重复start。资料更新本身不代表游戏已切换。

默认查询用短中文，宿主要解析时才用该入口已声明支持的 `--json`。Vortex 的本人状态回执可能是 `MC_RPG`，旧后端是 `MC_STATUS`；只接受包含实际生命/饱食等读数的状态，不能把同前缀的动作回执或 API ready 当作现场可用。缺项先等读数，不猜成功、不重放写操作。

基础生存技已恢复，按实际 `skills list common` 发现：寒霜、星芒箭、闪现、圣愈、饱食、造物和归乡无需选职或学习。只用原chat动作，施放基础技能不要加`--json`；技能info和list可查询JSON。饱食补饥饿，圣愈只回血。原回执、真实物品/血量/位置才是生效证据，冷却或未知结果不自动重放。

逐步指引候选不新增MCP工具。若本人 `MC_INTRO` 或状态 `MC_RPG` 包含 `guide`，`nextAction` 是实际目标，`verifyCommand` 仅核对；`requiresWorldAction:true` 时没有可代替行动的 `nextCommand`，应调用现有移动、攻击或制作动作。字段缺失时继续按该服实际帮助，不假定候选已发布。不把每轮同一状态查询计为任务进展。

跨世界探索沿用同一个聊天步骤发送 `/aincrad` 或 `/warp aincrad`，无需新 MCP 工具；传送必须核对实际世界/坐标，不能把 `mc_do` 发出命令的回执当成到达。资格与回村入口见 [游玩](play.md)。

主城NPC也用同一个chat步骤：`/mycli world npcs`、靠近后`world talk <ID> <问题>`；结束用`world end`。不要为NPC另接一个控制器或加载整份模组命令表。

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
