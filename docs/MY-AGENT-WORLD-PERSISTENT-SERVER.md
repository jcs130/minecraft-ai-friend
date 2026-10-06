# My Agent World：常驻服运维与 Agent 操作指引

2026-10-06：用户已授权先开放局域网，配置与网络策略已准备并通过回归，但 Windows UAC 返回取消，所属防火墙规则尚未创建；当前实际入口仍为下表回环地址。发布步骤、待办和预期 LAN 入口见 [局域网部署](MY-AGENT-WORLD-LAN.md)。原服务尚未停启，主 Agent 的历史未知动作仍暂停；不能把此授权或预备配置当成 LAN 已开放。

更新：2026-10-05。本文说明新的 NeoForge 生存服与普通玩家 Agent，具体游玩验收记录由维护者在文末追加。端口、世界、角色与恢复规则以本文及当前运行配置为准；[研究记录](MY-AGENT-WORLD-LAB.md)中的 28978/28980/28983 等历史研究端口不能代替本文的常驻入口。最新普通 Agent 与殖民地发展链的证明、失败和缺口见 [发展链验收](MY-AGENT-WORLD-AUTONOMOUS-LIFECYCLE.md)。

## 运行目录与入口

| 内容 | 当前路径或地址 | 用途 |
| --- | --- | --- |
| 常驻服务端 | `E:\QiandengJiSocietyLab\server` | Minecraft 1.21.1 / NeoForge 21.1.248，使用锁定模组包 |
| 当前生活世界 | `server\world-life` | 新的持续生存存档；不要重生成来修复 Agent 行为 |
| 旧实验世界 | `server\world-lab` | 保留，与新生活世界分开 |
| 注册表研究副本 | `E:\QiandengJiSocietyLab\research\registry-server` | 保留其研究世界、号表和原始证据，不当作当前生活服 |
| 常驻号表与网关缓存 | `gateway\permanent\registry`、`gateway\permanent\idmap.json`、`gateway\permanent\knowledge.json` | 从通过验证的研究产物复制，配置引用常驻目录，不依赖清理研究副本 |
| 原生网页资产 | `assets\native-20261005-v10-ysm` | 保留模组原始资源、冲突与完整性清单；当前区块号表SHA256为 `039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712`；YSM 试换范围见 [模型记录](MY-AGENT-WORLD-YSM.md) |
| Java 服务端 | `127.0.0.1:28976` | 模组服务端后端；真人 Java 客户端须匹配模组包并单独验证 |
| Agent 协议网关 | `127.0.0.1:28977` | Mineflayer 玩家从这里登录，完成 NeoForge 兼容与原生数据转发 |
| Agent 同连接网页 | `http://127.0.0.1:28984/` | 观察 MawExplorer 的真实行动与本人原生世界数据 |
| Agent 网页健康 | `http://127.0.0.1:28984/healthz` | 网页/动作宿主的就绪检查 |
| Supervisor 健康 | `http://127.0.0.1:28985/healthz` | 新服进程依赖、就绪与守护状态；暂停或故障时可以返回 503 |
| 宿主 QwenPaw | `http://127.0.0.1:8088/api` | 已有宿主运行时，新角色使用它的原生持久会话 |

以上入口均保持回环监听，只能从这台机器直接访问。当前没有新增 LAN、公网或基岩入口；基岩接入新模组服仍待验收。原 Paper 千灯纪的进程、存档、端口及路由映射属于原服务，不能用新服配置覆盖。

当前 `server.properties` 使用 `level-name=world-life`、`difficulty=easy`、`gamemode=survival`、`server-ip=127.0.0.1`。生活世界设置死亡保留物品和一人睡觉跳过夜晚，分别对应 `keepInventory=true`、`playersSleepingPercentage=1`；维护后需要在**当前世界**读回确认。

自然平原村庄定位为 X=-432、Z=400，已由操作员设置世界出生点 `(-432, 66, 400)`；MawExplorer 重新登录后的位置为 `(-431.5, 65.9375, 400.5)`，健康和饥饿均为20。此次只设置自然村庄落点，尚未建成带道路、照明和保护规则的安全出生村。初始化第一次高空传送发生过一次摔落死亡，记录保留，不能计入自主生存验收。

## 玩家、模型与数据归属

| 身份 | 当前值 |
| --- | --- |
| Minecraft 玩家名 | `MawExplorer` |
| 玩家 UUID | `e371227c-09fa-3722-84f4-f3228a552c3c` |
| QwenPaw 独立角色 | `maw-explorer` |
| 当前模型 | `maw-aliyun-codingplan / qwen3.7-plus`，线上阿里云 Coding Plan；其他角色原模型未改 |
| 模型接口 | `https://coding.dashscope.aliyuncs.com/v1`，OpenAI 兼容协议 |
| Agent 运行配置 | `E:\QiandengJiSocietyLab\services\agent.json` |
| Agent 私有状态目录 | `E:\QiandengJiSocietyLab\agents\maw-explorer` |

MawExplorer 是普通生存玩家，未授 OP。模型通过独立角色和固定 life session 生成 JSON 决策；它不能调用宿主终端、文件或管理员工具。新角色原生工具全部关闭、`max_iters=1`、跨模型回退关闭，每次任务另带 `request_context.subagent_allowed_tools=[]`。按用户指定，本项目调试使用上述线上 Coding Plan，不使用本地 Qwen3.8-27B，也不自动切回 GLM 或其他模型。API Key 只由 QwenPaw 私有凭据存储管理，不能写进源码、提示词或文档。原女神、其他宿主角色与 Cron 不随新服改动。

一轮模型最多返回八个动作。宿主解析、校验并按序执行；实际走路、采集、原生合成、模组交互和网页观察共用**同一个 Mineflayer 连接**，没有额外摄像机代替身体。模型使用本人健康、饥饿、库存、可见表面和实际回执作观察；坐标均为绝对坐标。模型说“完成”不是游戏成功证据。

其他 Agent 应使用独立 Minecraft 名称、QwenPaw 角色、固定 session、状态目录与任务/行动账本，每次连接挂接自己的原生客户端。不要第二次登录 `MawExplorer`，也不要共享它的窗口、SNBT、女仆 UUID 或任务 ID。多 Agent 常驻还需要容量、权限和并发实测，不因一个账号接通而自动通过。

## 现在如何游玩与观察

打开 `http://127.0.0.1:28984/` 查看 MawExplorer。网页的 Agent 状态显示其目标、决策阶段、近期动作摘要、身体状态与原生观察流健康；仅看页面加载成功或包序号增长不能证明生活目标完成。

本轮已把原 `mc-visual-console` 完整页面接到该同账号原生流并在新服发布：默认第一人称，`/third/` 第三人称，`/dungeon/` 地下城 2.5D 跟随，`/diagnostics` 独立诊断。可查看本人真实生存 HUD、原生背包/容器、已收到的 Ars 魔力与法术、游戏消息和 Agent 状态。发布与浏览器验收记于文末；此前 21:06 的独立检查页截图只作为历史记录。网页依旧只读，背包查看和视角切换不会代玩家点击、施法或调用模型。

初始目标从自然村庄的生活条件出发：采木，制作工作台和基础工具，取得食物、建立储物与避难点，再发展模组生产和社会关系。自然村庄可能受到夜间怪物袭击，尚无“安全区”验收；不能把反复死亡视为正常进度。

可用操作入口由 `world/src/society-agent/maw-agent.mjs` 提供；底层接入详见 [Mineflayer 模组操作指引](MINEFLAYER-MOD-OPERATIONS.md)。已有研究实测说明这些操作可通过普通玩家连接完成，但不等同于本角色已经自主完成：

