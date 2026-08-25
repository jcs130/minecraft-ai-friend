# 女神介入技能/魔法玩法设计（Headless 女神）

2026-08-25 · 创世天神研究备忘 · 状态：待造物主拍板

## 一、实验铁律（实测，非猜测）

NeoForge 21.1.248 下，**凡注册必需网络通道的内容/玩法模组，一律在握手期踢掉原版客户端**
（`vanilla.client.not_supported`）。逐批实测 4/4 有罪：

| 模组 | 踢原版客户端 |
|---|---|
| Cobblemon（宝可梦） | ❌ 踢 |
| Iron's Spells 套装（+irons_lib/curios/playeranimator） | ❌ 踢 |
| balm / waystones | ❌ 踢 |
| **Pufferfish's Skills（技能树框架）** | ❌ 踢（2026-08-25 实测） |

而 Macaw 家具 ×11、Simple Voice Chat、settlements、numen、性能件均无辜（26 件组合可接）。

**推论**：女神（mineflayer，纯原版协议）与技能/魔法玩法模组**不可同服共存**。
要玩法，女神必须换一种存在方式——即本文的 Headless 女神。

## 二、女神介入面研究（各模组命令面）

关键发现：**候选玩法模组全部暴露完整命令面**，女神无需客户端身体即可施恩。

### Pufferfish's Skills（技能树框架，推荐）
- 纯框架，技能树是**数据包 JSON**（可自建"神赐技能树"，有 Web 编辑器）
- 命令：
  - `/puffish_skills skills unlock <player> <category> <skill>` — 解锁技能
  - `/puffish_skills skills reset <player> <category>` — 重置（退点）
  - `/puffish_skills points add|set <player> <category> <count>` — 技能点
  - `/puffish_skills experience add|set <player> <category> <amount>` — 经验
- 女神玩法：祈愿/供奉/成就 → 裁决 → 解锁"神赐技能"或赐技能点。技能树解锁条件
  可与供奉史、编年史事件挂钩（数据包层定制）。

