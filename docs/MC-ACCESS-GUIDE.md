# 接入指南：文字 AI 与基岩版客户端如何进「千灯纪」服务器

> 现场核实：2026-09-20，全部来自实测（docker ps 端口表 / netstat / RCON 在线名单 / 容器 mods 清单）。
> **2026-09-21 更新 ✓**：NeoForge 网络号与原版表不一致的问题**已在门（gate）里翻译修好并复验** ✓
> 冒烟 `world/src/neoforge-handshake/verify-gate.cjs` **7/7 通过**（区块批量 / 单块实时 / `fill` 批量 / 物品 ✓）✓
> 所以 **mineflayer Agent 必须走门（内 `25701` / 外 `25702`）✓ 裸连 `25565` 仍会读错世界** ✗
> Agent 细节（身份铁律/白名单/前缀闸/`/mycli`）见 `docs/AGENT-ONBOARDING.md` ✓
> 服务端：Minecraft **Java 1.21.1 + NeoForge 21.1.248**，容器 `qiandengji-mc-1`，
> **离线模式（online-mode=false，免正版验证）** —— 这一条决定了下面所有接入方式都可行。

---

## 〇、一分钟结论

| 想接什么 | 走哪个口 | 需要什么 | 现在能用吗 |
|---|---|---|---|
| **AI / 机器人（mineflayer 等）** | **必须走门**：本机/内网 `127.0.0.1:25701` ✓ 外部 `192.168.3.133:25702`（名字须 `ag_` 开头）| 无需正版账号；`auth: 'offline'`；协议钉 `1.21.1` | **能 ✓ 读数已复验正确 ✓**（裸连 25565 会读错 ✗）|
| **AI / 假玩家（服务端内生）** | 不开网络口 | 服务端 `numen` 插件 + RCON `25577` | **能用 ✓ 且读数天然正确 ✓（不经网络编号）** |
| **基岩版（手机/Switch/Win10 版）** | **UDP `19140`**（经 Geyser 桥） | 宿主机 ViaProxy+Geyser 进程在跑 | **能用 ✓**（2026-09-20 拉起，计划任务 `ViaProxy-Bedrock` 登录自起 ✓） |
| **真人 Java 玩家** | `<服务器IP>:25565` | **装了 NeoForge 的客户端** | 能用（萌萌实测） |

---

## 一、AI（文字 Agent）怎么接入 —— 两条正路

### 路线 A：网络客户端（mineflayer 系）→ **必须走门 `25701`（内）/ `25702`（外）**

为什么"能进"：服务端装了 **`botgate.jar`**，处理"不会说 NeoForge 模组通道"的客户端协商（否则原版客户端会被以"必需通道缺失"拒绝 `vanilla.client.not_supported`）。

**但光"进得来"不够** ✓ NeoForge 带内容模组后**网络里的方块/物品号 ≠ 原版表** ✓ 直连 `25565` 会读到一个错乱的世界（红床读成活塞 ✓ 书架读成变体 ✓）。
所以 Agent 一律连 **「神社之门」`gate.cjs`**（它在出站把号翻回原版 ✓ 2026-09-21 已复验 7/7 ✓）：

- **内门** `127.0.0.1:25701`：本机/容器内 Agent ✓ 收任意名
- **外门** `192.168.3.133:25702`：外部/异地 Agent ✓ **名字必须以 `ag_` 开头**（内部号冒名在门口即拒 ✓ 实测有效 ✓）

最小可跑示例：

```js
// npm i mineflayer@4.37.1   —— 版本坑见下文
const mineflayer = require('mineflayer')
const bot = mineflayer.createBot({
  host: '127.0.0.1',        // 本机走内门；外部客户端写 192.168.3.133 并把 port 改 25702
  port: 25701,              // ★门，不是 25565；25565 只给装了 NeoForge 的真人客户端
  username: 'ag_myagent',   // 走外门须 ag_ 前缀；离线模式名字决定 UUID，见「身份铁律」
  auth: 'offline',
  version: '1.21.1',        // 必钉；不钉会协商到新版本被拒
})
bot.on('spawn', () => bot.chat('我进来了'))
```

已在跑的现成实现（三种）：