| 玩法 | 当前 Agent 操作方式 | 必须满足的真实条件 |
| --- | --- | --- |
| 采集、建设与储物 | 可见方块查询、短程导航、挖掘、原生放置、原生菜单 PICKUP | 已加载、可见、可达、权限允许、持有真实材料 |
| 原版合成 | 本人 2×2 / 工作台 3×3 原生网格辅助器 | 网格与游标初始为空，材料足够，背包有产物槽；逐步核验真实结果 |
| 农夫乐事 | 切菜板原生右键/工具交互，料理锅原生菜单 | 正确材料、工具、热源、餐具与配方，不把料理锅暂存槽当成可取产物 |
| Create | 原生放置/右键驱动，准星读取真实动力与磨石加工状态 | 正确布局、原料、动力与输出空间；检查 `waiting_input / waiting_power / processing / output_ready` 等实际状态 |
| MineColonies | `colony` 的查询、建镇、建筑、工单、交货及备料接口 | 本人城镇权限、真实库存/完整组件、实际请求 token 与可交互距离 |
| 东方女仆 | `maid list/status/tasks/follow/pickup/task/bag` | 本人拥有的女仆、真实召唤与工具/任务条件；关闭原生背包菜单后才恢复原生 Brain |
| Ars Nouveau | `spell list/explain/cast` | 本人真实法术书、已知法术、魔力、冷却与原生事件允许；扣魔不能代替命中验收 |

上述接口是本世界的 Agent 能力入口，旧 Paper `/mycli`、命格书、公会任务与试炼塔全套仍需逐项迁移和验收。不要把研究服的测试城镇、QA 材料、法术书或怪物当作 `world-life` 中已经存在的自然生活设施。

原生物品以本人菜单的 `id / count / snbt` 为准。网页或 Mineflayer 的原版投影名称不能覆盖真实模组组件。取物、合成、施法、交货都先核对窗口/游标/槽位，等待对应回执，禁止并行盲点或在未知结果后重新发起同一动作。

## 守护与起停

守护源码：`E:\minecraft-ai-friend-society-lab\tools\maw_service.py`。当前配置：`E:\QiandengJiSocietyLab\services\service.json`。

进程按 `java → gate → worker` 的依赖顺序启动、反序停止。守护检查真实 Minecraft 应答、网关监听、网页 `/healthz` 和监听进程归属，不接管找到的其他 Java/Node 进程。故障重启有退避与次数预算；出现 `restart_budget_exhausted` 应先排障，再显式 `resume`，不要无止境强拉。

健康判断以新鲜 `health.json` 和各子进程当前 `pid / ready / problem` 为准。`metrics` 中保留的上次 HTTP 或 worker 成功读数不是当前健康；worker 已退出时，即使旧 `httpReady` 为 true 也不能报正常。需同时核对当前 28984/28985 健康响应、原生流与本人连接。

运行时及轮转日志位于 `E:\QiandengJiSocietyLab\server\ops\maw-service`：`health.json`、`paused.json`、`requests/`、`replies/` 和 `logs/`。日志保留 Java、网关与 worker 的独立输出及操作回执。

在 PowerShell 中先设置这两个变量；命令只控制这套新服：

```powershell
$mawPython = 'C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe'
$mawConfig = 'E:\QiandengJiSocietyLab\services\service.json'
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' plan --config $mawConfig
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' status --config $mawConfig
```

| CLI 动作 | 含义 |
| --- | --- |
| `plan` | 校验配置并输出安全计划，不启动进程 |
| `run` | 启动守护主循环；已有实例时拒绝另起；日常由已登记的启动入口执行 |
| `status` | 读本地健康状态；超过 15 秒的心跳不能当作健康 |
| `pause` | 持久暂停自动启动/恢复；已经运行的子进程可继续运行，不能把它当作停服 |
| `resume` | 校验配置并解除守护暂停/故障退避；停止尚未完成时拒绝恢复 |
| `stop` | 写入持久维护暂停，按依赖顺序优雅停止子进程，保留守护进程 |
| `shutdown` | 优雅停服并退出守护；维护暂停仍保留 |
| `console` | 将一条允许的命令送到**本守护拥有的 Java stdin**；“已投递”不等于游戏命令已完成 |

示例：

```powershell
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' pause --config $mawConfig --reason 'maintenance'
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' console --config $mawConfig --command 'list'
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' console --config $mawConfig --command 'save-all flush'
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' stop --config $mawConfig --reason 'upgrade'
# 确认停止、备份并完成维护后，再单独执行：
& $mawPython 'E:\minecraft-ai-friend-society-lab\tools\maw_service.py' resume --config $mawConfig
```

检查每条 CLI 的退出码和 JSON 回执，再执行依赖它的下一步。`console` 的 `deliveryKnown=true / resultKnown=false` 只说明 stdin 投递成功，要在 Java 日志中查玩家名单、存档结束和停服记录。`stop` 的请求回执也不是“Java 已退出”的证明，要持续检查 `status` 与进程终态。

本地 IPC 操作可显式使用 `--request-id <稳定ID>`。回执未确定时保留该 ID、用同一动作与内容查询原回执；不要换 ID 补发。网页健康接口不提供管理员命令执行入口。

## 自启动与维护暂停

普通权限下的 S4U 任务注册已被拒绝。2026-10-04 19:36 已登记并读回当前用户的 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，启动项名 `MyAgentWorld.Service.28976`，用户登录后启动隐藏守护。这个方式不保证登录前开机启动，也不证明已经经过真实重启验收。守护本身异常退出后没有计划任务的独立重试能力，子服务恢复则由仍存活的守护负责。

登记工具是 `tools/maw_service_task.ps1`，支持 Plan/Register/Start/Unregister。核查实际记录 `server\ops\maw-service\startup.json`、所选方法、注册回读和 `started` 状态后再报告安装结果。新服维护暂停会跨守护重启保留，自启动不能绕过它。

不要为了清除新服暂停去删除旧 Paper 的维护标记，也不要批量恢复宿主所有 Cron。Supervisor 的 `paused.json` 与 Agent 的 `autonomy.paused` 是两种不同暂停：前者控制进程恢复，后者控制游戏决策。`resume` 只解除前者，不会擅自清除未知游戏动作保护。

## 退服、重连、死亡与未知结果

Agent 私有目录主要包含：

| 文件 | 作用 |
| --- | --- |
| `state.json` | 本账号目标、轮次、死亡次数与运行阶段 |
| `actions.jsonl` | 完整行动 intent/结果账本；派发前及记录结果时 fsync |
| `model-task.json` | 固定身份/session 的模型 intent、taskId、终态与最终文本 |
| `autonomy.paused` | 未知提交、未知游戏动作或进程中断留下的自主暂停原因 |

断线或原生观察流不可用时，worker 停止原连接，由守护按预算恢复自己的 worker。新连接等待本人登录、原生菜单和状态；不能把上次窗口当作当前窗口，也不能重建账号 UUID 来绕过死亡与库存。

模型任务只有取得可信 `task_id` 并看到原生 `status=finished`、内部 `result.status=completed` 和最终 assistant 文本，才进入 JSON 计划解析。原生 task 查询表位于 QwenPaw 内存，进程重启后可能 404；聊天会话持久不意味着 task 查询句柄也持久。

处理规则：

1. 提交前持久记录 intent，取得 taskId 后持久保存；POST 结果不确定且没有 taskId 时停止自主，不自动再 POST。
2. 已有 taskId 时恢复只 GET 原任务。轮询超时或临时查询失败保留该 ID，不取消后另建任务；404 不能冒充任务完成。
3. 从旧观察恢复得到的模型计划只作历史证据，丢弃动作；用新的身体与库存观察进入下一轮。死亡/重生的 epoch 变化也丢弃旧计划，在动作派发点再次检查。
4. 游戏回执的 `outcomeUnknown=true`、`outcomeKnown=false`、`outcome=unknown` 或相应超时/未知代码会写入 `autonomy.paused`，停止后续动作。
5. 进程重启发现未配对的行动 intent 会暂停自主。先按原 requestId、当前原生库存/方块/魔力/工单核对，保存明确的核对结论；不能直接删除标记让 Agent 猜测并重试。

