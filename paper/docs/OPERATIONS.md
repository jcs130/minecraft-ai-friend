# Paper 分支维护与发布

## 2026-10-08 公共仓库、个人分页箱与玩家委托（0.3.94）

2026-10-08 18:21:11 已正式发布 AgentFriend **0.3.94**（800787字节，SHA256 `C53FA4AB275867001EC1274A362C376389E6A3E0D9F09DAE433EC6648A240455`），Java PID **33296**。E/F `20261008-182016/.complete` 在替换前完整，正常维护任务结果0。公会公共仓库十二组双箱、四类各162格、总648格；供货自动使用同类上层空位，全部不足或权限异常明确拒绝且不扣物，后续结算失败回退背包和全部受影响箱。动态库存合计全部同类箱。个人奖励箱10页540格、待入箱队列1024组；玩家可用已有绿宝石余额托管发布物资/同行讨伐/维度或大型遗迹走查委托，在线生效。原7位玩家135个旧占用槽位及完整元数据保留，34张市场模板/7场地、114旧技能资格、三维度49个WorldGuard区域语义保留。普通难度、三维度keepInventory=true和本次AuraSkills startup-verified通过。CortiLan/Goddess/ag_NEKO 已回连；原机 CortiEye 尚未回连，camera=offline/attached=false，观战巡检与配对仍正常，不能记为直播镜头已恢复。原Agent客户端程序和配置未改。

18:20:16 正常保存停服；E/F 完整标记分别于18:20:20/22完成，18:20:23替换唯一AgentFriend JAR，18:21:11 Ready。服主确认ag_NEKO是可随服务器重连的Agent后，维护脚本只新增精确账号例外并留E/F原件；其余真人和未登记连接门禁不变，没有新增Eye配对或推断可信来源。女神桥、LAN网关和Eye巡检由原任务恢复，原客户端未重启或改配置。

同一最终JAR专项21、正常重启7通过；正式仓库20项通过，另1项原机Eye就绪检查因客户端离线失败并保留；正式分页箱/委托25项通过。原私有公会主人萌萌与观景塔规则保留，上层16格箱体明确公共，12组箱可从地面开盖且非主人不能拆。原个人箱占用槽位以本次完整停服快照逐项比较，包含附魔和PDC组件；没有重建玩家箱或奖励。两个临时客户端白名单均移除。正式检查只查询、开菜单和空账号余额不足拒绝，没有代用户交货、花点或发布真实委托。

同类箱先用原底层，再用上层；满箱或任一登记实体/权限异常返回中文和`MC_GUILD_DELIVERY status=denied/itemsDebited=false`。跨箱收货和奖励失败在同一服务器线程中恢复背包及全部受影响箱。动态`shared_stock`合计普通同类物品，已接单冻结数量不改。后续扩容只须建好真实双箱、登记两半公共权限、更新`guild-shared-chests.yml`，依次`mycli admin land reload`、`mycli admin sharedstorage reload/audit`，无需代码或服务器重启。规则见 [公共仓库](GUILD_SHARED_STORAGE.md)。

个人奖励箱10页540格，原编号1–54保留；`arena stash pages`选页，`page 1–10`开页，`list [页]`查询，`take`用全局编号1–540，旧`put`可继续填后页。附近免费，远程取放/开页仍消耗2魔力并需传送资格。玩家委托用`commission menu`或`publish/list/mine/info/accept/claim/abandon/cancel`；原公会菜单第9格为入口，个人箱图标右键选页。报酬托管已有绿宝石余额，物资实际交到发布者待入箱队列；队列满拒绝交付不扣物。同行讨伐须发布者32格内、真实击杀/30秒助攻，探索须实走和返程。每单一人，与原公会在途槽位独立；接单后不能被发布者单方撤回。详见 [CLI](MYCLI_AGENT_CLI.md)。

公开 [发布清单](../manifests/guild-shared-storage-0.3.94.json) 区分同C53包21/7专项和正式20/25检查、离线Eye检查及旧D2包67/15/7上游历史。旧16普通连接+1Eye的64查询不是C53新负载验收，也不代表16个LLM长期自主游玩。基岩/Xbox画面和手柄需真机确认。跨文件世界/奖励写入不宣称任意断电原子性；玩家交付settling日志冲突须先备份核对实际背包，不能删账或重复发奖励。

在线维修前后区域快照与完整停服发布备份分开保存。80组物品逐次确认，较早全量快照的石砖52块在实际取放时为48块，同48块入上层；4块并发差额未补发，也未把全量快照标成相等。私有回执和失败原件在E/F `repairs/guild-storage-20261008`，上游在`repairs/player-contracts-20261008`。

回退先完整备份并结清/退款新玩家委托，处理settling日志，转移新增个人页物品或优先向前修复。保留公共上层实体箱、物资和领地公共例外；旧0.3.92/0.3.93只投底层并只统计原箱，需人工维持余量。不能单独回退余额、日志、队列或玩家库存，不用旧世界覆盖新进度，不用`/reload`。



## 0.3.93 历史候选：源功能已由0.3.94发布（此包未单独部署）

AgentFriend **0.3.93 候选**已构建（789681字节，SHA256 `D2E930F259DFF33600384B16948B190F1CF479C95F76A404122EB1E69D771095`），最终同包功能67、正常重启恢复15、16普通连接+1实际Eye查询7项通过。个人奖励箱10页540格，原54格ID不变，待入箱队列1024组；玩家自行托管既有绿宝石余额，发布物资收购、同行讨伐、维度/大型遗迹走查委托，实际扣物和交货、探索返程、防重复结算及重启恢复。每单一位接单者，与公会槽位独立，不改Agent客户端。该D2候选未单独发布；源码随后合并公共仓库修改，由上述0.3.94正式启用。67/15/7为D2包历史上游测试，不能标为C53包同包测试。隔离服已停止恢复，QA禁用。

用户可见入口和规则见 [CLI](MYCLI_AGENT_CLI.md)。公会第9格新增玩家委托，个人箱入口右键分页；原37张卡、生活入口与工程市场并行。报酬是已有绿宝石余额，不是背包物品；每单一个接单者、每人同时承接1单/发布5个未结束，全服200个未结束/4000条历史。接单后不能由发布者单方撤回。两种交付中间状态（未扣物、已扣物未结算）经隔离原生日志夹具和正常JVM重启后均只结算一次。大型遗迹复用既有自然结构走查，本轮没有重走完整府邸。

16普通连接加1实际Eye完成64次受控查询，旧schemaVersion1状态和私有委托镜像保留，区块总数1648前后不增。末5秒MSPT平均21.5ms，单次峰值498.6ms；隔离JVM为2GiB，不能把本次短测当作长期16LLM自主游玩或无卡顿的证明。配对夹具先因超过16条、自动Eye名超过16字符而被正确拒绝；修正登记后重跑，失败材料保留，未放宽生产权限。基岩/Xbox观感待真机。

此节保留0.3.93候选验证历史。实际正式发布、维护快照和库存保存复核以本页0.3.94记录为准；原真人在线、试炼与旧JAR哈希门禁保持。

数据使用config.yml的player-contracts.jobs/active、dungeon-emerald-wallet、dungeon-bonus-items和dungeon-personal-stash全局0–539。交付state=settling保留before/after/goods；冲突时先备份核对实际36格存储栏，勿删记录或单发奖励。16MiB写入限额和4000条历史达到时拒绝新单，不自动删账/到期。

回退先完整备份、暂停新发布并结清/退回在途委托，安全处理settling日志，保留最新config.yml与玩家数据。旧0.3.92只访问前54格，需先腾出转移55–540物品或修复向前发布；不能单独回退余额、交付日志、奖励队列或库存，不用旧世界盖新进度，不使用/reload。私有回执和原件：E/F repairs/player-contracts-20261008；公开 [候选清单](../manifests/player-contracts-0.3.93.json)。


## 2026-10-08 战法牧、技能点与洗点（0.3.92）

2026-10-08 16:09 已正式发布 AgentFriend **0.3.92**（759749 字节，SHA256 `10E42183647EA1B5A2C7F3E918AB15A43E1571CEEFBA8F087E8593FB051DD375`），Java PID **31092**。正常任务结果 0，E/F `20261008-160838/.complete` 在替换前完整。战士/法师/牧师共十六项技能，通用基础二十项；初始 6 点、上限 30，AuraSkills 有效累计成长每 5 级增 1 点。新学习和升级花点，洗点默认 10 魔力/300 秒，退回实际支出，保留旧资格、任务/事件解锁、传承归属及施法冷却。命格书和原版罗盘菜单显示余额、等级、费用与来源。114 个既有玩家 UUID 基础资格保留，桐人设为战士但未代购技能。正式市场 34 张/7 场地，原 29 张不变。四个原账号已回连，原机 CortiEye 实际附身；三维度普通/keepInventory=true 与 AuraSkills 本次 startup-verified 通过。规则、验证边界与回退见 [职业与传承](CHARACTER_SKILLS.md)、[维护流程](OPERATIONS.md)。

16:08:38 正常保存停服；E/F 完整标记分别于 16:08:42/44 完成，16:08:45 替换唯一启用 JAR 并启动 Java 31092，16:09:30 Ready。Goddess 桥 30380、Eye watcher 33884 及 LAN 网关由原维护流程恢复；原 Agent 客户端程序/配置未修改或重启。当前 AuraSkills 回执绑定 PID 31092，transformApplied/behaviorVerified 均成功。16:13 在线合并五张职业试炼并热加载，原 29 张完整定义及 7 场地语义逐项保留；在途快照照旧。以真实 UUID 给桐人选择 warrior，没有代替他学习/升级或分配额外点数。

技能点是 AgentFriend 的学习分配层，AuraSkills 仍是唯一魔力池。任务与 Raid 奖励提供学习资格，另需花点购买；施放还要当前方向、装备、准备、目标和魔力。三方向共享余额；离开职业不退款，洗点后可重新选方向和分配。洗点需要明确命令 `skills respec confirm` 或原版确认菜单，试炼/PvP 内拒绝，已施放冷却不会清除。既有基础资格由首次启动时冻结的 114 UUID 快照保留，新玩家重登不会得到旧资格。学习、升级、洗点的价格、初始/上限/成长及逐级效果可在 `skill-points.yml` 热配置，四份目录用 `mycli admin professions reload` 整体校验；无效规则保留上一有效目录。公会用 `mycli admin market reload`，不执行 `/reload`。

验证分两份包，不能表述为所有检查使用同一 JAR：早期 `2898183E30888A11674A2064A9360C6E810FFA7F46490DA544BEF49054958699` 的效果/菜单/回执 45、配置及恢复 7、重启 7 项通过；最终包 147 个 class 逐字节相同，仅 skill-points.yml 调整步法距离/巡望目标与持续时间，最终包重跑坏账本 3、正式 6/30 点数规则 27、点数重启 7、16Agent+1Eye 负载 4 项通过。点数专测包括实际逐级扣点、魔力、四友军治疗、一次减伤、1.5 秒怪物攻击护佑、实际洗点退款、任务资格/唯一归属/施法冷却保留和写失败不收费。前一通用效果夹具使用 200 点，仅供隔离遍历；正式规则为 6/30。

最终包 16 个受控技能连接（6 战士/5 法师/5 牧师）加 1 Eye，48 次付费施法及 48 次查询均完成；区块数前后相同，无新生成区块，最后 5 秒 MSPT 平均/最小/最大 10.1/4.9/21.1 ms，一分钟最大 34.7 ms。不代表 16 个 LLM 长期自主游玩。袭击以真实原生 Raid 对象/胜利事件和贡献适配验证，试炼目标用已有过层回调适配，不代表完整自主袭击波次或整塔通关；基岩手机/Xbox 画面及手柄仍待真机验收。

正式普通客户端 21 项查询/拒绝操作/菜单/命格书检查通过，未代购技能、接任务或取放物资；临时白名单已移除。最后 5 秒 MSPT 6.9/3.9/44.3 ms，一分钟最大 353.3 ms 含探针接入，不据此声称无尖峰。命格书首次以 RCON 整背包文本检查后页失败，随后改读真实客户端收到的完整原版 written_book_content 并通过，失败报告保留。隔离服已停止并恢复原 0.3.86、原配置/配对/保护，QA 辅助插件禁用；一次性测试场景留在隔离世界。公开清单 `manifests/character-skills-0.3.92.json`，私有新旧包、全部回执和运营原件在 E/F `repairs/profession-skills-20261008`。

回退前先正常备份并暂停五张新试炼，审计在途快照与 profession-pending。0.3.91 不解释新 goal，不能只换旧 JAR 或删职业账本；保留职业/点数/唯一归属账本、公会完成历史及 pending 同组备份，优先向前修复。不能恢复旧世界来覆盖本次上线之后的玩家进度。

## 2026-10-08 工程完工交接与公共地标（0.3.91）

2026-10-08 13:04 已正式发布 AgentFriend **0.3.91**（676162 字节，SHA256 `ECFFB3A910E77BB9A8AAC47ED048D8B7D8FE75EA2845413BE030A34AE99039F0`），Java PID **27360**，正常备份任务结果 0，E/F `20261008-130342/.complete` 在替换前完整。BUILD 委托可用 handover 配置交接给验收完成者，主人到场登记公共地标，传送每次 6 魔力，后续内容运营无需重启。原 29 张任务/7 场地条件保留，仅观景塔和岗亭补交接政策；CortiLan 的原完工观景塔已核实历史并交接，原奖励与证据不变，塔上礼物箱单独公共，其余储物私有。公会仍归萌萌。最终同一 JAR 隔离 41、重启/下界/16Agent+Eye 13、正式只读 25 项通过；16Agent+1Eye 是受控 64 次查询，5 秒平均 MSPT 6.2，不代表长期 LLM 自主施工。13:17 最终复核 CortiLan/ag_Kirito/Goddess/CortiEye 均在线，原机 CortiEye 已恢复 camera=online、attached=true；基岩/Xbox 真机画面待验收。规则、迁移和回退见 [工程与公共地标](PROJECT_LANDMARKS.md)、[维护流程](OPERATIONS.md)。

13:03:42 正常停服保存，E/F `.complete` 分别于 13:03:45 / 13:03:46 写入，13:03:46 才替换唯一启用 JAR。13:03:47 启动 Java 27360，13:04:32 Ready；女神桥 29904、Eye watcher 31112、LAN 网关 32088 恢复且单实例。AuraSkills 本次 PID 的 startup-verified / transformApplied / behaviorVerified 全部成功，三维度普通难度与 keepInventory=true、角色皮肤保留。CortiEye 在本次维护前曾回连，维护后 13:10 原客户端仍离线；13:17 最终实查原机已回连，camera=online、attached=true、cameraNightVision=true。

健康确认后在线修改 `task-market.yml`，仅给 `sky_view_tower` 和 `village_watch_post` 增加 handover；29 张模板的其他条件及 7 个登记场地定义逐项相同。`mycli admin market handover tm_sky_view_tower` 核实 CortiLan UUID 和原 run `5806c539-ec5e-4006-a5a1-64d1b0795161` 的 BUILD 完工证据，新增 `qd_land_sky_view_tower`；原 28 个主世界区域及下界/末地各一项字段不变。现存礼物箱 `(-558,85,-572)` 经实查单独登记公共，新增单格 `qd_public_container_sky_view_tower_0`，其他库存私有。普通正式客户端实际开箱且没有取放物品。萌萌公会的门内私产、门口四组公共箱继续原规则。

公共地标需当前主人亲自到安全落点起名，罗盘「公共地标与建筑 → 管理我的地标」或 `landmark publish <领地ID> <名字>`。正式只读验收时公共目录为 0，观景塔尚待 CortiLan 登记落点；不能把管理权交接成功说成已经开放传送。之后目录实时反映主人登记/撤回。成功传送 6 魔力，共用私人点的活动/边界/安全检查；转让、撤销及异步等待时重新检查，访客不因此获得建造权。

隔离使用真实普通 Java/Mineflayer 施工、原生 Eye 附身消息、箱子菜单与聊天命名。41 项验证含冻结交接政策、未完工无奖励、重复交接不重发、OP/伙伴无登记权、实际拆建拒绝、6 魔力及特效、原私人/分享点回归、礼物箱例外；13 项验证含真实写失败 pending 收据在正常重启恢复、在途工程续交、保留后续转让、下界实际建造与跨维度传送。16 个 Agent 连接加一个 Eye 的 64 次目录查询无新增/增长区块，最近 5 秒 MSPT 平均/最小/最大 6.2/4.1/10.8；完整 1 分钟最大 275.6 包含接入和切维度准备期，原始报告保留，不作长期自主游玩承诺。正式普通客户端 25 项只读通过。基岩/Xbox 画面需真机。

隔离首次发现 Bukkit 内存 Map 不能按 ConfigurationSection 读取，已改用 createSection，并以最终 SHA 重跑。消息先后顺序、手持罗盘误开自身菜单、运营脚本块尾匹配、首次只等中心区块的勘察假设失败均保留；正式文件在配置候选语义检查通过后才写入。隔离服已正常停止并恢复原 0.3.86、原配置/配对/区域，测试辅助插件禁用。私有证据在 E/F `repairs/project-landmarks-20261008`，公开清单 `manifests/project-landmarks-0.3.91.json`。

回退前正常备份，保留已生成领地、公开箱区域、landmarks.yml、完成/奖励收据与世界。若回退 0.3.90，先暂停新交接委托并核对在途快照与 pending 收据；旧版本不执行交接/地标命令，也不管理新增公共箱例外，须审计 `qd_public_container_*` 区域。不要仅回退完成标记或施工基准，不用旧世界覆盖之后玩家进度。详细运营见 [工程与地标](PROJECT_LANDMARKS.md)。


## 玩家领地（0.3.90，2026-10-08 12:27 正式生效）

AgentFriend **0.3.90**，644680 字节，SHA256 `3C78F0F66120EEA06A3CAA1BC1A31CC6178FA4266D1779252925BDCFF3D504F7`，Java PID **29972**。接入已安装的 WorldGuard 7.0.10，不新增第三方插件。正式 `lands.yml` 仅有冒险者公会，主人为萌萌 `.MicroKQ` 的真实 Floodgate UUID；X `-498..-480`、Y `64..76`、Z `-509..-495`。主人和受信任玩家可改建原大厅及管理私产；访客可以走入、接任务和使用公共工作站，门口四组公共双箱正常。新增不同玩家的地块、改主人、授权/撤权均可控制台 `mycli admin land reload/audit` 在线完成。完整规则、配置示例和权限边界见 [玩家领地](LANDS.md)。

最终同一 JAR 的隔离功能 **36 项**、热配置和 **16 个独立连接 10 项**、正常 JVM 重启 **7 项**、正式普通客户端 **26 项只读检查**通过。覆盖不同主人实际拆建、OP 拒绝、原建筑主人改建、实体/混合双箱、公共菜单与四组公共箱、除草捷径、跨界漏斗进出与内部搬运、在线转让/授权/撤权并关闭旧库存窗口、无效/重叠配置保留旧规则、跨维度热增减、命令发现、27 格菜单、原生 Eye 私有拒绝镜像和附身包。16 连接完成 80 次受控权限查询，未额外加载远方地块区块，5 秒 MSPT 平均/最小/最大 **4.0/2.8/8.9 ms**；不代表 16 个 LLM 长期自主游玩。基岩真机触控/手柄画面仍待实际客户端验收。