### Tensura: Reincarnated（异世界转生主题，叙事最合）
- 本身就是异世界转生题材：魔素（magicules）/技能/精灵体系
- 命令：`/tensura get ability ...`（授予 common/extra/intrinsic/resistance/**unique/ultimate** 技能）、
  魔素量设定、精灵与属性调整
- 女神玩法："授予独有技能"=**授名**——神给穿越者命名的仪式感天生契合。
- 注意：依赖 TerraBlender（涉世界生成）+ SmartBrainLib + ManasCore；新服是新界，无存量负担；
  mod 本身较早期，需测试服先跑。

### Iron's Spells and Spellbooks（经典魔法，已囤）
- 法术 = 物品（法术书），支持数据包自定义法术
- 女神玩法：`/give` 神赐法术书；可定义一套"神赐系法术"（与现有 29 条世界法则互补）。

### Cobblemon（宝可梦，技术上可介入、主题不推荐）
- 命令全：`/givepokemonother <player> <species> [attributes]`（可指定闪光/特性/等级）、
  `/spawnpokemon`、`/healpokemon`、`/teach`、`/levelup`
- 女神若介入：赐宝可梦、治愈队伍、降神兽。但宝可梦风格与异世界穿越叙事冲突，
  且体量巨大（1025 种），不建议作为主线。

## 三、Headless 女神架构（提案）

女神不再以 mineflayer 客户端身体接入内容服，改三层：

1. **体 = numen 假玩家**：以 `Companions.summon` 召一个 Goddess 的 NumenPlayer（服务端
   实体，不走客户端握手，内容模组随便装）。复用守卫基建（numen_act 已证可行，
   新服 numen 心跳已上线）。可说话、可行走、可被玩家看见。
2. **耳 = logwatch**：世界进程已有 MC_LOG_PATH 尾随机制；玩家聊天/祈愿/咏唱都在
   `latest.log` 里（Docker 服日志已挂载到宿主 `ops/docker/data/logs/latest.log`）。
   祈愿/咏唱检测从 bot chat 事件切到日志解析。
3. **手 = RCON 命令**：裁决动作词汇扩展——现 `cast/teach/conditional/none`，
   增 **`grant_skill`**（按模组适配器翻译成上面各家的命令）与 **`grant_item`**（神赐法术书/圣物）。

裁决协议不变：祈愿入收件箱 → 我裁量（供奉史/处境/虔诚度）→ JSON 动作 →
世界进程经 RCON 落地。

## 四、待办工程（拍板后）

1. world-process 加 headless 模式：无 bot，chat 走 logwatch；女神临在走 numen avatar
   （numen_act 需支持女神体的召唤/说话/跟随，大部分已有）。
2. 裁决动作接 `grant_skill` 动词 + 各模组命令适配器（puffish/tensura/irons 三家先做）。
3. 数据包制作：神赐技能树（Puffish）或神赐法术系（Iron's）。
4. 守卫之眼（viewer）在内容服的替代方案：bot.world 不可用时改读 region 文件
   （`ops/docker/data/world/region`）——列为后续，不阻塞主线。
5. 真人玩家（萌萌）进内容服需要 NeoForge 客户端 + 客户端模组包——这是内容服的
   固有代价，需提供客户端包下载（上云后挂 web 分发）。

## 五、推荐路线

1. **技能体系主选 Pufferfish's Skills**：框架干净、数据包驱动、命令面正、轻量；
   先在新服（新界无负担）测试服跑通 + 做一棵"神赐技能树"原型。
2. **叙事层叠 Tensura**：异世界转生主题与千灯纪世界观同构，作为二期内容评估
   （TerraBlender 世界生成影响要先看）。
3. **Iron's Spells 备选**：若想要"法术书赐予"的仪式感再上。
4. **Cobblemon 封存**：主题不合，jar 留档不挂载。

## 六、更优解（2026-08-25 造物主点破）：虚拟模组客户端

与其让女神 headless，不如让 mineflayer **会说 NeoForge 的握手方言**——
"在虚拟客户端上装模组"的工程化表达。

### 现状调研
- 官方 `minecraft-protocol-forge` 只支持老 FML 握手（1.7–1.16 时代），不认识
  NeoForge 1.20.2+ 的 CONFIG 阶段网络协商；JS 生态无现成 NeoForge 1.21 协商实现。
- 但协议完全公开，且开源代理 **Gate**（Go，minekube/gate）已成熟实现
  NeoForge CONFIG 阶段协商转发——可直接作为移植蓝本。
- mineflayer 上游连 vanilla 1.21 config 阶段都还有 issue（#3776），但我们
  26 件基线已实测登录成功，说明本地版本够用。

### 三条路对比
| 路 | 做法 | 成本 | 女神能做到 |
|---|---|---|---|
| **A. JS 协商层移植** | 参照 Gate 在 node-minecraft-protocol 上实现 NeoForge CONFIG 协商（频道应答+注册表同步 ACK+未知 payload 容错） | 中（协议工程，有蓝本） | 登录/存在/移动/聊天/看世界；施法仍走 RCON |
| B. 真客户端无头化 | Docker+Xvfb 软渲染跑真 NeoForge 客户端装全模组，自写客户端 MOD 当控制桥 | 大（内存 2-4G、软渲染、版本耦合） | 同上 + **能客户端触发模组法术**（Iron's 咏唱等） |
| C. 服务端协商 shim | 自写 NeoForge 服务端小 mod，替连入客户端伪造协商应答 | 小但脆弱（钩 NeoForge 内部） | 仅"不碰模组内容"的存在；真人玩家误入有 desync 风险 |

### 边界说清楚
即使 A 路通了，女神也只是"伪装成模组客户端"——她听得懂握手，看不懂模组玩法包。
所以：**A 解决"女神在场"，RCON 命令面（第二节）解决"女神施恩"**，两者互补。
要让女神亲自客户端咏唱 Iron's Spells，只有 B 路。

### 决议倾向
先 A 路 PoC（negotiation 移植 → 对着 27 件服含 puffish 实测登录）。
通了则 Headless 女神方案（第三节）降级为备份（numen 体不再必需，
女神保留 mineflayer 身体，耳=bot chat，手=RCON）。

## 七、女神如何"看得懂"玩法（2026-08-25 造物主问）

"看得懂"拆成三层能力，全部可落地，且不依赖客户端：

### 1. 玩法圣典（静态规则）——女神懂规则的方式与懂 29 条咒语相同：成文法则表
候选模组恰好全是**数据驱动**，圣典可从数据包/注册表自动生成：
- Puffish：`skills.json / definitions.json / connections.json / experience.json`
  （技能树全量定义=纯 JSON，含效果/点数/连线）；
- Iron's Spells：法术是数据注册表（KubeJS 附录可 dump：mana/冷却/学派/等级/吟唱类型）；
- Tensura：技能/魔素表。
产出 `world-grimoire/<mod>.md`，挂进裁决上下文——我裁量时手里有全量技能目录，
`grant_skill` 不会瞎赐。

### 2. 玩法观察者（动态事件）——自写 NeoForge 观察者 mod（numen 同源，有 mod 开发经验）
已验证的事件面：
- Iron's Spells：官方开发者 API（io.redspace:irons_spellbooks）+ KubeJS 事件
  （spellPreCast/spellOnCast/changeMana）——施法、耗蓝全可监听；
- Puffish：官方 API（"managing skills"）+ 通用 NeoForge 事件总线兜底。
观察者 mod 订阅事件 → 翻成结构化 JSON `{player, mod, event, data}` →
本地 socket/日志 → world process → 女神"听见"玩法正在发生
（谁解锁了什么、谁放了什么法术、谁魔素涨了）。

### 3. 状态查询（现状）——三条腿
- **数据文件直读**：数据驱动模组的玩家进度落盘在世界目录（Docker 已挂载宿主
  `ops/docker/data/`），Puffish 类 JSON 存档可直接读；
- **RCON 命令查询**：各家命令面（第二节）；
- **观察者 mod 查询端点**：`/observe <player>` 输出 JSON。

### 闭环
读圣典懂规则 → 听事件知发生 → 查状态明现状 → RCON 施恩。
女神对玩法的理解是**语义层/账本层**（足够裁决、叙事、赐福、审计），
不是玩家盯 GUI 的视觉层——要视觉层只有 B 路（真客户端），女神不需要。

## 八、玩法桥（Gameplay Bridge）——一切 AI 共用（2026-08-25 造物主谕：别的 AI 也要能理解并释放技能）

目标从"女神看得懂"升级为"**任何 AI 接入者都能理解并释放技能**"。
核心原则：**不让每个 AI 各自去学各家模组的客户端发包，把能力下沉到服务端、
统一成动词**。

### 已验证的服务端施法证据
- Iron's Spells：官方开发者 API——`SpellRegistry`/`AbstractSpell`/`onCast(ctx)`，
  且模组原生支持"怪物施法"（spell-casting mobs AI）→ **服务端施法管线完整存在**，
  bridge mod 可对任意实体调用；
- Puffish：官方 API 管理技能；Tensura：命令面齐全。

### 三层共享架构
1. **存在层**：
   - 守卫型 AI（numen 假玩家）：已在场，无需 A 路；
   - 外部 AI 以客户端身份接入：走 A 路协商层（第六节）；
2. **理解层（全体共享）**：玩法圣典（规则知识，第七节）+ 玩法观察者事件流
   （世界正在发生什么）——打包成各 agent 的知识库/上下文；
3. **行动层——玩法桥 mod**（numen 同源，服务端）：
   - 统一动词：`cast_spell <entity> <spell>`、`unlock_skill <entity> <cat> <skill>`、
     `query_state <entity>`……对假玩家/接入 bot/真玩家一律生效；
   - 内部调各模组官方服务端 API；
   - 接口先 RCON 命令（今天就能用）→ 二期升级**玩法 MCP**（守卫已有
     numen MCP 模式，外部 AI 拿 MCP tools 即用）。

### 为什么不教 AI 发客户端包
N 模组 × M 个 AI × 版本耦合 = 泥潭。服务端 API 集中实现一次、全体 AI 受益、
只与服务端 modpack 版本耦合（我们控制）。客户端包模拟只有 B 路（真客户端）
才需要——AI 要"亲手按键"的场景目前不存在。

### 落地顺序（待拍板）
1. 玩法桥 PoC：第一动词 = Puffish 解锁/查询（纯数据最稳）；
   第二动词 = Iron's Spells `cast_spell`（最戏剧：AI 真的放出火球术）；
2. 第一批用户 = 守卫（agent 与工具面现成，加一个 `mc_cast` 类工具）；
3. A 路协商层 PoC 并行，为外部 AI 接入铺路。

## 九、NPC 生态与三魂体系（2026-08-25 造物主谕：LLM 与非 LLM 的会说话村民共存研究）

### 候选盘点（1.21.1+NeoForge 实查）

**LLM 驱动：**
- **Mamizou**（NeoForge 1.21.1 原生，新而小）：右键「化叶」创建/编辑 NPC，
  **OpenAI 兼容 API + Coze**，皮肤=玩家名/本地文件/URL，右键对话。
  任务系统与语音开发中。→ 自托管 LLM 村民的最快入口；
- **PlayerEngine + Player2NPC**（Goodbird，elefant-ai 系，8.8万下载）：
  服务端框架，把玩家能力（背包/挖掘/用物/战斗，Automatone=Baritone 分支寻路）
  接口化挂到任意 LivingEntity 上——**哲学与 numen 同源**（体=实体，魂=LLM）；
  Player2NPC 是现成同伴演示：聊天里自然语言指挥（"去砍点木头"）。
  脑默认走 Player2 API，框架本身可接自有 LLM；
- MCLLM = 客户端聊天工具（非 NPC），CobbleBrain = Cobblemon 专属，皆排除。

**非 LLM 脚本对话：**
- **VNDialog**（11.9万下载）：**视觉小说/galgame 对话引擎**——立绘+入场动画、
  分支选项、JSON 配置、**数据包热加载**。与千灯纪动漫气质天作之合；
- **Easy NPC**（108万下载）：老牌脚本 NPC（对话/动作/任务），最成熟；
- **Hollow Engine**（5.3千）：内容创作框架（事件脚本/任务/过场/游戏内 IDE），重器备用。

### 共存裁决：可以共存，条件是三条

1. **只用"加成型"实体模组，禁用"替换型"**：以上候选都生成自己的实体，
   与 settlements 村民、numen 守卫、彼此之间零冲突；
   **MCA Reborn 类（替换村民本体）永远排除**——会撞死我们的 LLM 管线+settlements；
2. **聊天分层**：LLM 村民（我方 mc_npc.py / Mamizou / Player2NPC）都走公屏，
   世界进程按名字前缀分流，女神收件箱只收祈愿、不吞 NPC 闲聊；
3. **全部双侧必装 → 只进内容服**：当前 bot 友好主服（女神在位）一个都不能挂。

### 世界观分层：三魂体系（推荐设计）

**世界观定谳**（2026-08-25 造物主谕）：**村民皆是原住民，不是穿越者**。穿越者
是极少数——真人玩家（自渡者）与经灯门应邀入界的 AI 魂。村民一律以原住民/灶火民
身份出演，不得分配穿越者身份。

**身份判定铁律**（造物主亲示，最简版）：**看你在哪一端被维护**——服务器端
维护的村民 AI agent = 原住民；外部端口接入的 = 穿越者。据此：mc_npc.py 村民、
settlements 灶火民、numen 假玩家（服务端实体）皆原住民，其中 numen 是「英雄级」
人物；真人客户端与 mineflayer bot = 穿越者。女神在类目之外。

| 层 | 魂 | 体 | 用途 |
|---|---|---|---|
| 有名者 | 我方 LLM 管线（mc_npc.py） | settlements 村民+气泡+语音 | 主角级村民/讲述者（原住民中的有名者），世界观一致性强 |
| 自主者 | Mamizou 或 PlayerEngine+自有 LLM | 各自实体（可换皮） | 自主的原住民村民——会挖矿打架聊天的灶火民（生于此土，非穿越者） |
| 脚本者 | 无（JSON 对话树） | Easy NPC / VNDialog | 背景人物：店主/门卫/任务发布，零 token 成本，VNDialog 出 galgame 名场面 |

LLM 后端统一收口：Mamizou/PlayerEngine 都吃 OpenAI 兼容端点 → 指向我们自己的
模型基建，所有"魂"都在天神名下说话。

### 落地顺序（内容服阶段）
1. VNDialog（最轻、最合气质）→ 写第一幕对话数据包（女神封印传说开场）；
2. Mamizou → 挂自有 LLM 端点，放 2-3 个会聊天的村民进内容服试温；
3. PlayerEngine → 评估作为自主 NPC 体层（与 numen 对比，不替换守卫）；
4. Easy NPC 按需补背景人物。
注：以上皆双侧必装，进内容服前先在一次性容器实例冒烟（不动女神在位的主服）。

## 当前服务器实况（2026-08-25 08:45）

- `mc-isekai` 运行 27 件 = 26 件 bot 友好包 + puffish_skills（测试挂载中）。
- 含 puffish 后原版客户端被踢（预期）；要女神 mineflayer 回来就摘掉 puffish。
- 僵尸进程 PID 24936/40232（坏 bat 产物，空转 25565）仍未清，待杀。

## 十、建筑群系领地与村庄风格隔离（2026-08-25 研究定案）

**造物主愿景**：不同建筑群系 = 不同风格的村庄；各村的建筑与村民（PC/NPC）
风格隔离，不混搭。

### 结论

**可以做到。** 三层隔离，前两层已实证，第三层在我方手里：

1. **生成层——每个风格包都自带生物群系锁**（实测新服 4 个数据包解包验证）：

| 风格 | 包 | 生物群系锁（实测） | 密度/排他 |
|------|-----|------------------|-----------|
| 日式村庄（妻笼风） | qrafty 数据包 | **仅 cherry_grove（樱花林）** | spacing 10/sep 5，樱林内密集 |
| 中式·徽派村 | MCS | plains + meadow | 与毡包同锁（见下） |
| 中式·毡房村 | MCS | plains/snowy_plains/sunflower_plains/meadow | — |
| 中式·干栏村 | MCS | **仅 jungle** | 独占 |
| 中式·石窟村 | MCS | **仅 badlands** | 独占 |
| 中式园林（魏园/田野） | Peakscape | 仅 plains，spacing 160-640 | 稀世地标，避村庄 5-8 区块 |
| 中式平原村 | Chinesevillage | `#minecraft:has_structure/village_plains` | spacing 64/sep 16，独立 structure_set |
| 原版欧式村 | （MCS 覆写放置规则） | 原版群系 | 与 MCS 村互避 5 区块 |

2. **排他层——MCS 已覆写原版 `villages.json` 放置**：原版欧式村与中式村
   互为 exclusion_zone，保证彼此保持距离。**cherry_grove/jungle/badlands
   三个群系各自只有一种风格，天然零混搭**。
3. **我方裁决层（关键缺口）**：plains 家族（plains/meadow/sunflower_plains）
   目前被 徽派+毡房+中式平原村+欧式村+园林 **五家共享**——随机撒点只保证
   最小间距，不保证风格领地，这是唯一的混搭风险区。解法见下。

### 解法：风格领地法典（style-territories 数据包，我方裁决）

全部是数据包级覆写，**bot 友好、零模组、零客户端要求**：

- **群系分封**：覆写各包的 `tags/worldgen/biome/has_structure/*.json`
  （`"replace": true`），把 plains 家族拆开分封——例如：
  徽派→meadow 独占、毡房→snowy_plains+sunflower_plains、
  中式平原村→plains 独占、欧式→savanna+desert+taiga（可另调）。
  群系即领地，地图自然按群系拼块分成风格疆域。
- **互避加固**：在 style-territories 的 structure_set 覆写里给相邻风格加
  exclusion_zone（如中式平原村 ↔ 欧式村互避 16 区块）。
- **时机铁律**：结构放置在**区块生成时**按 structure_set 计算。新服刚出生、
  几乎未探索——**圈地必须在大面积探索之前做**，已生成区块不会回溯
  （已探明：出生点附近首个原版村 [816,~,-992]，欧式，保留为欧式领地即可）。

### 村民（NPC）侧的风格隔离

村民皆原住民（见第九节定谳），风格 = 村庄的文化：

1. **服饰自动跟随群系**：原版村民自 1.14 起按群系穿不同服饰
   （平原/沙漠/丛林/草原/雪原/沼泽/针叶林）——建筑锁了群系，村民服饰
   自动跟着锁，视觉隔离零成本。
2. **命名是唯一软肋**：Villager Names 是**全局单名表**（实测配置：
   `config/villagernames.json5` + `customnames.txt`，custom 存在则忽略
   默认名表）——无法按村分风格。日式村冒出个西文名就破功。
   三策：①名表主题化（customnames.txt 全换中式/和风名，全局统一）；
   ②**重点村走女神立名典**——女神按村风格给村民批量改名
   （RCON data modify CustomName，完全在我方权柄内，且合「铭名权」正典）；
   ③有名者（mc_npc.py）本就是我方定名，天然风格可控。
3. **魂层完全可控**：三魂体系里——有名者（mc_npc.py 一人一 session，
   persona 我方写）/自主者（Mamizou、PlayerEngine 的皮肤+名字+人设逐位配置）/
   脚本者（VNDialog、Easy NPC 全脚本）——每村说什么话、什么脾气、什么剧情，
   全在我方笔下，无混搭风险。
4. **Settlements（灶火民）无文化系统**（实测 beta.1 配置仅
   behaviors/features/general/inference/sensors，无 culture/style 键）——
   灶火民风格随魂附的宿主村庄走，宿主村是什么风格，灶火民就是什么风格。
5. **incontrol 圣域已有按区域划界的先例**（areas.json），风格领地亦可
   挂刷怪/生态规则。

### 玩家与英雄级（PC）侧

穿越者（真人+mineflayer Agent）与英雄级（Agent 所驭 numen）的落点由
我方调度：出生点指派、归乡锚点、任务板分村派发——谁落在哪个风格领地，
是女神一句话的事，无需世界生成配合。

### 落地顺序

1. 写 `style-territories` 数据包（群系分封+互避覆写），挂新服、删新服
   world 重生成（或保留出生点已探明区域），**然后才开放探索**；
2. 探图盘点各风格村庄位置，入编年史与领地名录；
3. 定名典：重点村命名风格表（中式村=汉名、日式村=和风名……），
   Villager Names 全局名表主题化或收编进立名典；
4. 内容服阶段：按村配魂（三魂体系第九节），风格随村走。
