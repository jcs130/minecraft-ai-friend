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
- **模组物品不再一律 paper ✓**（2026-09-21 造物主谕「映射到最接近的原版」✓）：`build-idmap.cjs` 三级递进——**级1** 同名 mod 方块 → 那原版的方块物品（`prefab:item_pile_of_bricks→stone_bricks` ✓ 3231 个）；**级2.0** 工具/甲**保材质等级**（`item_swift_blade_diamond→diamond_sword` ✓）；**级2.1** 约 70 条语义家族（`scroll→enchanted_book` ✓ `staff/wand→blaze_rod` ✓ `spawn_egg→chicken_spawn_egg` ✓ `stew→mushroom_stew` ✓）；**级3** 才兜 paper。实测：兜 paper **3825 → 303** ✓ 覆盖 **68 种**代理物 ✓ 真给 12 件 **12/12 读对** ✓
  ⚠ 代理号只影响**显示与识别**，**不是可操作身份** ✓ 要真正使用模组物品请拿完整 id（RCON give / `/mycli`）✓ 加映射规则必须让 `badRules=0`（写错目标名会把 `undefined` 灌进号表 = 线上物品变未知号 ✗）
- **体检三项也过 ✓**（`node audit-idmap.cjs`）：号表与注册表**逐数对账一致**（states 116650==blocks.tsv 声明总数 ✓ items 5158==items.tsv 行数 ✓）· **双向往返恒等 8/8**（原版物品 `neo→vanilla→neo` 原样回来 ✓ 保证 Agent 反向操作不会被号表改成别的东西 ✓）· chunk 段模式实测 201 chunk/1440 段：palette 565 + singleValue 875 + **direct 0** ✓（"暂不碰 direct"那条分支实际发生率 0% ✓ 该脚本会持续量化它）
- 回归口复验方式（2026-09-22 起**容器内跑 = 正道**，宿主只作兜底；改翻译层后先 `docker restart qiandengji-gate-1 qiandengji-gate-public-1` ✓ `/app/src` 是宿主 `world/src` **只读挂载** ✓ 改宿主文件即生效 ✓ 不用重建镜像 ✓）：
  ```
  PW=$(docker exec qiandengji-mc-1 sh -c "grep '^rcon.password' /data/server.properties | cut -d= -f2")
  docker exec -e GATE_HOST=gate -e GATE_PORT=25700 -e RCON_HOST=mc -e RCON_PORT=25575 \
    -e RCON_PASS="$PW" qiandengji-world-1 node /app/src/neoforge-handshake/verify-gate.cjs
  ```

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

1. [ ] 选路线：临时/任务型 → **mineflayer 走门**（内 `25701` / 外 `25702` + `ag_` 名）；长期常驻角色 → numen
2. [ ] 起 ASCII 独占名（**定死别改**，名字=UUID=背包家园成就）；`whitelist add` 它（现 `white-list=false`，前缀闸只挡名字不挡准入）
3. [ ] mineflayer：`version '1.21.1'` + `auth:'offline'` + **端口走门，不是 25565** + 自带看门狗重连
4. [ ] 进门冒烟：`bot.chat` 收发 ✓ `bot.blockAt` 读一个已知方块（**注意 name 不带 `minecraft:` 前缀**）
5. [ ] 用命令面而非猜语义：`/mycli status --json` → `/mycli help` → `/mycli commands`（公屏不走命令，必须斜杠或 `/msg Goddess cli …`）
6. [ ] 服务端侧回归口（改过翻译层/号表后）：`node verify-gate.cjs`（7 项）+ `node audit-idmap.cjs`（覆盖率/往返/段模式）

## 8. 世界 CLI（`/mycli`）——Agent 的服务端正门

门的翻译层解决"看得见"，`/mycli` 解决"做得准" ✓ 权威定义在 `world/src/gameplay/commands/player-cli.ts`（`CLI_VERBS` 命令树）。
设计四条（CLI-Anything 哲学）：**一条命令一个动作** ✓ **自描述**（`help` 列全树、`help <动词>` 看单条）✓ **确定性**（同命令+同状态 → 回执结构一致，不靠 LLM 猜语义）✓ **机器可读**（`--json` 出 JSON 直接 parse）。

- 前缀等价：`/mycli`、`/cli`、`cli`、`!cli` 都认 ✓ **公屏不走命令**（2026-08-29 造物主谕）→ 用斜杠形式，或私聊 `/msg Goddess cli status`
- 进门三板斧：`/mycli status --json` → `/mycli commands` → `/mycli help cast`
- 动词分组：查询 `status/skills/spells/appraise/growth/help/menu` ✓ 施法 `cast/cancel/skillbar/bookget/learn/staff-cast` ✓ 女神对话 `pray/ask/chat` ✓ 成长 `innate/cultivate` ✓ 传送 `goto/waypoint` ✓ 世界社交 `summon/discoveries` ✓ 守卫专用 `guardian-cast`（守护天使代主人施法）✓ 共 24 个
- 技能体系三层，`/mycli` 站在交界处：**咏唱**（主动法术，众生自己念，真人/AI 通用）· **puffish 技能树**（修行数值层，AI 不装 mod 走 CLI/RCON 侧灌经验）· **女神加护**（`pray` 祈愿裁决）✓ 铁魔法另需"铭文台把卷轴装入法术书并**装备**"，只放背包不算 ✓ 用 `spells` 查真实可用与拒绝原因，别照旧档案硬试
- 号翻译 + `/mycli` 合起来才是一个完整 Agent：**看得见真世界 + 做得准动作** ✓

---
维护：本手册状态由 `verify-gate.cjs` / `audit-idmap.cjs` 实证背书；改过 `idmap-remap.cjs` 或 `build-idmap.cjs` 后**先跑这两件再更新本文**，勿凭记忆写状态词。

---

> **号映射单一事实源**：NeoForge↔原版 blockstate/item 号的来路、覆盖面、兜底规则、重建与验收，统一见 [BOTGATE-IDMAP](BOTGATE-IDMAP.md) ✓ 部署动作与宿主服务正本见 [deploy-release-runbook](deploy-release-runbook.md) §5–§6 与 `world/host-services/` ✓

> **形象/皮肤**：走 YSM（模型内置服务端 ✓ Agent 用 `world/tools/ysm_assign.py random <玩家>` 随机分配初始形象 ✓ 真人自己 Alt+Y 选）→ 见 [SKINS-YSM](SKINS-YSM.md)