WorldGuard 的默认 `break-hoppers-on-denied-move=true` 会拆掉越权搬运的漏斗；本版在 LOWEST 阶段先取消跨界搬运，保留装置，原有 WorldGuard 全局配置保持。此行为依据 [WorldGuard 配置文档](https://worldguard.enginehub.org/en/latest/config/) 核实。早期夹具的外墙坐标、挖掘等待、换行正则、窗口标题和启动时序失败材料保留；没有为测试放宽保护。实际挖掘以服务器方块查询为准，不能把 Mineflayer 的本地挖掘预测当成越权成功。

既有 **Afu-MC-DailyBackup** 于 12:26:38 正常停服，E/F **`20261008-122638/.complete`** 分别于 12:26:42/44 完成，12:26:45 才替换 JAR；12:27:23 `Done`，任务结果 0，待发布与自动暂停标记已清除。维护脚本只增加服主明确确认的精确账号 `ag_Kirito`，真人/副本/哈希门禁保留，无 `ag_*` 通配。当前 AuraSkills `startup-verified` 的 PID、transform 和 behavior 全部通过，女神为旁观者且礼物目录 ready=true。Java/LAN/Geyser Pong 正常，三维度普通难度与 keepInventory=true 保留。28 张市场模板哈希不变；27 个主世界、下界/末地各 1 个原 WorldGuard 区域字段保持，仅原生保存时旗标顺序变化；桐人及 CortiLan 的皮肤绑定与备份一致。正式探针没有编辑地形或取放物资，已退出并移除临时白名单。

Goddess 桥 PID **13724**、Agent Eye Watcher PID **30316** 已恢复；交互令牌读取进程命令行可能显示 stopped，已以 PID 存活、启动日志和空错误日志核实，没有重复启动。原机 CortiLan/ag_Kirito 已回连；CortiEye 原客户端本次复核仍未登录，`camera=offline,attached=false`，不能把 watcher 或插件在线当成镜头恢复。本机没有原客户端的重连入口，待其原运行机重连后再读回 `cortieye`。

隔离服已正常关闭，恢复原五份配置/配对/区域文件、原 0.3.86 JAR，禁用测试 JAR；一次性测试地形留在隔离世界。私有新旧 JAR、原件、最终/失败回执、发布清单、知识更新和保护核对在 E/F `repairs/land-ownership-20261008`。回退前正常备份并保留最新 lands.yml、三维度 WorldGuard 区域、世界和玩家库存；旧 0.3.89 仅保留原生区域保护，缺少本版明确拒绝、无 OP 绕过和跨界物品补充检查，应限制相关操作并优先修复向前发布。不得 `/reload`。

## 命名传送点（0.3.89，2026-10-07 23:54 正式生效）

AgentFriend **0.3.89**，618701 字节，SHA256 `E087627A249F5E5DF5B54E22D1342E5E83D8DF59A51334DACD1906AE74EADD3D`，Java PID **5316**。罗盘支持多个中文地点、主人隔离、三个维度和可撤回分享；个人保存/分享不需要改代码或重启，成功传送仍消耗 6 魔力。地点按主人和世界 UUID 保存，默认 32 个；旧 home 继续可用，新点独立存于 waypoints.yml。规则、Agent 回执、备份与回退见 [命名传送点](NAMED_WAYPOINTS.md)。

最终同一 JAR 的隔离功能 **39 项**、冷区块与 16 账号 **10 项**、正常重启 **4 项**、正式普通客户端 **17 项只读检查**通过。包含中文/跨维度、同名隔离、6 魔力与成功特效、分享撤回/改名/删除、危险落点/魔力/旁观/WorldGuard 拒绝、私有聊天命名、真实附身 Eye、旧 home 和 UUID/分享码保存。已卸载但生成过的目的地区块可以异步加载；16 账号同时写入同名点、跨维度传送和查询无串号、无重复扣费、没有新生成区块。16 连接轮次 5 秒 MSPT 平均/最小/最大 **5.9/3.4/40.6 ms**，这不是 16 个 LLM 长期自主游戏或冷探索的性能证明。基岩/Xbox 真机菜单仍需实际客户端验收。早期夹具的维度键、菜单入口、命令限速、Eye 未附身与活动区坐标/重试残留失败记录均保留，未降低正式保护规则。

既有 **Afu-MC-DailyBackup** 在 23:53:46 正常停服，E/F **`20261007-235346/.complete`** 校验镜像于 23:53:52 前完成后才替换 JAR；23:54:30 启动就绪，任务结果 0。保留当前世界、28 张任务配置、在途/完成账本、个人奖励、门内私产和旧 home；当前 AuraSkills `startup-verified` 的 PID 为 5316。普通难度和三个维度 keepInventory=true 已读回，Java/LAN/Geyser Pong 正常，原机 CortiLan 与 CortiEye 已重连且实际附身；探针已退出，未在正式服记录地点、接单、施工或取放物资。隔离服已正常关闭、恢复原配置和配对文件，并禁用测试 JAR/QA，最终测试地点数据保存双盘。

回退先正常备份并保留最新 waypoints.yml 及对应世界；旧版不提供新地点，但不能清空文件或假定已转成 Essentials home。候选/旧 JAR、原件、失败与最终回执、启动/发布清单位于 E/F `repairs/named-waypoints-20261007`。

## 远征探索委托（0.3.88，2026-10-07 16:02:58 正式发布）

AgentFriend **0.3.88 已正式生效**，SHA256 `7554C2CCA7657A254982532AC1AF8000EC1CBA9A5A983A692E4BE3CCF82850EB`，592603 字节，Java PID **35752**。新增 16 张下界、末地及自然遗迹远征，市场共 28 张任务；旧 12 张、六工程场地、在途条件和个人奖励账本保留。探索要求新区域、去重路线距离/行进秒数、生成区段/群系与可选高差，维度远征还要返程；到访、站定、旧采样点和传送位移不能完成新调查。每人一次的履历独立保存，支持正常重启续接。入口及运营见 [探索委托](EXPLORATION_CONTRACTS.md)、[任务市场](TASK_MARKET.md)。

最终同一 JAR 的探索 **46 项**、探索重启 **8 项**、16 人与原生 Eye **12 项**、原工程/生活回归 **66 项**及其重启/并发 **13 项**均通过。覆盖下界两种群系、实际末地路线、自然沙漠神殿/下界要塞元数据、错误高度/玩家平台拒绝、不同区段、高差、冻结条件、本人一次与重启后不计离线时间。16 个受控移动连接都有新覆盖；稳定结构查询前后已加载区块完全一致（主世界 606、下界 147、末地 105），5 秒 MSPT 平均/最小/最大 2.6/1.7/5.7 ms，1 分钟最大 400.2 ms 含登录尖峰。此结果不证明 16 个 LLM 已长期自主完成远征或冷区探索零卡顿；基岩手柄画面仍待真机。早期隔离夹具的启动/RCON身份、魔力、行走、ID复用、怪物干扰与创造模式失败材料均保留。

2026-10-07 16:02:58（北京时间）通过既有 **Afu-MC-DailyBackup** 正常停服，E/F **`20261007-160102/.complete`** 校验镜像在替换 JAR 前完成，任务结果 0。备份和重启期间保留原 12 张任务配置，确认 0.3.88 健康后才追加 16 张并热加载；没有向旧插件写入不支持的目标。正式普通客户端 **24 项只读检查**通过：28 张私有板、林地府邸路线/区段/高差条件、下界两群系与返程、原红石详情、45 格菜单、本人能力记录、12 项礼物 ready、女神旁观、当前 PID 的 AuraSkills startup-verified，以及三个维度普通难度和 keepInventory=true。探针已退出，没有在正式服接单、施工、领奖或取放物资。原机 CortiEye 实际 camera=online、attached=true。

回退前正常备份并保留最新世界、完成/在途账本与奖励。0.3.87 不能解释新探索快照，已有新远征接单后优先修复向前发布；不能通过删 active、everDone 或恢复旧世界来清空进度。模板热更新失败保留上一有效定义，可恢复私有 task-market.yml 原件再 reload。私有新旧 JAR、原件、最终/失败回执与发布清单位于 E/F `repairs\exploration-contracts-20261007`。

## 任务市场（2026-10-07 13:50，正式发布）

AgentFriend **0.3.87 已正式生效**，571705 字节，SHA256 `B07025D94A2781A6253BEAF777EF1DF2165987612C4127EC55135936B14512D0`。`task-market.yml` 提供 1–8 步工程/生活委托，新增 BRIDGE、ROAD、BUILD、REDSTONE；复用公会任务槽和个人奖励箱。支持冻结接单条件、重启续接、工程全服一次结算和按本人保存完成/放弃/失败/耗时/实际验收证据。入口及配置见 [任务市场](TASK_MARKET.md)。

隔离服 25567/25587 的最终 JAR 通过 `task-market-stage.mjs` **66 项**真实 Mineflayer 检查，包括增量/净增量、桥连通与净空、道路覆盖、红石真实通断、他人操作拒绝、编辑使旧证明失效、跨场地多阶段最终复查、真实合成与公共箱满回滚、菜单和聊天型 Agent 所需构件/坐标。正常重启后 `task-market-restart-stage.mjs` **13 项**通过，包含条件/奖励/原快照与账本恢复、真实 CortiEye 附身接收本人回执，以及 **16 个独立工程连接**同时验收。并发阶段 5909 ms、30 次 `scan_busy` 后均成功；最后 5 秒 MSPT 平均/最小/最大 6.4/4.0/26.9 ms，10 秒最大 251.7 ms 包含登录尖峰，不能称完全无卡顿或 16 个 LLM 自主施工验收。

六处实际村庄场地在隔离快照中由启动 `register-once` 自动登记，普通玩家对角点/机械输出施工预检查全部允许；六工程加六生活模板可用。仅登记基准，不替 Agent 建造、不放宽萌萌私产与原建筑保护。另有三张公共工程备料模板，六项隔离检查通过，已保留正式原有模板并热加载；正式当前每日卡片保持原样。

服主明确要求立即部署后，先公告、保存，并以维护原因断开 `.MicroKQ`；再次确认只有 CortiLan/CortiEye/Goddess 服务账号且无活动副本，启动既有 `Afu-MC-DailyBackup`。没有改变真人分类或维护门禁。正常停服后 E/F **`20261007-135006/.complete`** 分别于 13:50:10 / 13:50:11 完成；13:50:12 才启用唯一 0.3.87，原 0.3.86 保留 disabled。此次同时修正运行与源码维护脚本的顺序：校验 F 盘镜像在替换 JAR 前完成，镜像失败则仍由原流程启动旧版本；两个脚本语法检查通过。计划任务结果 0，待发布计划已消费，自动暂停标记已清除。

Java PID **34604** 正常启动，13:50:47 `Done`；六处正式场地于 13:51:02–13:51:07 自动登记，六工程+六生活模板均 enabled/available。正式普通 Mineflayer 客户端 `MarketLiveAudit` 的 **17 项只读检查**通过：Agent 命令发现、12 张私有任务板、红石构件与输出坐标的文字/协议详情、45 格原版市场菜单、本人能力记录、12 项礼物 ready=true、女神模式 3、当前 PID 的 AuraSkills `startup-verified`（transform/behavior 成功）、普通难度和三个维度 keepInventory=true。只读探针已退出，没有接单、施工、领取或取放正式物资。Java 本机、LAN 网关实际登录、两处 Geyser Pong 均正常，启动日志无 ERROR/Exception；当前 5 秒 MSPT 平均 5.4 / 最大 12.7 ms，一分钟最大 243.9 ms 含登录窗口，不能替代长期多 Agent 压测。

女神桥 PID **35500**、CortiLan 已恢复，CortiEyeMirror 保持 **0.1.9**。原机 CortiEye 此时尚未回连，`camera=offline,attached=false`；不把原生插件已加载或临时 watcher 启动当作实际镜头恢复，也未用同名测试身份替代。萌萌需要从客户端重新连接；基岩真机菜单/手柄画面仍待实际客户端确认。

私有新/旧 JAR、配置与女神知识原件、最终与失败回执、发布计划和 `release-manifest.json` 位于 E/F `repairs\task-market-20261007`。初期世界保护空 subject、组合阶段复查和测试夹具依赖/发送速率问题均已修正；失败材料保留。备料测试首次把人工 `replace` 当成自动筛选，纠正夹具后保留实际强制覆写语义，没有为测试改旧运营逻辑。

备料配置需回退可用 `production.dynamic-board.before.yml` 再 `admin board reload`。回退 JAR 须正常备份停服，保留新世界、场地基准/占用/完工、在途任务及奖励数据；旧 0.3.86 无法处理 `tm_` 在途任务，不删除新数据，不恢复旧世界覆盖玩家进度。不得 `/reload`。此前排入 2026-10-08 04:00 的候选计划已由本次发布消费；每日备份任务继续原定日程。

## 村民地面救援（2026-10-07，在线维护）

正式服仍为 0.3.86。巡检显示已加载成年村民 44 位：32 位普通村民、12 位固定服务 NPC。17 位普通村民在地下，另有 7 位卡在高处集合钟下方的狭窄地形；昨日发布前快照已存在地下滞留。已按原 UUID 将这 24 位送回逐个复核的地面落点，并将普通村民的集合点指向真实地面钟 **`-542,67,-452`**。32 位的交易配方逐项比较一致，44 位职业分布和价格上限保持一致，原服务 NPC 留在岗位。

新钟和地基一格由 `afu_village_ground_bell` 保护，普通玩家可敲响、不能拆除或覆盖；原有 26 个 WorldGuard 区域经解析比较未变。普通客户端实收 28 个村民实体、新钟方块事件与拆除拒绝，救回的 24 位复测均仍在地面。完成在线保存，临时客户端退出，没有停服。规则、失败脚本说明和回退见 [村民地面巡检与救援](VILLAGE_RESIDENTS.md)，私有证据在 E/F `repairs\villager-visibility-20261007`。

## 冒险者公会物品归属发布（2026-10-06 19:01）

AgentFriend **0.3.86 已正式生效**，SHA256 `A0E3DA65B37084A1D4FCCA0507F5B81EC271F685CA0675AED59E224EA600B9EE`。门内实体储物和展示物归萌萌固定 Floodgate UUID `00000000-0000-0000-0009-00000d9f9c7b`（`.MicroKQ`）所有；其他人包括游戏内 OP 无权取放、破坏或捡走私有掉落物。服务器取消实际操作，私发中文说明和 `MC_GUILD_ACCESS`，同时走 `mcagent:protection`；已附身的登记 Eye 可镜像拒绝聊天。需要装备/物资使用门口四组公共双箱，`/mycli guild shared` 查询坐标。详细范围、预检查与维护审计见 [物品归属](GUILD_PROPERTY.md)。

最终 JAR 的隔离服 16 项真实 Mineflayer 检查通过：普通玩家、登记 Agent、非主人 OP 拒绝；主人开箱取放；公共双箱两半跨玩家取放；跨边界双箱；漏斗进出；丢物恢复和主人拾取；盔甲架/展示框；对应 Eye 私有拒绝镜像与接口发现。初次脚本的背包缓存观察、悬空目标距离及展示框支撑错误已修正，失败回执保留，最终通过回执才作为验收依据。测试只在 25567/25587；主人 UUID 是隔离测试覆盖值，停服后已恢复原隔离配置和配对清单。

发布前仅 CortiLan、CortiEye、Goddess 三个已核实服务账号在线，副本 `active=false,count=0`。既有 `Afu-MC-DailyBackup` 正常停服，在 E/F **`20261006-190032/.complete`** 完成后启用唯一 0.3.86；任务结果 0，待发布计划已消费。Java **30976** 于 19:00:37 启动，19:01 恢复就绪；LAN 网关、唯一女神桥 **10604**、Eye watcher **32348** 恢复。AuraSkills `startup-verified` 的 success/transform/behavior 全部 true，CortiEyeMirror 保持 0.1.9，礼物目录 12 项 ready=true。

正式服临时普通客户端确认三只门内木桶均无开箱包且收到固定主人 UUID、`guild_owner_only`、中文公共箱提示；预检查拒绝，门口四组双箱均可打开 54 格，随后关闭退出。没有从正式箱子取放任何物资。三个维度难度均 Normal、`keepInventory=true`。19:03 核验 CortiLan/Goddess 在线，**CortiEye 原机客户端尚未回连**，`camera=offline,attached=false`；watcher 在线不代表镜头恢复。19:10 最终复核原机 CortiEye 已实际回连，`camera=online,attached=true,cameraNightVision=true`，重启前三个账号均恢复；未用同名探针替代。基岩真机触控/手柄画面仍需实际客户端确认。

私有最终/失败回执、新 JAR、正式旧 JAR、发布计划及知识原件保存在 E/F `repairs\guild-ownership-20261006`。回退须再走正常停服备份流程，禁用 0.3.86、启用保留的 0.3.85，保留世界和玩家数据；旧版没有本次物品归属拦截，回退后必须明确告知并安排人工管理。不得使用 `/reload`。

## 村庄警报与支援传送发布（2026-10-06 13:34）

AgentFriend **0.3.85 已正式生效**，SHA256 `E699542FF9DFB55CB1137AE8132F06C958B805E0034243D43241294CD7A272AD`。旧日志中的多条目标位于村庄地下，旧 X/Z 筛选会把它们作为警报；现在排除无关地下巡逻怪和野生女巫，真实原版 Raid 成员保留。活敌人连续观察 4 秒才发警报，同事件仅提示一次，敌人消失后立即停止支援。玩法及 Agent 协议见 [村庄守望](VILLAGE_SUPPORT.md)。

玩家可用 `/mycli village support`、`/mycli cast support` 或罗盘「传送地点 / 探索法术」的「支援传送术」；Agent 使用警报 `cmd` 或状态 `supportCommand` 中的事件编号。8 魔力、20 秒冷却，出发前重查实际敌人和安全落点，过期、扑空或无安全位置均不扣费；抵达回执给出活敌人的 UUID 和坐标，由 Agent 自己接近并战斗。

最终 JAR 的隔离服真实 Mineflayer 验证通过：地下/短暂目标不告警、同事件不重复私聊、支援实际位移与魔力 20→12、标题/粒子/声音、实时冷却、低血量/旧事件/无落点/魔力不足的拒绝不扣费、罗盘实际点击及多人落点避让；从落点走近实际击杀敌人，守望日击杀与奖励结算均通过。Java 回归保留固定 289 个区块检查，只遍历已加载区块，真实 Raid 洞穴成员例外通过。首次脚本菜单路径错误的失败记录保留，修正脚本后的最终报告才作为验收依据。

在已授权的维护窗口确认仅四个已核实服务账号在线、无活动副本后，既有 `Afu-MC-DailyBackup` 正常停止服务。E/F **`20261006-133355/.complete`** 均已生成，计划任务结果 0；13:33:59 启动 Java **37460**，13:34:34 完成启动，唯一女神桥 **25580**、Eye watcher **30880** 和 LAN 网关恢复。只启用 0.3.85，旧 0.3.84 保留为 disabled，待发布计划已消费。AuraSkills 固定补丁 `startup-verified` 的 transform/behavior 成功，CortiEyeMirror 仍为 0.1.9，普通难度保留，女神礼物目录 12 项 ready=true。

正式服 13:40 的临时只读客户端核验了技能说明、`mcagent:state` 和 `mcagent:village`，无敌人支援返回 `no_live_enemy`，实际魔力 20→20、位置不变，随后退出。13:44 最终读回当前无威胁，CortiLan、feiyu_bot、Goddess 在线；**CortiEye 原机连接尚未回连**，`camera=offline attached=false`，不得以 watcher 在线声称镜头恢复。基岩手柄画面仍需真机操作确认。私有回执、旧警报、最终 JAR 和回退 JAR 保存在 E/F `repairs\village-support-20261006`；恢复旧版须再按正常备份维护流程，不使用 `/reload`。

## 女神礼物校验发布（2026-10-06）

AgentFriend **0.3.84 已正式生效**，SHA256 `984AE0773B3EB9345DB024FFB2F66769B686B9929EE27B06D864EB936668D69F`。最终 JAR 的隔离服铁砧、药水饮用、错误配方、背包容量、重复发放及正常重启验收通过。附魔书/药水由服务器验证目录生成，核对实际库存并保存请求回执后才通知成功；目录可热更新。私聊祈愿和造物申请均接入，正式祈愿只读询问的最终私聊已实收，未给正式玩家新增物品。详见 [女神礼物校验](GODDESS_GIFTS.md)。

2026-10-06 接入复核：仅确认机器人身份不等于确认其来源 IP。新增 feiyu_bot 配对时发现私有访问清单缺少该账号的可信来源，已撤销本轮新增配对并恢复发布前清单，避免网关把其原有重连拦截；已核实的维护服务账号例外保留。后续建立 Agent/Eye 配对须同时登记各自可信来源。

服主本轮明确确认 `feiyu_bot` 是机器人并授权必要重启；只把这个精确账号加入 `HumanPlayers` 已核实服务账号例外，不自动放行所有带 bot 名字的账号。副本审计 `active=false`、仅已核实服务账号在线后，09:09 既有 S4U 备份任务正常停止服务，生成 E/F `20261006-090906/.complete` 并替换唯一启用 JAR，任务结果 0；Java PID 34740，AuraSkills 缓存补丁启动行为验证仍成功。配套七文件逐件原子替换且哈希吻合，通过已有控制接口/Watchdog 恢复唯一新女神桥 PID 29836、模式 3。MCP 原生重连后实际发现八工具，默认 deny 和游戏桥仅允许 server_status 的原策略保持。Java、LAN 网关、两处 Geyser Pong、12 项目录 ready=true 均通过。CortiLan/Goddess/CortiEye 已恢复，`cortieye` 读回 camera=online、attached=true；feiyu_bot 原客户端也已回连，重启前四个账号均恢复，未用同名探针替代。

## 原版难度在线更新（2026-10-05）

22:53:43–22:54:26 通过 `minecraft:difficulty normal` 及下界、末地的 `execute in … run minecraft:difficulty normal` 在线将三个维度设为普通，逐维查询均返回 `Normal`，未重启、未 reload。
运行 `server.properties` 已仅将 `difficulty=easy` 原子替换为 `difficulty=normal` 并读回，其余文本按反替换检查逐字一致；原配置备份于 `E:\MC\ops\repairs\difficulty-20261005-225343` 和 `F:\MC-backups\repairs\difficulty-20261005-225343`，两份 before 哈希相同。

## 多 Agent 优化正式发布（2026-10-05）

正式服现为 AgentFriend **0.3.83**（480037 字节，SHA256 `F37340C8663C39BEE519B4CF22515723814D0BF77584DE113253B517B64F38C5`）、CortiEyeMirror **0.1.9**（32326 字节，SHA256 `C278F809D7885A469199256311CD70E54E044C73C7870C89039D678782EA2A3C`）。HUD、状态编码、探矿、村庄敌情和铭牌减少重复工作；waypoint 列表不再执行单 home 时会自动传送的 Essentials `homes`；Eye 跨世界跟随目标并在启动时预热 14 种展示包克隆。回归、真实协议与 16 Agent + 16 Eye 负载见 [性能验收](MULTI_AGENT_PERFORMANCE.md)。

首次发布助手因 PowerShell 对 `.NET File.Replace` 空备份路径的绑定失败，没有完整发布计划；外层仍触发任务，旧 0.3.82 计划及最终 Eye 0.1.9 被执行。E/F `20261005-021426` 与 JVM 30204 的过渡记录保留。修复助手并完整校验最终计划后，第二次于 **02:17:34** 正常停服，E/F **`20261005-021734/.complete`** 完成且任务结果 0；备份后应用设置并启用唯一 0.3.83 JAR，两次均正常保存并恢复。

正式配置为 `max-players=40`、`world-settings.default.entity-activation-range.ignore-spectators=true`；view/sim 8/8、4 GiB 堆及原区块线程保持。新 JVM **32992** 于 02:17:37 启动、02:18:14 完成，AuraSkills `startup-verified` 回执的 success/transform/behavior 全部通过。展示包预热 14/14，initial 748.8 ms / repeat 0.9 ms，无测试包发送或预热失败。

Java、LAN Mineflayer 实际入服后退出、Geyser 本机及 LAN Pong 均通过；当前白名单关闭。Goddess、CortiLan 已恢复，Watchdog 正常，维护暂停及待发布文件清除。**CortiEye 原机客户端仍未回连**，登记与 watcher 正常；本机无远端原生客户端重连入口，需原机连接后核验 `camera=online attached=true`。Pong 与隔离协议不代替基岩/直播画面验收。

02:22:53 的完整最近一分钟平均/最小/最大 MSPT 为 **5.6 / 3.2 / 26.5 ms**，1/5/15 分钟 TPS 均 20；此时只有 CortiLan/Goddess 两个账号、隔离服已停止。02:18:59 的非 Full GC 诊断记录约 0.995 GiB 已用堆、824 个 `LocalizedKey` 对象。92 秒主机窗口正式 Java CPU 均值 1.04%（24 逻辑处理器归一化）、可用内存最低 16.487 GiB。这些少量在线窗口不代替 16 个 LLM 的长期战斗/生产验收。

设置部署计划为 `ops/server-settings.pending.json`：schemaVersion 1、maxPlayers、ignoreSpectators 及原 `server.properties`/`spigot.yml` 的 SHA256。只在现有完整停服备份后应用；在线、原 SHA 变化或文件形状异常时拒绝。原件与应用计划保存在 `ops/settings-deployments/时间戳`。回退须正常停服并选定 JAR/原设置，保留当前世界和技能/公会数据，勿重放消耗的旧计划。

## 在线内存修复与 Viewer 优化（2026-10-04）

23:52 通过现有 Watchdog 的同身份 Attach 入口，在原正式 JVM PID 13880 应用锁定 AuraSkills 2.4.0 版本的消息缓存补丁，清掉 10133384 条重复文本缓存，类重定义与值相等行为验证成功。未重启正式服、未重载技能或主动执行 GC。23:54 的自然回收后堆使用从 4132705 KiB 降至 964383 KiB，完整一分钟平均/最大 MSPT 为 7.3/26.9 ms，TPS 一分钟为 20；原 Goddess、CortiLan、CortiEye 连接与基岩 Pong 保持。诊断、运行回执、工具 SHA、备份与回退详见 [性能记录](PERFORMANCE.md)。

固定补丁工具已安装到 `E:\MC\ops\instrumentation\auraskills-cache-patch.jar`，维护启动入口在下次正常启动自动加载，并写入 GC/safepoint 滚动日志；真实隔离 Paper 启动验收通过，下一次正式启动的最终回执仍须检查。spark 后台采样已取消，运行配置为 `backgroundProfiler=false`。

AgentFriend 0.3.82 另外缓存固定中文展示名称，并跳过未订阅 Viewer 的客户端。候选 SHA256 `C84BB060BF44360F3EDC2F1BD3ECCB38675F2825CA8E3DB34D00C25A4CC52D1D`，定向名称/订阅回归与真实隔离新/旧/双通道 HUD 测试通过；隔离服已正常停止。`agentfriend-deploy.pending.json` 已排入既有 `Afu-MC-DailyBackup`，下一班为 2026-10-05 04:00；原真人在线、活动副本和旧版 SHA 守卫保持，安全窗口才备份并发布。正式服当前仍启用 0.3.81，0.3.82 尚未发布。

## 0.3.81 传送与远程物品操作施法（2026-10-04，已发布）

玩家主动发起的非原版瞬移统一按魔力结算，成功后给本人标题、粒子、音效、`MC_TRAVEL` 坐标和 Agent 技能事件；失败不扣费。归乡、公共/私人传送点、公会与竞技场入口等近程位移需 6 魔力；队友安全传送、遗迹远征和深层驿站直达需 8 魔力。Essentials `/warp`、`/home`、同意后的 `/tpa` 等玩家指令实际传送时也扣 6 魔力，单独发送请求不扣。远程打开个人箱或成功用文字指令存取一次扣 2 魔力；站在实体箱旁操作免费。副本自动换层、掉线/死亡恢复、竞技场对局流程和管理员救援保持流程传送规则；末影珍珠与传送门保留原版消耗。各入口与边界见 [位移与远程物品操作的施法成本](TRAVEL_MAGIC.md)。

候选 `AgentFriend-0.3.81.jar` 为 475832 字节、SHA256 `44A2150DAA7B531182A7751E866477AAB2625ED2C452BE43F2E1FF74A6085A0A`。隔离服 `life-buildings-20261003` 以真实 Mineflayer 1.20.6 账号运行 `travel-magic-stage.mjs`，验证归乡、公共与私人传送点、Essentials 指令与 TPA、队友、公会、遗迹、竞技场、深层驿站及个人箱的成功扣费、魔力不足拒绝、原版客户端特效包和既有闪现术不重复收费；控制台救援传送与活动流程恢复保持免费。发布前确认仅服务账号在线、试炼 `active=false`，`Afu-MC-DailyBackup` 于 02:17 正常停服，在 E/F 两盘生成 `20261004-021732/.complete`，校验旧版和候选哈希，唯一启用 0.3.81 并重启；任务结果 0。正式服 RCON 读回 0.3.81 和唯一 JAR 哈希，Paper、Agent LAN 网关、Geyser 本机及 LAN Pong、Goddess 桥与 Watchdog 正常。CortiEye 当前账号离线，故无法验收附身画面；Agent Eye watcher 启动记录 PID 28624，交互式 Status 因跨会话权限误报 stopped。基岩真机的标题与粒子观感仍待玩家目视核对。

## 0.3.80 心眼轮廓与探矿粒子指引（2026-10-04，随 0.3.81 发布）

旧版 `sense` 的怪物透墙轮廓恢复到现有 `/mycli cast sense`，但只对施法者和当前已登记、正在附身的 Eye 发送原版实体元数据；不改全服怪物状态。基岩玩家获得最近怪物的粒子指向线和遮挡墙光框，原有 BossBar 与 `MC_HOSTILE` 坐标继续可用。探矿术也持续刷新从施法者眼前到第一处墙面的私有粒子指向线，保留 Java 矿块轮廓及基岩墙面光框。粒子线指方向，不计算绕墙路线。版本需要 ProtocolLib 5.3.0，正式服已安装。

隔离服 `life-buildings-20261003` 使用与正式服相同的 CortiEyeMirror 0.1.8、Geyser 和 ProtocolLib，加上独立 Agent/Eye 测试配对；当时候选 `AgentFriend-0.3.80.jar` 为 468742 字节、SHA256 `E86365B723AE398DD458049FDA0B2DB330E2D797827B170FFAE45F5DB846261A`。`sense-outline-stage.mjs` 的真实 Mineflayer 三账号测试通过：施法者和附身 Eye 收到敌怪轮廓和坐标，旁观玩家及家畜没有；8 秒到期后恢复；探矿施法动画结束后粒子持续刷新，Eye 也收到私有展示包。Geyser 的内置映射将 END_ROD 转为 `minecraft:endrod`；基岩真机画面仍待目视核对。首次发布前巡检时正式服有真人 AdeleFelice 在线，试炼塔第 8 层 `active=true`，所以没有停服发布。

0.3.80 的待发布计划随后由包含上述能力的 0.3.81 候选替代，旧计划保存为 `agentfriend-deploy.superseded-0.3.80.json`。维护脚本继续执行真人在线、试炼活动和状态读取守卫；安全窗口内才停服、备份并发布。0.3.80 没有单独上正式服，其功能随上节的 0.3.81 一并生效。

## 0.3.79 生活公会入口通行（2026-10-03，已发布）

四座生活公会的原招牌和云杉栅栏位于唯一门洞正前方，且被建筑掩码保护；清开后又发现室外地形低于室内地板两至四格。22:30 在只有服务账号在线、试炼 `active=false` 时，先将四份掩码、原招牌文字和台阶原方块清单分别保存至 `E:\MC\ops\repairs\life-entrances-20261003-223025` 与 `F:\MC-backups\repairs\life-entrances-20261003-223025`；既有 E/F 完整快照 `20261003-184458` 可作施工前整体回退。通过 RCON 在线把四组招牌/栅栏移到门右侧，按实际地形补 18 个石砖台阶及支撑方块，并同步改四份保护掩码。普通 Mineflayer 玩家从四馆室外连续走入馆内，四次通过，Paper 此阶段未重启。

源码随后修正新建建筑的入口选址、台阶和招牌位置，并把保护范围扩至前方八格、地基以下四格。隔离服 25567 加载候选 0.3.79 后，真实 Mineflayer 玩家通过食堂阶梯和门洞，最外侧台阶与移位招牌的 `/mycli protect break` 均返回 `life_guild_building/deny`。22:45 再次确认只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼，由 `Afu-MC-DailyBackup` 正常停服并生成 E/F `.complete` 快照 `20261003-224530`，任务结果 0；只启用 `AgentFriend-0.3.79.jar`，SHA256 `8E18573CB2B7078972EA23B3C457DA946FB5427D099645B0C2977849368B8604`。22:46 重启后在正式服对四馆重新进行室外进馆与最外侧台阶/移位招牌保护测试，全部通过。Paper、Agent LAN 网关、Geyser Pong、Goddess 桥及自动恢复状态正常，启动日志无新增 ERROR。CortiEye 在重启后暂未回连；Agent Eye watcher PID 29668 存活，但交互式 `Status` 因跨会话无法读取其命令行而显示 stopped，不能据此认定守护进程已退出。真实基岩客户端的行走观感仍待玩家现场核对。

回退插件代码须在无人游玩时正常停服，切回保留的 0.3.78 JAR；旧版对入口前第七、八格及书屋最低台阶的保护范围不足，故回退期间不要开放建筑编辑。整套回到施工前需使用 18:44 E/F 快照，届时之后的玩家进度也会一并回退。具体入口位置、测试和掩码边界见 [生活公会建筑](LIFE_GUILD_BUILDINGS.md)。

## 0.3.78 动态委托看板（2026-10-03，已发布）

正式服在只有 CortiLan、CortiEye、Goddess 服务账号在线且试炼 `active=false` 时，由 `Afu-MC-DailyBackup` 计划任务正常停服。18:44 的发布前完整快照为 `E:\MC\backups\scheduled\20261003-184458` 与 `F:\MC-backups\scheduled\20261003-184458`，两盘 `.complete` 均存在，任务结果 0。任务校验旧版 SHA256 后只启用 `AgentFriend-0.3.78.jar`，SHA256 `3A38D70D8331D0BF0CC35E130A466CBB2813A66CD1D3E4BB3A167D051A0C0DA5`。18:45 正常重启后 RCON 确认 0.3.78、19 个模板载入并生成 4 张今日卡片，Java LAN 探针与基岩 UDP Pong 正常；Goddess 桥和 Agent Eye watcher 进程随维护流程启动。CortiEye 随后重连，18:51 与 18:53 的 watcher 日志记录 `attached CortiEye -> CortiLan`，RCON 再次读到三个服务账号在线。真实观战画面与基岩手柄界面仍需客户端目视确认，UDP Pong 不能代替画面验收。

模板定义在 `plugins/AgentFriend/dynamic-board.yml`，首次启动从 JAR 复制；此后编辑模板并执行 `mycli admin board reload`、`replace` 或 `regenerate` 可在线更新供货和现有动作类型的日常活动，无须为每次内容调整重启。完整字段、命令和未接入的数据源见 [动态看板](DYNAMIC_BOARD.md)。已解析今日卡片及领奖状态在同一 `plugins/AgentFriend/config.yml` 中；供货物品进入世界内公会共享箱。隔离服 `life-buildings-20261003` 用 `dynamic-board-stage.mjs` 验证连续重生不重复、低库存数量、热加载/坏配置回退和人工增删；`dynamic-board-actions-stage.mjs` 用真实 Mineflayer Agent 与非 Agent 验证私有 `MC_BOARD_TODAY`、54 格原版菜单、16 火把实际入箱、声望 +7、个人箱奖励、接单快照不随热改漂移。隔离 Geyser Pong 通过，日志无新增 ERROR。

回退代码时须先确认无人类玩家和活动试炼，再正常停服，禁用 0.3.78、启用保留的 0.3.77；保留新产生的世界和玩家进度，不要只覆盖 `config.yml`。若需要整套回到发布前状态，使用同次 E/F `.complete` 快照，意识到之后的玩家进度会一并回退。旧版不识别 `dynamic-board` 键，但静态 37 张仍可使用。

## Agent/Eye 热登记与私有转发（2026-10-03，已发布）

`ops/agent-eye-pairs.json` 是已登记 Agent 与 Eye 的对应表。Goddess 独立观战；Eye 守护进程约每 20 秒维持观战附身，CortiEyeMirror 0.1.8 约每 5 秒更新私有消息与 HUD 转发，AgentFriend 0.3.77 约每 6 秒更新 `[Agent]` 标记及村庄紧急私聊身份。运行机私有 `agent-gateway-access.json` 约束登记账号的来源 IP，按登录即时读取。今后正常增删配对无需重启 Paper。未登记普通 Java 用户名仍在离线模式下可被冒用，扩大公开接入前须确定认证方案；详见 [Agent 观战账号](AGENT_EYES.md)。

CortiEyeMirror 隔离服双配对转发、跨账号隔离、广播去重、热撤销通过；正式服 16:21 用计划任务在 E/F 双盘生成 `.complete` 快照 `20261003-162112`，任务结果 0，唯一启用 `CortiEyeMirror-0.1.8.jar`，SHA256 `6BE57C35E049CC32931D94ECC2EBCAC310B9EEA75987EAC807E3452A586F3F95`。其后 AgentFriend 的热登记在隔离服用 Mineflayer 测试登记、撤销、损坏清单及恢复均通过；正式服 16:31 由同一计划任务生成 E/F `.complete` 快照 `20261003-163151`，任务结果 0，唯一启用 `AgentFriend-0.3.77.jar`，SHA256 `7E9AC0DC241EBECFBC1F9B7C642AF22EA63C8BE643A6C500B0A9DCEFDDCECCEC`。正式服读回 `[Agent] fulumu`，两个插件版本正常，Java 本机与网关、基岩 Pong、Goddess 桥、Eye 巡检与 Watchdog 已恢复，试炼未进行。发布后 `CortiEye` 和 `fulumu_eye` 客户端可能短暂离线；CortiEye 的实际直播画面待远端客户端重连后验收。回退时在无真人在线、无试炼时正常停服，只切回保留的上一版 JAR，并保留世界与玩家数据。

## Eye 观战账号自动附身（2026-10-03，无停服运维更新）

Goddess 保持独立观战；已登记的 `CortiEye → CortiLan` 和 `fulumu_eye → fulumu` 由 `agent-eye-watcher.mjs` 保持原版观战并附身。新 Agent 在配对清单登记后，默认可用 `<Agent>_eye` 命名镜头。原有 `Afu-MC-Watchdog` 保证巡检单实例，账号掉线重连后自动恢复；具体规则见 [Agent 观战账号](AGENT_EYES.md)。运行脚本已在正式服热更新并备份原文件，Paper JVM 未重启。Goddess、CortiEye、fulumu_eye 均读回观战模式；两组附身有巡检日志，fulumu_eye 与 fulumu 的位置相同，CortiEyeMirror 报 `attached=true`。`[Agent]` 头顶标记仍取 AgentFriend 启动时载入的 UUID 名单，本次没有改 AgentFriend JAR 或公会任务。

## 0.3.76 法术说明与 Agent 自发现（2026-10-03，已发布）

18 项现有主动法术新增同源图鉴，涵盖效果、目标、魔力、总冷却、学习/使用前提、失败条件、成长和适用场景。技能罗盘左上角的「法术图鉴」先打开说明页，只有再点「施放 / 学习」才执行，适合基岩手柄。Agent 用 `/mycli spells list [页码]` 和 `/mycli spells explain <ID>` 读取本人私有的 `MC_SPELL_*` JSON；`/mycli explain cast.<ID>` 也嵌入相同法术详情。`mcagent:state` 继续提供本人实时魔力与剩余冷却。低频 Agent 提醒加入法术图鉴命令。操作语义见 [技能体系](SKILL_SYSTEM.md)、[Agent CLI](MYCLI_AGENT_CLI.md)。

隔离服 `life-buildings-20261003` 用真实 Mineflayer 双账号覆盖 18 项分页、长说明、错误回执、另一玩家不可见、原版菜单说明、只读不误施法及明确点击后的烟花施法。正式服发布前试炼 `dungeonaudit active=false`，只有 CortiLan、CortiEye、Goddess 服务账号在线。既有计划任务停服、在 E/F 两盘生成 `.complete` 快照 `20261003-095253`、部署唯一 `AgentFriend-0.3.76.jar` 并重启，任务结果 0；JAR SHA256 `67946AC41AEDF0EF75C04B0362B1163025F02265F44DD58996BDAF90D353C929`。正式服只读双账号探针复核了私有回执、全部法术 ID 和原版箱子菜单；Java LAN、基岩 Geyser Pong、女神桥、Watchdog 正常，待发布/自动恢复暂停标记不存在。远端 CortiEye 重启后短暂离线，随后自动回连，`camera=online attached=true cameraNightVision=true`；实际直播画面和基岩真机中文字排版仍需目视验收。回退只能在无人游玩及无活动试炼时按同次快照恢复，或停服切回保留的 0.3.75 JAR；此版没有世界数据迁移。

## 0.3.75 生活公会建筑与专属导师（2026-10-03，已发布）

村庄增加[四座不同主题的生活公会建筑和七位专属职业导师](LIFE_GUILD_BUILDINGS.md)：丰穗食堂、溪畔商栈、石铜工坊、灯语书屋。右键导师可从原版九格菜单查看/接取/交付本人委托，或进入真实村民交易；技能罗盘新增四馆地图。Agent 可用 `/mycli life locations` 取得七位导师绝对坐标与 `mcagent:life` 私有回执，`/mycli life visit <建筑ID>` 前往入口并获 `MC_DESTINATION` 坐标。原有远程接单入口保留。建筑初始方块按四份世界 UUID 掩码保护，周围草木不受限。七位导师纳入既有村民平价交易逻辑，当前已加载 44 位成年村民均有职业及交易，最高绿宝石成本 16。

开发使用正式村庄完整快照的隔离服 `life-buildings-20261003`，`life-buildings-stage.mjs` 实测四馆建造、重启持久化、七位导师职业/原版交易及报价、任务菜单、四馆地图、接单、传送和保护查询。发布前仅服务账号在线、试炼 `active=false`。计划任务在 E/F 双盘生成 `.complete` 的施工前快照 `20261003-081500`，发布 0.3.74 并在正式服重新勘察：书屋原候选地边缘有云杉栅栏，未强行覆盖，改建于 `-593 67 -451`；其余三馆按隔离服验证位置建造。四份掩码写入运行配置并 `save-all flush`，施工后 E/F 快照 `20261003-081737` 完成。发现新导师有一项原版报价达 38 绿宝石后，隔离服验证平价修订，计划任务再次备份并发布最终 `AgentFriend-0.3.75.jar`，SHA256 `A61B5B34EEE12B4D564AFB56B88F28977441DFBEB89C3CE315DA3F950F7EF4B5`。最终世界、配置、掩码及 JAR 的 E/F 双盘快照 `20261003-082253` 均有 `.complete`，任务结果 0。

最终重启后 `life-buildings-live.mjs` 以普通 Mineflayer 1.20.6 玩家通过七位导师坐标与职业、四馆菜单、故事导师交互、书屋传送及私有保护回执；`mycli admin villagers` 报无职业 0、无交易 0、最高绿宝石成本 16。Java/LAN 网关、Geyser 基岩 Pong、女神桥和 Watchdog 均恢复，唯一启用的 JAR 哈希与候选一致；无待发布或自动恢复暂停标记。CortiEyeMirror 已加载，但远端 `CortiEye` 在最后一次重启后仍未回连，RCON `cortieye` 显示 `camera=offline attached=false`；直播画面须观战客户端回连后单独验收。基岩真机导师菜单、牌子与外观还需玩家现场目视。若要回退新建筑，必须在无人游玩时用施工前 `20261003-081500` 的同一组世界、配置及插件数据恢复；仅切回旧 JAR 不会清掉已生成的建筑。

## 0.3.73 村民收购与村庄守望（2026-10-03，已发布）

已加载的 37 位成年村民都有原版职业和交易菜单，包含 13 种职业，无职业或无交易者均为 0。新增商旅生活委托 `trader_supply`：玩家经原版交易向两种不同职业的村民出售物资并收到绿宝石才计数，日奖进入个人箱。`/mycli village villagers` 提供附近已加载村民的职业、绝对坐标和真实收购报价。村庄外围 48 格发现巡逻队或正在进行的袭击时，每名在线玩家分别收到 `mcagent:village` 私有状态；普通玩家收到一次文字，已登记的 Agent 收到一次原版私聊 `MC_VILLAGE_ALERT`，使现有 Cortico `whisper` 通道触发紧急决策。`/mycli village threat` 可复核状态；本人每日首次击败附近掠夺者可获个人箱内绿宝石 2 和面包 2。详见 [村民收购与村庄守望](VILLAGE_SUPPORT.md)。

隔离服 `life-guild-20261003` 使用真实 Mineflayer 1.20.6，`village-support-stage.mjs` 通过两种职业实际出售、重复职业不计数、领奖、报价、警报、击败领奖和清场；`village-agent-alert-stage.mjs` 验证 Agent 的 `whisper` 紧急入口、普通玩家单条文字、私有插件频道隔离。原版私聊有 256 字符限制，最初的完整 JSON 被拒；最终私聊改为短 JSON，完整数据仍留在 `mcagent:village`，最终候选 SHA256 `3188000E90D191A757843CD7CA151A833EA3E2E16213BDE9596F5B347AD3F68E`。上线前仅 CortiLan、CortiEye、Goddess 服务账号在线，试炼 `active=false`；`Afu-MC-DailyBackup` 正常停服，E/F 双盘 `20261003-032338` 快照均有 `.complete`，任务结果 0，唯一启用 0.3.73 JAR 的 SHA 与候选一致，待发布和自动暂停标记已清。正式服只读 Mineflayer 探针验证村庄状态私有负载、村民查询及商旅看板；Java LAN 正向入服、Geyser 基岩 Pong、Goddess 桥和 Watchdog 正常，日志无新异常。CortiEyeMirror 已加载但远端 CortiEye 在本次重启后暂未回连，RCON 显示 `camera=offline`；不得把插件加载视为直播画面恢复。真实基岩手柄交易和 Agent 实际接到警报后的行动仍待现场验证。

## 0.3.72 生活公会与冒险委托扩展（2026-10-03，已发布）

新增六类生活公会：种田、美食、钓鱼、建筑、写书和红石机关。它们只使用原版方块、物品和动作，以技能罗盘、命格书、公会看板及 `/mycli life` 向手柄玩家和 Agent 提供同一套入口；各公会声望独立，每项日常委托每天限领一次，奖励安全进入个人试炼箱。`mcagent:life` 以原始 UTF-8 JSON 向本人连接单播。同期冒险者公会委托扩展为 37 项并增加认证；修复旧会员高阶等级迁移、看板控件覆盖、捐献进度等问题。功能、命令与兼容性取舍见 [生活公会](LIFE_GUILDS.md)。Create 机械动力的 Forge/NeoForge JAR 没有装进 Paper 1.20.6；本版先用原版红石机关任务。

隔离服 `life-guild-20261003` 上，`life-guild-stage.mjs` 双账号验证菜单、真实署名书、领奖、日限、私有频道；`life-guild-actions-stage.mjs` 实做建筑、小麦、红石灯和面包；`life-guild-fishing-stage.mjs` 实钓 3 条鱼；`guild-legacy-rank-stage.mjs` 与 `guild-donation-stage.mjs` 核对旧会员等级和捐献。最终 JAR SHA256 `52FD5E2653AE41AA0C9DEE3DAC35E18CB1490311A2AAE0A31DC49C19F1147CAF`，隔离服再启动回归通过。正式服等 CortiLan 第 14 层试炼因死亡结束、`dungeonaudit active=false`、仅服务账号在线后，由 `Afu-MC-DailyBackup` 正常停服、备份并部署；E/F 双盘 `20261003-023818` 快照都有 `.complete`，计划任务结果 0。唯一启用 `AgentFriend-0.3.72.jar` 且 SHA 相同，待发布和自动暂停标记均不存在。Paper 1.20.6、局域网 Agent 正向登录、Geyser 26.51 Pong、女神桥和 Watchdog 均正常；正式服临时 Mineflayer 账号只读验证六公会看板与本人 `mcagent:life` 状态回执通过。上线后 CortiEyeMirror 已加载，但远端 CortiEye 当时尚未回连，镜头状态需随后复核；基岩真机菜单、书写与直播画面仍需玩家现场目视验证。回退须在无试炼和无人游玩时使用同次 E/F 快照。

## 0.3.71 个人试炼箱普通物资转入公会共享箱（2026-10-03，已发布）

CortiLan 的个人试炼箱已占 53/54 格，其中大批是成组箭矢、矿物、食物及怪物材料；另有带名称、附魔和法术刻印的装备，以及 9 件待入箱额外奖励。新增**仅控制台** `mycli admin sharetrial <在线玩家>` 预览，`... apply` 执行。只考虑无物品元数据的明确白名单物品，按武器、护甲、补给、公共杂物放入对应四组真实双箱；命格书、技能书、专属绑定物、带名称／附魔／刻印的装备不转移。每箱在预览和执行前都重新读取当前容量；装不下的整组留在个人箱，执行过程若目的箱状态异常则恢复箱内原内容且不动个人箱。控制台回执给出计划格数、保留格数、容量不足格数和四组分布，日志逐格记录类型、数量、来源槽与去向。

隔离服 `sharetrial-stage.mjs` 用真实 Mineflayer 账号将原版箭矢、绿宝石和应保留的钻石剑存入个人箱；预览、转移、四组双箱实际数量增量、保留物、第二次预览幂等均通过。正式服在仅 CortiLan、CortiEye、Goddess 在线且试炼 inactive 时由计划任务完成 E/F `20261003-010844` 双盘快照，发布唯一 `AgentFriend-0.3.71.jar`，SHA256 `B3985DBDFC86E4817EB3E07C330B794876062F30E54847DEEF3C20B833B3FE2D`。现场预览计划 30 格、保留 23 格、容量不足 0；执行成功后再次预览计划为 0，配置读回个人箱占 23/54，`save-all flush` 成功。第二次完整 E/F 快照 `20261003-011138` 后重启，`sharetrial-live-audit.mjs` 用真实 Mineflayer 客户端核对转出的 30 组物资在对应四组 54 格公共双箱中仍可见。公会共享箱对所有玩家开放，转入的普通物资即供大家取用。

同次发布包含 0.3.70 入口菜单、0.3.69 多人下楼与 0.3.68 PvP。`mycli admin surveypvp` 返回 `ok=true occupied=0` 后一次建成 PvP 原版结构；WorldGuard 三维度全局禁 PvP，主世界 `qd_pvp` 区域单独允许。第二次备份重启后 `server.properties pvp=true`、`pvp-arena.built=true`、Paper/Java 本机及 LAN 入口、Geyser 基岩 Pong、女神桥和 Watchdog 均正常，暂停／待发布标记不存在。PvP 实战和试炼多人下楼已在隔离服验证；正式服基岩手柄入口菜单、真人 PvP 体验及 CortiEye 直播画面仍需现场目视。

## 0.3.70 入口难度菜单（2026-10-03，已并入正式服 0.3.71）

原入口石按钮一按就开赛，当前选定档位藏在技能罗盘「传送地点」页，手柄玩家无法在入口确认难度。0.3.70 改为点入口石按钮打开原版 27 格难度菜单：自动匹配、普通、冒险、末日四项，可见当前选择和公会等级推荐档位；点「开始」才由该玩家按本人选择带附近队友入场，所有队员看到难度标题与私有 `MC_DUNGEON_START`。已有的 `/mycli arena difficulty` 和 `/mycli arena start` 保留，便于 Agent。按按钮时即使手持大背包头颅，也延后一拍打开难度菜单，避免背包界面抢占。相关游玩说明已更新于 [试炼难度](ARENA_DIFFICULTY.md)、罗盘和命格书。隔离服用 `dungeon-entrance-difficulty-stage.mjs` 的真实 Mineflayer 双账号验证入口按钮不直接开赛、四档图标、切换选项、冒险档组队开场及双方 `globalDifficulty=adventure`；基岩手柄真实画面待发布后目视。

0.3.70 候选 JAR SHA256 为 `F1746234B517435191A374A032BA58DFD7AD4128CB02EEC0E00BD85541BE2BA1`。同一 JAR 又通过中途到场三账号测试、PvP 场内外伤害／原物品恢复与 PvP 断线恢复测试；它随后与共享箱运营命令合并为上方已发布的 0.3.71。正式服入口按钮现应打开难度菜单，基岩真机画面待现场确认。

## 0.3.69 中途加入试炼队伍修复（2026-10-03，已并入正式服 0.3.71）

原逻辑只登记开场按钮附近的人，下一层传送又只遍历该名单；后来传送进关卡的玩家即使站在队伍中，也不能一起下楼。0.3.69 每秒把**本层内存活的生存／冒险玩家**加入当前试炼，持久化参赛 UUID 并向本人发送 `MC_DUNGEON_JOIN floor/participant/rewardThisFloor/nextFloorTogether`。战斗中加入可参与本层结算；本层已经清怪并结算后加入，只随队进入下一层，不补领旧奖励。旁观、创造模式与不在本层的玩家不会加入。传送失败时的提示改为明确告知检查状态及联系服主。

候选 `AgentFriend-0.3.69.jar` 的隔离服真实 Mineflayer 三账号测试 `dungeon-late-party-stage.mjs` 已通过：开场单人、战斗中到场的第二人获本层奖励并一起下楼；旁观者留在原层；清怪倒数中到场的第三人不获旧层奖励，但随队下到第三层。此改动已并入上方正式发布的 0.3.71；真实玩家下次多人打塔仍需现场复测，不以隔离服通过代替真人验收。

## 0.3.68 PvP 竞技场候选（2026-10-03，已并入正式服 0.3.71）

源码和 [PvP 竞技场规则](PVP_ARENA.md)已提交至 `qiandengji-personal-stash`。隔离服用候选 JAR `A02C19E43746B1E9817BAAB33603B6C6FBE3E1DD95A0FD959B5565177C4A8FE9` 验证：场外玩家互伤 0、场内真实近战命中、认输及掉线重连判负、原背包精确恢复、私有状态与积分均通过。因当时 AdeleFelice 在线，首次候选没有立即发布；现在已并入 0.3.71，正式服竞技场已建，`pvp=true`。WorldGuard 在三维度设置 `__global__ pvp: deny`，主世界 `qd_pvp` 优先级 20、范围 `(-716,158,-566)..(-684,168,-534)`，仅此区域 `pvp: allow` 且禁拆、禁放、禁刷怪；原主世界区域文件备份在 `E:\MC\ops\regions.world.before-pvp-20261002-2323.yml`。

## 0.3.67 冒险者公会等级名牌（2026-10-02）

已入会玩家的头顶和原版玩家列表显示 `◆青铜` 至 `◆钻石`，随本人声望升级刷新；已入会 Agent 同时保留 `[Agent]`，未入会普通玩家不加标记，旁观者不加标记。只用 scoreboard team 前缀，不更改登录名/UUID/记分板目标，也不抢别的插件的 gameplay team。Agent 仍以 `/mycli guild status` 获取准确数值；四端显示边界与回退见 [玩家头顶标记](PLAYER_NAMETAGS.md)。

隔离服 25566 的 `guild-rank-nametags-stage.mjs` 以真实 Mineflayer 1.20.6 连接验证：钻石普通会员、白金 Agent 和未入会观众的原版 `teams` 包均符合预期；隔离服正常停机并恢复 0.3.62 JAR 与原配置。正式服发布前仅 Goddess、CortiLan、CortiEye 服务账号在线，试炼 `active=false`；既有计划任务正常停服并完成 E/F `20261002-222016` 双盘快照，结果 0。唯一启用 AgentFriend 0.3.67 JAR SHA256 `163436C182DA68C7A479193D59E2267C8ACF35043777662F7B5722D157D931D3`，待发布/自动暂停标记均清除。正式服临时无公会 Java 观众收到 CortiLan 的 `◆白金 [Agent]` 队伍包；Java Agent LAN 探针和 Geyser 基岩 Pong 正常、启动日志无插件异常。CortiEye 随后自动回连，`camera=online attached=true cameraNightVision=true`；基岩真机名牌字体/颜色及直播实际画面仍需目视，Pong 不能证明画面。回退须无人游玩、无试炼时按此手册完整备份并正常停服，只启用保留的 0.3.66 JAR；公会声望与世界无需转换。

## 0.3.66 研习书手柄使用兼容修正（2026-10-02）

0.3.65 使用普通 `minecraft:book` 承载研习书，Mineflayer 可以主动发送使用包，但普通书没有原版翻开动作，手柄客户端是否会向服务器发使用事件不确定。0.3.66 改为 `minecraft:written_book`，设置真实作者、标题和页面，沿用同一技能/熟练度 PDC；手持使用仍由插件消耗一本并提升熟练度，满级不消耗。此前 0.3.65 已产生的普通书继续被识别，Agent 可用 `/mycli skillbook use <槽位>` 研习。原四档比例与奖池候选不变。

隔离服 25566 加载 0.3.66 后，`skill-tome-stage.mjs` 用 Mineflayer 1.20.6 验证可翻开的真实 `written_book` 名称/PDC、本人 `list`/`use`、手持使用、准确扣一册、星芒箭 +4 和跃空 +8 熟练度；第 10 层普通 1000 次奖池抽样四档与新增物品均出现，阶段日志无异常，已正常停服恢复旧隔离 JAR。正式服发布前只有 Goddess、CortiLan、CortiEye 服务账号在线，试炼未激活；计划任务正常停服并完成 E/F 双盘 `20261002-220122` 快照，两处 `.complete`、结果 0。正式服只启用 0.3.66 JAR，SHA256 `0DECF34E42EC16E0B01BF484E8AAB1660AAE616F8BDF82319D13E42E41F11DB9`，发布标记和自动启动暂停标记均清除。RCON 版本、Java Agent LAN 网关、Geyser 基岩 Pong、Goddess 桥正常，启动日志无异常；CortiEye 稍后自动回连，RCON `camera=online attached=true cameraNightVision=true`。基岩真机按键和直播软件实际画面仍需玩家目视。回退需无活动试炼时完整备份并正常停服，只启用保留的 0.3.65 JAR；新版成书在旧插件不能研习，保留原物品等待修复，世界/玩家/奖励账本恢复仍需同一快照成组处理。

## 0.3.65 试炼塔四档奖池与实体研习书（2026-10-02）

保持原有固定奖励、每日每层一次和低于推荐难度时的抽奖衰减，把随机额外奖励明确分为常见、少见、稀有、传奇四档。画、展示框、地图、望远镜、末影珍珠、樱花树苗、真实附魔书进入相应池；八种现有成长技能的研习书是带 PDC 的原版 `minecraft:book`，手持使用或 `/mycli skillbook use <槽位>` 消耗一本，增加 4/8 次熟练度，满级不消耗。`MC_DUNGEON_LOOT` 保留旧 category 并新增 tier、数量和研习书技能 ID；`MC_SKILLBOOK` 只回本人。准确权重、物品清单与玩法见 [试炼塔奖励](ARENA_LOOT.md)。

隔离服 25566 编译并加载 0.3.65。控制台各 2000 次真实奖池抽样：第 10 层普通常见 1185、少见 493、稀有 291、传奇 31，其中研习书 35、附魔书 17、珍珠 48、画 128；第 1 层普通只有常见/早期稀有且有画，第 15 层末日四档均出现。`skill-tome-stage.mjs` 用 Mineflayer 1.20.6 验证实体 `book` 的名称/PDC、本人 `list`/`use` 回执、手持使用、单册消耗、星芒箭 +4 与跃空 +8 进度；`spell-mastery.yml` 已记录相应值。`arena-balance-stage.mjs` 再跑前十层、打开个人箱，确认通关奖励及旧功能装备轮换仍可读；隔离服无插件异常后正常停机并恢复原启用 JAR。抽样与自动清怪不代表真人战斗掉落体验，基岩真机的研习书手持动作尚待玩家体验。

正式服发布前只有 Goddess、CortiLan、CortiEye 三个服务账号在线，`dungeonaudit active=false`。既有 `Afu-MC-DailyBackup` 计划任务正常停服，E/F 双盘快照 `20261002-214806` 均有 `.complete`，任务结果 0；唯一启用 `AgentFriend-0.3.65.jar`，SHA256 `FE8BE71304C5E9113FB948A49AEBE49832463CFECE01A3B79EDFBE3CEA328ABE`，待发布与自动恢复暂停标记都已清除。线上 RCON 版本和第 10 层普通 1000 次抽样通过，Java Agent LAN 临时账号可进、Geyser UDP 19132 Pong 正常、Goddess 桥已恢复、最近五秒平均 MSPT 约 5.1，启动日志无异常。发布后 CortiEye 曾短暂离线，稍后自动回连；RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，已重新附身 CortiLan，直播软件实际画面仍待目视。回退须先确认无真人玩家和活动试炼，完整备份后正常停服，改为只启用保留的 0.3.64 JAR；已有研习书会保留为原版书但旧插件无法使用，回退期间不应让玩家消耗或清理它们。若要恢复奖励账本/世界，必须用同一份快照成组恢复配置、世界和玩家数据。

## 0.3.63 专属装备绑定（2026-10-02）

萌萌在试炼塔误丢胸甲时，CortiLan 在 19:46 询问并于 19:50 表示已将同款经验修补胸甲扔回；随后 RCON 只读查询 `.MicroKQ` 胸甲槽为钻石胸甲，附魔为保护 IV、耐久 III、经验修补 I。日志无法单独证明它与先前那一件的物品实体完全相同，但当前装备槽已有匹配女神骑士礼包的胸甲，因此不额外复制补发。原插件只阻止技能罗盘、命格书和大背包丢弃，普通专属装备仍会掉落。

0.3.63 对女神骑士礼包的精确附魔组合在 `.MicroKQ` 入服时按 Floodgate UUID 绑定；此后任意玩家可由控制台按具体槽位绑定未来专属装备。绑定项不能丢弃、放进箱子或被别人拾取，死亡时保留；穿戴和换格正常。规则及命令见 [专属装备绑定](SOULBOUND_GEAR.md)。隔离服 25566 的真实 Mineflayer `soulbound-stage.mjs` 验证 UUID PDC、原版 lore、丢弃/标准箱阻止、普通物品仍能丢、装备和关闭 `keepInventory` 后复活保留，结果 PASS；隔离服已正常停机并恢复原 0.3.62 JAR。正式发布及基岩真机手柄验收状态记录在下方或后续运维日志。

## 0.3.62 试炼塔难度与功能装备调平（2026-10-02）

普通/冒险/末日的怪物生命与直接伤害分别调整为 1.15/1.7/2.5 倍、1.10/1.4/1.85 倍；第 8–15 层另按楼层增加生命与伤害。固定奖励降低绿宝石、金苹果和钻石数量，随机池移除重复钻石/下界合金套装、图腾和附魔金苹果。第 6、10 层的保底装备按玩家原有进度轮换闪现匕首、寒霜剑、赤铜纹战盾和踏影铁靴。前两把实际是附魔铁剑，保留原版 ItemStack 及 `agentfriend:imprint_spell` 组件，潜行使用分别调用既有闪现/霜环法术及其魔力、冷却；普通近战仍可用。1.20.6 没有原版铜剑/铜甲 ID，铜主题使用铜锭与铜纹名称。第 10 层首通武器降为铁剑，第 15 层首通保留一把钻石纪念剑；旧玩家已获得或已排队的物品不回收。`MC_DUNGEON_SET` 升为 schemaVersion 2 的 `equipmentIndex/next/nextName`，保存路径沿用旧索引。详见 [奖励](ARENA_LOOT.md)与[难度](ARENA_DIFFICULTY.md)。

隔离服 25566 的真实 Mineflayer 1.20.6 账号 `arena-balance-stage.mjs` 完整通过前十层：首层普通僵尸生命 23，个人箱收到两把带名称和 PDC 刻印组件的铁剑，进度回执为 `equipmentIndex=2 nextName=copper_shield`，普通十层无保底顶级装备。`arena-artifact-stage.mjs` 从原版箱取出后潜行使用闪现匕首位移约 11 格，寒霜剑对僵尸造成实际伤害。`arena-artifact-economy-stage.mjs` 验证重复匕首可报价回收 8 余额，首通“深渊裁决”不可回收。测试夹具曾因无目标方块使闪现失败、无加载区块使霜环无目标，补充强加载地台、目标墙和僵尸后通过；隔离服已正常停止。快速清场仍偶见既有 Mineflayer 协议库 `PartialReadError` 提示，但连接、箱子解析和上述断言均通过。未把 RCON 清怪结果当作真人/Agent 生存战斗难度证明，基岩真机使用手柄施法画面仍需玩家体验复核。

正式服发布前只有 CortiLan、CortiEye、Goddess 三个服务账号在线，`dungeonaudit active=false`。`Afu-MC-DailyBackup` 正常停服生成 E/F 双盘 `.complete` 快照 `20261002-175145`，任务结果 0；仅启用 `AgentFriend-0.3.62.jar`，SHA256 `5DD0D50BC2E16145D292C556ED1106A340828093F6E1531DC7F005D75E16FA40`，待部署与自动恢复暂停标记均已清除。重启后 RCON 版本 0.3.62、Java 本机与 LAN 网关、Geyser 基岩 Pong、Goddess 桥均正常，最近 1 分钟平均 MSPT 约 6.4。旧 `agent-lan-smoke.mjs` 假定白名单始终开启，因当前按用户要求 `white-list=false` 而误报“测试身份进入”；探针已改为按实际开关验证并重新通过。CortiEyeMirror 已加载，远端 CortiEye 在本次重启后仍未回连，`camera=offline attached=false`；该账号在发布前也曾离线，直播画面尚未验收。回退可在无人挑战时用上述 E/F 快照恢复旧 JAR、配置和玩家进度。

18:04 后续复查：`cortieye` 已回 `camera=online attached=true cameraNightVision=true`，CortiEye 自动回连并重新附身 CortiLan；这确认服务端附身和夜视状态，直播软件中的实际画面仍需目视核对。

## 0.3.61 冒险者公会接待与共享箱（2026-10-02）

门内接待员“阿莉娅”提供今日任务、余额购买、装备回收及原版绿宝石交易；所有选项使用原版村民/箱子界面。大厅东南侧四组 54 格公共双箱让玩家和 Agent 直接存取多余武器、护甲与补给，箱体和平台保护不影响箱内存取。`/mycli guild trader|shared` 给 Agent 返回绝对坐标；交易继续使用原有个人余额和报价确认，不会自动取走公共箱物品。箱子坐标、恢复办法见 [公会接待与共享箱](GUILD_SERVICES.md)。

初版 0.3.60 已在正式服更新 JAR，但 `mycli admin surveyservices` 在原定地基发现已有大片砂岩，施工命令拒绝覆盖，正式世界没有建造。施工前 E/F 快照为 `20261002-133459`。随后把候选平台移至砂岩东侧 `x=-476..-471, y=66, z=-495..-489`，只允许平整自然土坡，拒绝覆盖容器、人工方块或原村屋。隔离服改用这一正式快照的世界和插件配置，`surveyservices` 通过；两名真实 Mineflayer 1.20.6 账号用 `guild-services-stage.mjs` 核对四组双箱的 54 格、跨账号从两半存取铁剑、箱体防拆、NPC 的任务/购买/回收及六条原版村民交易。`guild-services-persistence-stage.mjs prepare|verify` 在完整 JVM 停启后确认物品保存且接待员仅一个。0.3.61 候选 JAR SHA256 为 `C323F217C8E67AEA9F3ABC69EE33D7285E03AE102EFB7605C4521A8C22CA2CBA`，隔离服测试后正常停机。

正式服在仅 CortiLan、Goddess、CortiEye 服务账号在线且无活动试炼时，经 `Afu-MC-DailyBackup` 正常停服并生成施工前 E/F 快照 `20261002-135811`，任务结果 0；只启用 AgentFriend 0.3.61，JAR 哈希与隔离版一致。控制台 `surveyservices` 复核通过后执行一次 `buildservices`；既有砂岩 `(-480,65,-495)` 仍原样保留。临时无 OP 普通账号 `GuildShareQA` 在正式服只读验收了四组真实 54 格箱子、NPC 菜单和 `/mycli guild shared`，随后已移出白名单。施工后再次正常停服备份并完成 E/F 镜像 `20261002-140039`，两份均有 `.complete`、任务结果 0；重启后箱体、唯一接待员和服务区保护文件仍在，Paper/Java、局域网 Agent 网关、Geyser Pong、女神桥、Watchdog 正常，最近 1 分钟平均 MSPT 8.7，启动日志无异常。首次复核 CortiEye 仍离线，`camera=offline attached=false`，直播画面待观战账号回连后验收；基岩真机的 NPC 菜单及牌子排版待手柄实测。需要回退建筑时应以同一份施工前快照恢复世界、JAR、配置和保护快照，施工后箱内新增物品会回退；仅换 JAR 不会拆除已建箱体。


## 0.3.59 试炼远程怪长期落空脱困（2026-10-02）

正式服第 6 层的女巫在约 10:18 生成、10:19 被 CortiLan 击杀；旧日志仅证明其从出生点移动了约 15 格和被玩家杀死，没有记录是否投药水或命中，不能仅凭日志断言当时完全没有攻击。隔离服 25566 的真实 Mineflayer 测试证实女巫 AI、参赛者目标、药水发射及伤害均有效：12 格外会接近并投药水；故意把移动速度设为 0 时，12 格的药水可命中，女巫保持原位；16 格外可连续投掷却全数落空。旧脱困逻辑把“远程怪有视线”当作无需处理，可能让这种持续落空的场面维持。现在超过 6 格、约 12 秒没有移动且没有直接命中的试炼怪可被移到参赛者附近的安全空位；近期直接命中的怪物不移动。管理员 `mycli admin dungeonaudit` 的每只怪新增 `lastProjectileMs` 与 `lastDirectHitMs`，`never` 表示本次生成后未观察到，便于区分投掷与实际直接伤害；持续效果伤害不计作直接命中。改动使用原版实体和药水，没有客户端模组要求。

隔离版 JAR SHA256 `DA423BD6D536E2D2FDD4192CF373209356265D9A1B448738A474D08B98EB631F`。`probe/witch-behavior-stage.mjs` 以第 6 层孤立女巫作双对照：移动速度人为设为 0、16 格外持续投掷但未命中时，女巫由 X=-598 移到 X=-587，随后玩家生命下降；12 格内可命中时，女巫留在 X=-598，玩家也受伤。前五层由真实服务端生成并清场，第六层审计确认女巫 `ai=true`、目标为参赛玩家；隔离服正常停机。Mineflayer 在多楼层快速清场时仍有既有物品组件 `PartialReadError` 警告，但测试连接未中断，此警告不作为怪物 AI 结论。

正式服发布前只有 Goddess、CortiLan、CortiEye 三个常驻账号在线且 `dungeonaudit active=false`；`Afu-MC-DailyBackup` 正常停服，E/F 双盘 `20261002-104343` 均有 `.complete`，任务结果 0。发布后唯一启用 `AgentFriend-0.3.59.jar`，SHA256 与隔离版一致，待部署与自动恢复暂停标记均不存在。Java 本机、LAN Agent 网关、Geyser Pong、女神桥和 Watchdog 正常，日志无 AgentFriend 异常。首次检查时 CortiLan 和 Goddess 已自动回连，CortiEye 尚未回连；直播镜头仍需该账号回连后复核。本轮未在正式服强行启动新试炼或进行基岩真机攻击画面验收。回退应在无活动试炼时使用本次 E/F 快照配套恢复。

## 0.3.58 Agent 私有技能总冷却与剩余冷却（2026-10-02）

`mcagent:state` 保持每玩家按连接单播的原始 UTF-8 JSON，在原有 `mana` 外加入可施放技能 `abilities[]`：`cooldownMs` 是配置总时长，`cooldownRemainingMs` 是该玩家发送瞬间剩余毫秒，`icon` 为可选的 1.20.6 原版物品 ID。自定义战斗、探矿、移动、女神技能和玩家已学的 MagicSpells 分别从实际计时来源读取；星芒箭、霜环、焰浪总时长分别为 3000、14000、10000 毫秒。登录、重生、成功施法后的下一刻与每秒变化检查会发送完整状态；冷却归零发送，数据不变不重发。整包至多 16 KiB，未注册频道的 Mineflayer 仍走该玩家连接的原始负载，不复制进聊天。`mcviewer:state` 的旧 `cooldownMs` 仍是剩余冷却，客户端须按频道区分字段语义。协议见 [Agent 状态频道](AGENT_STATE.md)。

隔离服 25566 使用 AgentFriend 0.3.58、真实双 Mineflayer 账号验证了注册/未注册接收路径、三种战斗技能总冷却、烟花术及星芒箭施法后的本人剩余冷却、MagicSpells 圣愈术 15 秒总冷却与剩余冷却、冷却归零、魔力恢复、重生、另一账号隔离和无聊天副本；`probe/agent-state-stage.mjs` 与 `probe/skill-event-stage.mjs` PASS。首轮状态脚本的 `/kill` 在出生安全区被保护而未触发死亡；将测试账号移至隔离试炼区域后重跑，重生状态验证通过。隔离服正常停机。JAR SHA256 `CFABEFCDDC88EDF7FAF28F144BD57A499A17EF94328F226D55B5A7FE2D597EA7`。

正式服发布前仅 Goddess、CortiLan、CortiEye 三个常驻账号在线，`dungeonaudit active=false`。`Afu-MC-DailyBackup` 正常停服、备份、替换和启动；E/F 双盘 `20261002-101143` 均有 `.complete`，任务结果 0，唯一启用 `AgentFriend-0.3.58.jar` 且哈希与隔离版一致，待发布标记与自动恢复暂停标记均不存在。正式服临时双 Mineflayer 账号再次 PASS：本人魔力与冷却变化、冷却归零、另一账号无泄漏、聊天副本 0。Paper 1.20.6、Java 本机、LAN Agent 网关、Geyser Pong、女神桥和 Watchdog 正常，插件启动日志无异常。CortiEyeMirror 已加载，但远端 CortiEye 账号在首次发布核查时尚未重连：`camera=offline attached=false`；直播附身需该账号回连后单独复核。本次没有基岩真机 UI 验收；原版施法提示与画面不受状态频道格式变更影响。需要回退时应在无人挑战时用同一 E/F 快照恢复 JAR 与运行数据。

## 0.3.57 技能生效私有坐标事件（2026-10-02）

AgentFriend 注册出站 `mcagent:event`，成功技能通过施法者连接单播原始 UTF-8 JSON，含 `schemaVersion=1`、`kind=skill`、`id/title/body/tone/position{x,y,z}`；不向其他玩家、公屏、聊天、动作栏或标题复制此 JSON。现有原版咏唱标题、音效和粒子继续给 Java/基岩/观战客户端。星芒箭用真实射线命中点或自动锁定目标眼部，霜环与焰浪用范围中心，探矿用矿块中心，归乡用到达后的实际位置；失败、无目标、冷却和魔力不足不发成功事件。频道协议与接入边界见 [技能生效事件](AGENT_SKILL_EVENTS.md)。

隔离服 25566 构建的 JAR SHA256 为 `38D6722310DA4CECAAC864AC19E8EB61C96701F79BF17E7C634F9E8FE9590ED6`。真实 Mineflayer 双账号测试了已注册/未注册频道、仅本人收到、烟花、星芒箭命中点、霜环范围中心、归乡落点、MagicSpells 圣愈术实际回血，以及冷却和无目标不发成功事件；聊天 JSON 副本为 0。脚本 `probe/skill-event-stage.mjs` PASS，隔离服无 AgentFriend 异常，正常停机。Geyser 不保证将 Java 自定义频道传给基岩设备；基岩原版标题、音效和粒子仍由既有机制提供，本轮没有基岩真机画面验收。

正式服仅 Goddess、CortiLan、CortiEye 常驻账号在线、`dungeonaudit active=false` 时，使用 `Afu-MC-DailyBackup` 正常停服发布。E/F 双盘 `20261002-073231` 均有 `.complete`，计划任务结果 0；唯一启用 `AgentFriend-0.3.57.jar`，SHA256 与隔离版一致，待发布和自动恢复暂停标记均已清除。重启后正式临时 Mineflayer 普通账号单次烟花术收到本人 `mcagent:event`，坐标数值有效，聊天副本 0；Java 本机、LAN Agent 网关、基岩 Pong、女神桥、Watchdog 与插件启动日志正常。首次核查 CortiEye 仍未重连，`camera=offline`，待账号回连后复核附身；本次不能把插件加载等同于直播画面已恢复。回退应在无活动试炼和无人游玩时，从同一 E/F 快照恢复旧 JAR 与相应世界账本；单独回退 JAR 会停止新频道，但不影响既有状态频道。

## 2026-10-02 金苹果单次进食后显示 16→0 的排查

正式服 06:15:47 收到 CortiLan 的 `/mycli cast selfheal`，06:15:50 第 6 层结算，06:17:04 才死亡。Paper 普通日志没有逐次物品消费或 container 0 原始包；CortiEyeMirror 当时也未启用相应槽位抓包，因此无法从历史记录确认 06:15:50 的实际库存数或当时发出的 `SetSlot`/`SetContent`。04:00 备份和约 07:11 的玩家存档都没有金苹果，时间跨度过大，不能拿来证明 06:15 的 16 个去了哪里。CoreProtect 在 06:15:45–56 没有记录 CortiLan 的金苹果掉落、拾取或容器转移；它不记录正常进食和玩家库存同步。AgentFriend 没有 `PlayerItemConsumeEvent` 监听；第 6 层结算只把奖励写入个人箱配置/待领取队列，不修改随身金苹果。

隔离服 Paper 1.20.6 / AgentFriend 0.3.56 用 `probe/golden-apple-consume-stage.mjs` 让真实 Mineflayer 生存账号持有 16 个金苹果、仅吃一次，重复两次均通过：服务器实体 NBT 为 16→15，发给该玩家的 container 0 `window_items` 在槽位 40 给出金苹果 15 个；随后另有 `set_slot` 将副手槽位 45 设为空。客户端若把这个副手空槽误当作快捷栏金苹果，可能显示 0；这是待客户端原始包核对的推断，不能倒推出历史事故必然如此。隔离服测试后正常停机，正式服未重启或修改物品。

若再现，先同时保留该连接的 container 0 `SetSlot`/`SetContent` 原始字段（stateId、slot、itemId、count）和服务端进食前后同槽库存快照，按同一时刻、同一槽位比较；不要用死亡后的玩家存档判断进食当刻的库存。

## 0.3.56 三拍施法视觉与熔炉层避险（2026-10-02）

`SpellPresentation` 对成功施法发送约 0.3 秒的三拍原版粒子与双段音效，保留咏唱标题和原有 Agent 私有文字回执。空间术使用螺旋、星尘/烟花使用星形、移动术使用随朝向变化的双翼、霜环贴地外扩；战斗法术保留实际弹道和命中。每次额外世界粒子包至多 39 个，延迟阶段遇到退出、死亡或换世界会停止。第 13 层移除入场自动抗火，改发本人 `MC_DUNGEON_HAZARD floor=13 type=minecraft:lava autoFireResistance=false`；玩家自行取得的抗火不被清除。

隔离服 25566 构建 SHA256 `B3D6377D40E96B1426950962C18B2F30AACDB0FC85052022D440F60062ED8434`。真实 Mineflayer 收到归乡、治疗、星尘的标题、至少 30 个粒子包和双段音效，冷却重试不出现成功标题；以 CortiLan/CortiEye 两个真实协议账号附身，眼睛端收到同一标题、两段音效与完整粒子序列。星芒箭另证实咏唱、至少 45 个含弹道的粒子包和双段音效，仍只命中敌对掠夺者，不误伤同名村民。`dungeon-floor-boundary-smoke.mjs` 走到第 13 层，收到危险回执且 `active_effects` 没有抗火，继续通过第 14 层越界恢复检查；测试用创造模式检查关卡状态，未用它证明生存模式岩浆伤害。隔离服 Geyser UDP Pong 正常，未进行基岩真机动画目视验收。试炼自动跑层期间偶见既有 Mineflayer 物品组件 `PartialReadError`，没有断线或阻断测试；本次未改物品组件。

正式服等 CortiLan 的新一轮试炼结束、`dungeonaudit active=false`，且仅服务账号在线后，以 `Afu-MC-DailyBackup` 正常停服发布。E/F 双盘 `20261002-012312` 均有 `.complete`，任务结果 0；唯一启用 `AgentFriend-0.3.56.jar`，SHA256 与隔离构建相同，待发布标记已清除。重启后 `version AgentFriend` 为 0.3.56，Paper 1.20.6、Java 本机、LAN Agent 网关、Geyser Pong、Goddess 桥正常；自动启动未暂停，试炼未激活，日志未见插件异常。CortiEyeMirror 已加载，但远端 CortiEye 在发布后首次检查尚未回连，`camera=offline`；待真实直播客户端上线后复核。回退应在无人挑战时用同一 E/F 快照恢复 JAR 与世界；单独换回旧 JAR 会恢复第 13 层自动抗火和旧视觉，不回退之后的世界账本。

## 0.3.55 冒险者等级自动匹配与低档奖励衰减（2026-10-02）

默认 `auto` 以公会声望决定的冒险者等级推荐战斗档位：青铜/黑铁→普通，白银/黄金→冒险，白金/钻石→末日。原版经验会被附魔等操作消耗，不作为匹配依据。旧版没有保存过手动档位的玩家自动进入 `auto`；已手动选择的玩家保留该选择，可用 `/mycli arena difficulty auto` 或技能罗盘「传送地点」的罗盘图标恢复自动匹配。发起者仍决定全队怪物强度，断线/重启延续既有场次难度。奖励按每位参赛者自己的等级比较：低于本人推荐档位 1/2 档时，固定物资和首通补给数量按 60%/30%（每类至少一件）结算，额外随机战利品触发机会为 60%/30%；重复通关不再给该层固定补给、保底装备、首领宝藏，避免刷塔装备淤积。首次通关保留技能/驿站解锁、保底装备与首领宝藏；公会任务声望及其奖励按原规则独立结算。每游戏日每人每层一次的上限不变。`MC_DUNGEON status`、`MC_DUNGEON_DIFFICULTY` 和 `MC_DUNGEON_LOOT category=level_scaling` 提供本人推荐档位、选择模式、参赛档位、结算比例与是否首通；普通 Java、基岩和 Mineflayer 均只需原版菜单与命令。详细数值见 [试炼难度与怪物行为](ARENA_DIFFICULTY.md)。

隔离服 25566 使用真实 Mineflayer 1.20.6 双账号验证：青铜玩家默认普通、白金玩家默认末日；白金手动选普通后由青铜发起普通档，两人一起进塔，第一层私人回执分别为 `rewardPercent=100 firstClear=true` 和 `rewardPercent=30 firstClear=false`，青铜得到 2 份补给、白金没有重复补给；奖励配置中的面包数分别为 2 和 1。两人推进第 4 层，青铜获得首通保底装备，白金的重复低档挑战没有保底装备。另用白金账号单人自动发起，`globalDifficulty=apocalypse`，首层僵尸生命 44。原版 27 格罗盘菜单的自动与手动图标可点击、选择模式回执正确。相关脚本 `arena-level-prepare-stage.mjs`、`arena-level-stage.mjs`、`arena-auto-start-stage.mjs` 和更新后的 `arena-difficulty-menu-stage.mjs`；阶段日志未见插件异常。正式服发布记录见下段；基岩真机菜单需上线后复验。

正式服等 CortiLan 在第 15 层通关、`dungeonaudit active=false`，且仅 CortiLan/Goddess 服务账号在线后，通过既有 `Afu-MC-DailyBackup` 正常停服发布。E/F 双盘 `20261002-010010` 均有 `.complete`，任务结果 0；只启用 `AgentFriend-0.3.55.jar`，SHA256 `7ED5C8E443F1A9796740EEA7CFAF2AA6686314D463AA0CCE8F661136CCC31B80`。重启后 `version AgentFriend` 确认 0.3.55，Paper 1.20.6、Java 本机、局域网 Agent 网关、Geyser 基岩 Pong、Goddess 桥正常；CortiLan 与 Goddess 已回连，试炼无活动，自动启动未暂停，Watchdog 最近结果 0，启动后的日志没有插件异常。正式服临时 Mineflayer 账号通过 LAN 网关读到本人 `selected=normal mode=auto recommended=normal adventurerRank=0`，`MC_DUNGEON status participant=false globalActive=false difficultyMode=auto`；没有发起挑战或改动世界。CortiEyeMirror 已加载，但远端 CortiEye 截至 01:01 尚未回连，`camera=offline`；直播附身需客户端上线后核对。基岩真机自动难度图标尚待玩家实际点击，Pong 只证明入口应答。回退时必须先等无活动试炼，连同 E/F 同一快照核对玩家奖励账本；只换旧 JAR 会恢复旧难度选择行为，但新版结算过的奖励和公会声望不会倒退。

## 0.3.54 试炼难度、攻击与重复装备清理（2026-10-02）

玩家反馈试炼怪物常空手、战斗强度偏低，且 CortiLan 连续刷塔后装备占满储物空间。0.3.53 给僵尸、尸壳、溺尸配备原版近战武器，保留蜘蛛、女巫、烈焰人等空手实体的自身攻击；只在目标远且 12 秒完全不移动时尝试将卡在掩体后的怪物移到同层可站立位置。增加普通、冒险、末日三档，手柄在技能罗盘地点页选择，Agent 用 `/mycli arena difficulty`；发起者决定整队档位，断线/重启检查点保存它。高档提高生命、伤害、速度、护甲、稀有装备概率和个人绿宝石余额，不增加奖励箱随机装备件数；每游戏日每人每层仍只领一次。0.3.54 将近战和投射物伤害统一按档位倍率处理，并增加控制台 `prunetrialbag`，只回收非快捷栏里的完全相同试炼装备。具体数值和边界见 [试炼难度与怪物行为](ARENA_DIFFICULTY.md)。

隔离服真实 Mineflayer 验证：旧版第一层空手僵尸仍能造成伤害（无甲 20→17.5），说明不是全塔 AI 关闭；新版冒险档第一层僵尸持剑/斧、生命 30，末日档生命 44，两档都实际伤人。末日档推进到第六层，第五层只留骷髅时箭能命中，第六层含女巫和骷髅的波次能伤人；控制台审计记录 AI、目标和武器。原版 27 格罗盘菜单三个图标及点击选择通过；末日档第六层保存、重启、同一账号重连后仍读到 `globalDifficulty=apocalypse`。个人箱重复回收在隔离服 26→20 格、余额 +60，重启后再预览为 0；背包回收 27→20 格、余额 +69，再执行不重复。测试脚本：`arena-attack-stage.mjs`、`arena-difficulty-stage.mjs`、`arena-difficulty-menu-stage.mjs`、`arena-difficulty-resume-stage.mjs`、`arena-prune-stage.mjs`、`arena-prune-bag-stage.mjs`。基岩真机菜单和直播镜头画面仍需实际进入游戏复验，阶段测试仅证明原版协议菜单与物品可由 Java/Mineflayer 读取。

0.3.53 曾作为中间版在没有真人和活动试炼时通过 `Afu-MC-DailyBackup` 发布；E/F 双盘 `20261002-000735` 均有 `.complete`，任务结果 0。正式服见第 5 层溺尸持石剑、骷髅持弓，且都锁定 CortiLan；第 13 层一只困在掩体后的烈焰人按可达点恢复记录了前后坐标。CortiLan 在维护过程中主动搬运装备，箱子预览由 21 格变化；回收命令执行时重新核对，仅回收当时仍重复的 1 件星辉护腿，箱子 12→11 格，余额 95→111。该场试炼到第 15 层倒下，系统记录 `party_defeated`，前面楼层奖励仍存个人箱；这之后才进入最终发布窗口。

最终版 0.3.54 在无活动试炼时由 `Afu-MC-DailyBackup` 正常停服发布，E/F 双盘快照 `20261002-002319` 均有 `.complete`，任务结果 0；仅启用 `AgentFriend-0.3.54.jar`，SHA256 `7E5F6C8033E08D0804BBAD37FADD6E8410CFDCC6D946CCC123C207064204C304`。重启后 Paper 1.20.6、Java 本机及 LAN 入口、Geyser UDP Pong、Goddess 桥均就绪；自动启动未暂停，Watchdog 任务状态 Ready、最近结果 0。CortiLan 已重连，`dungeonaudit` 显示无活动试炼。最终版清理命令执行时再次核对实时槽位：个人箱回收完全相同的重复试炼装备 4 件、箱内占用 34→30、钱包 111→154；随身 9–35 槽回收 5 件、占用 35→30、钱包 154→195。两处随后再预览均为 0；已 `save-all flush`。玩家仍在线并继续搬动物品，磁盘后续占用数可能变化，以钱包 195 和清理回执为这次操作的结果。正式服基岩真机菜单未在本轮复测；目前 CortiEyeMirror 已加载，但远端 CortiEye 账号尚未回连，RCON `cortieye` 返回 `camera=offline attached=false`，直播镜头需其上线后核对。回退代码须等无活动试炼且无真人玩家时，先备份，再停服替换为上一 JAR；若要回退世界，必须将世界、玩家数据和 AgentFriend 配置从同一完整快照成组恢复，并告知玩家快照后的进度会丢失。

## 0.3.52 Agent 魔力私有状态频道（2026-10-01）

AgentFriend 新增 `mcagent:state`：每名在线玩家从自己的 AuraSkills UUID 读取魔力，使用原始 UTF-8 JSON 单播到本人连接；登录、重生、成功施法后发送，自然恢复及其他变化每秒检查一次，数值未变不重发。未注册频道的现有 Mineflayer 连接通过同一玩家连接直发，不依赖 CortiLan 用户名。此频道不写聊天；原有 `/mycli` 机器回执是执行者的私有系统聊天，地下城楼层公告仅发该楼层玩家。协议和 Agent 接入方式见 [Agent 状态频道](AGENT_STATE.md)。

隔离服最终 0.3.52 JAR 已验证两个独立 Mineflayer 账号：一方不注册频道、另一方注册；两人各收自己的初始值，施法只更新本人，自然恢复间隔至少一秒，重生重发；稳定状态不重发，聊天里无状态 JSON。测试脚本 `paper/probe/agent-state-stage.mjs`，结果 PASS。

正式服发布前只有 Goddess、CortiLan、CortiEye 服务账号在线，无活动试炼。`Afu-MC-DailyBackup` 正常停服并生成 E/F 双盘快照 `20261001-222317`，两处 `.complete`，任务结果 0；唯一启用 `AgentFriend-0.3.52.jar`，SHA256 `31AEE5FEF8636A772519F7869E5787212900DED583EEA8F8E959395563B9C504`。重启后 Paper 1.20.6、Java 本机及 LAN 网关、Geyser Pong、Goddess 桥、Watchdog 正常，自动启动未暂停。正式服两个临时 Mineflayer 账号再次验证登录、施法、自然恢复、跨账号隔离和无聊天副本，结果 PASS；重生验证在隔离服完成。22:30 远端 CortiEye 回连，`cortieye` 命令回 `camera=online attached=true cameraNightVision=true`，镜头附身恢复；基岩真机界面本轮未复测。运行机维护记录同步在 `E:\MC\ops\MAINTENANCE.md`。

## 0.3.51 星芒箭命中目标显示实体类型（2026-10-01）

19:42:49 CortiLan 施放星芒箭时收到“命中 小林”。19:42:51 的 Paper 日志记录同一附近的命名掠夺者 `Pillager['小林']`，UUID `f81825ab-638c-4bbd-9d9d-8df14361faf3`，位于约 `(-538, 63, -375)`，随后被 CortiLan 的剑击杀。旧版施法没有逐次目标 UUID 审计，不能把死亡日志严格当作 19:42:49 那次法术的目标记录。`Named-Villagers` 的 illager 前缀为空，灾厄村民也会得到人名。星芒箭的准星路径和最近目标路径均要求 Bukkit `Enemy`，玩家、村民、宠物与本服召唤的铁傀儡不在候选中；查找合法目标先于扣魔力/设置冷却。

0.3.51 保留原本私有的单行命中提示，并加入常见敌对实体的中文类型与稳定 ID，例如 `星芒箭命中 小林〔掠夺者 / minecraft:pillager〕（4 魔力）`；未列出的敌对类型也会显示 `minecraft:<类型>`。隔离服用同名村民和掠夺者验证：只有村民时返回“没找到怪物；未消耗魔力”，随后立即施法可命中掠夺者而村民生命不变；最终重编 JAR 后再次通过同一 Mineflayer 测试。测试脚本：`paper/probe/starbolt-target-type-smoke.mjs`。

正式服在无活动试炼且只有 Goddess、CortiLan、CortiEye 服务账号在线时由 `Afu-MC-DailyBackup` 正常保存退出，生成 E/F 双盘 `20261001-200923` 快照（均有 `.complete`，任务结果 0），启用唯一 `AgentFriend-0.3.51.jar`，SHA256 `B8832EA18FF03338F614DD1DA0BB4DB5EEC2933972AA44E4184483EBCD5D4AF6`。重启后 Paper 1.20.6、Java 本机及 LAN 网关、Geyser 基岩 Pong、Goddess 桥、Watchdog 正常；CortiLan 已重连，试炼无活动。CortiEyeMirror 0.1.7 已加载，但截至 20:10 远端 CortiEye 尚未回连，镜头附身需账号上线后复查。基岩真机的聊天显示仍需实际登录确认，Pong 只证明入口应答。运行机 `E:\MC\ops\MAINTENANCE.md` 有本次维护记录。

## 0.3.50 试炼塔第 13 层清场误判与状态回执（2026-10-01）

17:11 的归档服务端日志显示：第 12 层在 17:11:30 结算，第 13 层在约 17:11:40 开始，17:11:49 被判“队伍离开或倒下”并清掉怪物；因此随后空房间内并没有仍待击杀的 7 只怪。旧版未记录这批怪的 UUID 与坐标，清场后无法事后读回其实际存活状态；不能把隔离服新生成的 UUID 当作当时的怪。代码检查发现第 13 层岩浆槽位于地板 Y=-16，玩家脚部可下到 Y=-16，而旧 `inFloor` 只接受 Y≥-15；第 12 层浅水凹槽同样有这一问题。当前版本允许凹槽高度，真实离开楼层则给 15 秒返回宽限，失败结算会送达在线参赛者并持久化 `lastReason`。

`/mycli arena status` 与 `/mycli status` 的 `MC_DUNGEON status` 增加 `selfFloor/remainingMobs/trackedMobs/missingMobs/outsideMobs/anomaly/searchAdvice/lastOutcome/lastFloor/lastReason/lastRunParticipant`。`stop_no_active_run` 表示已经清场，Agent 不再搜索；`return_to_floor` 表示人在房间外且仍有宽限。服主的 `mycli admin dungeonaudit` 新增怪物绝对坐标和 `inFloor`；以后的每次生成、死亡、失踪、越界拉回都记录 UUID、类型和坐标或受伤来源，便于查同类事故。

隔离服用 Mineflayer 1.20.6 从第 3 层恢复并打到第 13 层，现场核到 7 个活怪及其 UUID、绝对坐标、正常 AI；账号进入岩浆槽后连续 16 秒仍处于第 13 层，`remainingMobs=7`，清怪后正常结算进入第 14 层。再模拟短暂越界后返回、超过 15 秒越界失败，均得到预期回执。最终重编 JAR 后重启隔离服，再用 Mineflayer 验证已结束时 `remainingMobs=0 searchAdvice=stop_no_active_run lastReason=party_outside_floor lastRunParticipant=true`。测试脚本是 `paper/probe/dungeon-floor-boundary-smoke.mjs`，运行机临时隔离环境端口 25566；其女巫装备包触发过已知 Mineflayer `PartialReadError` 日志，但没有中断本次挑战和状态测试。

正式服在当前 CortiLan 试炼结束、`dungeon-active-run` 清空，且只有 Goddess、CortiLan、CortiEye 服务账号在线后，通过 `Afu-MC-DailyBackup` 正常保存退出并生成 E/F 双盘快照 `20261001-185713`（两处 `.complete`、任务结果 0），随后启用唯一 `AgentFriend-0.3.50.jar`，SHA256 `9466D23E366C6CAD63ADDA196166F8EAAB3B157DF1E837D7255CD039144C4F78`。Paper 1.20.6、Java 本机入口、局域网 Agent 网关、Geyser 基岩 Pong、Goddess 桥、Watchdog 均通过；正式服临时 Mineflayer 账号从局域网入口读到 `participant=false globalActive=false remainingMobs=0 searchAdvice=stop_no_active_run` 后退出。由于调试期白名单按用户要求关闭，原本以“未知账号被拒”为成功条件的 `agent-lan-smoke.mjs` 返回 FAIL，此处改用正向 Mineflayer 登录和 `mcstatus` 核验网关。CortiEyeMirror 插件已加载，但本次重启后远端 CortiEye 尚未重连，镜头附身状态需客户端上线后复查。基岩真机玩法仍需现场验证，Pong 仅证明入口应答。完整发布记录见运行机 `E:\MC\ops\MAINTENANCE.md`。

## 大背包快捷物品恢复（2026-10-01）

CortiLan 的随身 36 格全满，Minepacks 的入服补发和原版 `/give` 都不能把快捷头颅放进物品栏；`/give` 的成功回执可能只代表物品落在脚边。先用玩家身份的 `/mycli arena stash putslot 1 64` 转存一组物品，再补发带 `minecraft:custom_name`（“大背包”）和 `minecraft:profile` 专属纹理的头颅，RCON 读回其位于随身槽 1。AgentFriend 0.3.49 新增丢弃拦截及入服、每分钟缺失自愈；满格时把一组物品持久化到本人个人试炼箱后补回，不覆盖装备或丢弃物品。隔离服 `backpack-recovery-stage.mjs` 用 Mineflayer 验证实际丢弃、满格转存、重登和在线定时恢复；发布记录及 E/F 双盘备份见运行机 `E:\MC\ops\MAINTENANCE.md`。

## CortiLan 个人奖励清理（2026-10-01）

CortiLan 在维护期间把大批重复战利品从个人箱移入了随身背包，停服后的最终存档为个人箱 6/54、背包 36/36。按完整物品组件核对后，只回收个人箱的重复星弦 1 件和背包中未装备的重复奖励装备 12 件；保留更好的武器、各类备用装备、已装备护甲、技能罗盘、命格书、法杖和大背包。按现有 `ArenaEconomy.unitPrice` 的材质、附魔和耐久规则记入个人绿宝石余额 95；清理后个人箱 5/54、背包 24/36，待领取队列为空。没有修改奖励生成规则或其他玩家数据。

清理前在 Paper 正常保存退出后取得 E/F 双盘完整快照 `20261001-135526`（两处 `.complete`）；运行机另留原始配置与玩家数据的单文件副本，精确操作记录及一次性脚本在 `E:\MC\ops\MAINTENANCE.md`。现有 `recycle quote/sell` 仅接受玩家身份，控制台不能代执行；此次在停服状态同步更新个人箱、玩家背包和余额，不能在服务器运行时直接覆盖这些文件。重启后 AgentFriend 0.3.48、CortiLan 重连、保留/清除的背包槽、Java、Geyser UDP Pong、女神桥与 Watchdog 均核验通过。CortiEyeMirror 已加载，但截至 14:05 远端 CortiEye 客户端尚未重连，直播镜头仍需在它登录后复查。

14:17 补验：远端 CortiEye 已自动重连，RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。

## 0.3.48 挑战侧翼、商人和游戏日领奖（2026-10-01 已正式发布）

第 11–15 层已在 X=-350、Z=-305 的独立侧翼建成：断桥掩体、浅水与干桥、围住的岩浆、热砖/踏板照明，以及第 15 层星灯主宰。第 10 层保留为中途首领，清怪后 10 秒自动进下一层并补血；第 7 层仍是可提前出发的驿站。新房间仅用原版方块与实体，不增加 Java/基岩客户端模组要求。`/mycli arena layout` 向参赛玩家给当前房间的绝对中心、半径、个人箱位置和危险类型。入口与驿站各有补给商、回收商；原版菜单和既有 `shop/recycle` 机器命令共用个人余额。每名玩家每个游戏日每层最多领一次奖励，重复通关返回私有 `MC_DUNGEON_LOOT category=daily_limit`；`/mycli arena loot` 列出当天已领楼层。第 15 层首通专属武器，后续首领奖励轮换。

隔离服先勘察 X=-430 时发现天然木板而拒绝覆盖，改至 X=-350 后才施工。真实 Mineflayer 跑完十五层，分别从新五层中心算路到个人箱，确认水、岩浆、热砖、踏板和掩体方块；相同游戏日再打第 11 层只收到 `daily_limit`，待领取件数不增加。0.3.47 曾短时发布并建成建筑，整理兼容记录时发现它将成品抗火药水放入第 12 层个人箱，与 0.3.46 已知的 Mineflayer `potion_contents` 解码缺口冲突。立即发布 0.3.48：第 12 层改给岩浆膏，入第 13 层时用原版效果包给予三分钟抗火。隔离服重新实走到第 13 层，Mineflayer 确认真实抗火效果、标准 54 格个人箱可打开且有岩浆膏、无成品药水。此前女巫装备包偶发的客户端解析警告仍存在，但未导致这次测试断线或开箱失败；远端 CortiLan 的自主战斗尚未端到端验收。

0.3.47 发布前 E/F 双盘快照 `20261001-132330`，正式世界勘察和一次性施工后 E/F 双盘快照 `20261001-132509`；0.3.48 修正前再次正常停服备份，E/F 双盘快照 `20261001-133623`。三次 `Afu-MC-DailyBackup` S4U 任务结果均为 0，两盘 `.complete` 存在，维护暂停标记清除。正式服唯一启用 `AgentFriend-0.3.48.jar`，279097 字节，SHA256 `18BD55AB50109FE87E16F23EC2BF3A68494FCC4F1A142A59C8A1C461CCBBD433`。正式 Mineflayer 临时账号验证 `maxFloor=15` 与入口购买菜单后已移出白名单；Java、Geyser UDP Pong、女神桥、Watchdog 正常，最近一分钟 MSPT 平均约 5.9 ms。CortiEye 已重连，RCON 回 `camera=online attached=true cameraNightVision=true`。基岩真机的商人菜单与新房间画面需用户实际体验，Pong 不能代替手柄验收。

回退 JAR 前须检查无活动试炼。仅回退到 0.3.47 会重新引入成品药水奖励；回退到 0.3.46 则不认识第 11–15 层的保护与领奖账本，**不可只换旧 JAR 后继续在新侧翼游玩**。如需世界级回退，应在无人游玩时将世界、插件配置、玩家进度作为一组从 `20261001-132330` 恢复，并明示该时间之后的进度将回退；平常保留 0.3.48，优先做前进式修复。

## 0.3.46 试炼身份回执与前层补给（2026-10-01 已正式发布）

`/mycli status` 和 `/mycli arena status` 现把本人 `participant` 与全服试炼状态分开；机器行 `MC_DUNGEON status` 带 `selfState/globalActive/globalState/globalFloor/maxFloor`，活动楼层坐标附 `scope=global`。隔离服两名 Mineflayer 1.20.6 账号分别在塔内和村庄时，两条命令均给参赛者 `participant=true`、未参赛者 `participant=false`；两者看到同一全服楼层，村庄账号仍显示“本人未参赛”。正式服重启后全新账号在两条命令中收到 `participant=false globalActive=false`，入口坐标标记 `scope=public`。

前三层保底材料、金苹果、酿药材料与弓箭，随机额外奖励也限制为材料和消耗品；铁甲保底移至第四、五、八、九层，钻石套装及首领轮换保持。曾尝试直接给成品药水：隔离服十层结算成功，但 Mineflayer 1.20.6 无法解码个人箱的 `potion_contents`，箱子打不开，故最终版改为可正常读取的金苹果、闪烁的西瓜片和河豚。最终候选再跑十层，Agent 逐层读到补给和六件装备，打开 22 格个人箱，钻石套装进度 2，结果 PASS。原有女巫手持药水 `entity_equipment` 偶发解析警告仍存在，本次没有妨碍领奖。规则见 [试炼塔奖励](ARENA_LOOT.md)。

发布前 CortiLan 的上一轮试炼在第七层休息站；等待其自然打完并确认 `dungeon-active-run` 清空后，仅 Goddess、CortiLan、CortiEye 服务账号在线。S4U `Afu-MC-DailyBackup` 正常停服，E/F 两盘 `20261001-124407` 快照均有 `.complete`、任务结果 0，只启用 `AgentFriend-0.3.46.jar`（273525 字节，SHA256 `5E3F607014D171A38683E2C1BDA3F9F8223DDE947810E6A8B7D8CA59B884AC13`）。RCON 读回 0.3.46；Java 状态、Agent LAN 网关、Geyser 基岩 Pong、Goddess 桥和 Watchdog 正常，待发布/自动恢复暂停标记不存在。CortiEyeMirror 服务端已加载，但远端 CortiEye 到 12:49 仍未重连，RCON 为 `camera=offline attached=false`；直播镜头需远端客户端重新上线后再核验 `attached=true` 和夜视。基岩真机的奖励显示与手柄开箱仍待现场验收。

## 0.3.45 试炼塔装备回收、套装保底与奖励轮换（2026-10-01 已正式发布）

0.3.44 的第七层私有回收、余额商店与怪物友伤防护一并随 0.3.45 发布。新奖励在前四层保底附魔铁甲，第六和第十层按玩家进度轮换钻石甲；随机池覆盖所有护甲部位及武器、工具、稀有补给，重复首领战轮换宝藏。`/mycli arena loot` 返回本人下件钻石甲与排队量。规则和经济接口分别见 [奖励设计](ARENA_LOOT.md)、[第七层回收与补给](ARENA_ECONOMY.md)。隔离服同 UUID 两次十层挑战、满 128 件队列后第八层保底装备、重复铁盔回收与专属武器保护均通过。Mineflayer 偶发解析警告已定位为女巫原版药水的 `entity_equipment` 包，不是奖励 ItemStack；这项客户端兼容缺口另行处理。

维护脚本同步修复了 `minecraft:list` 的 `[Agent]` 显示前缀导致真实账号名单解析失败的问题，改读 `minecraft:list uuids`；真实三服务账号和模拟 `.MicroKQ` 真人准入门均通过。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线，第十层活动试炼已经结束，配置没有 `dungeon-active-run`。现有 S4U `Afu-MC-DailyBackup` 正常停服、生成 E/F 两盘 `20261001-121106` `.complete` 快照，任务结果 0，并把唯一启用 JAR 从 0.3.43 切至 `AgentFriend-0.3.45.jar`，SHA256 `EAA258298A00F379C7E088E47AEC492D2825694DDA9ECB198E68A4CBA36DD0B1`。RCON 读回 0.3.45；Java、Agent LAN 网关、Geyser 基岩 Pong、Goddess 桥与 Watchdog 通过，临时调试白名单仍关闭；待发布标记和自动恢复暂停标记均不存在。CortiEyeMirror 服务端已加载，远端 CortiEye 客户端在 12:13 的首次复查仍未上线，直播镜头需其重连后用 `cortieye` 核验 `attached=true` 和夜视。基岩真机奖励名称与手柄菜单尚需实际游玩确认。

## 0.3.43 玩家头顶 Agent 标签（2026-10-01 已正式发布）

通过原版 scoreboard team prefix 给 CortiLan、Kirito、Naruto、corti 按 UUID 显示简短的 `[Agent]` 头顶标签；普通玩家、Goddess 与摄像机账号不加。不会替换玩家的 scoreboard 或夺走其他插件已分配的队伍。配置和多端限制见 [玩家头顶标签](PLAYER_NAMETAGS.md)。隔离服 25566 用全新 Agent/普通 Mineflayer 账号收到原版 `teams` 前缀和成员包，普通玩家不在队伍；隔离服已恢复原 JAR 与配置并停机。

正式服发布前只有 CortiLan 与 Goddess 在线，配置没有活动试炼检查点。`Afu-MC-DailyBackup` 正常停服并生成 E/F 双盘 `.complete` 快照 `20261001-090029`，任务结果 0，唯一启用 `AgentFriend-0.3.43.jar` 的 SHA256 为 `D5E470232DB3AACE8994E3254D2C9E85D92E0D7918579809377310ABCDBE4D3B`。重启后 RCON 读回 0.3.43；临时白名单 Mineflayer 普通玩家收到 CortiLan 的前缀和成员包，自己未进入 Agent 队伍，随后退出并移出白名单。Java、Geyser 基岩 Pong、Agent LAN 网关、Goddess 桥、CortiEye 附身/夜视及 Watchdog 正常，自动恢复暂停标记不存在。基岩真机的标签位置、颜色和中文字体仍待玩家画面验收；Pong 不能替代此项。

## 0.3.42 保护查询独占插件消息（2026-10-01 已正式发布）

`/mycli protect break|place <x> <y> <z>` 保留原判定与 JSON 字段，`deny`、`unknown`、`allow_likely` 只通过请求玩家连接的 `mcagent:protection` UTF-8 JSON custom payload 返回；不发 `MC_PROTECT` 系统聊天、广播、动作栏或标题。0.3.41 曾只删除聊天副本，但正式 CortiLan 的 `getListeningPluginChannels()` 为 `registered=false`，Paper 的 `sendPluginMessage` 会静默跳过这类连接。0.3.42 对已注册连接继续用 Bukkit API，对未注册连接复用 Paper 1.20.6 原生 `ClientboundCustomPayloadPacket`/`DiscardedPayload` 编码发送同一频道与原始 JSON；这个分支与服务端版本绑定，将来升级 Paper 须重新验证。控制台只读 `/mycli admin protectchannel <在线玩家>` 可查询注册状态，不向玩家发消息。

隔离服 `protection-channel-stage.mjs` 用干净角色数据模拟未注册的 CortiLan、未注册的 CortiEye 和已注册的普通玩家，收到状态 `deny/unknown/allow_likely` 各一次；普通玩家自己的回执不泄给 CortiLan，CortiEye 负载 0，三个聊天流均无 `MC_PROTECT`。旧隔离角色数据单文件备份后已恢复。发布前只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼；S4U 维护任务先正常停服，E/F 双盘 `20261001-084034` 均有 `.complete`，结果 0。正式服只启用 `AgentFriend-0.3.42.jar`（SHA256 `AF9E0D3334143D63300D6249D16A4F0E49BCD67CBF0F07BA9DCD4D268C0F658E`）；`paper/probe/protection-live-smoke.mjs` 让未注册的临时 Mineflayer 玩家在正式服收到建筑拒绝、道路拒绝、未知及户外可能允许四条 payload，聊天副本 0，临时白名单已撤。Java、Geyser Pong、Agent LAN 网关、女神桥和自动恢复正常。真实 CortiLan 仍未注册频道，协议层的未注册路径已验证，但其 192.168.3.152 运行程序是否把 `custom_payload` 交给决策层，服主机无法直接观测；不能声称这一层已端到端验收。CortiEyeMirror 插件加载，远端 CortiEye 在发布后首次复查尚未上线。

## 0.3.40 命格书与技能罗盘防丢（2026-10-01 已正式发布）

AgentFriend 标记的技能罗盘和命格书会拦截玩家丢弃事件，同类型普通物品照常可丢。命格书打开时按玩家本人实时写入生命、魔力、原版经验等级、击败怪物/玩家数、死亡次数、AuraSkills 部分技能等级及八项法术熟练度；公会页前移到战绩之后，保留本人冒险者等级、声望、完成单数、当前任务进度。当前没有自由属性点，书中只说明实际存在的自动经验成长和成功施法熟练度。改动没有新权限、配置或客户端协议要求。

隔离服 25566 用 `book-compass-stage.mjs` 验证带标记与普通物品的丢弃差异、客户端成书组件、打开时经验等级刷新；`journey-guide-stage.mjs` 验证罗盘到指南、地点、公会菜单及重新登录。发布前仅 CortiLan、Goddess 两个服务账号在线，`dungeon-active-run` 不存在；S4U `Afu-MC-DailyBackup` 先正常停服备份，再启用唯一 `AgentFriend-0.3.40.jar`（SHA256 `977DABA5C58AA998378800B43B6DAB97F0CEBDE782996092675ABC253337101D`）。E/F 双盘 `20261001-072303` 都有 `.complete`，任务结果 0；Java、Geyser UDP Pong、Agent LAN 网关、女神桥及自动恢复正常。旧 `0.3.39` JAR 留在服务端目录并禁用，可按现有无人游玩备份发布流程回退；CortiEyeMirror 服务端载入，但远端观战客户端本轮未联机验证。基岩真机的丢弃手势与书页显示仍待现场验收。

## 0.3.39 个人奖励箱扩为 54 格（2026-10-01 已正式发布）

CortiLan 的原 27 格个人箱与 36 格随身背包都已占满；绿宝石堆为 64，木棍没有可合并的箱格，所以普通存入与待入箱奖励都无法继续。试炼、公会和 `/mycli arena rewards|stash` 共用的虚拟箱改为原版 54 格双箱界面，实体入口方块和各玩家 UUID 不变。旧槽位 0–26 原样保留，新增槽位 27–53；`stash list` 和 `stash take` 的范围同步更新。奖励队列继续保留溢出，不直接改玩家背包。

隔离服 `dungeon-standard-chest-stage.mjs` 通过双人 UUID 隔离、标准 Mineflayer `openContainer`/`deposit`/`withdraw`、试炼及公会奖励、重启持久化；正式服临时 Mineflayer 玩家再次验证 54 格标准存取，随后移出白名单。发布前仅 CortiLan、CortiEye、Goddess 三个服务账号在线，没有活动试炼。S4U 备份任务结果 0，E/F 双盘快照 `20261001-070657` 都有 `.complete`，唯一启用的 `AgentFriend-0.3.39.jar` SHA256 为 `3C626FBAE538A6F922185EC3C1C8C60D101C817D94E0E2C36E31D1DF56104C02`。正式服 CortiLan 旧 27 格仍在；以其玩家身份重新开箱后占用 36/54，原待入箱的铁锭、绿宝石、箭均归零。Java、基岩 Pong、LAN Agent 网关、女神桥和自动恢复正常。CortiEyeMirror 服务端已加载，远端 CortiEye 在首次重查时尚未重连，直播镜头需另查 `cortieye`。

## 0.3.38 Agent 低频游玩提醒（2026-10-01 已正式发布）

新增 `/mycli coach status|on|off` 个人开关和只发本人的 `MC_COACH` JSON 系统聊天。Java/Mineflayer 默认开启、Floodgate 基岩默认关闭，旁观者不提醒；默认 30 分钟内死亡 3 次、15 分钟闲置、活跃游玩 45 分钟未用 `/mycli` 触发相应建议，三类提醒共享 30 分钟冷却。不会自动施法、传送或给物品。规则、配置、玩家 PDC 与客户端解析见 [Agent 游玩提醒](AGENT_COACH.md)。

隔离服 25566 将门槛临时缩为数秒、死亡阈值设为 2；`agent-coach-stage.mjs` 用真实 Mineflayer 1.20.6 账号验证个人开关、闲置只发一次、两次死亡后复活提示、持续活动但久未用 `/mycli` 提示、`list/explain coach` 和结构化错误码，结果 PASS。测试结束已恢复隔离服原配置与出生点并正常停机。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线、无活动试炼，自动恢复未暂停；S4U `Afu-MC-DailyBackup` 正常停服，E/F 双盘快照 `20261001-024036` 均有 `.complete`，任务结果 0。只启用 `AgentFriend-0.3.38.jar`，SHA256 `70B4CD8CCC585250836FB3E4BB5F0C367CB1B488DBC7AD733912CA80A608F07B`。正式服临时白名单 Mineflayer 账号核验生产默认门槛、`off` 跨重登保存和 `on` 恢复，随后移出白名单。Java、LAN Agent 网关、基岩 Pong、Goddess 桥、Watchdog 与 CortiEye 观战附身、夜视均正常；基岩真机手动打开提醒时的聊天渲染仍需玩家体验验收，152 上 CortiLan 客户端收集系统聊天的端到端链路也未在此轮直接验证。

## 0.3.37 Agent CLI 自发现（2026-10-01 已正式发布）

玩家命令新增 `/mycli list [分类|命令|all] [页码]`、`/mycli explain <ID>`，以及 `/mycli help <ID>` 别名。每页最多七项，`MC_CLI_LIST`、`MC_CLI_ITEM`、`MC_CLI_DETAIL`、`MC_CLI_ERROR` 是只发给发令玩家的系统聊天 JSON；`list` 和 `explain` 不施法、不传送、不操作物品。目录不包含控制台 `admin` 命令。Agent 用法与字段见 [Agent CLI 指南](MYCLI_AGENT_CLI.md)。现有手柄菜单和 Java、基岩、Mineflayer 原版命令兼容。

隔离服 25566 `mycli-catalog-stage.mjs` 实测 21 项顶层命令、18 项 `cast` 子命令的分页、点号/空格两种解释方式、未知 ID/坏页码错误码，以及查询前后生命、位置、背包一致。正式服发布前只有 CortiLan、CortiEye、Goddess 服务账号在线，没有活动试炼，自动恢复未暂停。S4U `Afu-MC-DailyBackup` 正常停服，E/F 双盘完整快照 `20261001-021354` 均有 `.complete`，任务结果 0，正式服仅启用 `AgentFriend-0.3.37.jar`，SHA256 `BC861D64563C1E036A89DA8600D326BF864F1CEE3594648BFA6E82AC410436DF`。正式服临时白名单 Mineflayer 1.20.6 玩家再次通过同一契约测试，已移出白名单；Java、LAN 网关、Geyser 基岩 Pong、Goddess 桥正常。CortiEyeMirror 已载入，但 02:15 远端 CortiEye 客户端仍未重连，`camera=offline`；附身状态待恢复后补记。基岩真人聊天渲染也待手柄玩家实际验证；Pong 仅证明 UDP 入口。

## 0.3.36 法术分类与熟练度（2026-10-01 已正式发布）

八项 AgentFriend 法术增加按 UUID 保存的个人熟练度：成功施放 8/24 次到 2/3 级；战斗伤害及控制时长、探索持续/感知范围、探矿标记时长有界成长。AuraSkills 战斗等级最多给战斗法术 +2 伤害，既有统一魔力、挖矿半径、公会声望、女神学习和 MagicSpells 生活法术保持独立。罗盘「技能成长」是 27 格原版菜单，命格书有短引导；Agent 用 `/mycli mastery` 取 `MC_MASTERY`，通用 `mcviewer:state` 仍只发本人能力等级。规则和未升级的类别见 [技能体系](SKILL_SYSTEM.md)。玩家进度在 `plugins/AgentFriend/spell-mastery.yml`，旧 JAR 回退时须保留这份文件。

隔离服 25566 用 Mineflayer 测过无目标不计数、第 8 次升级、按 UUID 隔离、菜单、状态包、JVM 重启后等级和实际伤害比例；原 `viewer-state-stage.mjs`、`utility-spells-stage.mjs` 回归通过。只在隔离服临时提高魔力回复做连续施放，随后恢复原 `stats.yml`。正式服发布前只有 Goddess、CortiLan、CortiEye 服务账号在线，无活动地下城；S4U 备份任务结果 0，E/F 快照 `20261001-014541` 均有 `.complete`，单一 JAR SHA256 `4BE39B3DA73E31525437C47BF15B497FFA1F2CAC5AB292226424C9A671C93504`。

首次启动遇到 Minecraft 官方发现服务一次 TLS 握手中断，Geyser 未监听 UDP；Java 仍正常。既有 Watchdog 连续三次探测失败且确认无真人后，于 01:49 自动正常重启一次，01:50 基岩 Pong 恢复，恢复标记清除，Watchdog 结果 0。独立 Java HTTPS 请求得到 200，未改 Geyser 或网络配置。正式服临时白名单 Mineflayer 实测 8 条个人熟练度、罗盘入口和本人 `mcviewer:state`，随后移出白名单；Java、LAN Agent 网关、女神桥、基岩 Pong 正常，最近一分钟 MSPT 平均约 7.1 ms。CortiEye 客户端稍后自动重连，01:58 RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。基岩真人尚未测试新菜单与光效；CortiEye 客户端的实际技能画面也尚未目视验收。

## 0.3.35 导航回执绝对坐标（2026-10-01 已正式发布）

`/mycli waypoint` 现在按本人列出公共 warp、试炼场、私人 home 的 `MC_WAYPOINT id=... dimension=... x=... y=... z=...`；`goto` 的 Essentials 地点返回 `MC_DESTINATION` **目标**坐标，真正抵达以客户端位置为准。`locate list|nearest|<玩家>` 返回 `MC_PLAYER`，追踪条继续保留方向/距离并刷新目标绝对坐标；探敌术最多给出五个最近怪物的 `MC_HOSTILE` 坐标；遗迹远征 `MC_SITE` 返回实际安全落点 x/y/z 与仅有水平精度的遗迹中心 X/Z。试炼状态和死亡领箱提示带维度、入口及箱子坐标，公会/试炼场/队友传送成功回实际落点。消息仅发给操作玩家，均走原版聊天或 BossBar；探矿和保护查询原有绝对坐标保持不变。移动目标坐标是快照，Agent 算路前须重查。

隔离服 25566 上 `absolute-location-stage.mjs` 以两名 Mineflayer 1.20.6 玩家验过队友、Essentials 公共和私人地点、探敌、试炼入口、遗迹安全落点与公会抵达，结果 PASS。隔离世界旧出生点会触发传送并把测试玩家移回，脚本临时设置远处安全平台和出生点，结束时恢复；该问题是测试场地，不作为正式服故障。正式服 0.3.35 JAR SHA256 `7A8AEBC489E03943E85E6C47037E97A6D454C31B1EF273D9A0534DC5CB40C5D4`。发布前只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼；S4U 维护任务正常停服、生成 E/F 双盘 `.complete` 快照 `20261001-005202`、发布单一 JAR 并重启，任务结果 0，Watchdog 未暂停。正式服临时白名单 Mineflayer 1.20.6 账号实测 `MC_WAYPOINT`、`MC_PLAYER`、`MC_DUNGEON` 后退出并移出白名单。Java 127.0.0.1、Agent LAN 网关、基岩 Pong、女神桥正常。CortiEye 最初未立即重连，01:00 后已重新上线；RCON `cortieye` 回 `camera=online attached=true cameraNightVision=true`，镜头重新附身 CortiLan。

## 0.3.34 地下城普通个人箱（已正式发布）

试炼塔实体箱、公会看板和 `/mycli arena rewards|stash` 指向同一个按 UUID 隔离的 27 格普通箱子。Mineflayer 使用实体箱的 `openContainer`、`deposit`、`withdraw`；Java 与基岩玩家使用原版箱子菜单。试炼、公会奖励先记入原 `dungeon-rewards`、`dungeon-bonus-items` 队列，下次开箱时移入 `dungeon-personal-stash`，保留附魔等 ItemStack 元数据；箱满时剩余部分继续留在队列，腾格后重开自动补入。`rewards list|take` 仅用于箱满后的待入箱物品，`stash inventory|list|put|putslot|take` 是远程辅助操作。回退 0.3.33 会暂时失去私人箱入口，但保留完整 `config.yml` 后重发 0.3.34 可恢复箱内与待入箱数据；不可用旧版运行配置覆盖现有数据。

隔离服 25566 的 `dungeon-standard-chest-stage.mjs` 用两名 Mineflayer 1.20.6 玩家验证实体箱连续开箱、标准 `deposit`/`withdraw`、UUID 隔离、首层与公会奖励自动入箱；以同一玩家账号跨 JVM 重启再次通过取物验证。测试后隔离服已正常停机。正式 JAR SHA256 为 `B82F4E3AE65ABE4A99F2969638553E5701564127F8F9421580C5F2FA3B0181CB`。2026-09-30 23:53，确认无真人玩家、无活动试炼后触发既有 S4U 备份发布任务，E/F 快照 `20260930-235317` 均有 `.complete`，任务结果 0；正式服只启用 0.3.34 JAR。Java、Geyser 基岩 Pong、LAN Agent 网关、女神桥及 Watchdog 检查通过。临时白名单 Mineflayer 1.20.6 账号在正式服用入口实体箱完成标准 `openContainer`、`deposit`、`withdraw`、重开与取物，随后退出并移出白名单。基岩真机手柄箱菜单仍须人工验收。CortiEyeMirror 已加载，但远端 CortiEye 客户端重启后尚未重新登录，`cortieye` 显示 `camera=offline`；直播镜头要待 152 上客户端恢复后复验，不能把插件加载视作镜头已恢复。

实体箱通过原版容器协议交互，不依赖 Agent 读取指令回执。作为辅助入口，服务端仍只把 `MC_REWARD`、`MC_STASH` 等回执发给本人连接。CortiLan 当前经 `192.168.3.152` 连入，服主机的 `E:\Cortico` 源码副本不是其运行实例；这个副本已在本地提交“斜杠命令收集系统聊天回执”的改动，类型检查与 4702 项测试通过，真实 1.20.6 协议也确认回复为 `system` 消息。运行在 152 的 Cortico 尚未更新，不能把本机源码测试等同于 CortiLan 端到端验收。`paper/probe/stash-live-smoke.mjs` 用临时白名单 Mineflayer 玩家在正式服核对服务器接口。

## 0.3.33 Agent 保护预检（已正式发布）

`/mycli protect break|place <x> <y> <z>` 按发命令的玩家身份查询 16 格内已加载目标；自 0.3.41 起，`deny`、`unknown`、`allow_likely` 结果只通过本人的 `mcagent:protection` 原始 UTF-8 JSON plugin message 返回，不再发送 `MC_PROTECT` 聊天副本。0.3.42 进一步为未注册频道的连接直发同种原生包，避免 Paper API 静默跳过真实 CortiLan。结果覆盖 WorldGuard、村屋原始方块、公会大厅、公共道路、试炼场和十层地下城。Agent 行为见 [接入说明](AGENT_PROTECTION.md)；实际方块事件仍是最终拦截。查询不返回方块材质，防止变成探矿旁路。

隔离服 25566 用真实 Mineflayer 1.20.6 验证：原村屋方块返回 `village_structure/deny`，村庄户外方块返回 `no_known_protection/allow_likely`，试炼塔返回 `dungeon/deny`，公共道路方块与道路净空的放置返回 `trial_road/deny`，远距离返回 `unknown_out_of_range/unknown`；聊天和插件消息一致，另一玩家连接没有收到查询结果。放置事件仍取被替换方块的旧状态；该逻辑用前一构建复测通过，随后只增加 `/mycli guide explore` 的 Agent 提示并重新编译，最终 SHA256 `958239948751A4FA0908A19DA71A1190E57BEE821BFD733F8723A5F107D936DB`。隔离服已停并恢复原 AgentFriend 0.3.31 JAR。

2026-09-30 首次检查正式服时 `.MicroKQ` 仍在线，因此当时没有重启。将 0.3.33 候选按哈希复制到 `E:\minecraft-ai-friend\paper\plugins\AgentFriend\`，把原 0.3.32 待发布计划替换为包含探矿坐标与保护查询的 0.3.33；旧版预期哈希仍是当时的生产 0.3.30。下面记录实际发布与复测。

2026-09-30 18:21，仅 Goddess、CortiLan、CortiEye 服务账号在线且无活动试炼，触发既有 `Afu-MC-DailyBackup` S4U 任务。正常停服快照 `20260930-182118` 在 E/F 两盘均有 `.complete`，任务结果为 0；计划中原 0.3.30 哈希与 0.3.33 候选哈希校验后，只启用 `AgentFriend-0.3.33.jar`，待发布文件已清除。RCON 确认版本 0.3.33；Java 状态、LAN Agent 网关的未授权身份拒绝、Geyser 基岩 Pong、Goddess 桥、CortiEyeMirror 载入与重新附身、Watchdog 未暂停均正常。最近一分钟 MSPT 平均约 5.2 ms。正式服临时白名单 Mineflayer 1.20.6 账号按本人连接查询，村屋返回 `village_structure/deny`，道路净空返回 `trial_road/deny`，户外返回 `allow_likely`；聊天与 `mcagent:protection` 原始 JSON 一致，账号随后退出并移除白名单。基岩真机此轮未入服，Pong 只证明网络入口。Cortico 自动挖掘代码尚未接入预检，不得声称它已经自动避让。

这台主机的普通交互式 PowerShell 会在停止 S4U 启动的 Agent 网关进程时收到“Access is denied”；这次直接运行 `manage-server.ps1 Backup` 在停服前失败并恢复了 Goddess，未创建快照或部署。随后通过 `Start-ScheduledTask -TaskName Afu-MC-DailyBackup` 执行同一维护脚本，成功完成备份、发布、重启和镜像。以后需要立即发布时，先确认无真人玩家、无活动试炼，再触发该任务并检查 `Get-ScheduledTaskInfo` 的结果、`manage-server.log` 和两处 `.complete`；不要强杀网关或绕过备份。若需回退，仅在无人游玩且无活动试炼时，正常停服，禁用 0.3.33、启用备份中的 0.3.30 JAR，再启动并复测；旧版不提供绝对探矿坐标或保护预检，不要直接恢复旧世界覆盖后续玩家进度。

此文档描述源码分支与当前 Windows 家服的关系。仓库是代码及配置基线；正式存档和玩家状态只保存在 `E:\MC\server` 以及已校验备份中。完整本机维护记录仍在 `E:\MC\ops\MAINTENANCE.md`。

## 0.3.32 探矿返回绝对坐标（已并入正式服 0.3.33）

探矿成功时只向施法者发送 `dimension=minecraft:overworld X=317 Y=115 Z=17 ore=minecraft:diamond_ore` 形式的聊天结果；坐标是矿块整数坐标，负坐标和下界使用同样的字段。BossBar 改为显示同一组绝对 X/Y/Z，原来的相对方向/距离不再需要 Agent 推算。矿块描边、基岩墙面光框、Paper 反透视、6 魔力与 30 秒冷却均不改。`prospecting-stage.mjs` 用 Mineflayer 1.20.6 实测了密封矿石仍隐藏、成功聊天与顶栏坐标一致、空搜索不扣魔力和冷却；`focus-outline-stage.mjs` 验证施法者独享描边及旧法杖治疗功能，两项均通过。最终候选 `AgentFriend-0.3.32.jar` SHA256 为 `89755A8D163DECCE9CD9DD733B82BA504F846B28E73F4EAD8FDF5B4BC18EFF20`。

2026-09-30 检查正式服时，真人 `.MicroKQ` 在线且正在试炼塔第八层，因此当时没有重启或替换正式服。随后 0.3.32 的待发布计划被包含本功能与保护预检的 0.3.33 取代；正式服现已运行 0.3.33，上述旧候选哈希仅供追溯。

## 日常检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Status
node E:\MC\probe\rcon.mjs mspt
node E:\MC\probe\agent-lan-smoke.mjs
node E:\MC\bedrock-ping.mjs 192.168.3.163 19132
```

`Status` 应同时显示 Paper、Agent 网关、Geyser Pong、Goddess 桥、CortiEyeMirror、最近 E 盘快照及 F 盘镜像。Pong 和状态包不是基岩真机、Agent 具体动作或直播画面的端到端验收。

## 0.3.30 玩家与 Agent 旅途指引（2026-09-30）

新玩家首次入服得到一次短提示：手持技能罗盘按使用键，从「旅途指南」开始；手柄无须打字，命格书可用页面箭头阅读。提示状态存在玩家 PDC，重连不重复刷屏。旧玩家下一次上线也会收到一次入口提示。原有命格书每次使用都会按当前血量、魔力和挖矿等级重建，书页改为从“开局三步”到手柄、探索、魔法、道具刻印、公会、试炼塔和奖励的短章节。书页不使用聊天点击事件，保持 Java/基岩原版书本可读。

技能罗盘新增「旅途指南」图标，打开 27 格原版容器菜单；选章节直接进入现有地点、公会、队友或技能菜单，命格书章节发真实 `open_book` 包。刻印章节在玩家手持合适工具且靠近附魔台时直接进入刻印菜单，否则发简短操作提示。没有新增必须输入的玩家指令。Agent 用 `/mycli guide` 或 `/mycli guide start|explore|magic|gear|guild|dungeon|team` 获取与菜单对应的精确 `/mycli` 操作，包括公会接单/交付和入口个人奖励箱；`/mycli guide menu` 也能打开相同菜单。

隔离服 `journey-guide-stage.mjs` 以 Mineflayer 1.20.6 验证书本原始物品同步含手柄、试炼和 Agent 章节；罗盘 → 旅途指南 → 地点/公会的真实菜单流、书本打开包、Agent 指令返回及重连不重复欢迎提示。`imprint-prospect-stage.mjs`、`focus-outline-stage.mjs` 复测工具刻印和旧法杖。发布只替换 AgentFriend，不改世界结构、代理或第三方插件；基岩真机的书本排版和手柄按钮仍需游玩时目视验收。

2026-09-30 11:39，仅服务账号在线且无活动试炼时，由 S4U 备份任务正常停服并生成 `E:\MC\backups\scheduled\20260930-113952`，校验候选与原 JAR 哈希后启用唯一 `AgentFriend-0.3.30.jar`（206148 字节；SHA256 `96fac10b4c7f9b4fd519d20292bfb61dee37c7361fa5bd6ea88cc5713a51b7d4`）。同名 F 盘镜像与本地均有 `.complete`。正式服 RCON 确认版本 0.3.30；Java 状态、Agent LAN 网关白名单拒绝探针、Geyser 基岩 Pong、Goddess 桥、CortiEyeMirror 和 Watchdog 未暂停均正常。回退时在无人游玩、无活动试炼时正常停服，禁用 0.3.30，启用保留的 0.3.29；命格书和入门标记在玩家数据中，回退前留完整快照。

## 0.3.29 探矿成长与附魔台刻印（2026-09-30）

探矿基础半径为 24 格；AuraSkills 挖矿等级每 5 级增加 2 格，等级加成为 16 格封顶。手持刻有探矿术的工具再加 8 格，最高 48 格。扫描只查询已加载区块，并从近到远搜索；无目标不扣魔力或进入技能冷却，失败尝试至少间隔 5 秒。反透视仍由 Paper 保持，真实矿物位置只在探矿成功时通过施法者自己的 BossBar、描边和粒子提示。矿物冷却与 6 魔力消耗不变。

玩家手持镐、剑、斧、铲、锄、弓、盾、望远镜等原版工具，在附魔台 4 格内潜行使用附魔台即可打开原版容器菜单，选择法术刻印；普通右键仍打开原生附魔界面。每件物品一次保存一个法术 ID；再次选择可改刻印。生存模式每次消耗 3 原版经验等级和 1 青金石，创造模式免费。刻印保存在物品 PDC，客户端可见说明和附魔光效；已有原版附魔与旧说明保留。潜行使用该物品会以本人身份走同一 `/mycli cast` 路径，因此学习条件、魔力、目标选择和技能冷却仍有效。Agent 在同样的附魔台距离内可用 `/mycli imprint <技能ID>`，并可直接 `/mycli cast <技能ID>`；`/mycli imprint list` 列出可刻印技能。这个“法术刻印”是服务端实现，不占用原版附魔注册表，避免要求基岩或 Mineflayer 安装客户端模组。

隔离服 25566 的 `imprint-prospect-stage.mjs` 使用真实 Mineflayer 1.20.6 客户端验证：未刻印 24 格找不到 26 格外的密封钻石；镐刻印后范围 32 格并能找到；AuraSkills 挖矿等级设为 25 后 `/mycli status` 显示 42 格；附魔台 54 格菜单刻印剑上治疗术并对受伤者实际治疗；经验与青金石各正确扣减，物品原始同步数据包含 PDC 和说明。`prospecting-stage.mjs` 复测原始区块反透视、无目标不扣魔力、BossBar、粒子和冷却；`focus-outline-stage.mjs` 复测旧法杖、只给施法者的矿物描边和治疗。Java/Agent 使用原版协议；基岩客户端仍须真人核对刻印菜单与手柄“潜行使用”的手感。

正式服仅服务账号在线、无活动试炼时，由现有 S4U 备份任务发布唯一启用的 `AgentFriend-0.3.29.jar`（202965 字节；SHA256 `75883b3ff3da16ab40c8b638f82f5e50b71587ec226a177a0d433df5a4ca4145`）。发布前快照 `20260930-112231`、发布后快照 `20260930-112457` 均完成 E/F 双盘镜像；后者两盘 `.complete` 且都包含 0.3.29。正式服 RCON 版本、Java 状态、Agent LAN 白名单拒绝测试、基岩 Geyser Pong、女神桥和 CortiEyeMirror 均通过。若回退，先确认无人游玩与无活动试炼，正常停服，将 0.3.29 禁用并启用保留的 0.3.28 JAR；物品上的刻印 PDC 不应丢弃，回退期间只是不会施法。

自动恢复收尾：交互终端读取不到 S4U Session 0 网关的命令行，旧 `Start` 因此误报“unexpected process”，而 Watchdog 被旧 `auto-start.paused` 暂停。网关新增只绑定 `127.0.0.1:25577` 的只读进程身份端口；维护脚本优先验证原有进程路径，遇到 Windows 跨会话隐藏路径时要求身份端口与 LAN 监听同 PID、且返回精确 PID。2026-09-30 11:25 通过完整备份重启了新网关，`Start` 标准流程确认服务已运行并清除暂停标记；手动触发 Watchdog 后任务结果为 0、状态 Ready，`Status` 显示 `Auto-start paused: False`、基岩与网关可用。身份端口只在本机，不新增公网映射。旧脚本保留在运行目录 `manage-server.before-gateway-identity-20260930.ps1` 与 `agent-lan-gateway.before-identity-20260930.mjs`。

## 0.3.28 深层试炼塔扩建（2026-09-30）

第七层为休息驿站，第八、九层为扩大后的战斗房，第十层为“深渊守卫”首领房。玩家通关第六层后可在地点罗盘或 `/mycli arena rest` 直达驿站；站内工作台、商人和个人奖励箱均为原版界面。商人菜单与 Mineflayer 的 1.20.6 交易包须在隔离服实测；基岩真机及直播显示另做上线体验验收。第八层起奖励增加，第十层保底专属附魔武器。旧塔下方的自然结构不动，新分区位于 `-510,-305`，楼层之间靠原有自动传送连接。

隔离服 `mycli admin surveydeep` 通过后一次建成四层。`plugins/AgentFriend/dungeon-deep-stage.mjs` 用 Mineflayer 1.20.6 跑通前六层、第七层工位和商人包、第八至十层自动推进、首领血条、保底钻石与个人箱前排的专属武器；`dungeon-rest-stage.mjs` 在冷却和重启后验证罗盘直达、持久检查点及面对面原版商人界面六条交易。商人的普通右键测试需要切开玩家初始背包所在的快捷栏第 1 格，以免背包插件接管交互。最终候选 JAR SHA256 为 `E6B6E3B017DD432A94D9F58376BF69894D6E604489EBAB8BB11212EDFA71C2E8`。

2026-09-30 10:56 在仅服务账号在线、无活动试炼时，现有备份任务生成施工前 `E:\MC\backups\scheduled\20260930-105658` 与同名 F 盘镜像，启用唯一 0.3.28 JAR 并重启。正式服 `mycli admin surveydeep` 再次通过后，执行一次 `mycli admin builddeep`，配置显示 `dungeon-expanded: true` 且再次运行勘察会拒绝覆盖。10:59 的施工后完整备份为 `20260930-105935`，E/F 两处 `.complete` 存在，`world/level.dat`、AgentFriend 配置和 JAR 的 SHA256 两盘一致。上线后 `version AgentFriend`、Paper 状态、Agent LAN 白名单探针、基岩 UDP Pong、Goddess 桥和 CortiEyeMirror 均通过；实际基岩手柄交易与直播画面需玩家体验。`auto-start.paused` 仍存在，Watchdog 暂停，见下方维护说明。

施工命令会拒绝容器、结构、活跃挑战及重复施工；若施工中断，停止使用该区域并从施工前完整备份恢复，不重复覆盖。回退 JAR 时先确认新版本没有活跃挑战；已建深层建筑与玩家检查点应与世界一起保留或一起从备份恢复，不能只删除配置中的 `dungeon-expanded`。

## 0.3.27 遗迹远征发布（2026-09-30）

此版只替换 AgentFriend JAR，不重建世界。新增三处由当前种子定位并在隔离世界实地查看的自然结构，六处遗迹集中在传送罗盘的“遗迹远征”页；15 张公会委托可从原版菜单和 `/mycli` 使用。调查委托只要求抵达中心附近，原生怪物、箱子与探险风险依然属于自然结构。个人奖励箱中排可接收盾牌、铁剑等非固定物品；任务和奖励数据仍保存在 `plugins/AgentFriend/config.yml`，必须随世界一同备份。源码测试为 `plugins/AgentFriend/expedition-expansion-stage.mjs` 和 `dungeon-expeditions-stage.mjs`，隔离服验证了三处新落点与旧三处、任务交付、声望、装备奖励和菜单。回退只需无人游玩时停服，禁用 0.3.27 并重新启用 0.3.26；新增的公会任务记录不应被旧版本破坏，回退前保留完整备份。

2026-09-30 10:12 在仅服务账号在线且无活动试炼时，现有每日备份任务先正常停服并生成 E/F 双盘 `20260930-101252` 快照，两处 `.complete` 均存在。备份完成、启动前一次性启用 `AgentFriend-0.3.27.jar`（193184 字节；SHA256 `af462398ad3c327730910ab05c7db358c65b68c2e767c1d5a0ac9c1713601770`）。重启后 RCON 确认 0.3.27，Agent LAN 白名单探针、基岩 UDP Pong、Paper 状态和女神桥通过；基岩真机与直播画面仍待玩家体验。此前从交互终端直接运行备份时，Windows 不向该终端暴露 Session 0 网关进程的路径/命令行，维护脚本因此拒绝停止未知进程；现有 `Afu-MC-DailyBackup` 计划任务有可验证的运行身份，备份与发布均由它完成。`manage-server.ps1` 新增一次性 `agentfriend-deploy.pending.json` 协议：备份完成后校验候选和旧 JAR 的 SHA256，只保留一个启用版本；失败则恢复旧版本并将标记改为 `.failed`，普通备份没有标记时行为不变。标记不进入备份。直接执行失败留下 `auto-start.paused`，本次自动清理动作被环境审批拦截；服务正常运行，但 Watchdog 需在核查后恢复自动启动。

## 0.3.26 村民交易发布（2026-09-30）

发布范围只有 AgentFriend JAR，不替换世界或第三方插件。新代码给已加载的成年无职业/游手好闲村民分配原版职业，保留有职业者的原版商品及等级；原生 MerchantOffer 调整交易价格和次数，避免 Bukkit 重新编码食物组件导致 Mineflayer 1.20.6 无法解析。各职业新解锁的商品也调整。分配职业和已调整的交易数记录在村民实体持久数据中，必须和世界一起备份。`/mycli admin villagers` 只统计当前已加载的成年村民，适合 RCON 运维检查；远处未加载区块会在加载时处理。

隔离服 25566 使用 `plugins/AgentFriend/villager-trades-stage.mjs` 让 Mineflayer 实际点击新分配职业、屠夫和图书管理员，三种商人菜单均能解析；检查最高绿宝石价不超过 16、其他交付物不超过 24、每条交易至少可用 1024 次。重启后测试村民职业与交易数据持久。最终 JAR 为 `AgentFriend-0.3.26.jar`，193482 字节，SHA256 `d16b07405a046977050afa06a6a7e2f107b8b22992f33726455d1ca826ac16d6`。

在只有 CortiLan、CortiEye、Goddess 服务账号在线且无活动试炼时完成发布；最新发布前快照是 `E:\MC\backups\scheduled\20260930-020045`，F 盘同名镜像，两处 `.complete` 均存在。停服后禁用 0.3.25、放入唯一启用的 0.3.26、核验 SHA256，再正常启动。正式服 RCON 读到 24 位已加载成年村民、无职业 0、无交易 0、最高绿宝石价 16；Paper、Agent LAN 网关、Geyser Pong、Goddess 桥和 CortiEyeMirror 状态正常。自动探针不能代替基岩真机交易界面的目视验收。若需回退代码，先在无真人玩家和活动试炼时正常停服，将 0.3.26 JAR 禁用、启用保留的 0.3.25 JAR，再启动；已分配职业及交易写在世界数据中，单独回退 JAR 不会撤销这些实体变更。

## 变更顺序

1. 对照 [安装内容锁](../manifests/installed-content.lock.json) 和当前服务端文件，确认要修改的源码、配置或第三方版本。AgentFriend 0.3.30 与 CortiEyeMirror 0.1.7 已在正式服运行；0.3.2 是历史源码。
2. 在独立服务端目录及端口构建、测试插件和跨端行为。自研 JAR 不提交 Git；第三方 JAR/数据包从原发布处取得并按哈希核验。
3. 检查没有真人玩家在线，执行 `manage-server.ps1 Backup`。备份会在只有服务账号在线时正常停服约半分钟，写 `.complete` 后重启，再复制到独立 F 盘。若 F 盘镜像失败，可在不重启游戏服的情况下单独执行 `Mirror`。
4. 停服、替换单一启用版本的插件/配置、正常启动；用 Java、基岩、Agent、CortiEye 四条路径复测。不要用 `/reload` 加载新的插件代码。
5. 保存源码修改、版本锁和测试说明到此分支，推送同一分支。运行日志、`server.properties` 实值、`ops.json`、Floodgate 私钥、玩家数据库与世界不提交。

背包界面验收：Minepacks 快捷头颅的 `minecraft:custom_name` 是“大背包”；基岩端接受 Geyser 自动生成的头颅资源包后显示其贴图。CortiEye 的 Fabric SpectatorPlus 客户端应跟随目标打开“大背包”和工作台；目标在自身物品栏点击并徒手合成时，CortiEye 自动打开同步物品栏，最后一次操作 3 秒后关闭。服务端只看到物品栏操作包，无法获知无操作的原版物品栏打开动作；Mineflayer 工具若需在打开时立即出画面，可发送 SpectatorPlus 的 `spectatorplus:opened_inventory_sync` 空载荷插件消息。Mineflayer 的 `item.displayName` 仍是注册表通用名 `Player Head`，物品的真实名称在 `components.custom_name`；Agent 界面应读后者。

需要核验快捷栏第 1 格实际出站数据时，以 OP 身份执行 `/cortieye inspectslot36`，再查 `logs/latest.log` 的 `CortiLan outbound slot36`。此命令让目标玩家重收一次原版物品栏同步包，仅记录 container 0、slot 36 的物品类型、组件名、物品名称和纹理 Base64 长度，不记录纹理正文。2026-09-29 正式服抓到 `ClientboundContainerSetContentPacket`：`player_head`，组件 `minecraft:custom_name` 和 `minecraft:profile`，名称“大背包”，`item_name` 不存在，纹理 1 条、Base64 长度 180。因此网页出现 `Player Head` 应检查客户端对 `components.custom_name` 的解析和显示链。

战斗法术验收：隔离服用同一个 Mineflayer 账号打开罗盘“战斗法术”页并分别咏唱 `starbolt`、`frostnova`、`flamewave`。对无 AI 的僵尸和羊读取施法前后的 `Health`：三招均使僵尸受伤，羊维持 8；无目标提示不耗魔力，重复星芒箭触发冷却；Agent 收到原版 `world_particles` 包。正式服发布后核对 AgentFriend 版本、Java/基岩入口、LAN 网关和 CortiEye 附身；基岩真机粒子外观需由玩家进入游戏亲眼确认。

星芒箭自动锁敌回归：隔离服让 Agent 背对 7 格外僵尸施法，僵尸从 20 降到 15.08，挡在中间的羊仍为 8；第二次立即施法只得到冷却提示。隔墙施法没有目标也不扣血；移除墙、正面瞄准远处僵尸时，优先命中准星目标而不是身后更近的僵尸。Agent 收到 16 个 `world_particles` 包。此逻辑与罗盘按钮及 `/mycli cast starbolt` 共用。

观战状态通道验收：用 Mineflayer 1.20.6 在隔离服以不同名称登录，分别注册 `mcviewer:state` 和旧的 `corti:viewer_state` 并监听原始 `custom_payload`。服务端按每位玩家 UUID 构建完整状态，对每个连接调用 `sendPluginMessage` 发送 `mcviewer:state`；仅注册旧频道的客户端还发送一份旧频道兼容消息。Paper 只向已注册该频道的客户端实际投递，因此新版客户端须注册 `mcviewer:state`；同时注册两个频道时只收到新版。`plugins/AgentFriend/viewer-state-stage.mjs` 以三个账号验证登录首包、独立技能经验、魔力与冷却变化以及 5 秒心跳。负载以 `{` 开头、可直接按 UTF-8 JSON 解析，不加长度前缀；两类列表各不超过 24 项、单包不超过 16384 字节，聊天栏没有 JSON。这个频道只传接收者本人的状态，不镜像目标玩家状态。

0.3.17 发布：最终 JAR 在 25566 隔离服完成三账号新/旧/双频道测试，最大实测 2622 字节；技能经验、魔力、冷却只改变本人负载。2026-09-29 在仅有服务账号在线时备份至 E:\MC\backups\scheduled\20260929-192545 并完成 F 盘镜像，再停服替换唯一启用的 AgentFriend JAR 并正常启动。生产日志确认载入 0.3.17，Agent LAN 白名单探针、Java 状态、Geyser Pong 和 Goddess 桥均通过；基岩真机画面未在本次自动测试中打开。

公会与地下城验收：六层地下城已建成；0.3.19 只扩展原有挑战与个人奖励箱，不覆盖世界结构。`plugins/AgentFriend/guild-stage.mjs` 在 25566 隔离服用两名 Mineflayer 玩家接单、进入第 1–3 层，验证真实怪物死亡事件、同层队伍共享讨伐计数、楼层结算、每日重复交付拒绝、命令和菜单放弃委托、黑铁等级门槛、罗盘原版箱子菜单接单、声望升级与个人奖励箱绿宝石数量。最终候选两次测试均通过，最后一次第 1 层击杀 3 只、第 2 层 4 只，A 声望升至 10（黑铁），B 为 5（青铜），A 箱中绿宝石 8；停服后 `config.yml` 的 `guild-players` 与 `dungeon-rewards` 均保留。公会数据与世界一同备份，不把隔离服玩家记录复制到正式服。Dungeons and Taverns v3.2 已含 `undead_crypt` 刷怪房模板和战利品表，本版不重复注入其自然生成结构。

0.3.19 正式发布：0.3.18 先完成原流程验证并短暂上线；复核发现接高层任务后缺少退出方式，补 `/mycli guild abandon` 与看板红色按钮后重新编译、重新跑双人三层完整验收。最终候选 JAR SHA256 为 `3cccb75797ae0fe4667340f20276fa9d5a6943a9b5c2450f8978cf0782a92d09`。仅服务账号在线时再次完整备份至 `E:\MC\backups\scheduled\20260929-195422`，F 盘镜像完成；停服替换唯一启用的 AgentFriend 0.3.19 JAR 后正常启动。正式服日志确认 0.3.19 与已建六层地下城，Java 状态、Agent LAN 白名单探针、Geyser Pong、Goddess 桥通过。基岩真机手柄看板操作仍待玩家实际体验。

探矿与法杖验收：在隔离服先放密封矿物，再让 Mineflayer 连接并读取原始区块；三个真实矿种应被 Paper mode 1 显示为石头，敲开邻格后真实矿物重新可见。`plugins/AgentFriend/prospecting-stage.mjs` 验证探矿 BossBar、粒子、魔力下降 6、冷却进入状态频道和空搜索不耗资源。`plugins/AgentFriend/focus-outline-stage.mjs` 以两个 Java 协议账号验证：施法者潜行使用法杖选钻石、单次使用施法，只有施法者收到发光方块展示实体（元数据 Glowing 位为 64）和墙面光框，旁观者收不到，矿块消失即清除；换绑治疗后单次使用能恢复生命。正式服重启后核对 `world/paper-world.yml` 与 `world_nether/paper-world.yml` 的反透视配置、Java/基岩入口和 MSPT。基岩版没有 Java Glowing 效果，使用墙面粒子和 BossBar；真机视觉及手柄操作由玩家复核。

探索法术与村庄验收：`plugins/AgentFriend/utility-spells-stage.mjs` 用无 OP 玩家验证法杖绑定跃空后单键起跳、飞行能力包与 15 秒到期收回、探敌 BossBar、守护铁傀儡击败尸壳且不伤羊，并从各玩家自己的 `mcviewer:state` 读取冷却。`plugins/AgentFriend/village-safety-stage.mjs` 在现有 `afu_house_02` 内以无 OP 玩家确认短草可清、地基不能拆，村民受玩家攻击仍 20 血；村庄室外的羊从 8 血降至 7 血。隔离服 WorldGuard 区域配置必须先从正式服当前 `regions.yml` 同步，旧副本的 `damage-animals: deny` 会给出假失败。2026-09-29 发布前已在无人类玩家在线时完成停服备份 `E:\MC\backups\scheduled\20260929-150855` 和 F 盘镜像，替换唯一启用的 AgentFriend 0.3.14 JAR 与两份 Paper 反透视配置，正常重启；插件版本、Java 状态、Geyser Pong 和 Agent LAN 白名单探针通过。基岩真机飞行及手柄操作须由玩家亲测。

Agent 文字指令验收：0.3.15 的同一隔离测试先读取 `/mycli help`、`/mycli spells` 和 `/mycli focus list`，确认世界名称、四种探索法术英文 ID 与法杖绑定 ID 均可从聊天响应直接获得，然后执行 `/mycli focus bind leap` 和使用物品动作。2026-09-29 在无人类玩家在线时备份至 `E:\MC\backups\scheduled\20260929-172947`，完成 F 盘镜像后仅替换 AgentFriend 0.3.15 JAR，正常重启；无需调整现有世界与反透视配置。

村庄建筑保护验收：0.3.16 在隔离服把 23 个 `afu_house_*` 的 `passthrough` 改为 `allow` 后，无 OP Mineflayer 在房屋保护框内完成放泥土、拆自己放的泥土、拆树叶；原房屋的云杉墙体无法拆，村民血量保持 20，羊可受到攻击。AgentFriend 第一次启动将原建筑坐标与材料保存为 `plugins/AgentFriend/village-structure-mask.tsv`，第二次启动从同一世界 UUID 的快照恢复，原有保护数均为 8096。此文件属于世界运行数据，**必须跟随存档备份**；不要把隔离服快照复制到正式服，换世界/改变房屋范围前先核对并重建。加载失败时插件会在村庄范围内拒绝改块。正式服在零真人玩家时先备份至 `E:\MC\backups\scheduled\20260929-181237` 并镜像 F 盘，再替换单一 AgentFriend 0.3.16 JAR 与 WorldGuard 区域配置，正常启动；日志确认 23 栋、8096 个原建筑方块成功捕获。随后完整停服快照 `20260929-181602` 已在 E/F 两盘带 `.complete` 保存，均包含结构快照文件；此快照是 0.3.16 的优先恢复点。再次启动仍读回 8096 个保护块，Agent LAN 白名单探针和基岩 Pong 通过。

## 0.3.20 公会大厅发布与恢复点

隔离服 `guild-hall-stage.mjs` 用无 OP Mineflayer 1.20.6 验证原版任务牌、27 格菜单接单、`/mycli guild hall` 传送、地板防拆和重复施工拒绝；停服重启后同一测试再次通过。正式服现场 `surveyguild -489 -502` 返回地板 Y=66、仅 1 格树干与 42 格树叶，无原房屋或道路冲突。仅服务账号在线时先做 E/F 双盘备份 `20260929-201735`，停服替换唯一启用 JAR 为 AgentFriend 0.3.20（SHA256 `B6E15E8361A4072531355744642FCC97B2357A5967A618797D1C81C5C4C9E95A`），再用控制台/RCON 一次性执行 `mycli admin buildguild -489 -502`。正式大厅中心 `-489,66,-502`；主任务牌在 `-486,68,-495`。构建记录 960 个原版结构方块，写入 `plugins/AgentFriend/guild-hall-mask.tsv`，和世界 UUID 对应。重复建造被拒绝。

建成后又做完整备份 `20260929-202045`，E/F 两份均有 `.complete`、0.3.20 JAR 和大厅保护快照。备份引起的重启成功，日志无公会快照错误，原版任务牌仍在；Java 状态、LAN 网关白名单探针、基岩 Pong、Goddess 桥和 CortiEyeMirror 均通过。基岩手柄右键任务牌的真实画面仍由玩家入服确认。`guild-hall-mask.tsv` 必须和同一世界存档一起恢复，不要单独替换或删除；要回到施工前状态，使用 `20260929-201735` 整套快照并意识到之后的玩家进度也会回退。仅回退 JAR 不会拆除建筑，不应直接降到不认识公会大厅的旧版后继续长期运行。

## 0.3.21 试炼场步行道路

施工蓝图在 `plugins/AgentFriend/resources/trial-road.tsv`。隔离服中 `/mycli admin surveyroad` 对现有 23 栋村庄建筑、头顶空间、原方块材质、桥墩落点和在场玩家做预检；然后一次性执行 `buildroad`。村庄出生点 `-543.5,66,-439.5` 到道路起点 `-570,63,-411`，再到试炼场北入口 `-590,90,-329`，普通 Mineflayer 不挖方块即可全程步行。构建约 312 格三格宽路面，水面为云杉栈道，山坡为石砖阶梯，另有 142 格护栏位置、落到河床的云杉桥墩和路灯。最终候选 JAR SHA256 为 `CA2D8C124B0A4F3B684D7A54CE6A5B54B7ADE9FD48FFD849F8B329CC02703BFB`。隔离服重建后记录 671 个受保护方块，其中 21 个是桥墩木；`plugins/AgentFriend/trial-road-stage.mjs` 用新 Mineflayer 账号从出生点走至入口、不挖方块，并试挖栈道及安全区外阶梯，两处都被插件拒绝。Geyser 隔离服 Pong 正常。原版 Java、基岩和 Agent 无须新增客户端资源。

正式施工仅在没有真人在线时进行：先运行 `manage-server.ps1 Backup` 并确认 E/F 两盘 `.complete`，再正常停服替换唯一启用的 AgentFriend JAR；启动后运行 `mycli admin surveyroad`，结果允许施工才运行一次 `mycli admin buildroad`。施工一旦中断，保留现场并恢复施工前完整世界备份，不删除 `trial-road.building` 标记硬重试。施工完成后再做一次 E/F 完整备份和重启检查。`plugins/AgentFriend/trial-road-mask.tsv` 与世界 UUID 绑定，必须与世界文件一起恢复；仅回退 JAR 不会拆除道路，也会失去道路的保护逻辑。

2026-09-29 正式发布：`.MicroKQ` 下线后，先在 E/F 两盘生成施工前完整快照 `20260929-213910`；正常停服，把 0.3.20 JAR 设为 disabled，仅启用 SHA256 `CA2D8C124B0A4F3B684D7A54CE6A5B54B7ADE9FD48FFD849F8B329CC02703BFB` 的 0.3.21。正式世界 `surveyroad` 通过后执行一次 `buildroad`，保护快照记录 671 个方块，其中云杉桥墩木 21 个。建成后的 E/F 完整快照为 `20260929-214136`，重启后日志再次读回 671 个方块。Java 状态、Agent LAN 白名单探针、Geyser Pong、Goddess 桥和 CortiEyeMirror 加载均通过；基岩真机走路观感需玩家入服查看。要回到施工前世界，使用 `20260929-213910` 的整套快照，意识到之后的玩家进度会一起回退。

## 0.3.22 咏唱画面和观战特效

AgentFriend 在施法实际生效后向施法者发送原版标题、副标题、少量粒子和音效。归乡术只有成功到达村庄后才显示“空间之力，护你归途”；冷却、魔力不足、缺少目标不会播放成功效果。Agent 仍能读取原有聊天结果。CortiEyeMirror 0.1.7 在附身时同步目标收到的标题、声音和世界粒子包，并限制世界特效转发为每秒最多 128 包。隔离服 25566 的 `spell-presentation-stage.mjs` 测得归乡、自疗、星尘均有标题/声音/粒子包，冷却重试不再出标题；`spell-presentation-camera-stage.mjs` 的真实附身关系测得目标和观战者都收到三类包。旧 `utility-spells-stage.mjs` 仍使用过期的 `317,119,17` 高空测试点，在当前隔离世界落至 Y=50，跃空用例因此未通过，需更新地形夹具后才能重跑，不作为本次功能验收证据。

2026-09-29 正式发布：仅 CortiLan、CortiEye、Goddess 服务账号在线时生成 E/F 完整快照 `20260929-220753`，两盘 `.complete` 均存在。正常停服，将旧 AgentFriend 0.3.21 与 CortiEyeMirror 0.1.6 设为 disabled，只启用 0.3.22（SHA256 `BB3BAAED18ED967AEE4AFF3F9C31E4B8BD2884C33C023F6C1C2A4123507A2B8C`）及 0.1.7（最终 SHA256 `7D5912AD12D37070B2D3ECC3E36AAAFC9D334C49E7F52E20F7DE81A3596B4C9E`）。首次启动发现 ProtocolLib 对不存在的 `CUSTOM_SOUND_EFFECT` 包发出注册警告；删除该多余监听后，隔离服以最终 JAR 重新验证附身画面三类数据包，再替换正式服 0.1.7 JAR，未改世界。最终重启后 RCON 版本、Java 入口、LAN 网关白名单探针、Geyser Pong、Goddess 桥和道路/房屋保护快照均正常，启动日志无上述警告；CortiEye 真实直播观感仍需在开播时目视验收。回退这次代码只需无人游玩时正常停服、禁用两个新 JAR、启用对应旧 JAR 后启动；不需恢复整个世界而丢失玩家进度。

## 0.3.25 地下城死亡领奖指引

试炼中死亡的玩家会立刻收到原版聊天指引；复活后再次收到聊天和标题。指引区分已通关奖励与尚未结算的当前层：已有奖励保存在按 UUID 隔离的个人箱，不会在死亡地点掉落；未通关的楼层不产出奖励。玩家可走到地面入口箱 `(-594, 91, -313)`，Agent 可执行 `/mycli arena rewards` 打开同一份奖励。死亡后断线，待发提示写入 `plugins/AgentFriend/config.yml` 的 `dungeon-death-guide`，重登后补发并清除。已有奖励仍存于原 `dungeon-rewards`、`dungeon-bonus-items`，此次不迁移物品或世界结构。

隔离服 25566 的 `dungeon-death-guide-stage.mjs` 用两个 Mineflayer 账号验证首层未结算死亡与通关首层后在第二层死亡两条路径；两种提示、复活后补发、入口箱坐标、命令及已结算铁锭/随机奖励均通过。正式发布前需确认无人类玩家在线、无活动试炼，再按本文件流程完成 E/F 双盘备份、正常停服和唯一启用 JAR 替换；发布后核对 Java、基岩、Agent 网关及 Goddess/观战服务。

2026-09-29 正式发布：CortiLan 六层试炼结束、`dungeon-active-run` 清空后，确认仅服务账号在线；正常停服快照 `20260929-235745` 在 E/F 两盘均有 `.complete`，随后正常停服并只启用 AgentFriend 0.3.25（184365 字节，SHA256 `496F232BF26D43722DF41B0795F5E9ED701E61EDA431B85E52EB1F0565FC4FD9`）。重启后 RCON 读到插件 0.3.25、六层加载成功；Java 状态、Agent LAN 网关拒绝未授权账号、Geyser 基岩 Pong、Goddess 桥与 CortiEyeMirror 插件加载均通过。原生 CortiEye 观战插件会在观察者客户端下次登录时附身；维护脚本的旧 watcher 因原生插件已加载而保持停止。回退须在无活动试炼时正常停服，把 0.3.25 设为 disabled 并启用 0.3.24；奖励和死亡提示配置必须与世界一起保留，不要用旧备份覆盖新进度。

## 0.3.24 地下城断线续打

原实现于 2026-09-29 23:14:43 在 CortiLan 与 CortiEye 同时显示 `Disconnected` 后，当秒把第二层判为失败；CortiLan 于 23:14:52 重连，但队伍已清空。日志足以证明不能续打的服务端原因，尚不能证明最初两条连接为何同时断开。第一、二层的已结算奖励仍在各自个人箱中。

新版在所有参赛者离线时暂停当前层、怪物波次和自动下楼计时，最多保留 10 分钟；同 UUID 重连自动返回当前层。队友仍在挑战时，掉线玩家重连进入队伍已到的楼层，错过的楼层不补发奖励。暂停前未通关的当前层重开完整怪物波次；已通关的层不重新结算。正常停服时把 `dungeon-active-run` 检查点与原有奖励一起写在 `plugins/AgentFriend/config.yml`，重启后仍按原宽限期等待；过期则结束并启动常规冷却。插件启动与暂停时明确加载试炼房四个区块再清理带标签旧怪，防止卸载的旧波次与重试波次叠加。主动返回地面和死亡照常退出。**恢复整个世界时必须连同 `config.yml` 一起恢复**；单独回退到 0.3.23 不能识别活动检查点，必须等队伍退出后再回退。

隔离服 25566：`dungeon-reconnect-stage.mjs` 通过倒计时中断线与战斗中断线两条路径；`dungeon-party-reconnect-stage.mjs` 通过队友继续下楼、迟归成员回到当前层且无离线奖励；`dungeon-restart-stage.mjs prepare|verify` 在真实 JVM 停启前后通过检查点、倒计时和不重复发奖。最终 JAR `AgentFriend-0.3.24.jar` 为 183526 字节，SHA256 `DF865EB830B2E6F3CD5A430754765F99EB89F6F659C291435131131D769AE795`。基岩真机的断网重登体验仍需用户入服核对。

2026-09-29 23:39 在无人类玩家在线、无活动试炼时，正常停服备份至 `20260929-233951`，E/F 两盘 `.complete` 均存在。随后把唯一启用的 AgentFriend 0.3.23 JAR 设为 disabled，复制并校验上述 0.3.24 JAR，正常启动。正式服 RCON 确认新版本和六层载入；Paper、Agent LAN 网关、Geyser Pong、Goddess 桥和 CortiEyeMirror 状态正常，Agent LAN 白名单探针通过。回退代码须在无活动试炼时正常停服、禁用 0.3.24、启用 0.3.23 再启动；0.3.23 不认识 `dungeon-active-run`，不能用于续打新版本的活动挑战。

## 0.3.23 地下城自动推进与远征

发布范围只有 AgentFriend JAR。六层试炼现从入口按钮附近取最多 12 格内队伍；每层清怪后等待 10 秒，幸存且仍在该层的队员自动下楼并补满生命。第六层结算后不再下楼。旧绿色按钮只提示状态，旧路牌在插件启动时按原文案自动更新。奖励由原有固定物资和新增独立随机物品组成，均留在个人箱子；`dungeon-bonus-items` 与 `dungeon-rare-misses` 存在 `plugins/AgentFriend/config.yml`，不能只恢复世界而丢失该配置。公会菜单扩为 36 格、12 项；遗迹远征只使用现有世界中已生成的 Dungeons and Taverns 结构，安全落点约距中心 70 格。若更换世界种子，`DungeonExpeditions.java` 的三处坐标必须重新勘察，不能沿用。

隔离服 25566 验证：`dungeon-flow-stage.mjs` 测双人入场、远处排除、清怪 10 秒自动下楼、12→20 血、个人奖励及组队/领箱任务；`dungeon-six-floor-stage.mjs` 测六层完整推进与稀有保底；`guild-stage.mjs` 测旧任务接取、结算、声望与日限；`dungeon-expeditions-stage.mjs` 测三处遗迹落点与调查委托；`dungeon-loot-persistence-stage.mjs` 在重启后核对随机物品 `custom_name`、`lore`、`enchantments` 和配置持久化。最终 JAR 为 `AgentFriend-0.3.23.jar`，181252 字节，SHA256 `7BB79464481347A964A33C3AE77EDE81E26621C12FE1D4B643F9252099DFDB49`。隔离服最终启动还查到第一层旧指示牌已更新为“自动下楼 / 清怪后等待 / 10秒 / 无需按键”。

2026-09-29 22:53 在仅服务账号在线时完整备份 `20260929-225357`，E/F 两盘 `.complete` 均存在。随后正常停服，将 0.3.22 JAR 设为 disabled、复制唯一启用的 0.3.23 JAR，并正常启动。正式服 RCON 确认 AgentFriend 0.3.23、六层初始化，`Status` 确认 Paper、Agent LAN 网关、基岩 Geyser、Goddess 桥及 CortiEyeMirror 正常；Agent 网关白名单探针和基岩 Pong 通过。若要回退插件代码，在无人游玩时停服、禁用 0.3.23 JAR、启用 0.3.22 JAR 再启动；不要删 0.3.23 写入的奖励配置。若需恢复整套进度，使用上述 E/F `.complete` 快照，但会失去快照之后的玩家进度。基岩手柄界面与真人战斗仍待入服目视验收。

## 当前自动恢复

`Afu-MC-Watchdog` 开机及每分钟执行：验证 Java/RCON、Agent 网关、女神单实例、观战绑定和基岩 Pong。基岩连续三次失败，且无人类玩家在线时，才尝试一次完整重启；持续故障不会每分钟或每半小时重启。自动启动暂停标志用于计划停服。`Afu-MC-DailyBackup` 每天 04:00 尝试快照；在线名单中出现真人或读取异常时跳过。

## 恢复

备份目录为 `E:\MC\backups\scheduled\<时间>` 和 `F:\MC-backups\scheduled\<时间>`。只选择带 `.complete` 的快照；F 盘镜像在校验后才写此标记。先停服，把现有服务端目录另存，再从同一快照恢复 `server/`；管理脚本损坏时，还原该快照的 `ops/`、`probe/`、`root/`。恢复世界会舍弃快照之后的进度，因此需要保留事故现场副本。异盘快照能应对 E 盘故障，不能应对整机损毁。

## 公网与身份边界

Paper 使用离线模式供本机 Mineflayer 与 Floodgate 连接，所以 Java 后端必须继续绑定回环。局域网 Agent 网关只接受可信来源，并拒绝 OP 名称；公网 Java 接入需要单独的身份验证入口。基岩由 Geyser/Floodgate 接入，服务端白名单仍开启。不要把 `rcon.port`、Floodgate 密钥或未验证身份的 Java 端口直接发布到公网。
