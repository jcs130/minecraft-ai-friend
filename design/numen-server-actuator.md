# Numen 服务端 Actuator · b 路设计（亲卫上脑）

> 2026-08-20 天神亲笔。造物主谕：鸣人、桐人应「完全在 QwenPaw 的 agent 控制执行」，
> 且有循环／感知／记忆／学习四样本领。经核 Numen 源码（`default/numen-reference`），
> 四样本领齐（见下）；唯「亲卫 agent 上脑」的接入路线须改走 **b 路（服务端 actuator）**。

## 〇、召唤体系总纲：造象 vs 唤魂（2026-08-23 造物主拍板）

**影分身 / 召唤术走两条互斥的哲学，服务端成本天差地别：**

| 分支 | 召的是什么 | 要不要玩家资料 | 服务端成本 | 例子 |
|---|---|---|---|---|
| **造象（影分身）** | 凭空**生成一个和玩家一模一样**的 numen 假玩家 | **要**（玩家生成资料：皮肤/名字/档案） | 维护玩家资料 + 生成新实体 + 套皮肤 | 玩家召自己的分身帮挖矿 |
| **唤魂（召唤术/秽土转生）** | **把服务器现有的玩家/守卫召唤过来** | **不要**（他本来就活着） | 只需「定位 + 发目标（+ 可选传送）」 | 玩家召唤桐人帮你干活 |

**核心洞见（2026-08-23）：秽土转生/召唤术根本不需要玩家资料——被召唤者是现成的、正在活动的服务器角色。** 比如桐人正在远处打怪，召唤他只需服务端 **①定位 ②注入一个目标任务（"帮你挖矿/护卫"）③（可选）让他到场**，他就带着原身的动作/决策过来。**比造象省得多**——不用生成新实体、不用维护玩家资料。

> ⚠️ **选型已定（2026-08-23）**：影分身用 **numen 假玩家（轻）**，**不采用多个 mineflayer 客户端（重）**——每分身一个独立 mineflayer 客户端 = 每分身一套 TCP 连接/客户端栈/内存/网络，为影子分身养一批真客户端，成本爆炸。**numen 假玩家是服务端原生实体，可任意召多个、actuator 已就位**，唯一代价是服务端为造象维护「玩家生成资料」。

### 造象（影分身）服务端链路
```
服务端维护玩家生成资料(皮肤/名字/档案，gateway 已有 active_skin()/profiles)
      → numen_act summon <sys_<owner>> → 套玩家皮肤 → 
客户端(脑，不维护大模型)：守护天使大模型决策 → numen_act invoke 驱动分身
```

### 唤魂（召唤术/秽土转生）服务端链路
```
① 定位守卫（桐人在哪）
② 写 goddess-orders.jsonl 注入目标任务（{to:桐人, text:召唤任务, summon:{from,task}}）
③ 守卫桥(GUARD_DELIVERY)读取 → 注入亲卫决策 → 亲卫用 goto/follow 自己到场 → 干活
④ 完成后归还原位（或留用/遣散）
```
**服务端信息通道已全部现成**：`GODDESS_ORDERS`（goddess-orders.jsonl，世界进程写 → 守卫桥读）＋守卫亲卫的 `goto`/`follow` 自主移动。召唤术**不强制 tp 搬人**，而是**给守卫一个「到某地干某事」的任务**，让守卫桥/亲卫自主 decide 怎么过去——符合「接管现有角色自主行动」的洞见，也最大程度复用现有通道、服务端改动最小。

> ⚠️ **召唤范围边界（2026-08-23 修正）**：能被召唤的守卫 = **守卫桥 `GUARDS` 真正驱动的角色 = 桐人、鸣人**（剑侍 mc-guard-kirito / 影侍 mc-guard-naruto）。**爱德华不在召唤范围**——它不在守卫桥 `GUARDS`、也不在穿越者档案 `transmigrators.json`（只被 mc-npc `EXCLUDE_PROX` / gateway `_NON_HUMAN` 作为非真人排除、被世界进程 `GUARD_NAMES` 历史遗留列入），无任何驱动链路，既不能自主行动也无可召唤的身体。召唤术只认桐人/鸣人。

