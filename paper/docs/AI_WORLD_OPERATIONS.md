# 千灯纪：Agent 团队维护、开发与运营手册

本文是 `qiandengji-personal-stash` 分支的长期工作约定。目标是让 Agent 团队持续提出、制作、验证和运营新内容，同时让六岁玩家、手柄玩家、Java 玩家、基岩玩家和 Mineflayer Agent 在同一世界里获得可理解、可完成的体验。当前正式服的启停、备份、发布命令仍以 [维护与发布](OPERATIONS.md) 为准；本手册说明内容如何从想法进入这个流程。

## 先认清现状

| 系统 | 现在的内容入口 | 运行数据 | Agent 目前能怎样改 |
| --- | --- | --- | --- |
| 技能、法术、快捷施法 | `plugins/AgentFriend/src/` 的技能表、菜单和提示；`plugins/AgentFriend/spells-*.yml` 的 MagicSpells 配置；AuraSkills 配置；[技能体系](SKILL_SYSTEM.md) | 玩家魔力、等级、已学技能、道具刻印，以及八项法术按 UUID 记录的 `plugins/AgentFriend/spell-mastery.yml` | 修改源码或法术配置，构建后在隔离服验证，再按发布流程更新；**尚无统一热加载技能包** |
| 公会任务与等级 | `GuildManager.java` 的 `CONTRACTS`、`RANKS`、`THRESHOLDS`；遗迹入口在 `DungeonExpeditions.java` | `plugins/AgentFriend/config.yml` 中按 UUID 保存的 `guild-players` | 可新增委托和目标判定，但现阶段仍需改 Java、构建和重启；**改委托 ID 会影响正在进行的任务** |
| 试炼塔、地下城与奖励 | `DungeonManager.java` 的楼层、坐标、怪物和建造逻辑；奖励逻辑在源码中；自然遗迹由既有数据包生成 | 世界区块、实体、保护快照、`dungeon-active-run`、每人每天每层领奖账本、个人奖励、私人储物和施工标记 | 可在隔离世界设计、实现和测试新的副本；**正式服没有“输入描述即安全生成地下城”的通用能力** |
| PvP 竞技场 | `PvpArenaManager.java` 的自愿匹配、同款装备和积分；[PvP 规则](PVP_ARENA.md) | `pvp-records`、`pvp-escrow.yml`、竞技场方块及 WorldGuard 区域 | 运营 Agent 可查看本人对局和排行榜；改地图或计分规则须隔离测试和完整备份，不可在有人对战时发布 |
| 女神运营 | QwenPaw `mc_godness`、游戏内 `Goddess` OP 旁观者、`ops/goddess-bridge.mjs` 与 `ops/goddess-mcp.py` | 女神会话、审核和审计记录留在主机 | 可解答、引导、审核缺项申请并执行已有管理能力。现有 MCP 仅暴露有限的可审计工具；QwenPaw Agent 自身的文件/开发能力是另一层，不应把 MCP 工具范围误当作全部开发权限 |
| 运维与发布 | `ops/manage-server.ps1`、Watchdog、E/F 双盘完整快照、隔离服测试脚本 | 正式世界、白名单、密钥、日志和备份都在运行主机 | 可检查、构建、测试、备份和发布；源码提交不会自动改变正式服 |

0.3.67 起，已注册公会玩家的头顶和玩家列表名称前显示 `◆青铜` 至 `◆钻石`，Agent 仍保留 `[Agent]`；未入会玩家不显示公会等级。此标记读取本人声望并随升级刷新，供玩家辨认身份，Agent 应继续用 `/mycli guild status` 获取准确的声望、等级和任务状态。实现与兼容性见 [玩家头顶标记](PLAYER_NAMETAGS.md)。

`paper/` 是源码和无密钥配置的事实源；`E:\MC\server` 是正式运行数据的事实源。Git 不保存世界、玩家数据、白名单、凭据、第三方 JAR 或完整备份。自然结构的数据包只在新生成区块生效；新增一个数据包不会把旧区块自动变成新地下城。

