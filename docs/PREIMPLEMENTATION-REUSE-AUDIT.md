# 桐人优化前：现状、复用边界与最小修复顺序

审计日期：2026-09-20。运行统计固定到北京时间 08:53:28；后续补查技能资格与隔离 fixture。本文是实施前审计，没有部署新的调度、执行或语音功能。

结论：项目已经具备原生后台身体任务、受限多步程序、语音队列、消息回执、持久会话与增量上下文。当前优先事项是恢复已有程序的有效测试资格、修正外部任务回执契约、拆开聊天与身体动作的调度条件。此前拟议的“新执行器、新语音队列、新身体仲裁器”应取消。

## 1. 审计对象与证据边界

- 生产挂载源码：`D:\Projects\QiandengJi`，`codex/performance-foundation`，HEAD `706317fa9f391c9ef20f111b36a997050ac63da3`。存在未提交修改；运行代码不能仅用这个 HEAD 描述。
- 增量会话工作区：`D:\Projects\QiandengJi-context`，`codex/survivor-context-session`，本次审计开始时 HEAD `da7334e`。本次只在此提交审计说明。
- 生产目录同时包含前轮部署的上下文改动，以及 `standing_task.py`、对应测试、`operations_native_tasks.py` 等其他在途改动。本次不接管、回滚或混合提交这些文件。
- 检查覆盖 Docker 服务状态、挂载与版本、实际 MCP 清单、QwenPaw 配置和健康校验、近期决策/动作记录、程序技能资格、语音回执，以及身体—控制器—会话—语音的相关源码。没有逐行审计全部模组、网页、公会和世界内容。
- 本次没有提交新模型任务、发起游戏动作、发送聊天、做真人麦克风/播放测试或重启生产服务。读取运行状态会与自然运行并存，统计采用明确截止时间。

原始探针和快照保存在本机工作区的 `runtime/preimplementation_audit.json`、`runtime/audit_runtime_probe.py`、`runtime/audit_jar_contracts.py`、`runtime/audit_skill_eligibility.py` 等忽略目录，不作为公开源码提交。

## 2. 实际部署基线存在漂移

13 个项目容器运行：11 个 healthy，QwenPaw unhealthy，gate 无健康探针。游戏 QwenPaw 镜像为 `qiandengji-qwenpaw-game:2.2.1-memory1`，survivor 为 `qiandengji-survivor:2.2.0-autonomy23`；后者的镜像标签不能解释为当前 QwenPaw 版本。旧运营 18090 环境没有运行，不应按旧文档重新启动。

Numen 实际部署为 NeoForge 1.21.1 / 0.1.3。宿主文件与 Minecraft 容器内挂载文件哈希一致：

| 文件 | SHA256 |
| --- | --- |
| `numen-neoforge-1.21.1-0.1.3.jar` | `9591136eea7eb68e7914e31c8627474a1925c11eb675f076e209620afcd9508d` |
| `numen_act-neoforge-1.21.1-0.1.3.jar` | `a3af5d075068c4cbf5bd0ad3d7fec953065fe8cffca7816c1414519d0d818699` |

`manifests/numen-upstream.lock.json` 的部署哈希仍为 `bda81485…`，与现役文件不符；[旧来源记录](NUMEN-UPSTREAM-RECORD.md) 仍描述 0.1.1。不能仅更新清单里的哈希就宣称来源已核实，需先对应源代码、构建产物和部署记录。

QwenPaw 完整健康校验在 `role_learning_profiles.validate_jobs:text_drift` 失败，逐角色只读复核发现全部 10 个现役角色均有此项漂移。同时原生角色状态接口可访问，审计窗口内有完成任务。因此这是需要处理的配置/校验契约问题，不能直接等同推理服务停机，也不能靠覆盖现役提示词或放宽探针凑绿。

其他旧文档也有失效描述：快慢系统文档中的每日 48 次、180 秒冷却，语音文档中的“队列待实现”，均不能代替当前配置与代码。

## 3. 已有能力与复用决定

