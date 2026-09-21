# Agent 接入手册（mineflayer / numen 假玩家）

> 2026-09-21 实测基准（世界当日曾整体宕机一次 ✓ 恢复后已复验 ✓）。服务端：Java **1.21.1 + NeoForge 21.1.248**、**离线模式**。
> 本文只讲「文字 AI / Agent 怎么接进来」，且**只写实测过的**；读数状态见 §4（冒烟 7/7 ✓）。

---

## 1. 一句话选型

| 你的 Agent 要做什么 | 用哪条 | 现在能不能上 |
|---|---|---|
| 快速挂个 mineflayer 做点事（物品/背包/聊天）| mineflayer 经门（内 `25701` / 外 `25702`）| **能 ✓ 读数正确 ✓** |
| mineflayer 且**要看方块世界**（找床、避怪、挖掘、建造）| mineflayer 经门 | **能 ✓ 方块读数已复验正确 ✓**（§4）|
| 长期住世界、要最稳不掉线、要服务端级权限 | **numen 假玩家**（服务端内生）| **能 ✓ 且不经网络编号 ✓ 最稳** |
| 真人客户端观战/游玩 | Java 25565 + NeoForge，或基岩 UDP 19140 | 能 ✓ |

**默认建议**：外部/临时 Agent 直接 **mineflayer 走门** ✓（读数已复验正确 ✓）；要长期常驻当角色 → **numen** ✓（不掉线 ✓ 零网络开销 ✓）。**任何 mineflayer 都别裸连 `25565`** ✗（不翻号 ✓ 方块物品都会错 ✓）。

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
- **实测生效范围（2026-09-21 世界恢复后复验 ✓ 冒烟 `verify-gate.cjs` 7/7 通过 ✓）**：
  - ✅ **物品**：背包/槽位号已正确（diamond_sword/stone/bookshelf/red_bed/blaze_rod 实测对；mod 物品兜底 paper）
  - ✅ **区块批量（map_chunk）**：chiseled_bookshelf/bookshelf/obsidian/diamond_block/furnace/sticky_piston/magma_block/glowstone/packed_ice **逐格读对** ✓ 历史上"红床→活塞、书架→变体、obsidian→火"这批高位号全部归正 ✓
  - ✅ **单块实时（block_change）**：`setblock` 后 **1s 内**模型更新 ✓ 号已翻译（diamond_block→4276 ✓）
  - ✅ **批量变更（multi_block_change）**：`fill` 4 格 1s 内全读对 ✓ —— 这条是本轮**新补的翻译**（record = `方块号<<12 | 局部坐标` ✓ 实测反推定谳 ✓ 此前漏翻会把高位号砸进客户端读成 air ✗）
- **结论**：**mineflayer Agent 经门已经能正确读写方块世界** ✓ 不再强制走 numen ✓ numen 仍是"长驻角色"最稳选项（不掉线、不经网络编号）✓
- 回归口复验方式：`cd world/src/neoforge-handshake && node verify-gate.cjs`（改翻译层后先 `docker restart qiandengji-gate-1 qiandengji-gate-public-1` ✓ `/app/src` 是宿主 `world/src` **只读挂载** ✓ 改宿主文件即生效 ✓ 不用重建镜像 ✓）

## 5. 白名单与安全铁律

- **前缀闸已实测有效 ✓**：外门日志原话 `拒之门外：「Goddess」不符外门命名（须 ag_ 开头）` ✓ `ag_probe` 完整进门进 PLAY ✓
  （注：被拒时客户端表现是**挂断/超时** ✓ 不是一句友好提示 ✓ Agent 侧要自己处理连接失败 ✓）
- **⚠️ 当前 `white-list=false`（server.properties 实测 ✓）= 只挡名字、不挡准入** ✓ 任何知道地址的人拿 `ag_xxx` 就能进世界 ✓（本轮 `ag_probe` 就是无白名单直接进来的 ✓ 已退出 ✓）
  → **25702 要对公网开放前，必须先** `whitelist add <ag_名>` 再 `whitelist on` ✓（RCON 即时生效 ✓ 不用重启 ✓）
- **外部 Agent 的入口 = `gate-public`（`0.0.0.0:25702` ✓ 现仅局域网可达 ✓ 公网仍需路由器转发那一跳 ✓）**
  → **绝不要把裸 Java `25565` 转发到公网** ✗✗ 它不过前缀闸、也不翻号 ✓ 离线模式下可被 `Kirito`/`Goddess` 冒名抢家当 ✓
- 服务端离线、**没装 Floodgate** ✓ → **基岩访客**（UDP 19140）同样"名字可被冒用" ✓ 对外开放前同上（14 个自家号已预置 ✓ 没填就开 = 把自家 AI 锁门外 ✗）
- **绝不转发到公网**：`25577 RCON` / `19091 面板` / `19092 观战` / `445 SMB` / `3389 RDP` ✗✗（本机有 Agent 凭据 ✓ 泄露=世界沦陷 ✓）
- 自家 Agent 在异地机器跑 → 优先 **Tailscale 私有组网**（已装 ✓ 连内门 25701 语义 ✓）；要真走公网就连外门 25702 + 独占 `ag_` 名 + 开白名单 ✓
- 其它实测参数：`online-mode=false` ✓ `view-distance=6`（**Agent 视野只有 6 区块 ✓ 别指望看远 ✓**）`spawn-protection=0`（出生点不保护 ✓）`max-players=20` ✓

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