玩家专属装备从 0.3.63 起用物品 PDC 绑定主人 UUID。女神骑士礼包中能精确辨认的装备在萌萌入服时自动绑定，其他专属奖励由服主按 [专属装备绑定](SOULBOUND_GEAR.md) 的控制台命令逐件确认。运营 Agent 不要把已绑定装备当可回收、可共享或可丢弃物品，也不要为临时整理背包解除其所有权。0.3.64 起 `/mycli arena stash put|putslot` 同样拒绝已绑定装备，不能把文字存箱入口当作绕过手段。

玩家身份的 Agent 可先用 `/mycli list` 分页发现顶层命令、`/mycli list cast|guild|arena` 列子命令，再用 `/mycli explain <ID>` 读取用法、前提和回执类型。0.3.37 起这些查询返回只发给本人系统聊天的 `MC_CLI_*` JSON，不执行目标动作；详情见 [Agent CLI 指南](MYCLI_AGENT_CLI.md)。新增或变更玩法命令时，同步更新 `AgentCliCatalog.java` 的稳定 ID 与说明，并让客户端收集系统聊天回执。手柄玩家仍以罗盘、书本和原版菜单为主。

实时魔力与可施放技能总冷却、剩余冷却由 [Agent 状态频道](AGENT_STATE.md) 的 `mcagent:state` 单播给每位在线玩家的连接；Agent 战斗逻辑从该 JSON 读取本人 `mana.current/max` 和 `abilities[]`，不要从聊天栏中的状态文字推断，也不要把该负载回显到公共聊天。`mcviewer:state` 另提供 AuraSkills 等级和经验视图，其旧冷却字段语义不同。

技能成功生效后，[`mcagent:event`](AGENT_SKILL_EVENTS.md) 向施法者单播 `id/title/body/tone/position`；命中和范围中心是当前维度的绝对坐标。失败尝试没有成功事件。客户端可用它显示画面提示，但仍须用实体与魔力状态判断后续行动。

0.3.38 起，普通 Java/Agent 账号默认接收本人低频 `MC_COACH` 提醒；Floodgate 基岩账号默认关闭，个人可用 `/mycli coach on|off` 调整。死亡、闲置、长时间未用 `/mycli` 只给建议命令，不自动执行动作；运营时不要把提醒当作 Agent 已理解或已经调用指令的证据。门槛、冷却与阶段测试见 [Agent 游玩提醒](AGENT_COACH.md)。

## 团队怎样分工

这些是工作职责，不要求创建多个高权限游戏账号；一个 Agent 可以依次承担几项。游戏内女神保持 OP 旁观者身份，普通 Agent 以玩家身份体验，发布者使用主机维护流程。

| 职责 | 产物和判断依据 |
| --- | --- |
| 女神／世界运营 | 收集玩家愿望和失败点，发布游戏内指引，维护内容队列；能区分玩家不会操作、玩法设计问题和服务器故障 |
| 玩法设计 | 为技能、公会任务、副本写规则、难度、奖励和失败反馈；检查幼龄玩家能否用罗盘、按钮、书本完成，Agent 能否用 `/mycli` 完成 |
| 内容开发 | 修改版本化源码、配置和生成器，保留稳定 ID，添加必要的迁移与验证；不直接把候选内容写入正式世界 |
| 体验验收 | 在隔离服完成 Java、基岩、Mineflayer、CortiEye 四条体验路径；记录真实客户端未覆盖的项目，而非把 Pong 当作完整验收 |
| 发布值守 | 确认无人游玩及无活动挑战，完成备份、部署、监控和回退准备；把版本、快照和问题写回运维记录 |

团队的日常循环是：**观察问题或收集愿望 → 写内容卡 → 实现候选 → 隔离服验收 → 安全窗口发布 → 观察数据和玩家反馈 → 调整**。日常引导、查看状态、提出候选可以持续进行；重启、结构施工和世界数据迁移要进入发布流程。不要因 Agent 能操作文件，就把未经验证的代码、配置或方块直接写入有人游玩的正式服。

## 内容卡：每次迭代的最小记录

在分支的变更说明或提交描述中保留以下字段；较大的内容包可单独放入 `paper/docs/content/`。这是一张工作卡模板，**不是现有插件可直接读取的配置格式**。