| 能力 | 当前实现和边界 | 决定 |
| --- | --- | --- |
| 假玩家身体控制 | Numen `Input`、`ExecHarness` 处理移动、视角、跳跃、攻击/使用及原生交互；长动作由游戏 tick 执行 | 保留。控制语义接近键鼠，但不是操作系统输入注入，无需换成 Mineflayer |
| 原生后台任务 | `TaskDispatch` 短任务同步、长任务立即受理；`TaskSlot` 管理当前任务、抢占及恢复 | 保留；它不是任意多步骤 FIFO，不能把 Cortico 队列的全部能力算作已经拥有 |
| 多步骤程序 | `skill_library.py` 的 QuickJS `next(state,memory)`、版本/fixture/晋升；`tick_skill` 持久任务、等待、感知及执行证据 | 复用现有 `skill_start`，不新建程序执行服务或任务库 |
| 身体所有权 | Numen `CompanionBrain` / `TaskSelector` / 原生反射；项目动作租约、防重与未知结果处理 | 保留，不另加 Neko 式仲裁器叠在上面 |
| 语音 | `SpeechTools` → `SpeechBroker` / `SpeechWorker` → `SpeechLane` / `TtsQueueWatcher` | 已有排队、取消、过期、缓存和实际回执，不新建 TTS 队列 |
| 消息 | `perception.py` 游标/待处理事件、伙伴收发/听见回执、既有麦克风 ASR 入口 | 复用现有通路，修收件人与调度边界 |
| 会话和记忆 | QwenPaw 持久 session、Scroll、ReMe；现役 `contextProtocol=2` 行为会话与增量投递 | 保留，避免新增 Agent 循环或再复制历史 |
| 失败反馈 | 已有停滞、环境处罚、模式检测、学习/复盘任务、常驻任务回收 | 先验证现有分支，不继续叠加监督器和守护循环 |

`world/survival/character_speech.py` 与 `world/sidecar/character_speech.py` 内容相同，并有一致性测试；这是现有打包方式，不能仅凭两份文件就删除其中一份。

## 4. 最具体的复用障碍：两个技能当前无法启动

本次检查桐人的本地技能目录发现两个已晋升程序：`craft_sticks` 与 `farm_harvest_replant`。本地目录数量不代表共享库总量。

两份 activeVersion 的原测试报告均为 passed、7 个用例、QuickJS 引擎 `0.16.2.1`，但测试内核哈希为 `bd6ada4e…`；现役容器 `/survival/skill_library.py` 的实际内核哈希为 `5905a54a…`。`SkillLibrary._tested()` 明确要求精确匹配。

在生产容器只调用读取资格证据的 `_tested()`，两个版本均返回 `matching_passed_tests_required`。没有调用 `skill_start`，没有重写生产测试报告或晋升记录。随后把相同 activeVersion 和 fixture 复制进无网络、只读挂载源数据的临时容器，用当前源码重新测试：两个程序各 **7/7 通过，共 14/14**。

这说明现役资格检查会挡住这两个程序，隔离结果也支持优先重新验证原版本。不能据此断言它解释了全部导航空转，更不能把 fixture 通过当作农耕产出已经完成。

当前最近一份 `skill-job.json` 仍来自 9 月 14 日；统计窗口内没有新程序运行，08:53 快系统 active=false。下一步应走已有测试/使用流程恢复资格，不改旧报告 hash 冒充验证，不重写两份技能，不由控制器擅自启动模型未选的程序。

证据入口：[skill_library.py](../world/survival/skill_library.py) 的 `_kernel_version` / `_tested`，以及 [mcp_server.py](../world/survival/mcp_server.py) 的 `SkillTools.start`、[controller.py](../world/survival/controller.py) 的 `tick_skill`。

## 5. 外部任务回执与实际完成通道不一致

源码和现役 JAR 的相关类常量相互印证：

1. Numen `TaskRecord.EXTERNAL_CALL_PREFIX` 是 `mcp-`，通过 call ID 前缀区分外部调用。
2. `TaskDispatch` 给内部调用返回“完成会自动收到 task_finished，不要轮询”；给外部调用返回依赖状态查询与感知的说明。
3. `CompanionBrain.shipResults()` 将内部异步完成送往 Numen 的事件/客户端通路；外部异步调用跳过这条通路，以免唤醒没有发起任务的内置大脑。
4. 我们的 `NumenActCommand` 经 RCON 调 `onServerCall`，call ID 使用普通 `UUID.randomUUID()`，没有外部前缀。因此走到了内部回执分支。
5. QwenPaw 侧 `WorldPerception` 读取现有 JSONL 世界通道，没有订阅该 Numen 客户端完成事件。当前实际动作回执也出现了“会自动收到事件”的承诺。

当前网关仍靠轮询与位置/身体状态确认。`TaskStatusTool` 不保存可查询的历史终态，网关 `_observed_arrival` 在身体空闲后以到达距离等证据补确认。这能解释为什么“原生支持后台执行”并不等于“QwenPaw 已收到对应完成事件”。