模型输入与网页只使用近期回执摘要；完整原生 SNBT 和回执保存在私人账本。`QwenTaskClient.status()` 不显示完整 prompt、答案或提供商凭据。网页若显示 `paused_unknown`，应先看账本原因和原任务，再决定恢复，不用重启 Java 来“清空问题”。

## 升级、备份与回滚

1. 先读 `plan/status`，确认操作路径、端口和实例归属。只维护这套新服；不要修改旧正式服或研究副本以凑验收。
2. 安排真人退服并确认 Agent 当前任务/动作已结束或持久暂停。未知结果先保留账本，不通过重启重试。
3. 持久暂停守护，使用 owned stdin 查看在线名单、`save-all flush`，再 `stop`；核验 Java 与依赖进程真正退出。
4. 备份 `world-life`、服务端配置/模组锁定清单、桥接与网关版本、`services` 配置、本人 Agent 状态/任务/行动账本和相关日志。`world-lab` 与研究世界单独保留。原始世界、第三方模组和资源不提交到 Git。
5. 模组、游戏或注册表变化先在隔离副本构建并导出匹配号表。组件、entity serializer、粒子和世界状态 ID 都按本次模组包绑定；不能硬编码某次自定义网络 ID 或套用旧缓存。
6. 验证原生包边界、本人菜单完整组件、普通账号登录、关键配方/权限及网页缺口后发布。启用 `resume`，核验全部健康、真实玩家状态与新日志；已知错误不能通过隐藏日志或静默丢包改成“兼容”。

回滚使用同一批次的世界、配置、模组/桥接、网关与号表；跨版本存档不能只换 JAR 期待恢复。保留失败日志、未知 intent 和请求回执，不覆盖原证据。Windows 正在运行的 JAR 可能被锁定，必须确认停服后安装。

## 验收边界与后续工作

这套常驻入口能够承载真实模型驱动、同账号 Mineflayer 动作与原生网页观察。以下项目仍须独立验收，不能由守护健康、模型任务成功或一轮短动作替代：

- 安全村庄出生、自然食物供给、受击避险和长期自主生活。
- 所有模组操作、通用原生碰撞/寻路、多 Agent 协作与资源竞争。
- 网页完整实体、GUI、粒子、光照以及整体 Java 画面一致性；当前不是全部模组 1:1 渲染。
- Ars 非空粒子 timeline 与尚未适配的扩展粒子/序列化格式；未知格式仍明确拒绝。
- 真人完整模组客户端和新服基岩接入、外部认证及 LAN/公网连接。
- 旧千灯纪技能、公会、地下城等完整内容迁移和新世界自然生产经济。
- 用户注销/登录或整机重启后的自启动实测，以及更长时间的故障与性能窗口；登记和通过已登记入口实际启动已验证。

运维验收应同时记录“服务是否就绪”和“玩家实际上完成了什么”。真实自然采得的材料、玩家自行制作/加工的产物、库存/饥饿/工单变化须与 QA 发料、操作员移动和纯脚本测试分开。不要把有限操作接通写成长期自主成功。

## 当前游玩与部署证据

2026-10-04 新生活世界独立常驻。三个子服务按依赖启动，Minecraft 状态查询、同账号原生画面与 `/healthz` 均有实际就绪证据。一次受控 `stop` 已验证 worker 和 gateway 退出0、Java保存所有维度后退出0，再 `resume` 重新登录同一 UUID；旧两个25565实例及宿主8088的PID保持。HKCU登记与DACL私有化已实际读回，尚未进行整机重启/用户注销登录验收。

默认 Qwen 模型的三条已知失败任务为 `task-ef751f1bf1f3`、`task-7dc2b04b7bc9`、`task-f332c1927211`，实际原因是 Token Plan 月额度耗尽，供应商回执说明10月20日16:00 UTC重置。仅新角色改用已配置的 GLM Coding Plan，不改女神/default或它们的会话；无跨角色补投。原始失败保留在角色会话与 `model-task.json`。新增配额/鉴权错误停自主的规则，避免继续空转调用。

19:50真实GLM任务 `task-e493f04cd3d7` 首次进入普通玩家动作链。私有 `maid.list` 回执确认本人女仆 `0e84aac1-b22a-4c51-b155-09c08f4f4694`，owner为MawExplorer，loaded=true，health20；这不是额外观察者或服务端假玩家。导航行动 `0386ac5f-f2ae-46ba-9195-100a61ef7d5a` 实际到达 `(-420.5,63,399.502...)`。19:53采集行动 `ab12b941-e890-4286-92ba-6f7abaab7034` 在 `(-417,64,389)` 将原生橡木变为空气，本人库存新增橡木1。该木头实际为村屋角柱，Agent后续主动选择修复，不能写成成功采到野树。

19:54修复放置回执 `0307e8cd-865e-42e8-bb96-e562fb499595` 返回 `placement_not_verified`，验证射线击中了邻近橡木门。保留失败，尚不把此回执当成修复成功。前期三轮GLM回答使用action字段而执行器要求type，均无行动；已添加无歧义别名和明确JSON示例，冲突字段仍拒绝。此前原生时间BigInt的观察序列化失败也保留，现转换为精确十进制字符串而非丢精度Number。当前已证明模型驱动实际移动、采集与本人模组查询，尚未证明持续食物生产、完整合成/战斗/模组社会成长。

实际游玩记录继续追加模型 taskId、行动/回执 ID、物料来源、绝对坐标、独立终态、死亡/失败和网页缺口。完整原生包、物品组件、截图与日志只保存在本地，凭据不入Git。

## 常驻目录与最终接线（2026-10-04）

运行依赖已独立安装到 `E:\QiandengJiSocietyLab\gateway\permanent\node\node_modules`，网关和 worker 的 `NODE_PATH` 都只指向该目录，不再依赖 Cortico 的工作区。源码 `world/src/society-agent/package.json` 与 `package-lock.json` 锁定 mineflayer 4.37.1、minecraft-protocol 1.66.2、minecraft-data 3.112.0、pathfinder 2.4.5、prismarine-nbt 2.8.0、vec3 0.2.0 与 prismarine-chunk 1.41.0；传递版本和 Vec3 构造器一致性已实际核对。使用官方 npm 源执行 `npm ci --ignore-scripts --no-audit --no-fund`，没有改全局 PATH、Cortico 或其他运行服务。

原生资源固定在 `E:\QiandengJiSocietyLab\assets\native-20261004-v3`，号表、握手知识与失败记录固定在 `gateway\permanent`，研究副本仍保留。107852 个原生方块状态的资源/网关 SHA256 一致：`039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712`。服务器桥接 JAR 的 SHA256 为 `8578a55b244f459ef35e27d239eac4167f2ae8bc5c230ed50b4ef1aed109feb5`，与源码模组锁定清单一致。

20:11 从已登记的 Run 启动入口实际重启、读回四个回环端口，普通账号 UUID 和女仆 UUID 保持。20:13 原生 `inspect` 已包含本人 `modStates`：真实拥有的女仆及其位置/跟随状态、殖民地明确 `no_nearby_or_owned_colony`、未装备法术书与本人100/100魔力；不是把缺失功能伪装成成功。GLM 任务 `task-34875dd13d97` 产生实际导航，行动 `48d623b6-6081-4947-bb30-35bd1d69cb77` 到达 `(-409.500416,63,379.628199)`，随后同账号原生观察确认。只读模组查询并行，但所有动作仍顺序派发。

审查补充：采样前固定身体 epoch，查询后检查死亡/重生、连接和维护暂停，再提交模型；采集后的等待和拾取也重新检查 epoch。维护重启先等模型任务终态，不删除账本、不补投旧行动。2026-10-04 本次相关回归：109 个 Node 网关/SDK/模型任务/计划测试、18 个服务管理测试、3 个独立健康测试通过；可视化仓库对应29项通过。短窗口与受控重启不替代整机开机、长期生存和全部模组验收。

