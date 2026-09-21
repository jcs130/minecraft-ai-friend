# Agent 接入手册（mineflayer / numen 假玩家）

> 2026-09-21 实测基准。服务端：Java **1.21.1 + NeoForge 21.1.248**、**离线模式**。
> 本文只讲「文字 AI / Agent 怎么接进来」，且**只写实测过的**；当前有已知读数缺陷，务必看 §4。

---

## 1. 一句话选型

| 你的 Agent 要做什么 | 用哪条 | 现在能不能上 |
|---|---|---|
| 长期住世界、看方块/寻路/采集/建造 | **numen 假玩家**（服务端内生）| **能 ✓ 且读数天然正确** |
| 快速挂个 mineflayer 做点事、主要看**物品/背包/聊天** | mineflayer 经 **gate `25701`** | 能进 ✓ 物品读数已正确 ✓ |
| mineflayer 且**要看方块世界**（找床、避怪、挖掘）| —— | **别用 ✗ 方块仍读错**（见 §4）→ 先用 numen |
| 真人客户端观战/游玩 | Java 25565 + NeoForge，或基岩 UDP 19140 | 能 ✓ |

**当前最优默认：重要 Agent 走 numen。** mineflayer 的方块读数修复还差「chunk 缓冲区翻译」这一步（§4）。

---

## 2. numen 假玩家（推荐）

- **身** = 服务端实体 `NumenPlayer`（`ServerPlayer` 子类），由服务端 `numen` 插件召唤，**不走网络**、零网络开销、**不会掉线**、天然读真世界。
- **魂** = 外部 agent（QwenPaw 侧）经 **RCON `127.0.0.1:25577`** 下 `numen_act` 驱动。
- 现役：Kirito / 鸣人 / 爱德华（`agents.json` 注册，`guardian_angels.owner_uuid` 认主用真实 UUID）。
- 口令：容器内 `/data/server.properties`（不落仓库）。

## 3. mineflayer 直连（写法 + 坑）

```js
// npm i mineflayer@4.37.1
const bot = require('mineflayer').createBot({
  host: '127.0.0.1', port: 25701,   // ★首选 gate(神社之门)：出站把 NeoForge 号翻回原版号
  username: 'MyAgent',               // 离线：名字即身份(UUID)，定死别改
  auth: 'offline',
  version: '1.21.1',                 // 必钉，不钉协商失败
})
```
- **端口选择（compose 实测 ✓ 有两道门）**：
  - `127.0.0.1:25701` = **gate（内门）**：本机/容器内 Agent 用 ✓ 收任意名 ✓
  - `0.0.0.0:25702` = **gate-public（外门）**：外部/局域网另一台机器的 Agent 用 ✓ **只收 `GATE_AGENT_PREFIX` 前缀名**（如 `agent` 开头 ✓ 内部号 Goddess/Kirito 冒名在门口即拒 ✓）
  - `25565`=直连(未翻译，方块物品都可能错)——**别直连，一律挂门** ✓
- 内网门/外门都走同一 `gate.cjs`（同一翻译层 ✓）；外门还多一道前缀闸 ✓ 所以**外部 Agent 不必转发裸 Java 口** ✓ 用 25702 即可（见 §5 更新）。
- 已固化的坑：`version` 必钉；`keepAlive` 竞态曾踢 bot；偶发 `ECONNRESET` → **长驻必带看门狗自动重连**。

---

## 4. ⚠️ 当前读数状态（实测，别当已修好）

- NeoForge 带内容模组后，**网络里的 blockstate/item 数字号 ≠ 原版表**，mineflayer/Geyser 按原版表解码必然错位。
- 2026-09-21 已上线修复链路：botgate 导出权威号表 → `idmap.json`（state 11.6 万 + item 5158）→ gate 出站翻译。
- **实测生效范围（截至 2026-09-21 世界宕机前）**：
  - ✅ **物品**：经 gate 背包/槽位名已正确（diamond_sword/stone/bookshelf 实测对；mod 物品兜底为 paper）
  - ⏳ **方块**：chunk palette 翻译代码 `remapChunkBuf`（prismarine-chunk load→翻 palette→dump）已进 gate ✓ 但**世界宕机未能复验是否真读对** ✗ —— 上一版"方块仍读错"是**该代码合入前的旧账** ✓ 别当定论 ✓
- **结论**：方块修复**代码已就位·待世界起来复验** ✓ 复验前，找床/避怪/挖矿/建造类 Agent **稳妥仍走 numen**（读数天然正确 ✓）；复验通过后放开此建议。

## 5. 白名单与安全铁律

- **外部 Agent 的公网入口已经建好 = `gate-public`（`0.0.0.0:25702`）** ✓ 带前缀门（`GATE_AGENT_PREFIX` ✓ 内部名冒名即拒 ✓）。
  → **别再另开/转发裸 Java `25565` 给 Agent** ✓ 那条没有前缀闸 ✓ 离线模式下可被 `Kirito`/`Goddess` 冒名抢家当 ✗✗
- 服务端离线、**没装 Floodgate** ✓ → **基岩访客**（UDP 19140）仍受"名字可被冒用"约束 ✓ 对外开放前：
  1. `whitelist add <访客独占名>` → 全部备齐再 `whitelist on`（RCON 即时生效 ✓ 不用重启 ✓）
  2. 已预置 14 个自家号（Goddess/Kirito/…/live）；**没填就开 = 把自家 AI 锁门外** ✗
- **绝不转发到公网**：`25577 RCON` / `19091 面板` / `19092 观战` / `445 SMB` / `3389 RDP` ✗✗（本机有 Agent 凭据 ✓ 泄露=世界沦陷 ✓）
- 自家 Agent 在异地机器跑 → 优先 **Tailscale 私有组网**（已装 ✓ 连内门 25701 语义 ✓）；要真走公网就连外门 25702 + 前缀独占名 ✓

## 6. 与「观战 / 附身」联动

- 直播机位 `live` 是**真实基岩客户端**，附身观战某 Agent：`python tools/live_spectate.py switch <名字>`（服务端 `/spectate` 锁镜头 ✓）。
- 观战对象建议选 numen 角色（读数正确 ✓）；观战 mineflayer bot 会看到它眼中的错位世界 ✗。

## 7. 接入 checklist

1. [ ] 选路线：重要/看方块 → numen；轻任务/看物品 → mineflayer@gate
2. [ ] 起 ASCII 独占名，`whitelist add` 它
3. [ ] mineflayer：`version 1.21.1` + `auth offline` + 端口 25701 + 自带重连
4. [ ] 跑一条 `bot.chat` / `bot.blockAt` 冒烟，确认能收发
5. [ ] 涉及方块世界决策前 → 等 §4 方块修复 或 改 numen

---
维护：本手册随 §4 修复进度更新；「方块经 gate 已读对」成立那天，把 §4 的 ❌ 改 ✅ 并放开 §1 的"别用"。