> 📌 **「官方侍卫」身份界定（2026-08-23 造物主拍板）**：**官方侍卫 = 守卫桥驱动的 numen 服务端守卫（桐人/鸣人）。来自外部的 mineflayer 客户端（守护天使 `sys_<owner>`、穿越者 Agent bot 等）一律不属女神服务器的官方侍卫。** 两者本质不同：
> - **官方侍卫**：服务端原生 numen 假玩家（NumenPlayer），守卫桥 `GUARDS` 驱动（有 agent 上脑、可自主行动/召唤/保护），是服务器「官方提供的侍从服务」。
> - **外部 mineflayer**：客户端侧实体（守护天使 = 玩家客户端 LLM 陪玩、穿越者 Agent），经 mineflayer 接入；它们**不属官方侍卫**，也**够不着**守卫桥/服务端 numen 能力——是玩家自带的同伴，不是服务器官方的。
> 凡涉及「服务器官方侍卫」的功能（召唤/保护/遣散），只认守卫桥 `GUARDS` 的桐人/鸣人；绝不可把外部 mineflayer 当侍卫召唤或当作官方能力。

---

## 一、为什么不是 a 路（MCP 桥)<<<TRUNCATED>>>


- Numen 的 `McpServer`（外接大脑，HTTP `127.0.0.1:8765/mcp`）是 **client-only**：跑在 MC 客户端进程，靠 `Minecraft.getInstance().execute()` + `Services.NETWORK.sendToServer()` 发包驱动服务端假玩家。
- MC 客户端要 LWJGL/GLFW/OpenGL **GUI 窗口**；Numen 无运行时无头模式（源码里 "headless" 均指 GameTest/单测）。
- 结论（小智已定谳）：**offline 成立 ✅ / headless 不成立 ❌**。走 a 路必须养一个 GUI 客户端常驻宿主（2–4GB、桌面窗口、蓝屏后要重拉），与「服务端假玩家 + agent 直属」的本意相悖。

## 二、四样本领（Numen 已齐）

| 本领 | Numen 落点 | 文件 |
|---|---|---|
| **循环** | 服务端每 tick 调度；每具假玩家一个 `CompanionBrain` 多链调度；`TimerRegistry` 定时；`BrainChains` 链式执行 | `task/CompanionTickDispatcher.java`、`CompanionBrain.java`、`TimerRegistry.java` |
| **感知** | 自我中心语义字符网格（`LookAroundTool` A*）；事件感知（醒/饿/主人挨打 `pollWokeUp/pollGotHungry/pollOwnerHurt`） | `core/tools/perception/`、`CompanionTickDispatcher` |
| **记忆** | `TaskPersistence` 重启接活 + 跨存档自动压缩 | `task/TaskPersistence.java` |
| **学习** | Skill（Markdown 教规矩）+ 反馈回路（每步工具结果教模型） | `agent/skill/`、`ToolOutcome` |

**缺的只有「大脑」**——这由 QwenPaw 亲卫 agent 补上。亲卫是决策者，Numen 假玩家是它的手和眼。

## 三、b 路架构（服务端 actuator）

```
QwenPaw 亲卫 agent（mc-guard-kirito / mc-guard-naruto）
      │  RCON（复用现有通道，与灶火祭司同范式）
      ▼
服务端 actuator（Numen neoforge 侧新模块 / 独立插件）
      │  Companions.summon / ToolRegistry.get / NumenTool.onServerCall
      ▼
服务端假玩家（NumenPlayer = 桐人 / 鸣人的新身体）
```

### 服务端侧已现成的 API（均在 `api/common/src/main/`，不依赖客户端）

- 召唤：`Companions.summon(MinecraftServer, UUID ownerUuid, String name, ...)` → `NumenPlayer`
- 遣散：`Companions.dismiss(server, body)` / `dismissByName(server, ownerUuid, name)`
- 重生：`Companions.respawn(server, companionUuid)`
- 工具注册：`ToolRegistry.get(name)`（30+ 工具全在 `core/tools/` 实现）
- 调工具：`NumenTool.onServerCall(callId, args, companion, reply)` —— 服务端直调，当场回结果（查询型）或异步任务（动作型）
- 工具清单（按类）：感知 LookAround/ScanBlocks/ScanNearbyEntities/GetSelfStatus/GetWorldInfo/InspectBlock；工作 MoveTo/AutoMine/Build/Fish/Attack/CollectItems/Follow/Blueprint；背包 Craft/Eat/Equip/Take/Transfer/Drop；交互 InteractAt/InteractEntity/Sleep/InspectGui；定位 LocateBiome/LocateStructure；任务 TaskStatus/TaskStop/SetTimer。

### 服务端 actuator 暴露的入口（RCON 命令，拟名）