最小修复必须先统一调用归属、准确回执与完成证据。仅补 `mcp-` 能修正身份/提示，不能声称已经接通完成事件；优先调查已有 outbox、公开扩展点和现有动作账本的适配，避免新造事件总线或唤醒第二套内置 LLM。

证据入口：[TaskRecord](../world/numen-src/api/common/src/main/java/com/dwinovo/numen/task/TaskRecord.java)、[TaskDispatch](../world/numen-src/api/common/src/main/java/com/dwinovo/numen/task/TaskDispatch.java)、[CompanionBrain](../world/numen-src/api/common/src/main/java/com/dwinovo/numen/task/CompanionBrain.java)、[NumenActCommand](../world/numen-actuator-src/neoforge/src/main/java/com/dwinovo/numen/actuator/NumenActCommand.java)、[perception.py](../world/survival/perception.py)、[numen_gateway.py](../world/survival/numen_gateway.py)。

## 6. 边做事边聊天：卡在入口与授权生命周期

控制器当前分支顺序为：已有模型任务则只轮询；动作在途则等待确认；身体 busy 则标记 acting / 检查常驻任务；只有身体空闲，才运行程序推进及 `submit_model()`。伙伴 `party.pending()` 在 `submit_model()` 内取出，因此身体长期忙或程序持续工作时，待回复消息没有独立获得一次决策的机会。

与此同时，已有 `speak` 可以在有效模型轮内、身体动作继续时排队播放，所以“现在所有说话都阻塞游戏”是不准确的。真正需拆开的是新对话的准入、调度、权限和回执生命周期：当前 `SpeechTools` 复用动作租约，`skill_start` 又会关闭该租约。不能直接删掉 busy 判断，再让两个任务覆盖同一动作租约或同时写同一会话。

生产目录另有在途 `standing_task.py` 与 13 项通过的测试，用于超时收回无终点任务。应保留并核对这份现有工作，不再添加同功能 watchdog；回收常驻身体任务本身也不等于实现聊天并行。

QwenPaw 现役模型为 `qwen3.5-plus`，thinking off，QPM=0，原生 iteration 限制关闭；存储的旧 `max_iters=12` 不能直接当作有效迭代上限。本地模型并发容量仍为 **1，按 provider:model 共享**，从安装版 limiter 的 key 和获取路径核实。拆 session 不会自动消除模型排队。应先用原任务流/回执区分等待模型槽、生成、工具、身体执行和控制器唤醒的耗时。

外层观察周期为 15 秒；这与游戏 tick 中的连续身体控制是两种节奏。旧记录中的 58–148 秒属于完整模型任务耗时，不能称为单次推理延迟。`adaptive_router` 虽有多个等级建议，但当前调用端主要处理 SKIP，其余仍走同一 `submit_model`，不能宣称多档推理策略已经全部生效。

## 7. 语音通路已存在，实听证据尚不足

现役 MCP 有 46 个启用工具，包括 `speak`、`speech_status`、`stop_speaking`、`skill_start`。桐人语音档案 enabled；现有队列包含演员绑定、持久请求 ID、取消代次、过期与缓存。Java `SpeechLane` 已有逐演员播放及等待队列。

本次保留数据中，桐人共有 **526 份语音请求/回执，全部 failed，错误码均为 `no_voicechat_listeners`**。这是当前留存集合，不是承诺完整历史。统计窗口内新增请求为 **0**。

这些证据说明已有播放链路尝试过工作，并记录了没有合格 SVC 接收客户端的失败；不能推出“没有语音队列”，也不能证明 TTS 和真人实听已经验收。后续应在正常真人客户端具备接收条件时核实 heard/played 及实际音频，单独保留发送、播放与听见的区别。

麦克风 ASR → `voice-command-inbox` → `goddessChat` 路径也已存在，当前默认进入灯语女神会话，并非自动进入桐人。需要的是明确收件人后的复用。对 config、world/src、sidecar、survival 的检索未发现可确认的 B 站弹幕运行入口；这不是全仓无任何相关代码的证明。先跑通现有游戏内对话，直播弹幕接入作为后续独立需求。

## 8. 实际运行表现，不能用“任务完成率”替代产出

固定统计窗口：2026-09-20 **08:05:47–08:53:28（北京时间）**。

