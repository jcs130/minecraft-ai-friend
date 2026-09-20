# 接入指南：文字 AI 与基岩版客户端如何进「千灯纪」服务器

> 现场核实：2026-09-20，全部来自实测（docker ps 端口表 / netstat / RCON 在线名单 / 容器 mods 清单）。
> 服务端：Minecraft **Java 1.21.1 + NeoForge 21.1.248**，容器 `qiandengji-mc-1`，
> **离线模式（online-mode=false，免正版验证）** —— 这一条决定了下面所有接入方式都可行。

---

## 〇、一分钟结论

| 想接什么 | 走哪个口 | 需要什么 | 现在能用吗 |
|---|---|---|---|
| **AI / 机器人（mineflayer 等）** | `<服务器IP>:25565` | 无需正版账号；`auth: 'offline'`；协议钉 `1.21.1` | **能用**（Goddess 与 NekoX 今日实测在线） |
| **AI / 假玩家（服务端内生）** | 不开网络口 | 服务端 `numen` 插件 + RCON `25577` | **能用**（Kirito 在线） |
| **基岩版（手机/Switch/Win10 版）** | **UDP `19140`**（经 Geyser 桥） | 宿主机 ViaProxy+Geyser 进程在跑 | **当前不能：桥没启动**（见第三节） |
| **真人 Java 玩家** | `<服务器IP>:25565` | **装了 NeoForge 的客户端** | 能用（萌萌实测） |

---

## 一、AI（文字 Agent）怎么接入 —— 两条正路

### 路线 A：网络客户端（mineflayer 系）→ 直连 25565

为什么能进：服务端装了 **`botgate.jar`**，专门处理"不会说 NeoForge 模组通道"的客户端协商。
没有它，原版协议客户端会被 NeoForge 以"必需通道缺失"为由拒绝（`vanilla.client.not_supported`）。

最小可跑示例：

```js
// npm i mineflayer@4.37.1   —— 版本坑见下文
const mineflayer = require('mineflayer')
const bot = mineflayer.createBot({
  host: '127.0.0.1',        // 本机；局域网写 192.168.3.133
  port: 25565,
  username: 'MyAgent',      // 离线模式：名字会决定 UUID，见「身份铁律」
  auth: 'offline',
  version: '1.21.1',        // 必钉；不钉会协商到新版本被拒
})
bot.on('spawn', () => bot.chat('我进来了'))
```

已在跑的现成实现（三种）：

| 实例 | 引擎 | 入口 | 备注 |
|---|---|---|---|
| **Goddess**（女神化身） | mineflayer | 25565 | 一直在岗 |
| **NekoX**（wehos/mc-agent-neko fork） | Node + mineflayer | 127.0.0.1:25565 | 今日整天在跑 |
| **Kirito / 鸣人 / 爱德华** | **numen 假玩家**（服务端内生） | 不走网络 | 由 RCON `numen_act` 驱动 |

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
5. **别连 `25599` / `25567`**：`25599` 是容器内部原生口，`25567` 只绑 127.0.0.1；对外一律 **25565**。
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
| **19140** | UDP | 宿主 ViaProxy+Geyser | **基岩版入口（当前未运行）** |

---

## 三、基岩版（手机/平板/Switch/Win10 版）怎么接入

基岩与 Java **协议完全不同**，不能直连，必须走协议翻译桥：

```
手机基岩客户端 --UDP 19140--> ViaProxy(内挂 Geyser 2.11.2) --TCP 127.0.0.1:25565--> NeoForge 服务端
```

### 现状（必须先说清）

- 桥是**宿主机进程**，不在 Docker 里：Docker Desktop 的 UDP 端口映射在本机不转发（实测过）。
- **现在 ViaProxy 没在跑**，UDP 19140 无监听，其日志停在 09-07 19:49。
- 但**东西齐全且已修好**：
  - `ViaProxy-3.4.12.jar` + `plugins/Geyser-ViaProxy.jar`（Geyser 2.11.2，199 个 mod 方块映射）
  - 启动脚本里 **target 已是正确的 `127.0.0.1:25565`**（历史上写死成 `25599`——容器内口、宿主不通，曾造成"僵尸进程占端口→基岩连不上"，已修）
  - `plugins/Geyser/extensions/settlementsgate-1.3.0.jar`：把万家烟火的自定义实体 `settlements:base_villager`
    映射成基岩的 `minecraft:villager_v2`。**没它，智能村民在基岩端会变成一条鱼**（真事，已修）

### 拉起来（一条命令）

```bat
start "" /min cmd /c "C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\viaproxy\start-viaproxy.bat"
```

或由我做成计划任务常驻 —— 本机 Windows 作业对象会把随会话启动的整棵进程树收走（这是踩过的坑），必须脱离会话。

### 基岩端配置

- 地址 **`192.168.3.133`**，端口 **`19140`（UDP）**
- **不需要正版/Microsoft 账号**（Floodgate 免验证 + 服务端离线模式）
- 客户端为基岩版（手机/平板/Switch/Win10 版）

### 基岩端能看到什么（预期管理）

| 内容 | 基岩端 |
|---|---|
| 地形、建筑、昼夜、天气、玩家与生物 | 正常 |
| 智能村民（经 settlementsgate 映射） | 显示为村民（不再是鱼） |
| 买卖、红石、容器、探索 | 能玩 |
| 模组方块/物品贴图 | 可能黑紫格子（基岩没有 Java mod） |
| puffish 技能树界面 | 看不到 |
| 网页观战镜头 / 神谕 UI / 书页点选施法 | 收不到自定义 payload |
| 语音（Simple Voice Chat） | 基岩端无此 mod |

**一句话**：基岩端 = "能活、能逛、能交易、能看到村民"的**原版体验**，模组专属功能看不到。
要"点书页施法 / 听天音"这类体验仍需 Java + NeoForge 客户端。

> 别指望在基岩"下载服务器模组"：mod 是 Java 专属；客户端提示"要装 NeoForge"是 Java 侧拒连话术经桥透传，不是基岩能装 mod。

---

## 四、三份速查

1. **我要挂个 AI 进世界**：`port 25565` + `auth offline` + `version 1.21.1` + 起个 ASCII 名（名字即身份，之后别改）+ 配自动重连。
2. **我要手机进来看**：先把桥拉起来（第三节），再连 `192.168.3.133:19140`（UDP），接受"原版体验 + 无 mod 贴图"。
3. **我要服务端驱动角色**：走 numen 假玩家 + RCON `25577`，不占网络口、最稳。

## 五、当前欠账（别当已完成）

1. **基岩桥未运行** —— 东西齐、脚本对，缺"拉起来并常驻"。
2. **`packet_entity_metadata` 解析洞未修** —— AI 实体视图不完整，影响避怪/寻路。
3. **偶发 `ECONNRESET`** —— 长驻 bot 必须自带看门狗重连。
4. **AI 自主性依赖 `MC_SELF_PROPOSE=1`**（已开）：不设则没任务时原地罚站，看着像死机。
5. **夜里角色倾向"躲夜罚站"**（自保反射独占身体且空转）：白天演示，或给它一张床。