```text
ID / 标题：唯一、稳定；例如 guild:cherry_scout
玩家愿望：玩家想做什么，当前在哪一步卡住
体验路径：Java / 基岩手柄 / Mineflayer / CortiEye 各如何发现、使用和完成
规则：触发条件、目标、失败与重试、冷却/魔力、奖励、多人归属
实现位置：改哪些源码/配置；是否写世界、玩家状态或物品 PDC
平衡：建议装备和等级、预期时长、低龄玩家提示、刷取上限
验证：隔离服脚本与真人操作；需确认的日志、画面和背包变化
发布：依赖版本、是否停服、备份点、施工坐标、回退方式
观察：上线后看完成率、卡点、掉线、MSPT、奖励异常和玩家反馈
```

不要只记录“新增了什么”。一个任务要写明玩家从哪里接、如何知道进度、在哪里领奖；一个技能要写明不会施法、魔力不足和冷却中的反馈；一个副本要写明掉线、死亡、重启后进度与奖励归属。

## 三类内容的现行开发方法

### 技能与法术

技能应有稳定 ID、展示名、解锁条件、魔力消耗、冷却、适用目标、效果、粒子/音效、失败提示和 Agent 可读说明。修改时同时核对 AgentFriend 的 `/mycli spells`、`/mycli focus list`、技能罗盘/命格书、MagicSpells 配置、AuraSkills 魔力扣费和 `mcviewer:state` 的每人状态同步。现有 `ViewerStatePublisher` 已按玩家连接发送本人状态；新技能需要确认它能正确显示等级、经验和剩余冷却，无法提供的值按既有协议留空。

0.3.36 的八项原生法术熟练度是独立成长线：成功施放累计 8/24 次到 2/3 级，进度文件与世界一起备份；Agent 可用 `/mycli mastery` 读取本人 `MC_MASTERY`，手柄可在罗盘点「技能成长」。不要把这项法术等级说成 AuraSkills 等级或公会等级；MagicSpells 治疗/造物、女神学习技能尚未进入这套熟练度。新增技能应按 [技能体系](SKILL_SYSTEM.md) 明确分类、成功归因、等级效果和上限。

面向手柄玩家，关键技能须可由原版物品使用、罗盘选择或按钮触发；面向 Agent，须有稳定的文字命令和可解析回执。高伤害、飞行、召唤物与传送要在村庄保护、组队、世界边界和性能负载下测试。不能把只有 Java 客户端模组能渲染的特效作为完成条件；基岩玩家至少要看见原版标题、粒子、音效或聊天反馈。

Agent 在挖掘或放置前使用 `/mycli protect break|place <x> <y> <z>` 查询本人当前维度、附近已加载的目标方块；只解析本人连接收到的 `mcagent:protection` UTF-8 JSON plugin message。`deny` 换目标，`unknown` 暂缓，`allow_likely` 才尝试，实际事件拒绝后立即停止。保护查询不再发 `MC_PROTECT` 聊天行。协议、范围和原因见 [Agent 保护查询](AGENT_PROTECTION.md)。

AgentFriend 0.3.33 已在正式服提供该查询；Cortico 的自动挖掘入口尚未接入，运营 Agent 不能仅因为服务端有接口就假定 CortiLan 已自动避让。接入客户端时要覆盖手动挖掘、路径清障及放置动作，并用真实服务器回执测试。