| 实例 | 引擎 | 入口 | 备注 |
|---|---|---|---|
| **Goddess**（女神化身 + 天神之眼） | mineflayer | **`gate:25700` 已走门 ✓（2026-09-21 15:14 切换）** | compose `MC_HOST=gate/MC_PORT=25700` + `MC_GATE_TRANSLATED=1` ✓ 门日志实证 `穿越者 Goddess 叩门→PLAY` ✓ 天眼 `/healthz` 报 `blockStates.mode="gate-translated"` ✓ RCON 仍直连 `mc`（管理面不绕门 ✓）|
| **守卫之眼 render_view**（`guard-render-pure/webgl.mts`） | mineflayer（宿主侧 numen MCP 拉起） | **已走门 ✓** `GUARD_RENDER_PORT` 默认 25701 ✓ 门日志实证 `RenderBot 叩门→PLAY→603 chunk→err=none` ✓ |
| **NekoX**（wehos/mc-agent-neko fork） | Node + mineflayer | **`127.0.0.1:25565` 裸连·⚠ 未走门** | 实验体，**当前已停** ✓ 要再跑应把端口改 25701 ✓ |
| **Kirito / 鸣人 / 爱德华** | **numen 假玩家**（服务端内生） | 不走网络 | 由 RCON `numen_act` 驱动 ✓ **读数天然正确** ✓ |

### 路线 B：numen 假玩家（服务端内生"身体"，魂在外面）

- **身** = 服务端实体（`NumenPlayer`，`ServerPlayer` 子类）：天然全权限、零网络开销、不会掉线
- **魂** = 外部 agent（QwenPaw 侧），经 **RCON `25577`** 下 `numen_act` 驱动
- 适合"要长期住在世界里干活"的角色；一次性任务用路线 A 更省事

### 身份铁律（AI 接入最容易踩的坑）

离线模式下 **玩家 UUID 由名字推导**，所以：

- **中文名（桐人/鸣人）只用于叙事与界面**；`Kirito` / `Naruto` 这类 ASCII 登录名才是**程序键**
- **改名 = 换 UUID = 背包/家园/成就全部错位** —— 直播号 `live` 也绝不要改名
- 程序里发消息/引实体：先查权威映射（`transmigrators.json` / `agents.json` / `usercache.json`）拿真实登录名或 UUID，别拿中文名硬编码

### AI 接入的六个已知坑（都实际踩过）

1. **`version` 必须钉 `1.21.1`**，否则协议协商失败。
2. **mineflayer 打补丁需 `4.37.1`**：npm 默认装的 4.39.0 会让 `patch-package` 失败。
3. **keepalive 竞态**：曾有"门神双应答把 bot 踢下线"的事故。
4. **`PartialReadError: packet_entity_metadata`（未修）**：mineflayer/protodef 读不懂模组新增生物的实体元数据（本服 64 格内 39 个非玩家实体），AI 的实体视图有洞，影响避怪与寻路。
5. **Agent 一律走门，别连 `25565`/`25599`/`25567`**：`25565` 是发给**装了 NeoForge 的真人客户端**的（Agent 裸连它 = 读一个错乱的世界 ✗）；`25599` 是容器内部原生口、`25567` 只绑 127.0.0.1。Agent 只连 **内门 `25701`** 或 **外门 `25702`（名字须 `ag_` 开头）** ✓
6. **偶发 `ECONNRESET`**：今日 NekoX 即因此掉线（`[LoginGuard] read ECONNRESET` + `transport close`）；长驻 bot 必须自带看门狗。

---

## 二、端口速查（实测）

| 宿主端口 | 协议 | 去向 | 用途 |
|---|---|---|---|
| **25565** | TCP | `qiandengji-mc-1:25599` | **唯一对外游戏口**：真人 Java（要 NeoForge）+ AI mineflayer（原版协议） |
| 25567 | TCP | 同上（仅 127.0.0.1） | 本机内部 |
| **25577** | TCP | 容器 `25575` | **RCON**（口令在容器 `/data/server.properties`，不入仓库） |
| 25701 | TCP | `qiandengji-gate-1:25700` | 握手门神（旁路备用） |
| 19091 / 19092 | TCP | panel / world:3070 | 管理面板 / 观战与镜头服务 |
| 24455 | UDP | 容器 `24454` | Simple Voice Chat 语音 |
| **19140** | UDP | 宿主 ViaProxy+Geyser | **基岩版入口（运行中 ✓）** |

---

## 三、基岩版（手机/平板/Switch/Win10 版）怎么接入

基岩与 Java **协议完全不同**，不能直连，必须走协议翻译桥：

```
手机基岩客户端 --UDP 19140--> ViaProxy(内挂 Geyser 2.11.3（build 1245）) --TCP 127.0.0.1:25565--> NeoForge 服务端
```

### 现状（必须先说清）

