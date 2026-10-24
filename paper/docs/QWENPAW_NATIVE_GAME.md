# 桐人的 QwenPaw 原生游戏接入

**2026-10-25，正式原生频道为0.3.1，多会话与PowerContext见 [认知接入](QWENPAW_COGNITION.md)。** 循环优化已按原生角色停止／启动流程上线，110项检查通过、6项既有独立联机条件跳过。原身体、8项游戏工具和心跳已恢复，生产有效窗口64000已核对；实际任务效果及长动作阻塞另见[日常循环](QWENPAW_AUTONOMY_LOOP.md)。本页下方保留0.1.0历史记录，不能当作当前配置。

2026-10-20初版记录。**下文为0.1.0隔离候选历史，已由0.2.1替代。** 本候选不包含 Paper JAR、玩家物品或 YSM 变更。

## 实现

| 功能 | 使用的原生能力 | 游戏适配部分 |
| --- | --- | --- |
| 游戏消息入口 | `BaseChannel`、Channel Manager、Task Tracker、原生队列 | 通过已有 MCP driver 读取身体事件；不另建 Brain 连接 |
| 单一行动会话 | 原生频道、会话和运行期 Hook | 固定身体 UUID、user、session；整轮互斥，控制台请求转交真实游戏频道 |
| 入门 | 原生 Skill 注册、预加载和 Prompt Contributor | `qiandengji-start` 正文521字符，只放 `/mycli` 入口、背包区别和动作确认规则 |
| 短目标 | 原生 `/goal`、目标工具及停止门 | 3个外层目标回合、64000 token预算；仍最多12个内层工具循环，游戏完成靠服务器回执 |
| 长期经验 | ReMe 自动整理、`memory_search`、原生自动检索 | 正式候选保持每5个外部用户回合整理；自动检索最多2条 |
| 主动检查 | 原生 Heartbeat Scheduler | 10分钟一次；离线或忙碌跳过，先只读查状态；健康且没有原生目标时不调用模型 |
| 私聊 | 原生消息处理生命周期、原版 `/minecraft:msg` | 整轮结束才考虑最终回复；已用身体工具说过则不补发；多发送者由明确 `/msg` 分别回复 |
| 公开执行状态 | 原生 `on_acting`、`on_system_prompt` | 有界文件投影，只写身份、代次、状态、工具名及实际预加载 Skill 名 |

QwenPaw 2.2.2 的旧 `/plan` 仍是迁移占位，保持关闭。PawApp SDK 是插件系统的应用包装；本轮用官方频道与生命周期扩展接入游戏，不增加一套模型推理循环。宿主机命令行、浏览器和文件工具保持关闭。

## 关键约束

- 同一个身体只有原 stdio MCP driver 持有 Brain 凭据。`event_transport=channel` 时关闭旧 Console 自动分发；`events` 返回有ID的快照，频道使用SQLite去重，模型读取快照不会偷走频道事件。
- 控制台请求先转交游戏频道，不在执行中改写请求身份。这样会话保存、原生用量统计、Goal预算和停止操作使用同一标识。
- 原生队列之外还有整轮锁，覆盖会话加载、完整执行和保存；不同优先级不能交错操作身体。取消时在原生 `FINALLY` 释放。
- 游戏文字带固定数据包装，不能作为 `/goal` 等框架控制命令执行。可信控制台可明确启动短目标。
- 中断、超时和断线不重放动作。事件投递账本保留未知结果；`delivered_or_unknown` 仅说明通信生命周期结束，不表示游戏任务成功。
- 私聊自动补发只接受服务端 `talk` 事件的首部，并再次用原版在线 UUID 名单核对用户名。Numen 0.1.4 的该事件没有发送者 UUID 字段；未核实或多个发送者时不自动转发最终文本，更不会转公屏。
- 工具输出、中间解说、模型切换通知不送进游戏聊天。明确的游戏发言工具仍实际发言，受正常玩家权限限制。
- 心跳默认的 `main` 请求在构建模型前转交游戏频道；保留 `source=heartbeat`，遵守原生记忆中间件对自动化来源的排除。
- ReMe 笔记异步整理。助手说“已记录”不是持久化凭据；验证须查实际笔记与原生搜索结果。当前库存、任务、坐标、魔力和冷却每次重新查服务器。

## 配置摘要

工作区 `qiandengji.json` 仅包含本角色配置：

```json
{
  "enabled": true,
  "companion_uuid": "8e7b99e0-595d-3402-935c-7139ac6814e3",
  "player_name": "ag_Kirito",
  "session_id": "kirito-production-8e7b99e0-595d-3402-935c-7139ac6814e3"
}
```

