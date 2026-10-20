# 桐人使用 QwenPaw 原生能力的核验

**后续实现候选：** 已完成原生游戏频道、预加载Skill、短Goal、ReMe持久化/新进程召回和低频心跳验证；尚未切换正式服。见 [候选实现与验收](QWENPAW_NATIVE_GAME.md)。下表记录此前正式版本的只读核验。

2026-10-20，实际运行版本 QwenPaw 2.2.2；角色 `ag_Kirito`，Agent `mc-kirito`。这是只读核验，没有借此启用宿主机工具、计划、心跳或修改其他 Agent。

## 结论

核心大脑正在使用 QwenPaw 原生 Agent。游戏适配器负责游戏通信、回执和事件入口；推理、工具循环、会话、上下文及工具治理由 QwenPaw 执行。后续深查发现：2.2.2 的 Plan Mode 实际暂不可用，应优先评估原生 Goal；游戏 Skill 和自动记忆检索仍未启用。完整结合方案见 [原生能力结合研究](QWENPAW_GAME_INTEGRATION.md)。

| 能力 | 实际状态 | 依据或边界 |
| --- | --- | --- |
| Agent 推理与工具循环 | 原生 | `backend=qwenpaw`；原生 Console Channel 进入 `QwenPawAgent` / AgentScope Agent，实际模型完成3次游戏查询 |
| 模型和调用限额 | 原生 | 原生 Provider 引用 `qwen3.7-plus`，并发1、每分钟12次、最多12轮；适配器不直接调用模型服务 |
| MCP 工具接入 | 原生驱动 | 原生工作区 MCP driver 启动 stdio 游戏适配器；提供8个本角色工具，游戏权限和消耗保持 |
| 会话、历史和检查点 | 原生 | 原生 Chat Manager / Task Tracker、工作区 sessions 和 checkpoints；生产事件使用独立稳定会话 |
| 上下文管理 | 原生 | `context_manager_backend=light`，原生中间件和压缩链路 |
| 长期记忆框架 | 已配置，验收不完整 | `remelight`；手动搜索开放，自动检索关闭；实际自动沉淀enabled=true、每5个外部用户回合，工作线程空闲无错误；沉淀/跨会话召回仍待验 |
| 原生计划模式 | 当前版本暂不可用 | `plan.enabled=false`；实际 `/plan` 返回暂不可用，不能靠打开配置获得；当前 `todo` 是 Numen 游戏工具 |
| 框架游戏 Skill | 未配置 | 没有已启用的千灯纪 Skill；当前基本指引在工作区提示和游戏 `/mycli` 中。MCP 的 `skill` 工具是 Numen API 资料，不是 QwenPaw Skill |
| 原生主动心跳 | 未启用 | `heartbeat.enabled=false`；当前由真实游戏事件触发，空事件不循环调用模型 |
| 宿主机内置工具 | 全部关闭 | 文件、命令行、浏览器、桌面等通用工具未开放；这不影响原生 MCP 和独立注册的记忆工具 |

`auto_memory_inbox_push_enabled` 等配置控制记忆通知；关闭通知不能被描述为关闭了全部长期记忆。已有会话文件同样不能代替长期记忆召回验收。

## 游戏桥的具体职责

桥位于 `paper/integrations/numen-paper/qwenpaw/numen_controller.py`，正式安装副本为 `E:/MC/ops/numen-qwenpaw-controller.py`：

- 使用原生 Brain 凭据连接本机 Numen MCP，固定为旧桐人 UUID，并通过进程锁保持单实例。
- 转发游戏工具并串行执行动作。`command` 使用同一次原始命令结果，完整保留长 JSON；未知结果不自动重放。
- 每次最多等待10秒读取原生收件箱，合并、去重、记录实际事件。模型回合至少间隔15秒。
- 将事件提交到 QwenPaw 原生 `/api/console/chat`，由其原生会话和 Agent 执行。适配器本身没有模型调用 SDK 或另一套推理循环。
- 保存有限的通信日志与未知结果记录；这些不是 QwenPaw 长期记忆的替代品。

Numen 内脑在当前控制期间为 `hold=EXTERNAL`，普通玩家私聊已实际唤起 QwenPaw，并通过原版私聊回复原发送者。

## 优先补齐顺序

1. 先以原生 Goal 评估有预算的短目标；Plan Mode当前不可用。与 Numen 身体任务分清，目标完成须核对服务器回执。
2. 验证 ReMe 写入与召回，再启用有预算的自动检索。游戏实时状态继续以服务器查询为准；旧记忆不能覆盖当前库存、任务或权限。
3. 增加一个简短的 QwenPaw 千灯纪入门 Skill，只给 `/mycli help`、`status`、`tasks status` 和安全操作方法，具体玩法仍在游戏内学习。
4. 如需无人交谈时持续自主生活，先统一身体执行会话，再配置低频 Heartbeat；本机心跳使用main会话，target只影响回复投递，不能直接假定与游戏事件串行。

后续接入优先复用上述原生机制。宿主机命令行、浏览器或多 Agent 委派并非完成 Minecraft 行动的前提，不因“使用原生能力”而全部开启。

## 本次已验证与未验证

正式服：3次实际 QwenPaw 只读工具调用完成，39项技能33383字符完整收到；普通非主人私聊的4项事件/回复检查通过。旧身体身份、背包、职业和技能点核验另见 [接管记录](KIRITO_QWENPAW.md)。

原生计划执行、框架游戏 Skill、长期记忆形成与跨会话召回、原生主动心跳、16个自主模型并发没有在本次宣称完成。完整记录见 [发布清单](../manifests/numen-kirito-qwenpaw-release-20261020.json)。