- 桥是**宿主机进程**，不在 Docker 里：Docker Desktop 的 UDP 端口映射在本机不转发（实测过）。
- **现在 ViaProxy 在跑**（2026-09-20 拉起）：UDP 19140 监听 ✓、Geyser 2.11.3（build 1245）-b1232 完成启动 3.98 s ✓、
  `settlementsgate` 扩展加载 **6/6 vanilla 定义 captured (all OK)** + **37 NPC 名册** ✓、
  后端 target = `127.0.0.1:25565` ✓、防火墙规则 `Geyser Bedrock UDP 19140` = **Enabled: Yes** ✓。
  已挂计划任务 **`ViaProxy-Bedrock`（onlogon）** ✓ 重启后自起 ✓（本机作业对象会杀掉随会话启动的进程树 ✓ 所以必须走任务计划 ✓）
- 但**东西齐全且已修好**：
  - `ViaProxy-3.4.12.jar` + `plugins/Geyser-ViaProxy.jar`（Geyser 2.11.3（build 1245），199 个 mod 方块映射）
  - 启动脚本里 **target 已是正确的 `127.0.0.1:25565`**（历史上写死成 `25599`——容器内口、宿主不通，曾造成"僵尸进程占端口→基岩连不上"，已修）
  - `plugins/Geyser/extensions/settlementsgate-1.3.0.jar`：把万家烟火的自定义实体 `settlements:base_villager`
    映射成基岩的 `minecraft:villager_v2`。**没它，智能村民在基岩端会变成一条鱼**（真事，已修）

### 拉起来（一条命令）

```bat
start "" /min cmd /c "C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\viaproxy\start-viaproxy.bat"
```

**已经挂成计划任务**（`ViaProxy-Bedrock`，onlogon 自起 ✓）—— 因为本机 Windows 作业对象会把随会话启动的整棵进程树收走 ✗（踩过的坑 ✓），必须脱离会话 ✓
日常运维两条命令 ✓：

```bat
schtasks /run  /tn "ViaProxy-Bedrock"    :: 拉起/重启基岩桥 ✓
schtasks /end  /tn "ViaProxy-Bedrock"    :: 停掉（改完名册后先 end 再 run）✓
```

### 基岩端配置

- 地址 **`192.168.3.133`**，端口 **`19140`（UDP）**
- **不需要正版/Microsoft 账号** ✓：实测 Geyser `config.yml` 里 **`auth-type: offline`** ✓ 与服务端离线模式配套 ✓
  （**注意：本部署没装 Floodgate** ✓ 只靠"双离线"放行 —— 好处是零配置 ✓ 代价是基岩玩家身份可伪造 ✓ 若将来要对外网开放须补 Floodgate 或改正版 ✓）
- 客户端为基岩版（手机/平板/Switch/Win10 版）

### 基岩端能看到什么（预期管理）

| 内容 | 基岩端 |
|---|---|
| 地形、建筑、昼夜、天气、玩家与生物 | 正常 |
| 智能村民（经 settlementsgate 映射） | 显示为村民（不再是鱼） |
| 买卖、红石、容器、探索 | 能玩 |
| 模组方块/物品贴图 | **已修 ✓ 2026-09-21**：基岩桥上游已改指门（`ViaProxy --target-address 127.0.0.1:25701`）✓ 于是 Geyser 收到的是**翻译后的原版号** ✓ 模组方块/物品显示为「最像的原版方块/物品」代理物（屋顶→石砖类、卷册→附魔书、刷怪蛋→蛋类），不再是黑紫格子/满地假火 ✓ 但**不可能像素级还原** ✗（基岩无该 Java mod 的物理上限 ✓）|
| puffish 技能树界面 | 看不到 |
| 网页观战镜头 / 神谕 UI / 书页点选施法 | 收不到自定义 payload |
| 语音（Simple Voice Chat） | 基岩端无此 mod |

**一句话**：基岩端 = "能活、能逛、能交易、能看到村民"的**原版体验**，模组专属功能看不到。
要"点书页施法 / 听天音"这类体验仍需 Java + NeoForge 客户端。

> 别指望在基岩"下载服务器模组"：mod 是 Java 专属；客户端提示"要装 NeoForge"是 Java 侧拒连话术经桥透传，不是基岩能装 mod。

---

## 四、三份速查

1. **我要挂个 AI 进世界**：连**门**（本机 `127.0.0.1:25701` ✓ 外部 `192.168.3.133:25702` ✓ 外门名字须 `ag_` 开头）+ `auth: 'offline'` + `version '1.21.1'` + 起个 ASCII 名（名字即身份，之后别改）+ 配自动重连 ✓ 细节看 `docs/AGENT-ONBOARDING.md` ✓
2. **我要手机进来看**：先把桥拉起来（第三节），再连 `192.168.3.133:19140`（UDP），接受"原版体验 + 无 mod 贴图"。
3. **我要服务端驱动角色**：走 numen 假玩家 + RCON `25577`，不占网络口、最稳。