原私有控制配置增加 `event_transport: "channel"`、`auto_wake: false`。MCP驱动及八个工具名称保持，凭据继续引用受保护文件。框架频道设置为 `channels.qiandengji.enabled=true`、`driver=kirito-world`，关闭工具和思考的聊天显示。

### 控制和停止

在控制台给桐人明确下达 `/goal 只读检查当前委托并报告下一步`，请求会进入“桐人的游戏生活”会话。也可通过现有本机 `/api/console/chat` 指定上述session、`channel=qiandengji`、`user_id=body-<身体UUID>`。

停止使用原生接口 `POST /api/console/chat/stop?chat_id=<游戏会话的ChatSpec.id>`，请求头 `X-Agent-Id: mc-kirito`。停止的是游戏会话；转交请求的控制台会话已经结束。取消后先查实际身体任务、位置和库存，再决定是否继续。

默认心跳只延续已有获准目标或处理生存需要；没有目标且状态正常时安静待机，不自动接单、领奖、交易或开始远征。

### 公开状态

`game-public-status.json` 包含真实身体UUID、账号、epoch、sequence、时间、状态、工具名和有效预加载Skill名称。`tool_sent` 是发出工具，`receipt_received` 是收到回执，`unknown` 是未核实；三者不能当作任务验收。

该文件没有原始私聊、提示、工具参数、记忆正文、密钥或模型内部推理，也不编造路径。现有 Web 的 `getAgentStatus` 消费者可以接这个投影；**本轮没有把文件自动接到远端 Web/OBS，也未改变共享渲染器**。

## 验证

固定环境：QwenPaw2.2.2、AgentScope2.0.10、ReMe0.4.1.11、Python3.12；隔离Paper1.21.1，独立回环端口和工作区。

- 46项单元检查通过（29原生接入、17原适配器）。另6项旧独立联机测试默认跳过，未计入通过数。
- 真实模型通过本轮三个 `/mycli` 只读查询与 `update_goal(complete)`；原生Goal结束。实际有效提示包含入门Skill。
- 两个普通玩家同时私聊，各自只收到一次指定回复；未串人、未在公屏回复。
- 实际原生心跳经过同一游戏会话；加入廉价预检后，健康空闲的一次定时检查只有1次只读命令、0次模型调用。
- ReMe实际生成带隔离标记的笔记。关闭该Agent后，新进程仅启动原生记忆管理器，不载入对话；用不含暗号的关键词搜索，最多2条结果，实际查回暗号与来源路径，返回3933字符。
- 测试与生产工作区、记忆、令牌作用域和对话分开。未验证16个自主模型负载、完整战斗/探索目标、远端Web、Fabric或基岩实际画面。

保留的早期失败：新建Agent与立即修改配置导致MCP可选服务启动竞态；在运行中改会话ID导致用量统计留在旧键；测试调低记忆间隔后积压的旧回合先整理，首次等待最新暗号超时。正式候选采用停用→完成配置→启用；请求经真实频道进入；记忆以实际落盘和新进程搜索验收，不把首次失败改写为成功。

## 安装和回退

1. 固定本候选源码和摘要，备齐E/F两盘候选及回退前像；核对正式角色配置未被其他维护改动。
2. 停用桐人的QwenPaw角色并等原驱动退出；备份工作区、全局配置、已安装控制器及私有控制配置。玩家身体保留。
3. 用官方本地插件安装接口安装 `native_plugin`。**该接口会重载所有QwenPaw Agent**，因此上线需先确认这个影响范围；Paper不需要重启。
4. 安装并启用/预加载入门Skill，写本角色频道及限额，更新原控制器与传输开关，再启用桐人。验证原UUID、八工具、实际查询和记忆状态。
5. 回退时先停用桐人，再恢复原控制器、私有配置、提示和角色配置，关闭本工作区游戏频道，恢复旧Console事件入口。新产生的记忆、游戏会话和账本保留，不回写旧世界或玩家背包。

本机证据及准备目录：`E:/MC/ops/repairs/qwenpaw-native-game-20261020/`，双盘副本对应 `F:/MC-backups/repairs/`。生产切换状态见该目录部署回执。

官方资料：[频道与Bot配置](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/website/public/docs/channels.zh.md)、[插件及原生频道/中间件](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/website/public/docs/plugins.zh.md)、[REST API](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/website/public/docs/api-tutorial.zh.md)、[PawApp SDK入口](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.2/src/qwenpaw/pawapp/__init__.py)。