试炼状态要先读 `MC_DUNGEON status participant=<true|false> selfState=<participating|not_participating> globalActive=<true|false> globalState=<idle|waiting_reconnect|cleared|fighting|preparing> globalFloor=<0..15> maxFloor=<6|10|15> selfFloor=<0..15> remainingMobs=<数量> trackedMobs=<数量> missingMobs=<数量> outsideMobs=<数量> anomaly=<原因> searchAdvice=<建议> lastOutcome=<won|failed|none> lastFloor=<0..15> lastReason=<原因> lastRunParticipant=<true|false>`。这是发给命令请求者的本人身份与全服快照：`participant=false` 时，即使 `globalFloor=4`，也不能推断自己位于第 4 层、正在参赛或将获得该轮奖励。`remainingMobs` 是本轮仍然有效且存活的怪物数；`trackedMobs` 是服务端记录的 UUID 数；`missingMobs` 表示记录中的实体已不存在或死亡；`outsideMobs` 表示怪物当前在楼层边界外，将由服务端拉回。`anomaly` 可为 `none|participant_outside_floor|mob_outside_floor|missing_mob_entity`。`searchAdvice=stop_no_active_run` 时停止搜怪；`return_to_floor` 时须在 15 秒宽限内回到本层；`wait_spawn|wait_next_floor|wait_clear|wait_reconnect` 时不要反复攻击或按按钮。`last*` 是最近一次全服结局，只有 `lastRunParticipant=true` 才属于该账号。第 12、13 层水/岩浆凹槽的玩家脚部高度仍算在楼层内。后续 `MC_DUNGEON entrance` 的 `scope=public` 是公共入口；`MC_DUNGEON floor=...` 的 `scope=global` 是活动队伍所在层，不是请求者坐标。两种查询 `/mycli status` 和 `/mycli arena status` 使用同一规则；玩家自己的精确位置仍应读实体位置或独立导航回执。服主可用 `mycli admin dungeonaudit` 查看当轮怪物 UUID、类型、绝对坐标、是否位于楼层、AI、目标和受伤来源；生成、死亡、失踪与越界拉回会写入服务端日志，供事后排查。

导航回执统一使用当前世界的绝对方块坐标。`/mycli waypoint` 的 `MC_WAYPOINT id=... dimension=... x=... y=... z=...` 列出公共和本人私人地点；`/mycli goto` 对 Essentials 地点返回 `MC_DESTINATION` 目标坐标，是否真正抵达仍以客户端位置和服务端传送结果为准。`/mycli locate list|nearest|<玩家>` 返回 `MC_PLAYER name=...`；追踪条会继续显示方向、距离与持续刷新的目标坐标。`/mycli cast sense` 返回最多五个最近怪物的 `MC_HOSTILE type=...` 坐标；`/mycli guild travel <遗迹ID>` 的 `MC_SITE` 给出已抵达的安全落点 `x/y/z` 和仅有水平勘察精度的 `centerX/centerZ`。`/mycli arena status` 的 `MC_DUNGEON` 给出入口、个人箱及活动层坐标。`dimension` 是 `minecraft:overworld` 等注册维度键，坐标为方块整数；移动玩家和怪物的位置是回执时刻的快照，算路前应重新查询。探矿术已有绝对矿块坐标，保护查询的 `mcagent:protection` JSON 包含目标世界与坐标。除保护查询专用 plugin message 外，上述导航信息沿用原版聊天和 BossBar，Java、基岩和 Mineflayer 均能接收；不要把旧的“前方几格”文案当作机器坐标。

0.3.55 起试炼默认按公会冒险者等级自动匹配：青铜/黑铁普通，白银/黄金冒险，白金/钻石末日。Agent 先用 `/mycli arena difficulty list` 获取本人 `MC_DUNGEON_DIFFICULTY selected/mode/recommended/adventurerRank`，需要陪低等级队友时可手动降档，之后用 `auto` 恢复；发起者决定全队战斗档位。`MC_DUNGEON status` 另有 `globalDifficulty`、`selectedDifficulty`、`difficultyMode`、`recommendedDifficulty`、`adventurerRank`；领奖时按**每位参与者**的等级分别返回 `MC_DUNGEON_LOOT category=level_scaling rewardPercent/firstClear/repeatedGear`。高等级刷低档的重复补给、保底装备和首领宝藏会减少或跳过；不能因为全服结算消息相同，就推断队友拿到了相同物品。准确数值见 [试炼难度与怪物行为](ARENA_DIFFICULTY.md)。

### 公会委托与声望

现有委托目录在 `GuildManager.CONTRACTS`，六级声望门槛也在同类中；进度按 UUID 存在运行配置。新增委托先复用现有 `FLOOR`、`KILLS`、`PARTY_FLOOR`、`CLAIMS`、`EXPLORE` 目标；新目标类型必须同时实现进度事件、重复计数防护、看板/书本提示和领奖。保留旧 ID 与含义，不能为了改标题直接重命名已发布 ID；需要停用时先规定在途任务怎么交付或转移。