| 项目 | 观察结果 | 含义 |
| --- | --- | --- |
| `decision_finished` | 20，均为 completed | 20 次调度任务结束，不是 20 次供应商请求，更不是 20 个游戏目标成功 |
| `action_observed` | 12：goto 完成 7 / 失败 4，eat 完成 1 | 当前主要是移动与进食，不能称复杂生产任务稳定 |
| 记录到的库存变化 | 面包 -1 | 此窗口未取得采集、制作、建造或交付产出的对应证据 |
| 程序执行 | 无新程序运行；截止时 fast.active=false | 与“拥有技能库”区别统计 |
| 语音请求 | 0 条新增 | 未验证本次上下文优化后的实时语音互动 |
| survivor readiness | ready=true，contextProtocol=2 | 相关就绪检查通过，QwenPaw 总健康仍有上述 text_drift |

行为会话与增量上下文已部署，详见[实施记录](SURVIVOR-INCREMENTAL-CONTEXT.md)。应用只追加新输入，并不保证供应商网络请求只发送增量；QwenPaw 仍可能组装必要上下文。程序/动作受理、模型完成、物理完成、目标达成、长期掌握应继续分开记账。

## 9. Cortico / Neko 的借鉴范围

两个仓库已经在 `D:\Projects\QiandengJi-rsi-study\runtime\reference-repos` 克隆，并按固定源码核对；本次没有运行它们替代生产角色。

- Cortico：`7d20a1029d69e5f8b3a968d476419d0ddfe6b786`。[executor.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/executor.ts) 的步骤队列、暂停恢复及独立任务状态，[core/loop.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/core/loop.ts) 的输入处理，以及 [bilibili/coalescing-buffer.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/bilibili/coalescing-buffer.ts) 展示了执行与高频消息汇聚的边界。适合借鉴契约和调度方式，不需复制整套执行层。
- Neko：`23f5971203e3f4d15ef416ff8e5cc67965845d82`。[action_manager.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/action_manager.js) 与 [framework/arbiter.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/framework/arbiter.js) 提醒我们核对动作所有权的真实领取/释放，而不仅是有没有仲裁类。本项目已有身体与动作租约，应补覆盖缺口，不能叠一套相互争用的仲裁。

这些是源码机制对照，未进行三项目同模型、同世界、同任务的性能基准。不能仅凭展示效果断言它们在所有情况下更快，或将 Mineflayer 的便利等同于必须更换假玩家。

## 10. 收缩后的实施顺序与验收

| 顺序 | 最小工作 | 验收边界 |
| --- | --- | --- |
| 1 | 核对源码、在途修改、JAR 来源和部署清单；按原流程重新测试现有 activeVersion，恢复有效资格；查明学习任务 text_drift 的预期契约 | 原技能保持原版本、真实测试报告匹配当前内核；不改 hash 凑绿；在途修改归属清楚 |
| 2 | 修正 RCON 外部调用身份、回执措辞与完成证据传递 | 受理/完成能按同任务关联；未知结果不重放；不会触发另一套内置脑 |
| 3 | 在原控制器和 QwenPaw 中拆开对话准入与身体动作许可，复用消息/语音队列 | 做长动作时可接收并处理聊天；身体仍只有一个所有者；取消、死亡、迟到回执不串轮 |
| 4 | 让模型在合适任务中选用现有已验证多步程序，测实际产出与时延 | 一个有界目标有真实物资/方块证据；分段耗时可解释；不以技能文件数量或 task completed 代替成功 |

暂停扩展：新执行服务、新 TTS 队列、新仲裁器、新记忆/反思框架、新通用事件总线、第二套 ASR、立即接 B 站、盲目增大模型并发。已有的自动进食反射确实尚未注册，但本轮不把它顺势加进实施范围。

每一项先用现有相关测试和最小复现验证，再做需要的部署与实机验收；当前审计结论不是上述修复已经完成。

## 11. 本次验证结果

复用现有回归测试 **72 项通过**：fast execution 18、character speech 16、survival speech 5、standing task 13、party reply segments 8、fast skills 12。fast skills 首次在 Windows 宿主因缺少 `quickjs-ng` 失败，随后在现役 survivor 镜像的无网络、只读源码隔离容器中通过；没有安装宿主依赖，也没有把依赖缺失解释为生产故障。

新增核对操作只读检查了两份生产技能资格，均明确拒绝；两份原 activeVersion 在临时副本重跑 **14 个原 fixture 全部通过**。这 14 个用例与上面的 72 项回归分开统计。生产报告未刷新，生产资格问题仍待按正常流程修复。

未运行全仓测试、Minecraft GameTest、真实生产动作、模型性能基准或真人实听。以上验证支持审计结论与后续修复优先级，不构成全项目上线验收。
