# 渲染与接入路线调研：Mindcraft / Velocity / Geyser / Hydraulic / MCDR

> 2026-08-26 · 造物主提问驱动 · 结论先行：**当前架构已是参考项目同款，不动；Bedrock 入口若要开，走 ViaProxy+Geyser 一条路；MCDR+Carpet 假人不适合本服。**

## 一、问题拆解

造物主四个名字，其实问了两件事：

1. **渲染**：9090 面板的画面有没有比 prismarine-viewer 更好的做法？
2. **接入**：真人（含基岩版手机玩家）和 bot 接入服务器，有没有比现在（直连 + numen 假玩家）更好的架构？

## 二、逐项查实

### 1. Mindcraft（mindcraft-bots/mindcraft，UCI，5.7k star，arXiv:2504.17950）

- **渲染 = prismarine-viewer**，和我们的 9090 面板 iframe 同一个库（mineflayer 官方推荐的 "See what your bot is doing"）。它每个 bot 开一个 viewer 端口（docker 例子里 3000-3003），我们开 3050/3150 双视角——**参考项目的做法我们已经对齐，且刚修好**。
- **接入选型**：README 里根本没有 Velocity。给不支持版本用的代理是 **ViaProxy**（`services/viaproxy/`，standalone ViaVersion）——版本翻译代理，不是 Velocity。造物主记忆里的 "velocity 接入" 实为 ViaProxy。
- **真正值得抄的不是接入，是 agent 层**：任务 JSON 格式（goal/initial_inventory/timeout/blocked_actions）、embedding 选 few-shot 示例、多智能体 MineCollab（行动级协作）、自设目标模式。这些是行为设计经验，与我们守卫/任务板体系互补。

### 2. Velocity（PaperMC 代理）

- 本体是**玩家流量网关**：多后端路由（大厅/生存/异界）、统一认证、服务器间无感切换。
- **对 mineflayer bot 没有增益，反而有坑**：mineflayer #3776——bot 过 Velocity 在 1.21+ 配置阶段被踢（configuration phase kick），需打补丁绕。我们 bot 直连后端（现状）零问题。
- 对我们的真实价值只有一个场景：**将来 mc-isekai 上线、要一个正门把「生存服/异界服」路由在一起时**，Velocity（或 minekube Gate，后者对 modded 后端支持更好，配套 CrossStitch）才是对的工具。现在还用不上。

### 3. GeyserMC + Floodgate（基岩版进 Java 服）

- 官方支持矩阵：**Geyser 只跟最新 Java 版**（现 Java 26.2 / Bedrock 26.0-26.40）；Geyser-NeoForge 同样只支持最新版。
- **旧版 Java（我们锁 1.21.1）的官方正解**：standalone **ViaProxy + Geyser-ViaProxy**（Geyser 官网 wiki 原文推荐，Floodgate 认证也兼容）；或 Velocity 上挂 Geyser-Velocity + ViaVersion 插件降协议。前者更轻：**一个 jar 同时做版本翻译（26.2↔1.21.1）+ 基岩入口（19132）**。
- **硬伤在本服内容模组**：Settlements 的自定义方块、Macaw 家具、日式结构……基岩客户端没有这些注册表，Geyser 只翻原版。基岩玩家进村会看到大量 fallback/缺块。聊天、走路、打怪、看风景没问题，看建筑体验残缺。
- 结论：**能开，但定位成「手机党低配入口」**——萌萌想在手机上看世界/聊天可以；完整体验仍需 Java 客户端。要开就在 shadow 栈加一个 viaproxy 容器试运行，风险隔离。

### 4. Hydraulic（GeyserMC 官方，modded 服的基岩翻译）

- 定位：服务端 mod，把 mod 注册表（物品/方块）翻译给基岩客户端，配 Geyser 用。
- 官网自述：**"still in very early development and should not be used on production setups"**。只认主流大 mod（翻译是手工/半自动映射），我们的 Settlements/Macaw 冷门 mod 必然不在册。
- 结论：**观望**。它成熟也不解决冷门 mod 翻译问题，除非我们自写映射（那是给自己加长期维护负担）。

### 5. MCDReforged + Carpet 假人（playerbot + Python 接口）

- MCDR：Python 服务端**管理壳**（包 java 进程、插件 API、热重载），定位是运维工具，不是 bot 框架。
- "游戏内置 playerbot" = **fabric-carpet 的 `/player spawn` 假人**；MCDR 侧插件如 FastBotSpawn 只是批量召唤壳。**Carpet 是 Fabric mod，跑不进我们的 NeoForge 1.21.1**——要走这条路得换加载器，等于放弃 Settlements 等全部 NeoForge 生态，不成立。
- 就算平台对得上，carpet 假人也远不如 numen：无寻路、无自动觅食、无对话，只能站桩/攻击/跟随。**我们的 numen 就是这一类东西的加强版**（服务端实体零握手 + goto/mine/eat/attack/follow/say 全套 act API + MCP 直连 LLM），是自己写出来的正典路线。
- MCDR 本身作为运维壳（备份/统计/定时）与 B 仓 sidecar 职责重叠，引入是负资产。**跳过**。

## 三、裁决

| 方案 | 对渲染 | 对接入 | 结论 |
|---|---|---|---|
| Mindcraft 路线 | prismarine-viewer（同款，已落地） | mineflayer 直连（同款，已落地） | **已对齐**；抄它的 agent 行为设计（任务 JSON/embedding 选例/多智能体协作） |
| Velocity | — | bot 过代理有已知 bug；多服路由才用得上 | **备而不用**（mc-isekai 转正时再启，或选 Gate） |
| ViaProxy+Geyser | — | 基岩版手机入口，一 jar 双职责 | **可试点**：shadow 栈加容器，服务手机看护场景 |
| Hydraulic | — | modded 基岩翻译 | **观望**（官方自认不可上生产） |
| MCDR+Carpet 假人 | — | 平台不符（Fabric≠NeoForge）且能力弱于 numen | **跳过** |

**一句话**：渲染和 bot 接入我们已经在参考项目的同一条正道上，不用换；四个名字里唯一值得动手的是「基岩版入口」（ViaProxy+Geyser，等萌萌/手机党有实际需求就试点）；Mindcraft 真正值钱的是它的 agent 行为设计，可作为守卫/任务板进化的参考。