## 五、当前欠账（别当已完成）

1. **基岩桥映射名册要重启才刷新** —— `plugins/Geyser/settlements-professions.json` 变更后必须重启 ViaProxy 才生效（`schtasks /end /tn ViaProxy-Bedrock` + `/run`）；另日志提示 ViaProxy 3.4.13 / Geyser 5.12.0 有新版可升（可选，不影响当前连通）。
2. **`packet_entity_metadata` 解析洞未修** —— AI 实体视图不完整，影响避怪/寻路。
3. **偶发 `ECONNRESET`** —— 长驻 bot 必须自带看门狗重连。
4. **AI 自主性依赖 `MC_SELF_PROPOSE=1`**（已开）：不设则没任务时原地罚站，看着像死机。
5. **夜里角色倾向"躲夜罚站"**（自保反射独占身体且空转）：白天演示，或给它一张床。
6. **已连客户端绕过门的情况（2026-09-21 更新）** ✓ 基岩桥已修 ✓ 余两处待点头：
   - ✅ **基岩桥已接上门（2026-09-21 14:37 落地）**：`start-viaproxy.bat` 的 `--target-address` 已由 `127.0.0.1:25565` 改成 **`127.0.0.1:25701`** ✓ 新进程实查带新值 ✓ **免手机验证法**：`node verify-gate.cjs 127.0.0.1 25568`（打 ViaProxy 的 Java 入口=基岩同一条上游）→ **7/7 通过 ✓** 门日志亦见该会话 ✓ 说明 Geyser 收到的已是原版号 ✓ 改前实查 `Updated 0 players` ✓ 未踢访客 ✓
  ⚠ 回滚：`copy start-viaproxy.bat.bak-target25565 start-viaproxy.bat` → `schtasks /end` → **还要 `taskkill /T /F` 掉残留 java**（`/end` 不杀孤儿子进程 ✓ 实测踩过）→ `schtasks /run`
  ⚠ **持久性隐患**：`ops/docker/.gitignore:8` 的 `shadow/` 把整个桥目录排除 ✓ **此脚本不在版本控制里** ✓ 换机/重建即丢 ✓ 正本该另存
   - ✅ **`world` 服务（Goddess 化身 + 天神之眼）已改走门 ✓（2026-09-21 15:14）**：compose `MC_HOST=gate / MC_PORT=25700` + 新增 `MC_GATE_TRANSLATED=1` + `depends_on: gate` ✓ 门日志实证 `穿越者 Goddess 叩门→PLAY` ✓
   **同时必须停用天眼自带的第二套翻译层**（`injectModBlockRegistry` + `vanilla-state-map` 归一化）✓ 门已翻过一次 ✓ 再翻就是二次映射：实测那张表 26834 条、**键值域与原版号重叠 26684** ✓ 且 `normalize()` 对不认识的号直接 `throw viewer_state_id_unregistered` → 表现为 `viewerUnavailable` ✗ 所以天眼本地补偿**只在不过门的裸连接下才需要** ✓（`MC_GATE_TRANSLATED=1` 即切到恒等映射 ✓ 可回退）
   守卫之眼（`guard-render-*.mts`）同理已改：它原先复用 `MC_PORT` ✓ 而宿主那个环境变量指向裸口 25565 ✓ 现改用专用 `GUARD_RENDER_PORT`（默认 25701）✓ 门日志实证 `RenderBot` 进门 ✓
   - NekoX（已停）复活时把端口改 25701 ✓
   注：计划任务里 `Geyser-Bedrock`（State=Ready ✓ 未跑）与 `ViaProxy-Bedrock`（Running）并存 ✓ **现役是 ViaProxy 内嵌 Geyser** ✓ 早前"Geyser-Standalone b1245"那条记录作废 ✗
7. **外门 `25702` 已可被局域网直连（`ag_probe` 实测进门成功）** ✓ 而 `white-list=false` ✓ → **公网转发前必须先加白名单并 `whitelist on`** ✓ 否则任何知道地址的人拿 `ag_xxx` 就能进 ✓

---

> **号映射单一事实源**：NeoForge↔原版 blockstate/item 号的来路、覆盖面、兜底规则、重建与验收，统一见 [BOTGATE-IDMAP](BOTGATE-IDMAP.md) ✓ 部署动作与宿主服务正本见 [deploy-release-runbook](deploy-release-runbook.md) §5–§6 与 `world/host-services/` ✓
