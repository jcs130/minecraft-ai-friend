# AI 接入与自研技能核查

核查日期：2026-09-07。已查看源码、实际 JAR、Docker 状态/挂载，并执行只读 RCON 查询；没有重启服务、召唤角色、施法或改动原始实例。

## 确认存在的组件

以下世界端相对路径均以 `C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend` 为根；Numen 源码位于同级 `numen-reference`。

| 组件 | 实际作用 | 保留位置 |
|---|---|---|
| `botgate.jar` | 原版协议 AI 接入 NeoForge 的兼容补丁，并承接技能书、技能箱/轮盘、飞行、羽落靴、武器技能、光环 | Minecraft 服务端 |
| `numen-neoforge-1.21.1-0.1.1.jar` | 本地修改的 Numen，提供可受 Agent 控制的服务端假玩家与动作工具；内嵌 `numen_api` | Minecraft 服务端 |
| `numen_act-neoforge-1.21.1-0.1.1.jar` | 本地扩展 Numen Server Actuator，提供 RCON 动作入口、同机文件通道、技能书交互 | Minecraft 服务端 |
| `sidecar/guard/mcp_numen.py` | 将角色感知、移动、挖矿、战斗、咏唱、祈祷等包装为 Agent 的 MCP 工具 | QwenPaw/Agent 运行环境 |
| `bootstrap-world.mts`、`src/mc-magic.ts`、`src/mc-god.ts` 等 | 判定技能、扣资源、执行效果、成长与神谕 | 世界进程 |
| `src/neoforge-handshake/gate.cjs` | 原版协议客户端/Mineflayer 的独立接入代理 | `shadow-gate` |
| `god-voice-0.1.0.jar` | 自研天音播报组件，属于配套视听能力 | Minecraft 服务端 |

Numen 上游作者为 dwinovo，不能将整个 Numen 称为本项目原创；本地独立 `numen_act` 的元数据作者为 mc-god。相关来源分别见 `numen-reference/gradle.properties:12` 与 `actuator/neoforge/src/main/resources/META-INF/neoforge.mods.toml:8`。

## 两条 AI 路线

### 外部穿越者 / Mineflayer

Agent → Minecraft 协议代理或服内直连 → 普通玩家角色 → 聊天/私聊咏唱 → 世界进程判定并执行。

协议代理外部端口为 **25700**。当前 Goddess 使用 Mineflayer，经容器网络 `mc:25599` 直连。代码入口见 `src/mc-bot.ts:63`；代理编排见 `ops/docker/shadow/docker-compose.yml:130`。

真人 NeoForge 整合包另有正在运行的 **25566** TCP 直通入口（`mc-direct` → `mc:25599`），不应将它与原版协议代理混用。**25575 是 RCON，8011 是 HTTP 门户**。

### Numen 守卫 / 假玩家

Agent → MCP 工具 → `numen_act invoke <角色> <工具> <参数>` → Numen 服务端角色执行动作。

这是受信任的服务端控制路线，MCP 桥内部使用 RCON，不等同于给任意外部穿越者提供管理员权限。`NumenActCommand.java:61` 要求 OP 2；`:166` 起执行 ToolRegistry 的服务端接口。

咏唱走专门通道：

```text
Agent 调用 chant("咒语")
  → MCP 写 chant-requests.jsonl
  → mc-god 消费请求并调用 resolveChant
  → mc-magic.castSpell 校验与执行
  → RCON 落地效果，写回执与编年史
```

证据：`sidecar/guard/mcp_numen.py:542`、`src/mc-god.ts:2396`、`:2344`、`src/mc-magic.ts:1577`、`:1865`。

MCP 中 `get_magic_state` 查询魔力、等级、已学/天赋/被动，`pray` 提交祈祷；`guardian-cast` 则允许绑定的守护 AI 按主人的技能和资源施法，见 `src/mc-god.ts:2291`。

## 技能不是只有第三方铁魔法

实际世界进程使用自研数据驱动系统：