20:15:43 最后一次审查修复发布后，同 UUID 从自然存档位置重新上线，维护标记在核对具体原因后移除。20:16:22 新服专用健康检查全部通过：本人连接、原生流、三个 owned 子进程、守护新鲜度与自主模式 `thinking`。原两个25565实例仍为 PID21076/PID13880，QwenPaw8088仍为 PID19304。正式入口是 `http://127.0.0.1:28984/`，健康口是28985；没有开放LAN或公网端口。网页实时显示本人位置、世界与真实决策/行动，不额外登录观察者账号。

依赖审查另移除了 npm 产生的无用 `my-agent-world-runtime: file:` 自引用及 lock 中的自链接声明。源和运行目录的两份声明保持一致，其余包版本/完整性不变；正在运行的 `node_modules` 没有重装，已有无用 junction 留到下一次停服 `npm ci` 清理，不删除其目标目录。

## 线上调试模型切换（2026-10-04）

按用户指定，MawExplorer 当前改用 `qwen3.7-plus`，接口为 `https://coding.dashscope.aliyuncs.com/v1`。地址与模型符合[阿里云 Coding Plan 配置说明](https://help.aliyun.com/zh/model-studio/qwen-code)。创建独立 QwenPaw custom provider `maw-aliyun-codingplan`，通过原生 provider 配置接口保存私有凭据（不触发模型发现），只更新 `maw-explorer.active_model`。其余角色的模型路由和本角色其他配置完整读回保持一致，fallback 列表为空、enabled=false；本项目调试不使用本地 Qwen3.8-27B，也不自动回退到此前 GLM。

切换前等待原 GLM 原生任务 `task-b4251ab12eac` 结束并暂停自主，保留身体、UUID、life session、库存与账本。20:33:13 宿主日志确认 `Workspace instance replaced: maw-explorer` 和旧实例停止，零停机重载完成；不重启 Minecraft、网关、worker 或宿主其他角色。恢复后原生任务 `task-2b25bb4ec99a` 实际 completed，聊天持久 metadata 的 `qwenpaw_turn_usage.usage` 确认 `provider_id=maw-aliyun-codingplan`、`model_name=qwen3.7-plus`，有真实 prompt/completion token 及缓存记录；同角色/provider/model 的用量账本已有实际调用增量。这比仅读取 active_model 配置更能证明请求路由。

脱敏切换证据在仓库外 `E:\QiandengJiSocietyLab\agents\maw-explorer\online-qwen-switch-evidence.json`。密钥不进入该报告、源码、提示词或文档。Agent 继续采用 QwenPaw 原生任务/持久会话，加项目 JSON 计划校验与 Mineflayer 执行动作；此次更换模型不代表长期自主生存或完整模组功能已验收。

## 本人可见与观战视角修复（2026-10-04）

此前28984展示原生区块检查页，缺少本人实体模型，区域镜头也未持续跟随。21:06 首轮通过同一个 action bot 的 `selfPlayer` 接入本人经典模型、头顶姓名、真实生命／饱食和绝对坐标；当时检查页默认第三人称跟随，提供第一人称、自由观察、回到 Agent 与 F5 切换，后续完整页面默认第一人称。没有另建观察者账号。本人原生 profile 确认无自定义 textures，UUID `e371227c-09fa-3722-84f4-f3228a552c3c` 按匹配1.21.1客户端规则选择原始 slim/makena 皮肤，纹理SHA-256为 `197307bf92fb9d3adb5808593c88e48ab152335cc4276db4127ccb82d010ca68`。未收到最大生命属性时显示未收到，不补固定20。

维护先持久暂停本角色，核对模型任务已达终态、所有行动 intent 均有结果，21:05使用守护 owned stop 正常保存全部维度并退出三个子服务；停服后备份 `world-life`、services配置与角色状态／模型／行动账本至仓库外 `E:\QiandengJiSocietyLab\backups\viewer-own-player-20261004-2105`。21:06恢复守护并确认同UUID登录，再只清除本次明确原因的自主暂停。新java/gate/worker PID为23156/27540/13136；旧两个25565实例PID21076/13880、QwenPaw8088的PID19304保持。模型仍走线上qwen3.7-plus，维护前一条模型timeout失败原样保留，恢复后的真实决策与移动／采草回执再次出现，未重投旧任务。

浏览器实际验证本人模型与姓名可见、三种视角及回到本人切换正常，角色移动时绝对坐标与跟随画面持续更新。实际截图 `E:\QiandengJiSocietyLab\agents\maw-explorer\own-player-third-person-20261004.jpg` 保留在私人目录，不提交到Git。渲染仓库73项相关Node回归通过。

该首轮验收仅覆盖本人静态经典身体和头部俯仰。后续完整页面已接上本人原生 GUI，但完整动画、装备／持物、其他实体、部分方块、粒子与完整光照尚未全部验收，`completeSceneParityVerified` 仍为false；不得将“能看见本人”写成全部模组画面1:1。原生资源优先级等缺口仍在页面诊断中显式呈现。

## 原完整网页接入与协议维护（2026-10-04，本轮发布）

可视化仓库重新使用原 `page-template.html`、`viewer.css`、背包人物预览和自适应画质组件，由独立 `native-scene.js` 消费该玩家的 1.21.1 原生世界。浏览器只有一个场景 SSE 订阅，`native-console.js` / `native-ui-adapter.js` 共用其状态。第一／第三人称与地下城跟随相机走各自真实相机模式；地下城遮挡、切面与点击操控仍未接入。

worker 用 `createNativePlayerPresentation` 同步读取已有的 `menu.current()`、`spell.current()` 及本人近期法术回执，并通过宿主 `getPresentationState` 回调注入。这不是新模型任务、游戏轮询或摄像机连接，不改变角色/provider 配置。宿主按本人 UUID、注册表与世界 epoch 校验；掉线、重生与身份不符清掉旧世界、界面和消息。

界面物品来自真实原生菜单的 `id / count / snbt`，保留完整模组组件。只有确认 window 0 的 46 格 `minecraft:inventory` 才显示本人背包；打开其他容器时保留实际全部槽位，不猜其中玩家背包的布局。菜单标题未收到时为未知。界面回调有大小上限，过大的 SNBT/集合会明确不可用，不截掉组件再冒充完整物品。

生命、饥饿、经验与已解析属性使用本人真实值，未知保持 null。魔力与法术来自本人 Ars 回执，并显示 `observedAt / stale`；没有冷却数据时不能画成已就绪。原生 HUD 使用同包原始 1.21.1 PNG，有限原版静态物品图标读取原始 JSON+PNG 并核验哈希和资源优先级；未知模组、组件敏感或动态图标保留名称和 SNBT。装备／持物、声音、音乐、小地图、完整实体和整体 Java 画面一致性尚未验收。钓获组件和待机预览 API 已复用，尚不能因此声称真实钓获事件已经在宿主持续显示。

通用前端合约和回归入口位于可视化仓库 `packages/modern-viewer/renderer-src/SOCKET_PROTOCOL.md` 第 8 节；这里使用原生 SSE，不套用旧 Paper 的 Socket.IO HUD 合约。本次可视化源码已合并并推送 `mc-visual-console/main`，提交 `106ca3880a6019d2e37309cc08a208ff7df38691`；本地与远端 tree 逐项核对一致，来源分支历史保留，后续可视化在主干继续迭代。服务端桥和常驻 worker 仍在后端实验分支。源码接通、单测、实际发布、浏览器演示与匹配 Java 客户端画面对照需要分别记录，`completeSceneParityVerified=false` 保持。

### 已定位的药水断线与原始字节保护

21:32 起新 worker 接连因网关解析失败退出，六次恢复耗尽预算，后一次受控复现得到第七条同型记录。失败包为 `entity_equipment`（原生包 ID 91），实体 ID 1269、主手一瓶 `minecraft:potion`、`minecraft:potion_contents` 组件；仅此包不足以确认实体种类或药水效果。七条原始失败保留于仓库外 `gateway\permanent\protocol-failures.jsonl`，没有通过清日志或静默丢包掩盖。

锁定 NeoForge 21.1.248 的实际服务端字节码确认 1.21.1 `PotionContents.STREAM_CODEC` 只有可选 potion holder、可选 INT 颜色、效果列表三项。依赖 minecraft-data 3.112.0 的 1.21.1 schema 多读了后续版本的 `customName`，使真实 14 字节装备包越界。修复仅覆盖 `component-protocol.cjs` 内已克隆的后端 1.21.1 协议；没有全局修改 node_modules，也没有改变前门 schema。

另确认依赖的装备数组解析会原地清除槽位高位终止标志。编译后端解析器现先使用独立 `Buffer.from` 副本解码，并把原始 `buffer / fullBuffer` 留给 raw 监听者，避免兼容解析污染同连接原生视觉数据。网关仍先发送原生语义镜像，再做前门投影；没有把女仆、模组物品或未知组件改成代理画面。

组件、Ars 物品/实体 codec 与原生包信封共 41 项回归通过，含真实失败包精确解码、完整重编码、连续多装备高位标记、相邻组件边界、前门解析不改原始字节和截断拒绝。七条私有捕获逐条重放均消费精确长度、保留输入字节并重编码逐字一致。这些证明本项协议修复，不能代替重新开服后的稳定性窗口。

```powershell
cd E:\minecraft-ai-friend-society-lab
$env:NODE_PATH = 'E:\QiandengJiSocietyLab\gateway\permanent\node\node_modules'
node --test world/src/neoforge-handshake/component-protocol.test.cjs world/src/neoforge-handshake/native-ars-codec.test.cjs world/src/neoforge-handshake/native-ars-entity-codec.test.cjs world/src/neoforge-handshake/native-viewer-packet.test.cjs
```

维护前发现 21:43:48 的 `wait` 行动 intent `1abe8801-0bf3-4261-a48f-cc49c918a744` 没有配对终态；21:44 的解析断线发生在其执行期间。先保留行动账本与 `interrupted_action_outcome` 自主暂停，未因等待时间已经过去编造完成。模型旧任务仍只按持久 taskId GET 恢复；服务恢复不自动清除该游戏动作保护。

操作员使用 owned stop 并于 22:10 完成停服冷备 `E:\QiandengJiSocietyLab\backups\native-full-console-20261004-2210`，仅本套新服受影响。22:35:10 执行守护 `resume`，worker 于 22:35:37 启动；同账号、存档与线上模型沿用，旧服及宿主其他角色未动。

### 暂停收尾与实服浏览器验收

原未配对行动经严格核对仅为 30 秒 `wait`、没有游戏变更；操作员保留原 intent，追加 `operator_retired_interrupted_wait` 的失败/结果未验证记录，未标成游戏成功、未重放。22:36 将原暂停标记归档为 `autonomy.pause-retired-20261004-2236.json`，原原因、动作 ID 和时间保留；只解除本次已核对的自主暂停。恢复后 QwenPaw 原生任务 `task-1893bafcfc29` 真实完成，继续走独立角色的阿里云 Coding Plan `qwen3.7-plus`，不使用本地模型或改女神配置。

22:44:48 独立读取新鲜 `health.json`：`healthy=true / paused=false`，Java/gate/worker 均 `ready=true / problem=null`、`startsInLastHour=1`，这是本次正常启动，无启动后的自动重启；gate/worker 本轮 warn/error 为0，Agent处于 thinking。Java28976、gate28977、网页28984和守护28985均有当前就绪证据。前文历史 PID、旧截图和累计 Java warning/error 不是本轮异常的判定依据，维护者后续仍需看新日志与最新心跳。

真实浏览器 `/third/` 显示本人原始 Makena 皮肤，按 E 得到真实 46 格背包与本人预览；第一人称和地下城跟随相机也验证。原版小麦种子、腐肉显示严格原始 JSON+PNG 静态图标，其余未适配模组/动态物品显示原生文字与 SNBT，未画近似图标。当前生命20但 maxHealth未知保持未知，Ars本人读数100/100。页面 warn/error为空，截图在私人目录 `E:\QiandengJiSocietyLab\agents\maw-explorer\full-native-console-20261004.jpg`，不提交资源或私人库存。

22:43 本账号真实多次 navigate成功；22:44:29 的 gather实际把 `minecraft:oak_log` 方块变为空气，本人库存新增橡木1，私有行动账本留有终态。只证明本次模型驱动移动与采集，不因一块橡木认定已建立自然木材/食物生产或长期生活闭环。

最终回归：renderer专项213、仓库根230、真实Cortico0.1.4集成6、后端协议41和society22通过，typecheck通过；前端集合有重叠，不相加。可视化根测试默认不依赖可选Cortico，真实SDK另用 `pnpm test:cortico` 验证，缺失不会跳过或mock。实服恢复、零网页错误和短时动作不证明长期稳定、全部实体/装备/动画/光照/声音一致、全模组操作或新服基岩支持。

### 收尾发现的守护异常退出

22:54 再次核查发现上述 22:44:48 健康文件已经过期，原 supervisor 与三子进程均不存在，28985 拒绝连接；没有正常停服记录。不能把该历史 `healthy=true` 当成当前状态。异常退出原因尚无完整堆栈，不能断言由协议修复或文件读取引起。

重启前将当时停止的 `world-life`、角色账本与守护日志另存到仓库外 `backups/supervisor-exit-20261004-2256`，保留异常退出后的未验证存档；没有覆盖存档或重放动作。按已登记的 `maw_service_task.ps1 -Mode Start` 隐藏启动，仅新服受影响。22:56:42 原 UUID 再次入服；worker 按旧 taskId 恢复查询并明确丢弃 `task-979a667f10b4` 的过期观察计划，再创建新观察任务。

后续体检优先读取回环 `/healthz` 并核对心跳时间，CLI `status` 已会将过期健康置为 false。检查发现原 `atomic_json` 替换文件遇 Windows 共享冲突没有重试，守护 tick 抛出异常后关闭 owned job 会同时结束三子进程；这是需要修复的真实可靠性缺口，尚不是本次退出原因的确定证据。

现已为同一完整临时文件增加最多五次替换、合计 150ms 短退避，仅重试 WinError32/33 或 PermissionError5。永久权限/磁盘/配置错误仍明确失败；守护记录 `supervisor_failed` 的阶段和堆栈、尽量发布失败状态，再执行既有 owned 退出边界，不吞掉异常。HTTP `/healthz` 也明确核对 15 秒心跳新鲜性。独立临时目录的真实 Windows `CreateFileW` 分享锁在 50ms 后释放，完整 JSON 成功写入且没有临时文件残留；没有锁住正式健康文件来制造故障。

本次升级前先持久暂停本人 Agent，确认模型任务和行动全部终态。23:00:49 发出 owned shutdown，23:00:53 所有维度保存完毕，守护及三子进程退出；停服冷备保存到 `backups/supervisor-retry-20261004-2301`。维护暂停只按本次原因恢复，不能清除未知动作/模型保护。

守护回归 `python tools/maw_service_test.py` 共25项通过，包括真实分享锁、永久失败、非共享错误不重试、异常审计和健康新鲜性。新守护23:07:53接受resume；23:08:56 HTTP读回 `healthy=true / heartbeatFresh=true / paused=false`，Java/gate/worker全部ready，原账号身份和本人展示UUID一致。随后只归档本次原因的暂停到 `autonomy.pause-retired-supervisor-retry-20261004-2309.json`，恢复Agent；历史异常、原操作回执及两份冷备全部保留。HKCU登录启动仍不能保证守护自身崩溃后自动重启，本次只是明确修复和短时恢复验收。

后续浏览器重连保留一条23:08:25的真实 Three.js 错误。已独立复现空数组展开为零参数 `Object3D.add()` 会产生同一错误；场景初始为空、空模型或无可绘制水面时都可能触发。三处改为逐个添加实际 mesh，空集合保持为空，不补代理模型；可视化主干后续提交 `4ad65ee123a82d8d7584c257c81496a1f9d3aa20` 已推送，38项相关宿主/界面回归通过。23:17:55零待定行动/模型后正常停三子服务，23:17:59全部维度保存、三服务退出0，之后恢复守护以重建新bundle；历史浏览器错误不清除，后续验收只按新bundle加载后的时间判断。

23:20:08 HTTP读回三服务就绪、`healthy=true / heartbeatFresh=true / paused=false`，同UUID本人状态匹配；只归档本轮暂停至 `autonomy.pause-retired-viewer-reconnect-20261004-2320.json` 并恢复自主循环。重新加载最终bundle后本人模型、真实快捷栏及Ars100/100可见，23:20:08之后的浏览器warn/error为空；历史错误仍保留。完整页面截图为仓库外 `agents/maw-explorer/full-native-console-final-page-20261004.jpg`。当前画面仍是局部原生场景，远景、完整实体/装备动画与声音等缺口没有因此通过完整一致性验收。

## 连续地形与动作更新维护（2026-10-05）

本轮原生地形默认范围扩为本人快照锚点周围水平24格、向下24格、向上24格（49×49×49）。只读取同一 MawExplorer 连接已经收到的原生区块，保留实际 state、biome 与已有 block entity 数据；不读存档中尚未收到的区块，不增加机器人连接，也不替换模组方块。流体邻点改为实际所需邻域的去重集合。扫描、方块和字节预算分别为262,144格、100,000个非空气方块、1.5MiB快照；超过预算时缩小完整水平范围并报告覆盖边界，未收到区块仍为 unknown。范围以外和垂直切面依然存在，不能把局部快照解释为无限地形。

宿主合并地形变化，完整快照至少间隔500ms，移动以4格阈值更新锚点，并复用当前快照；不再每跨过一个整数坐标就重扫地形。动作状态独立来自本人连接的 physicsTick，最高20Hz更新，慢客户端使用背压而不积压旧帧。掉线、死亡、重生与世界切换清理旧快照、动作和界面，并验证世界 epoch 与本人 UUID。此次同时有限支持经锁定1.21.1客户端确认的蒲公英、虞美人 XZ 模型偏移；未知模组偏移仍明确未支持。

本轮两次发布均通过 owned stop/resume 管理新服，操作回执保留在 `server\ops\maw-service\replies`，不能把 stop 请求已接受当作存档完成。以下时间均为北京时间：

| 维护 | 正常停止与保存证据 | 恢复回执 |
| --- | --- | --- |
| `viewer-continuity-stop-20261004` | 10月4日23:58:03，Java日志确认玩家与全部维度保存完毕 | `viewer-continuity-resume-20261004`，10月5日00:01:55 |
| `viewer-ground-models-stop-20261005` | 10月5日00:13:10，Java日志确认全部维度保存完毕；健康记录确认三子服务均按请求退出0 | `viewer-ground-models-resume-20261005`，10月5日00:14:50 |

本轮首次停服冷备保存到 `E:\QiandengJiSocietyLab\backups\viewer-continuity-20261004-2358`，目录包含 `world-life` 和 `maw-explorer`。此前冷备及历史失败证据继续保留；本轮未修改旧25565两个实例、基岩19132或QwenPaw宿主8088的运行配置，也没有切换其他角色或模型。

10月5日00:24:47再次读取 `127.0.0.1:28985/healthz`：`healthy=true / heartbeatFresh=true / paused=false`，Java28976、gate28977、worker28984均 `ready=true / problem=null`。本次 supervisor PID20732，三子进程PID依次18788、11760、24648，各 `startsInLastHour=1`。worker健康接口确认本人在线、`mode=paused`；地形覆盖来自16个已收到区块列，缺失列为空，包含52,024个非空气方块，当前一次构建耗时20.67ms。这是恢复后的短时在线及性能读数，不是长期稳定性证明；Java累计warning/error仍保留。

**服务在线，但自主模型仍暂停。** 10月4日23:38:47原生任务 `task-1db3f1206bb9` 以 `MODEL_QUOTA_EXCEEDED` 失败，宿主日志确认 Coding Plan `qwen3.7-plus` 上游HTTP429、`throttling`、`usage allocated quota exceeded`；未证实额度窗口或恢复时间。`E:\QiandengJiSocietyLab\agents\maw-explorer\autonomy.paused` 继续保留，原因为 `model_configuration_or_quota`，错误为 `MODEL_TASK_FAILED: MODEL_QUOTA_EXCEEDED`。守护的 `paused=false` 只表示服务维护暂停已解除，不表示 Agent 可以继续发起模型任务；本轮没有清除该标记、重投旧任务或自动换模型。

原生资源优先级与完整画面一致性仍未验收，`completeSceneParityVerified=false`。连续地形与真实动作更新不等于全部实体、装备／持物、模组动态模型、动画、光照和声音都与匹配Java客户端一致；后续须继续保留显式缺口，并分别记录资源来源核验与客户端对照结果。

可视化源代码已提交并同步 `jcs130/mc-visual-console` 的 `main`，提交 `0f5da18f007c2ba7c4e91168161912b08fbff781`，本地与远端树一致、工作区干净。renderer专项253项及仓库根270项回归通过（入口重叠，不可相加），typecheck通过。最终真实浏览器确认草地/土径/花恢复，可渲染51,282/52,024个非空气块，当前reload无warn/error；此统计不代表像素一致率。仓库外完整页面截图：`agents/maw-explorer/native-console-continuity-20261005.png`。本人当前静止，步态实战和新立方物品GUI像素对照仍待后续验收。

## Coding Plan 限流分类与恢复（2026-10-05）

纠正上述历史暂停原因的解释：`MODEL_QUOTA_EXCEEDED` 是当前 QwenPaw 对 HTTP429 的泛化标签，不能据此认定套餐总额度耗尽。原生任务 `task-1db3f1206bb9` 已明确终态 `failed`；23:38:47宿主记录的原始上游错误为 HTTP429、`code=throttling`、`message=usage allocated quota exceeded. please try again later.`。[阿里云 Coding Plan 官方 FAQ](https://help.aliyun.com/zh/model-studio/coding-plan-faq) 将此消息解释为短时请求密集或资源消耗峰值限流，建议至少等待一分钟；`hour/week/month allocated quota exceeded` 才分别表示额度窗口，`concurrency allocated quota exceeded` 表示并发限制。本次不能进一步确定是请求频率、输入Token峰值还是共享账号使用造成，也没有证据表明总额度耗尽。

只读路由核对确认 MawExplorer 仍使用 `maw-aliyun-codingplan/qwen3.7-plus`，provider 的 API host 为 `coding.dashscope.aliyuncs.com`、路径 `/v1`、协议 `OpenAIChatModel`；角色自动回退与 LLM routing 均关闭。没有改 QwenPaw 全局配置、provider、密钥或其他角色，也没有直接调用上游 API。

源码局部策略现将已知失败的 usage/concurrency 限流及无细节的历史泛429归入可恢复退避：依次60、120、240、480秒，之后最多每15分钟尝试一次。受控 `modelBackoff` 保存失败次数、计划时间、到期时间、等待长度和原因；重启保留退避，检查点位于获取新观察及提交模型之前。等待期间仍响应服务维护与自主暂停。模型成功后清除连续限流计数；退避到期只允许新观察、新意图、新任务，绝不重发失败任务或执行它的旧计划。

原生任务的 `errorDetails` 优先投影到固定原因枚举和 HTTP状态；原始消息、密钥、URL、临时dump路径不进入公开状态或新增账本。鉴权、模型配置错误继续持久暂停；明确hour/week/month窗口另记 `model_quota_window`，不伪装为短时限流。未知任务、丢失回执及未完成任务的轮询超时继续保留原taskId并暂停，人工核查只读原任务；原生已结束的超时与取消不会被当作游戏计划。未知游戏动作的暂停保护保持。

部署前应确认行动账本无未结算 `action_intent`，原生任务账本无 `intent/submitted`，并只读确认上述原task已失败。**程序不会自动删除现存 `autonomy.paused`。** 操作员仅在核对其精确内容仍为 `reason=model_configuration_or_quota`、`error=MODEL_TASK_FAILED: MODEL_QUOTA_EXCEEDED` 后，将它改名归档为带日期的 `autonomy.pause-retired-codingplan429-*.json`；遇到其他原因或新的未知行动暂停即停止恢复。随后按现有 owned 服务流程启动/恢复一次，保留全部任务和行动账本。不批量删除暂停文件，不清空 session，不自动换模型。

局部 Agent/任务客户端回归共34项通过，覆盖退避下限及上限、跨重启保留、结构化原始原因优先、鉴权/配置、明确但窗口不明的 `insufficient_quota` 保守暂停、未知任务、终态失败后新意图，以及敏感错误不落盘；语法检查通过。这是源码策略验证，实际模型恢复、后续限流和长期稳定性需由部署后的真实任务另行记录。

## 专用物品 GUI 渲染发布（2026-10-05）

网页源仓库 `jcs130/mc-visual-console` 的 `main` 已同步 `905dd33d552ea459c5b0ef8757603db4582deca4`（原生专用物品）及 `854c4a160d0749e8abc3befe14fc7c1cb327aeb7`（限流等待提示）。Ars Nouveau 5.13.2 的破旧笔记本、初学／学徒／大法师法术书按锁定客户端与 GeckoLib4.9.3 的原始闭合书几何、分级骨骼、GUI变换、UV与贴图渲染，并支持16种原始染色；没有用同名静态PNG代替专用模型。女仆空白智能石板与已知 Patchouli 幻想乡书使用各自真实生成模型及贴图，依据本人物品的完整原生SNBT选择。

SNBT 输入限定64KiB、16层、4096节点，保留原生数值类型和组件。缓存以完整原始SNBT为键，限128项；缺失来源、未知书籍／视觉组件、动态纹理及尚未实现的附魔光效明确显示缺口，资源来源SHA核验不等于像素对照。此次仅完成物品栏／快捷栏GUI；持物模型、翻页、装备、其他专用渲染器与Java客户端完整像素对照仍未验收，`completeSceneParityVerified=false` 保持。

可视化根回归305项通过、0失败0跳过，typecheck通过；后续界面退避提示定向8项通过。这两轮入口有重叠，不能相加。原始资源、JAR、输出PNG、编译bundle与运行数据均在仓库外。

正式新服于00:55完成存档后停止，备份在 `backups/special-item-renderers-20261005-0055`，共161文件。恢复前核对330条游戏行动意图均有结果、167条原生任务全部终态（162完成、5失败），并通过宿主只读原任务确认 `task-1db3f1206bb9` 已结束失败。只将精确匹配旧限流误判的 `agents/maw-explorer/autonomy.paused` 改名为 `autonomy.pause-retired-codingplan429-20261005-0113.json`；所有历史记录保留。

使用同一监督器的 `special-items-resume-20261005` 回执恢复一次，01:14三子服务健康、原UUID MawExplorer本人在线。实际生产网页 `http://127.0.0.1:28984/third/` 已检查自己的石板、幻想乡书、破旧笔记本：两处显示均加载成功，原始图标16×16、法术书专用GUI64×64；本次reload无warn/error。完整截图位于仓库外 `research/special-items-live-20261005.png`。恢复后使用原角色、原session及原在线模型提交新的 `task-95afb63dc32a`，不是重投旧失败任务；01:15宿主只读回执确认 `finished/completed`，Agent已继续进入后续轮次并执行动作，`lastError=null`、没有新暂停标记。这证明原模型路由本次恢复成功，不能据此宣称长期自主生活或限流永不再发生。旧两个25565服务、UDP19132及宿主8088的监听PID均保持，路由器与其他角色配置没有改动。临时28986只读预览已按精确命令行归属停止，正式28984继续运行。

01:15追加真实后置证据：恢复后的前三个模型任务均已完成；MawExplorer连续导航到村庄地面区域，并自主采集 `(-441,67,391)` 的 `minecraft:short_grass`，世界读回变为空气、种子库存4→5。此次没有操作员传送、补物或伪造采集结果，仍不代表全部模组功能或长期游玩验收完成。

## 原生模型、菜单与动作回执增量（2026-10-05）

本轮支持范围、原始来源与各模组缺口见 [MY-AGENT-WORLD-NATIVE-COMPATIBILITY.md](MY-AGENT-WORLD-NATIVE-COMPATIBILITY.md)。可视化主干已推送 `0b1d8ab02469e753d6eb35e19891d4b1017e242c`，本地与远端tree一致、工作区干净。服务端与Agent源码继续留在 `experiment/agent-society-1.21.1`，未把新服当作旧Paper服迁移。

新增原始床、猪／牛／鸡／羊／史莱姆／村民模型及有限原生动作、按原始变换的第一／第三人称持物、更多源代码核实的静态物品图标、工作台／标准箱子／炉子布局，以及本人真实健康和规范46槽物品栏。905个物品处于离线guard范围，不能解释为4810件物品或257类实体都已完成。橡木板与橡木按钮仍因同一路径贴图来源优先级未确认而明确拒绝，未知模组实体／专用屏幕不画替身。炉进度原生dataValues未透出，保持unknown；网页菜单只读。

动作总期限45秒、嵌套导航25秒；未知中断关闭原连接mutation fence到owned worker重启。原长时间未结束的采集意图 `9b15ab3e-130f-4e90-8beb-2ac1a8725e2e` 在正常停服、冷备后追加一次明确 `operator_interrupted/outcome=unknown/retryAutomatically=false` 结果，原意图和所有历史保留，不算采集成功。新的gather分别核验方块破坏和真实库存增量，排除合成预览槽0；没有确认拾取则 `no_pickup_confirmed`，不重挖原位置。select最多等待5秒同UUID服务端确认，修复150ms读旧菜单导致的误报失败。

| owned维护回执 | 实际停止与存档完成（北京时间） | 恢复 |
| --- | --- | --- |
| `native-renderers-stop-20261005` | 07:38:04所有维度保存；三子服务07:38:01–05依次退出0 | `native-renderers-resume-20261005`，07:44:26 |
| `native-renderers-final-stop-20261005` | 08:06:30所有维度保存；三子服务08:06:27–31退出0 | `native-renderers-final-resume-20261005`，08:07:01 |
| `native-gui-layouts-stop-20261005` | 08:35:31所有维度保存；三子服务08:35:29–33退出0 | `native-gui-layouts-resume-20261005`，08:40:05 |

冷备 `backups/native-renderers-20261005-0736` 共177文件，`backups/native-gui-layouts-20261005-0835` 共186文件，均保留世界、Agent账本和当时桥JAR及SHA清单。原生资产v4共39058件资源，39127个资产／变体／注册文件通过完整性检查；本轮桥JAR实际SHA与锁文件一致：`ba66d91d194ad1b05b11a3565e7ff38d2f44d1d94891becdbbe342e0256352dd`。资源优先级／完整场景接受标记仍为false。

08:32实体流曾明确 `NATIVE_ENTITY_METADATA_INVALID`，没有原始失败entry。锁定协议实际codec证明四种bool前缀optional的own undefined合法；现只对这四类转换为JSON null并保留absence标记，其他缺值继续拒绝，诊断有界且不含元数据内容。08:40:54实服SSE已恢复 `entityState.available=true/reason=null`，当前范围有1个真实实体；这不能证明旧错误的唯一原因，也不能把附近女仆的unsupported模型当成渲染通过。

08:40:44新鲜健康确认三服务ready，本账号原UUID不变（本次entityId101）。核对627条意图全部有结果、原模型任务终态后，仅归档精确GUI维护标记为 `autonomy.pause-retired-native-gui-layouts-20261005-084053.json`。未清除其他暂停、未知行动或旧任务保护。08:42:17宿主GET确认新任务 `task-6ad9b9a90118` 已 `finished/completed` 且原session匹配；本轮第290轮，636条意图／636条结果、无待定动作、没有新暂停。真实select回执 `hotbar_selection_confirmed/selectedHotbarSlot=7/effectVerified=true`，随后继续工具／方块交互与观察，没有管理员补物或传送。

08:42:17 `health_mon.py --society` 当前10项均通过，新增原生实体流与同UUID规范库存／有效生命形状冒烟。监督PID20732；Java28976 PID13352，gate28977 PID34068，worker28984 PID21956，均problem=null。本人生命12.666664/20、饥饿7、实际Ars100/100。gate／worker本轮warning/error为0；Java累积warning248/error8和原日志继续保留，不能把累积计数或短时就绪当成长期稳定性结论。

最终回归：可视化仓库根391项、Agent71项、society健康8项均通过，0失败0跳过，typecheck与diff检查通过；前文分轮专项入口有重叠，不相加。真实生产网页重载后背包、原始书／工具图标、生命／魔力与第三人称本人可见，该reload无浏览器warn/error。截图留在仓库外 `research/native-compat-live-final-20261005.png` 和 `research/native-compat-third-final-20261005.png`。后者同时显示真实gather未确认拾取的失败回执，未冒充采集完成。

工作台另用日志第1572行原始回执做浏览器只读重放：`2026-10-05T00:27:50.219Z`、actionId `0360dc19-1c3a-4ae9-9e1f-17f7620dd9e0`、window3/state25；同一真实记录的46槽、self与playerInventory，不重建物品或配方。已看到原3×3布局、木板／木棍输入与木锄结果、原书／工具图标，加载0、4个资源优先级拒绝如实显示。页面醒目标明“历史菜单重放；不是当前游戏窗口”，截图 `research/native-crafting-replay-final-20261005.png`，浏览器无warn/error。该证明只覆盖历史菜单布局，不算本次新合成或Java全像素对照。临时28986只读helper PID26244已按精确命令行核对后停止，临时页已关闭。

旧服TCP25565两实例、UDP19132和QwenPaw8088仍监听；本轮没有改它们的配置、路由器映射、provider、密钥、其他角色或模型。当前Agent仍为线上Coding Plan `qwen3.7-plus`。本轮原始资源／JAR、世界、私人记录及生成bundle均未提交Git。女仆／殖民地／Create／Ars复杂实体与动画、完整光照／声音、新服基岩入口及全模组长期生活闭环仍需继续实现和验收，`completeSceneParityVerified=false` 保持。

## 原生内容读取、操作与女仆画面发布（2026-10-05）

本轮普通玩家身体仍为 MawExplorer、UUID `e371227c-09fa-3722-84f4-f3228a552c3c`，采用原 QwenPaw life session、线上 Coding Plan `qwen3.7-plus` 和同一 Mineflayer 连接。新增真实 RecipeManager 查询、完整 FOOD 默认组件、本人已跟踪实体身份与归属查询、工具 list/explain、原生方块命中点交互、食品原生库存操作及实际后置条件核验。农夫乐事菜单提供实际槽位/两项料理锅进度/热源/容器，炉灶和切菜板保持原无 GUI 交互。细节与已知边界见 `MY-AGENT-WORLD-NATIVE-COMPATIBILITY.md`，不声明完整模组生活闭环。

桥 JAR 与仓库锁文件 SHA-256 一致：`c32f68bd51e17c21bb02247595fe420ea789fb61be65d6efc137a2da8e36b04f`。新增桥使用锁定 Farmer's Delight 1.3.4 实际 API，24 类编译通过，构建守卫6项通过。私有 v5 资产 `E:\QiandengJiSocietyLab\assets\native-20261005-v5` 完整验证39127文件，资源/注册表与v4逐字相同，仅桥来源SHA变化；11处覆盖冲突继续 unresolved，所有完整/优先级/像素接受标记仍为false。

| owned维护回执 | 实际停止与存档完成（北京时间） | 恢复 |
| --- | --- | --- |
| `native-mod-content-stop-20261005` | 09:26:53所有维度保存；09:26:51–55三子服务退出0 | `native-mod-content-resume-20261005`，09:38:35 |
| `native-mod-content-host-stop-20261005` | 09:41:44所有维度保存；09:41:42–46三子服务退出0 | `native-mod-content-host-resume-20261005`，09:42:26 |
| `native-mod-content-plan-stop-20261005` | 09:46:52所有维度保存；09:46:50–54三子服务退出0 | `native-mod-content-plan-resume-20261005`，09:48:44 |

第一轮停服时有一个模型任务尚未结束。已保存原任务账本，精确读取原 `task-40ceeb4e22b2` 的终态，确认同 session 后归档结果；仅 GET、零重投、零旧计划游戏动作。行动账本759个意图全部有结果。冷备 `backups/native-mod-content-20261005` 保存198个世界/Agent/旧桥文件及SHA清单。后两轮停服前均确认动作及模型完全结算，不清空账本或会话。

现场发现女仆状态已从服务端发送、但宿主最终 presentation 漏传；已补齐，并增加宿主端回归。实际浏览器看到原 typeB vengeful 变体的73骨骼模型与红蓝原贴图，同UUID/实体ID10/epoch1，仅本连接原始跟踪实体，不新增旁观游戏连接。只读相机转动没有修改游戏角色。截图私存 `research/native-maid-live-20261005.png`，当前重载无浏览器warn/error。空装备/背包、无乘骑/游泳的有限动画范围已进入实际画面；未完成Java像素对照、复杂装备或特殊动画。

另发现真实原生模型任务在合法 fenced JSON 后追加单行角色摘要，计划解析器因此拒绝整轮。修复仅允许完整唯一 fenced计划及受限单行 `⟧ … ⟧` 尾注（≤256字符，禁换行、JSON定界符、反引号和嵌套尾标记）；多份JSON、多围栏或任意尾文继续拒绝，全部计划schema/action校验保持。历史已结束计划仅本地解析验证，恢复只用新观察、新任务，不执行历史计划。未修改 QwenPaw 全局角色、宿主、provider或模型。

最终可视化根419项、后端Agent/协议115项测试全部通过，无跳过；typecheck、diff检查通过。可视化 `main` 已同步提交 `ff3aa1dca9398642e2c401c0b3dba06d7a7b4c95`，本地与远端树一致。源码/资产检查、同账号状态、浏览器可见结果及自主操作验收分开记录，不能用测试数量宣称全部模组可玩或长期稳定。

09:49:32确认 owned 三服务新鲜就绪后，仅归档本次精确维护标记，恢复自主循环。第347轮全新任务由模型选 close_menu/eat(slot44)/inspect；真实行动 `6bd76a7e-43a0-4788-aacf-0194649eb9ad` 返回 `native_food_consumed`、`effectVerified=true`，本人腐肉4→3、饥饿15→19、消耗数量1，未给物、传送或管理员代定计划。后续饥饿效果与自然回血仍按原版规则运行，09:50:59生命2.166668/20，不能从一次进食推断长期生存已解决。

该轮 inspect 实际收到同UUID、epoch1 的 `server_recipe_manager` 目录：共6286配方、44种类型，包含 FD cooking28/cutting105、Create milling55/mixing46/pressing8、TLM altar43 等；初小页返回原 `ars_creo:starbuncle_wheel` 配方，definitionAvailable=true。目录有 nextOffset、时间和epoch；未知语义的配方明确 definitionAvailable=false，不臆造流体、概率加工或社会玩法。实际Food默认组件读到腐肉 hunger600tick、概率0.8，SNBT patch缺省不再被当作无副作用。

09:50:59实服健康 `healthy/heartbeatFresh=true / paused=false`，Java37296、gate36012、worker36004均ready且problem=null，本人原UUID不变、当前entityId81。实体流available、46槽本人规范库存、实际Ars100/100均收到。第348轮继续新模型任务，无autonomy暂停；账本762意图/762结果、零未结算动作。正在运行的任务尚未返回时session不作成功匹配声明。gate/worker本轮warning/error均0，Java累积warning342/error11如实保留，短时就绪不代表长期稳定性。