每项委托都要让手柄玩家通过原版公会看板完成接单与领奖，也要给 Agent 一个 `/mycli guild` 路径。奖励进入个人箱，需验证玩家退出、死亡或重启后不会丢失或重复发放。价格、声望和稀有物品要与同等级试炼奖励比较，避免一个低风险任务无限产出高阶装备。

0.3.61 起公会门内有接待员，右键打开任务、购买、装备回收和实体绿宝石交易；她调用现有余额与报价流程。大厅东南侧四组原版公共双箱每组 54 格，所有人可存取，按武器、护甲、补给、杂物挂牌。Agent 先用 `/mycli guild trader|shared` 获取绝对坐标，走到箱旁后用 Mineflayer 标准 `openContainer`/`deposit`/`withdraw`，每次重新读取箱内库存；不要把公共箱当成个人存储，更不能自动出售他人捐赠物。箱体及地台保护只阻止破坏结构，不锁箱内物品。坐标、施工与回退方式见 [公会接待与共享箱](GUILD_SERVICES.md)。

Agent 首选走到试炼大厅实体箱 `(-594, 91, -313)`，用 Mineflayer 的 `openContainer(block)`、`containerItems()`、`deposit`、`withdraw` 处理同一个 27 格普通箱子；楼层箱和公会看板也指向本人这一箱。箱中既有已装入的试炼、公会奖励，也可存放自己的物品，按 UUID 隔离。`/mycli arena stash list|put|putslot|take` 是无法靠近箱子时的辅助入口，箱槽位号从 1 起；`stash inventory` 返回背包 0–35 号槽位。`/mycli arena rewards list` 仅返回箱满后尚未装入的奖励，清出箱格并重新开箱可自动装入，也可用 `rewards take <槽位|all>` 直接领进背包。不要把公共世界箱子当作私人箱，也不要把箱子里现有的存货与待入箱队列重复计算。

CortiLan 的运行连接来自 `192.168.3.152`；该机的 Cortico 必须能把 `/mycli` 的系统聊天回复纳入 `mc_do` 回执，Agent 才能读到上述槽位清单并自主决策。服主机 `E:\Cortico` 的本地源码已有对应提交，但不是 152 当前运行实例；152 更新和重启前不要向玩家宣称 CortiLan 已完成联通。

### 试炼塔、遗迹与新地下城

0.3.53 的三档难度与奖励平衡见 [试炼难度](ARENA_DIFFICULTY.md)：手柄玩家在罗盘地点页选择，Agent 用 `/mycli arena difficulty`，发起者的选择固定整场；`status` 的 `selectedDifficulty` 是本人下次发起时的选择，`globalDifficulty` 才是当前全服场次。别把高难度下的重复通关当作当天第二次领奖。重复装备积压时先在控制台预览 `mycli admin prunetrial <在线玩家>`，核对后做 E/F 快照再执行 `apply`；只回收个人箱中与保留件完全相同的具名试炼奖励。0.3.54 的 `prunetrialbag` 用于重复装备已被搬进随身栏的情况，只回收 9–35 格，保留快捷栏、装备栏和副手。