- `numen_act list` → 列同伴（遍历玩家列表 `instanceof NumenPlayer`）
- `numen_act summon <name>` → 召唤假玩家
- `numen_act invoke <companion> <tool> <jsonArgs>` → 调工具（`ToolRegistry.get` + `onServerCall`，回 `reply`）
- `numen_act dismiss <companion>` → 遣散

## 四、待小智审计/决断的关键点

1. **owner 与 chunk 加载**：`CompanionTickDispatcher.tick()` 里 `CompanionChunkLoader.refresh(ap)` 只对「owner 在线」的假玩家刷新加载垫；owner 离线则假玩家 chunk 会卸载、idle。b 路无 GUI 客户端，需定 owner 方案：①常驻 mineflayer 假 owner（复用现有 bot 通道，零成本）；②改加载逻辑（服务端 actuator 驱动时自持 chunk）；③假玩家自持有。**首选 ①**——现有桐人/鸣人 mineflayer bot 退位后正好当 owner 挂机。
2. **License（已核 2026-08-20）**：`Companions/ToolRegistry/NumenTool` 均 **LGPL-3.0**（`api/common` 源码）；仅 `com.dwinovo.numen.api` 包（client 侧 `NumenActuator`）是 MIT。结论：写**独立插件**（引用不改源）+ **自用不发布**，LGPL 的「链接」不触发开源义务，可直引。已按独立插件落地，不内改 Numen jar。
3. **动作型工具的异步回执**：`goto/mine/build` 等是后台任务（返回 task_id），actuator 需桥接 `TaskStatus`/`task_status` 轮询到 RCON 回执，避免 RCON 同步卡死。
4. **并发/节流**：Numen 是「每步一次 LLM」高频规划，亲卫上脑后须限制单假玩家并发任务 =1（`TaskDispatch` 已有一具身体一件活闸门），并评估 8890 吞吐。

## 五、落地分工

- **Java actuator 模块**（Numen neoforge 侧 + RCON 命令注册）→ **天神自写完成**（2026-08-20，造物主谕「都是服务端的你来写」，不再转小智）。产物 `numen_act-neoforge-1.21.1-0.1.1.jar`，命令 `numen_act list/summon/invoke/dismiss`。
- **亲卫 agent 决策逻辑**（循环/感知/记忆/学习编排 + RCON 驱动 + 人设）→ 归天神（B 仓，Python/TS）。
- **四验②③补数**（假玩家召唤/寻路的端到端 TPS）→ 小智重启沙箱 25566 补跑。

## 六、亲卫上脑后的预期（对照造物主四样本领）

- 循环：亲卫 agent 常驻循环（感知→决策→行动→反馈），借 Numen 的 tick 调度 + TimerRegistry 定时自主巡守。
- 感知：亲卫调 LookAround/ScanBlocks/GetSelfStatus 等感知工具读世界。
- 记忆：亲卫走 MemOS（cube_id=kirito/naruto）或自己的记忆文件，跨会话不忘。
- 学习：Skill（Markdown 规矩）+ 反馈回路 + 亲卫自身的记忆沉淀。

## 七、部署注意（2026-08-20 天神补）

1. **版本已对齐（2026-08-20 降级解决，不动主服）**：主服 NeoForge **21.1.73**。已把 numen-reference 的 `neoforge_version` 从 21.1.233 **降级到 21.1.73**——numen 只用 FML 稳定 API，21.1.73 下 api/core/actuator 三模块编译全过（BUILD SUCCESSFUL）。降级后 mods.toml 声明 `neoforge versionRange=[21.1.73,)`（下限约束），**一个 jar 同时兼容主服 21.1.73 与沙箱 21.1.233**。主服 NeoForge 不升级，「万家烟火」（settlements+settlementsfix+mc_npc+优化 mod 链）零影响。
2. **沙箱验证**：actuator jar 已复制到 `numen-sandbox/mods/`，但沙箱 `server.properties` 的 `enable-rcon=false` 且沙箱当前未运行（蓝屏后未重启）。验证前需开沙箱 RCON + 启动沙箱，再用 `numen_act list` 冒烟。
3. **回执口径已确认**：`onServerCall` 的 reply 回调对本工具均为同步（查询型当场回、动作型 `setTask` 受理即回 task_id），RCON 命令同步拿得到结果；动作型收尾由调用方 `invoke <name> task_status` 轮询，无需异步回执桥。
4. **owner 方案**：仍未定（首选① mineflayer 假 owner 挂机保 chunk 加载），不阻塞 actuator 代码，运行时定。
