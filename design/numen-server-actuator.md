# Numen 服务端 Actuator · b 路设计（亲卫上脑）

> 2026-08-20 天神亲笔。造物主谕：鸣人、桐人应「完全在 QwenPaw 的 agent 控制执行」，
> 且有循环／感知／记忆／学习四样本领。经核 Numen 源码（`default/numen-reference`），
> 四样本领齐（见下）；唯「亲卫 agent 上脑」的接入路线须改走 **b 路（服务端 actuator）**。

## 一、为什么不是 a 路（MCP 桥）

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
