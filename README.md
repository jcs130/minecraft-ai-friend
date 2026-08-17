# minecraft-ai-friend · 我的世界 AI 陪玩 — 世界端

> 游戏的最高配是朋友。

**服务器侧项目**：一个由"天神"治理的 Minecraft 世界——魔法、成长、苦难修行、供奉经济、编年史，以及一整套给人类观众看的观察甲板。AI 玩家（"穿越者"）由配套的开源插件项目 [dsh-minecraft-agent](https://github.com/jcs130/dsh-minecraft-agent) 驱动，任何人都可以让自己的 Agent 接入这个世界一起玩。

本项目为**私有仓库**（含世界规则数据与平衡数值）。

## 双进程架构

世界与穿越者彻底分离，两者之间**只有 Minecraft 聊天**：

```
                ┌─────────────────────────────────────────────┐
                │  Minecraft Server (vanilla, RCON enabled)   │
                └───────▲─────────────────────▲───────────────┘
                        │ RCON (唯一持有者)    │  公屏聊天 / 私聊
    ┌───────────────────┴──────────┐   ┌──────┴──────────────────────┐
    │  世界进程（本仓库）            │   │  穿越者进程 ×N（开源插件仓）  │
    │  bootstrap-world.mts         │   │  bootstrap-mc.mts           │
    │                              │   │                             │
    │  mc-rcon    共享 RCON 服务    │   │  mc-bot      mineflayer     │
    │  mc-logwatch 日志事件流       │   │  mc-tools    工具层          │
    │  mc-worlddb 众生册+编年史     │◄──┼──仅聊天──│ mc-memory   记忆   │
    │  mc-magic   快路径魔法        │   │  mc-transmigrator 人格档案   │
    │  mc-god     慢路径神谕(天神)  │   │  mc-mystic   咏唱/祈祷       │
    │  mc-ritual  降临仪式          │   │  mc-wiki     生存知识库      │
    │  女神化身（旁观模式 bot）      │   │  mc-loop     自主循环        │
    └──────────────────────────────┘   └─────────────────────────────┘
```

**铁律**：世界进程是唯一的特权持有者（唯一握 RCON 密码）；穿越者进程零服务器权限——AI 与真人玩家平权，想施法就得在聊天框里念咒，想祷告就得低语。服务器永远不需要知道登录的是人还是 AI。

## 世界端插件

| 插件 | 职责 |
|---|---|
| `mc-rcon` | 共享 RCON 服务，自动 Unicode 转义（RCON 不能直接传中文命令）。 |
| `mc-logwatch` | **服务器事件流**。tail 原版 `logs/latest.log`，~0.5s 内产出结构化事件（死亡含凶手/死因、上线、成就）。日志即 API：事件只作触发，一切变更都经 RCON 复核后才落账。 |
| `mc-worlddb` | SQLite 世界账本：众生册（玩家名册）+ 编年史（每次施法/死亡/供奉/升级/被动觉醒/仪式全部留痕）。 |
| `mc-magic` | **快路径施法**。监听公屏聊天，把咒语匹配到原子表（`data/magic-atoms.json`），校验并扣除三资源消耗 `{mana, food, hp}`，经 RCON 用纯 vanilla 粒子/音效/大字渲染效果。全程程序化实时，**零 LLM**。 |
| `mc-god` | **慢路径神谕 + 世界守望者**（天神三职：裁决/守望/史官）。私聊入队给外部 QwenPaw Agent（女神人格）出神谕，结构化裁决经 RCON 落地为神迹；驱动供奉经济（RCON 复核祭品→永久魔力上限祝福）、死亡守望（日志秒级触发+记分板复核）、等级同步（原生 XpLevel ↔ 魔力池）与被动引擎。 |
| `mc-ritual` | 新穿越者降临仪式：女神公屏宣读候选天赋，穿越者聊天作答，落定出生天赋。 |
| `mc-offering` | 供奉协议共享库（物品名、背包解析）：穿越者上报供奉，世界侧 RCON 复核并收执。 |
| 女神化身 | 旁观模式 bot：世界的眼睛，用于观察与运镜。 |

### 魔法系统（数据驱动）

咒语目录在 **`data/magic-atoms.json`**——加法术、调消耗、改咒语词都是改 JSON，不动代码。消耗按资源拆 `base` + 按参数 `unit_cost`；魔力惰性回蓝（状态文件 + `last_update` 时间戳）；饱食/血量直读 MC 实体。视觉效果**纯 vanilla**——不装 mod、不改客户端，真人玩家零门槛。

**逆转换法术保证经济闭环**：体内资源可互换但汇率必亏——燃血（6 HP → 15 魔力）与炼食（8 饱食 → 6 魔力）对圣愈/赐福的往返汇率差保证任何循环净亏损，不存在永动机（单元测试断言每条环路利润为负）。

### 成长体系与被动引擎（苦难即修行）

**成长——一个数字管到底。** 等级就是原版 `XpLevel`：挖矿、杀怪、供奉、女神嘉奖，全是同一条经验条，女神每 20s 同步进魔法状态。升级触发原版图腾仪式 + 公屏昭告，并解锁更高阶法术（每原子 `requiredLevel`）。魔力池体系自有：`maxMana = 100 + 12 × (XpLevel − 1) + maxManaBonus`，`maxManaBonus` 是独立祝福通道（供奉/仪式/被动），祝福不会跟经验曲线打架。`鉴定`法术（Lv1，2 魔力，零命令）回读实时状态：生命力、护甲、已学/天赋法术、被动进度，私信 aqua 面板。

**被动——受苦解锁力量。** 定义在 **`data/skill-events.json`**。每个被动有触发条件（指标/阈值），**只累不清零**；苦难时长攒够，女神公屏宣告觉醒 + 发经验，此后只要条件保持，被动引擎每轮 watcher 经 RCON 续杯药水效果（时长略长于轮询间隔=无缝续杯）：

| 被动 | 触发（累计） | 效果（条件保持期间） |
|---|---|---|
| 坚毅 | HP ≤ 30% 满 600s | 回蓝 ×2 |
| 血怒 | HP ≤ 40% 满 120s | 力量（攻击提升） |
| 铁壁 | HP ≤ 25% 满 180s | 抗性（受伤 −20%） |
| 求生本能 | 饱食 ≤ 20% 满 240s | 疾行（更快找到食物） |

真人同样适用：指标直读 MC 实体，经历过同样地狱的人类玩家也会觉醒同样的血怒。加新被动 = 改一条 JSON。

## NPC 村民引擎（`sidecar/mc_npc.py`）

世界侧 Python 常驻：**讲述者 NPC**（风临/烛九/静水驻场广场，点名即答，话题来自村民档案）+ **每日委托经济**（村民发委托、交割付绿宝石，账本落 `data/village/quest-ledger.jsonl`）+ 村民白天自由活动。村民档案数据驱动：`data/village/villagers.json`（人设/话题/委托表/拴绳半径）。断线 300s 自动重连自愈。

## 观察甲板（`web-panel.mjs`，:9090）

给人类观众的零依赖 web 甲板：

- **穿越者 tab** — 点头像切第一人称视角流（iframe 嵌各自 viewer 端口），支持⛶全屏。
- **交互式小地图** — canvas 俯视图：当前 bot（绿+朝向）、其他穿越者（紫）、基地（金）、公共箱（蓝）、资源点（按类型着色）；点击切视角、滚轮缩放、拖拽平移、双击回跟随。
- **思维流** — 当前目标、思考、最近聊天、每步 `mc_see` 截图。
- **状态彩条/技能卡/背包/记忆** — 生命力❤🍗✨、出生天赋+已学+被动苦修进度条（生效中红色脉冲）。
- **村口实况** — 穿越者 × NPC 对话/事件流（读 `data/npc-feed.jsonl`）。
- **编年史事件流** — 直读 world.db（SQLite）。
- **智能运镜**（`?follow=smart`）— 默认追尾镜头；NPC 回话时自动切双人过肩镜头（按距离近/中/远三档，10s 平滑回追尾）。

## 环境要求

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（developer preview）
- Node.js **22.19+ / 24+**
- Minecraft 服务端（Java 版，实测 **1.21.11**；开启 RCON）。离线模式即可。
- 一个 OpenAI 兼容 LLM 端点（本地 llama.cpp / Ollama 即可，零成本）。
- Python 3.11+（仅 NPC 引擎 sidecar 需要）

## 快速开始

1. 本仓库 clone 到 DeepSeek Harness checkout 旁边（`start-*.bat` 期望 `..\node_modules` 存在；跑一次 `setup-vendor-links.bat` 修复 @deepseek-ai junction）。
2. 把 RCON 密码放进 `data/rcon-secret.txt`（UTF-8 无 BOM，单行；**永不入库**）。
3. 起世界进程（先改 `MC_HOST`/RCON 配置）：

```bash
start-world.bat
```

4. 起观察甲板：`start-panel.bat` → `http://localhost:9090`。
5. （可选）起 NPC 引擎：`python sidecar/mc_npc.py`。
6. 到开源插件仓 [dsh-minecraft-agent](https://github.com/jcs130/dsh-minecraft-agent) 起穿越者：

```bash
start-bot.bat Kirito 3001
```

**启动顺序铁律**：先穿越者 bot 入服 → 再启世界进程（死亡守望名单是武装时刻快照，world 后启才全员覆盖）。

环境变量：`MC_HOST` / `MC_PORT` / `MC_USERNAME` / `MC_VIEWER_PORT` / `MC_GOD_NAME`。运行时状态（记忆、魔力、状态快照、日志、world.db）都在 `data/` 下且已 git-ignore。

## 运维注记

- 生产运行目录当前与仓库分离（ops 目录），本仓库是**世界侧正主快照**；后续计划收敛为单目录。
- 旧版项目历史（Autopilot 控制台时代）已在本仓 force-push 覆盖时归档于本地 ops 机器，旧 HEAD `82766e7`。
- 咒语匹配第一版为关键词匹配，bge-m3 向量匹配（容忍错字）在路线图上。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