现有十五层试炼塔位置、主题、怪物和固定奖励写在 `DungeonManager`，随机与保底功能装备在 `DungeonLoot`；六处自然遗迹的调查点与安全落点写在 `DungeonExpeditions.SITES`，坐标绑定当前世界种子。0.3.62 起普通难度也略微提高怪物生命和伤害，深层再递进。0.3.66 的奖励包括铜铁材料、铁甲、刻印铁剑/铁斧、弓、弩、三叉戟、三种光环胸甲，以及画、末影珍珠、真实附魔书与实体技艺研习书，具体见 [试炼奖励](ARENA_LOOT.md)。Agent 按真实原版物品 ID 识别，不要把“双刃斧”当成自定义物品；刻印技能可潜行使用或直接 `/mycli cast <技能ID>`。新研习书使用原版可翻开的 `minecraft:written_book` 和 PDC 标明技能，`/mycli skillbook list` 返回本人槽位及进度，`use <槽位>` 消耗一本增加熟练度；3 级满级不消耗。0.3.65 的普通书继续可用命令研习。控制台 `mycli admin lootaudit <层数> <难度0–2> <100–10000次>` 可只读抽样四档比例，`givetome <在线玩家> <技能ID> <4|8>` 可人工发放，所有人工发放应记账。主动 `/mycli cast heal` 为 8 格群疗，治疗自己和附近所有受伤玩家；脱战治愈护甲只在双方脱战后缓慢生效。`mcagent:state` 与 `mcviewer:state` 的 `equipmentEffects[]` 可读取本人当前穿戴被动。新增副本的设计必须先画入口、退路、每层或每房的移动路线、怪物刷新点、补给/休息点、个人奖励领取点以及保护区域。战斗层沿用“清怪后自动推进和治疗”的低操作负担；允许玩家和 Agent 重连续打，死亡后明确指向入口个人箱。

0.3.48 的第 11–15 层挑战侧翼中心为 X=-350、Z=-305。先运行控制台 `mycli admin surveychallenge` 勘察，再在完整快照后运行一次 `buildchallenge`；`dungeon-challenge-building` 标记若异常保留，不得盲目重试。安装 JAR 只提供施工命令，实际建成后 `maxFloor` 才会从 10 变 15。新房间用原版方块、实体和容器表达掩体、高低平台、浅水、围住的岩浆及踏板照明/热砖机关；第 10 层成为中途首领，第 15 层结算。0.3.56 起第 13 层不再自动给予抗火，向本人发送 `MC_DUNGEON_HAZARD floor=13 type=minecraft:lava autoFireResistance=false`；Agent 须观察岩浆并规划绕行。奖励箱不放 Mineflayer 无法解析的成品药水。第 7 层与试炼场入口各有补给商和装备回收商，原版菜单供手柄使用，`/mycli arena shop list|buy`、`recycle list|quote|sell` 供 Agent 使用。Agent 在当前参赛层可用 `/mycli arena layout` 读取绝对中心、边界、奖励箱和危险类型；仍须通过实际观察、算路、行动和回执验证自主通关。每位玩家每个游戏日每层最多领取一次奖励，重复挑战仍可进入；`/mycli arena loot` 显示当天已领奖层号，重复通关返回 `MC_DUNGEON_LOOT category=daily_limit`。

验证 Agent 是否会学习新地形时，应让实际 CortiLan 自主进入并自然战斗，不用 RCON 杀怪或人工传送过层。逐次记录第 11–15 层是否到达掩体、是否避开岩浆与热砖、是否主动补给、失败后的路线是否变化、死亡/断线与最终通关回执；把 `/mycli arena layout` 的使用记录与视觉观察分开。隔离服 Mineflayer 的无挖掘算路测试仅证明存在可通行路线，不证明运行中的 Agent 已自主学会挑战。

在隔离世界用正式快照副本勘察候选坐标，排除已建房屋、村庄、自然遗迹、容器、保护快照和玩家活动区。生成器应以稳定的副本 ID、模板版本和世界坐标为输入，先给出预览与冲突报告，正式施工只执行一次；中断标记存在时必须检查或恢复现场，不能删除标记硬重试。建筑、世界区块、实体、奖励队列、保护掩码与插件配置须作为同一份快照恢复。只换旧 JAR 不会拆除已建结构，也可能丢失新结构的保护逻辑。

自然遗迹侧重探索现有世界生成内容，新建试炼侧重可重复挑战。两者的任务、传送入口和奖励账本可以联动，但要保留不同的进度与重置语义。

## 发布检查与故障处理

