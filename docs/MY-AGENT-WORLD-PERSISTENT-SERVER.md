# My Agent World：常驻服运维与 Agent 操作指引

更新：2026-10-04。本文说明新的 NeoForge 生存服与普通玩家 Agent，具体游玩验收记录由维护者在文末追加。端口、世界、角色与恢复规则以本文及当前运行配置为准；[研究记录](MY-AGENT-WORLD-LAB.md)中的 28978/28980/28983 等历史研究端口不能代替本文的常驻入口。

## 运行目录与入口

| 内容 | 当前路径或地址 | 用途 |
| --- | --- | --- |
| 常驻服务端 | `E:\QiandengJiSocietyLab\server` | Minecraft 1.21.1 / NeoForge 21.1.248，使用锁定模组包 |
| 当前生活世界 | `server\world-life` | 新的持续生存存档；不要重生成来修复 Agent 行为 |
| 旧实验世界 | `server\world-lab` | 保留，与新生活世界分开 |
| 注册表研究副本 | `E:\QiandengJiSocietyLab\research\registry-server` | 保留其研究世界、号表和原始证据，不当作当前生活服 |
| 常驻号表与网关缓存 | `gateway\permanent\registry`、`gateway\permanent\idmap.json`、`gateway\permanent\knowledge.json` | 从通过验证的研究产物复制，配置引用常驻目录，不依赖清理研究副本 |
| 原生网页资产 | `assets\native-20261004-v3` | 保留模组原始资源、冲突与完整性清单；当前区块号表SHA256为 `039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712` |
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
| 当前模型 | 仅新角色改用已有 `zhipu-cn-codingplan / glm-5.3-flash`；default 原模型未改 |
| Agent 运行配置 | `E:\QiandengJiSocietyLab\services\agent.json` |
| Agent 私有状态目录 | `E:\QiandengJiSocietyLab\agents\maw-explorer` |

MawExplorer 是普通生存玩家，未授 OP。模型通过独立角色和固定 life session 生成 JSON 决策；它不能调用宿主终端、文件或管理员工具。新角色原生工具全部关闭、`max_iters=1`、跨模型回退关闭，每次任务另带 `request_context.subagent_allowed_tools=[]`。原女神、其他宿主角色与 Cron 不随新服改动。

一轮模型最多返回八个动作。宿主解析、校验并按序执行；实际走路、采集、原生合成、模组交互和网页观察共用**同一个 Mineflayer 连接**，没有额外摄像机代替身体。模型使用本人健康、饥饿、库存、可见表面和实际回执作观察；坐标均为绝对坐标。模型说“完成”不是游戏成功证据。

其他 Agent 应使用独立 Minecraft 名称、QwenPaw 角色、固定 session、状态目录与任务/行动账本，每次连接挂接自己的原生客户端。不要第二次登录 `MawExplorer`，也不要共享它的窗口、SNBT、女仆 UUID 或任务 ID。多 Agent 常驻还需要容量、权限和并发实测，不因一个账号接通而自动通过。

## 现在如何游玩与观察

打开 `http://127.0.0.1:28984/` 查看 MawExplorer。网页的 Agent 状态显示其目标、决策阶段、近期动作摘要、身体状态与原生观察流健康；仅看页面加载成功或包序号增长不能证明生活目标完成。

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