- 仓库基准 `data/magic-atoms.json` 有 **71 项定义**。
- 当前运行卷 `ops/docker/shadow/data/magic-atoms.json` 有 **72 项定义**：65 项非 passive、7 项 passive。仅比基准新增 `thousand_return`「千回」，共同 71 项内容一致。
- `skill-events.json` 另有 **9 项被动定义**，与 atoms 中 passive 项属于不同数据集合，不直接相加为主动法术数。
- 示例包括圣愈术、螺旋丸、炎爆术、御空术、附魔技能、光环和千回。
- 修炼 CLI 还依赖 Puffish Skills 的经验/点数命令，见 `src/mc-god.ts:2304`。
- 当前降临仪式代码会跳过 Kirito、Naruto、Taro 等指定 AI/假玩家；不能假设所有 AI 进入后都会自动选天赋，见 `src/mc-ritual.ts:194`。

本轮在 Numen actuator/core/API 中没有发现 Iron's Spellbooks 的原生专用 cast 工具。已确认的 Agent 咏唱执行链是本项目的世界技能系统；“已安装铁魔法”不能直接推导为“Agent 已能使用铁魔法全部能力”。

另有 **11 篇 Agent 技能说明**，用于教 AI 战斗、建造、容器操作、进下界、寻末地等流程，位于 `sidecar/guard/skills/`。这是给模型阅读的操作知识，与游戏里消耗魔力的法术不同。

## botgate 已承接旧组件的技能功能

`botgate-src/botgate.mixins.json` 共 **15 个 Mixin**：六个网络兼容项，以及 `SkillBookUse`、`SkillItemUse`、`BookAutoRestore`、`BookDropGuard`、`SkillChestBoot`、`FlyBoot`、`FeatherBoots`、`WeaponSkill`、`AuraTick`。

实际构建 `botgate-src/botgate.jar` 与服务端现役文件哈希一致。相关实现位于 `botgate-src/dev/god/botgate/chest/`、`magic/` 和 `mixin/`。

只读 RCON 查询已确认服务器注册了：

```text
/fly <player> <seconds>
/skillenchant <player> <skill>
/skillenchant aura <player> <aura>
/skillchest wheel <player> [<page>]
/skillchest panel <player> [<page>]
```

因此这些能力不是随 `settlementsfix` 退役而一并消失。技能书交互在本地 `numen_act` 中也有转发实现；最终效果与两处处理的交互仍需实际施法验证。

## 当前运行与版本差异

| 只读检查 | 本轮结果 |
|---|---|
| MC、世界进程、协议代理、QwenPaw | 容器运行中；MC 与 QwenPaw 显示 healthy |
| `rcon-cli list` | 1 位在线玩家：Goddess |
| `rcon-cli numen_act list` | `count=0`，当前无在册 Numen 身体 |
| `shadow-guard` | 已停止，退出码 137 |
| 本地 MCP 源码 | 54 个工具声明，含 `list_skills/read_skill` |
| QwenPaw 容器 MCP 文件 | 29 个工具声明，有 `chant/get_magic_state`，没有 `list_skills/read_skill` |

鸣人和桐人的 DriverCard 都启用，指向 `/opt/sidecar/guard/mcp_numen.py`，`MC_DATA_DIR=/data`。QwenPaw 的 `/data` 与世界进程的 `/app/data` 对应同一宿主运行卷，咏唱通道路径可对接。

本地与容器 MCP 文件哈希不同，说明运行镜像尚未与这份本地源码对齐；不能将本地 54 个工具和 11 篇技能说明宣传为当前容器已经全部提供的能力。此次通过 AST 静态解析容器文件统计工具，没有向 Agent 发指令。

## 整合时使用的来源

现役自研 JAR 统一从 `ops/docker/shadow/mc/mods/` 取，哈希见 `manifests/ai-components.lock.json`。`numen-reference` 中两个构建产物与此目录完全相同；`mc-server/mods/`、`ops/docker/shadow/mods/` 则存在同名不同哈希旧副本。

需要保留的整体是：客户端基础包 + 现役服务端内容/自研组件 + 世界技能运行数据 + Agent/MCP 服务。客户端单独放几个 JAR 无法替代整条执行链。

本轮已确认组件、数据和命令注册存在。尚未做角色召唤、技能消耗、效果回执或 AI 自主行为测试；上述停止状态和部署差异已记录，未在检查过程中修改服务。