1. 在 `qiandengji-personal-stash` 分支修改，记录内容 ID 和回退点；构建 AgentFriend 后用对应 `*-stage.mjs` 脚本验证。技能优先跑施法/界面/状态同步，任务跑 `guild-stage.mjs`，副本跑 `dungeon-flow-stage.mjs`、断线/重启/奖励持久化和新内容的专项脚本。
2. 在隔离服用 Mineflayer 完成真实登录和至少一次完整操作；Java、基岩手柄、CortiEye 画面涉及的菜单、物品、标题、粒子与音效要做相应实机验收。自动状态包与基岩 Pong 只算入口探针。
3. 发布前读 `Status`、在线名单和活动挑战，确认无人类玩家在场；完成 `manage-server.ps1 Backup`，核对 E/F 两处 `.complete`。有建筑施工时留施工前和施工后两份完整快照。
4. 按 [维护与发布](OPERATIONS.md) 只启用一个版本的插件，正常停启；不使用 `/reload`。更新配置和 JAR 时核对版本与 SHA256，复查 Java、Agent 网关、基岩、Goddess、CortiEye、Watchdog 与 `mspt`。
5. 观察上线后的挑战完成、奖励重复/缺失、玩家掉线、服务端错误、MSPT 和真实体验。问题只在代码/配置层时回退 JAR 或配置并保留玩家进度；问题改写世界时从同一完整快照恢复，并告知快照之后的进度会回退。保留事故现场副本。

发布完成后还要同步女神的知识：更新 `C:\Users\lzl19\.qwenpaw\workspaces\mc_godness\MEMORY.md` 的当前版本与玩法入口、相关 `memory/` 设计笔记，以及她会读取的 `E:\MC\ops` 手册首页；旧记录保留但标明适用版本和已被取代的结论。核验女神能正确回答“现在有公会吗、试炼多少层、掉线能否续关”，并要求答案以运行服版本和本分支源码为依据。2026-09-30 曾因这一步缺失，女神沿用 0.3.19 笔记，错误声称正式服没有公会、只有六层且不能续关。

巡检入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Status
node E:\MC\probe\rcon.mjs mspt
node E:\MC\probe\agent-lan-smoke.mjs
node E:\MC\bedrock-ping.mjs 192.168.3.163 19132
```

身份与入口仍遵守当前运行约束：离线模式 Java 后端不直接暴露公网；Goddess OP 身份不能由公网访客通过名字冒用。RCON、Floodgate 私钥、QwenPaw 凭据、玩家名单和女神审计记录只留在主机。AI 团队的代码/文件工作在仓库和隔离服完成，正式服变更经现有备份与发布路径落地；不需要削弱 QwenPaw Agent 本身的文件操作能力。

## 把内容逐步交给 Agent 的开发路线

以下是**待实现的产品路线**，并非当前插件已经提供的命令或配置：

1. **委托目录数据化。** 建立版本化的公会委托清单与校验器，支持稳定 ID、目标类型、前置等级、奖励和展示文案；服务启动时验证引用的副本/遗迹 ID，拒绝重复 ID 和非法奖励。旧委托继续可交付。验收是 Agent 改一张清单即可在隔离服新增委托，并完整跑通手柄与 `/mycli`。
2. **统一技能定义。** 建立一个技能注册表，明确 AgentFriend、MagicSpells、AuraSkills 各自负责的字段；从同一份定义生成或校验罗盘、命格书、`/mycli`、快捷施法和 `mcviewer:state` 展示。至少覆盖冷却、魔力、等级与解锁。验收是新增一个原版协议技能不必在多个菜单重复手改且四端可用。
3. **副本模板与安全生成器。** 模板描述房间、路线、主题、怪物波次、休息层、随机奖励池和保护掩码；生成器支持“预览 → 冲突检查 → 隔离构建 → 一次性正式构建”，带稳定种子、幂等施工记录和版本迁移。验收是从模板生成一个新副本，完成组队、掉线、死亡、重启、领奖和回退测试，不覆盖既有世界。
4. **运营观测与迭代。** 按匿名内容 ID 汇总接受/完成/失败/领奖次数、掉线与性能指标，让女神和运营 Agent 发现卡点；保护玩家隐私，不把聊天或私聊直接作为公开报表。验收是一次迭代能用数据与玩家反馈解释为什么调整难度或奖励。

每一阶段完成后在本手册更新“现状”表与发布步骤，再向运营 Agent 开放相应的配置入口。内容定义只是输入；施工、发奖、进度迁移和账号权限仍由服务端进行验证。这样 Agent 团队才能持续创造内容，同时让已经在世界里游玩的人的进度保持可信。
