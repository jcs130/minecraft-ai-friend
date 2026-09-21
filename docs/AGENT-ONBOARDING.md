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
- **端口选择**：`25701`=gate（物品号已翻译 ✓ / 方块号未翻译）；`25565`=直连(未翻译，方块物品都可能错)。**要用就挂 gate**。
- **gate 只绑 `127.0.0.1:25701`**：局域网另一台机器的 Agent 现在**连不到 gate**，要么本机跑，要么以后把 gate 口开放到内网（别对公网，见 §5）。
- 已固化的坑：`version` 必钉；`keepAlive` 竞态曾踢 bot；偶发 `ECONNRESET` → **长驻必带看门狗自动重连**。

---

## 4. ⚠️ 当前读数状态（实测，别当已修好）

- NeoForge 带内容模组后，**网络里的 blockstate/item 数字号 ≠ 原版表**，mineflayer/Geyser 按原版表解码必然错位。
- 2026-09-21 已上线修复链路：botgate 导出权威号表 → `idmap.json`（state 11.6 万 + item 5158）→ gate 出站翻译。
- **实测生效范围**：
  - ✅ **物品**：经 gate 背包/槽位名已正确（diamond_sword/stone/bookshelf 实测对；mod 物品兜底为 paper）
  - ❌ **方块**：经 gate **仍读错**（红床读成活塞、火把读成火、书架读成刻纹书架）—— 因为 chunk 数据是**原始 buffer**，翻译层还没解它
- **结论**：需要看方块世界的 Agent（找床/避怪/挖矿/建造）**现在必须用 numen**；mineflayer 的方块修复 = 待补「chunk palette buffer 翻译」（工程项，未做）。

## 5. 白名单与安全铁律

- 服务端离线、**没装 Floodgate** ✓ → **名字可被冒用** ✗ → 公网开放前必须：
  1. `whitelist add <Agent/访客独占名>` → 全部备齐再 `whitelist on`（RCON 即时生效 ✓ 不用重启 ✓）
  2. 已预置 14 个自家号（Goddess/Kirito/…/live）；**没填就开 = 把自家 AI 锁门外** ✗
- **绝不转发到公网**：`25577 RCON` / `19091 面板` / `19092 观战` / `445 SMB` / `3389 RDP` ✗✗（本机有 Agent 凭据 ✓ 泄露=世界沦陷 ✓）
- 需要跨公网跑自己的 Agent → 用 **Tailscale 私有组网**（已装 ✓），不是转发 Java 口。

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
