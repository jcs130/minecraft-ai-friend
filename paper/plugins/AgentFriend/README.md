# AgentFriend：Paper 1.20.6 服务端扩展

## 0.3.12 探矿术

`/mycli cast prospect [all|coal|iron|copper|gold|gems|diamond|redstone|ancient]` 由服务端在玩家周围 12 格内查找最近的真实矿物。命中后消耗 6 点 AuraSkills 魔力，进入 30 秒冷却，并在施法者屏幕顶部用紫色 BossBar 显示矿种、相对方向、距离和高低差 12 秒；短距离末影烛粒子提示方向。找不到矿物不扣魔力也不触发冷却，空搜索仍有 2 秒扫描间隔，防止频繁命令拖慢服务端。技能罗盘的“探矿术”页为手柄玩家提供铁、煤、铜、金、宝石、红石和任意矿脉按钮；Agent 可用文字命令。旁观者不能施法。`mcviewer:state` 中每名玩家自己的 `mycli:prospect` 报告剩余冷却。

普通 Java、基岩和 Mineflayer 都使用原版 BossBar、粒子、箱子菜单和命令。原版协议无法在隔墙矿石上画出精确发光轮廓；顶部方向条是跨端可用的屏幕提示。Paper 的世界级反透视配置另见 `../../config/anti-xray-overworld.yml` 与 `../../config/anti-xray-nether.yml`：engine mode 1 把密封矿物发成普通石头，不给只读区块的 Agent 制造假矿；洞穴中真正暴露的矿仍可被肉眼发现。主动施放探矿术才由服务端查真实矿物。它只搜索已加载区块，不生成新地形。

隔离服 25566 的 `prospecting-stage.mjs` 用无 OP Mineflayer 1.20.6 验证：密封钻石、铁、金矿的三个原始区块值全部变为石头，敲开旁边方块后真实钻石重新可见；探矿命中钻石、顶部 BossBar、粒子、魔力扣 6、30 秒冷却与 `mcviewer:state` 更新通过；罗盘可进入探矿页；空搜索不耗资源。Geyser 19133 Pong 与通用状态通道回归通过。构建候选 `AgentFriend-0.3.12.jar` 的 SHA256 为 `0dd884011c4ef3680a8464987f5f2e713f3331a4ff5e8810e3b457ae1e8cdcee`。基岩真机显示效果仍需玩家进服验收。

## 0.3.3 世界名称

命格书作者改为「千灯纪」。除此之外沿用 0.3.2 的罗盘、皮肤、地下城与技能逻辑。正式服名称、Geyser 展示名和女神资料的修改及重启记录见 `E:\MC\ops\WORLD_NAME.md`。

## 0.3.2 罗盘指针、队友传送与换装入口（已部署）

手持带服务端标记的技能罗盘时，指针自动朝向**同一维度最近的可见队友**，画面顶部同步显示姓名、方向、距离和高低差。罗盘主菜单“找队友”里，点上排头像可固定追踪某人，点对应下排末影珍珠可安全传送到她附近；右上角也可传送到最近的队友。停用追踪后，放下再拿起罗盘可恢复自动模式。女神和旁观者不成为追踪目标。

传送寻找目标旁边的可站立方块，避开水、岩浆、火、仙人掌、岩浆块、粉雪、浆果丛、蛛网和传送门；找不到则拒绝。每位玩家有 20 秒冷却，使用 Paper 异步传送，避免重复发送大量区块包。文字接口为 `/mycli locate tp <玩家名|nearest>`，原有 `list|nearest|<玩家名>|off` 保留，适合 Agent。

罗盘主菜单增加“换装皮肤”，直接打开 SkinsRestorer 的 `/skins` 画廊，手柄无需输入命令。`skin-catalog.json` 从 SkinsRestorer 随附的已签名推荐皮肤中选出 15 款动物/奇幻皮肤；`install-skin-catalog.ps1 -ServerDir <服务端目录>` 可重复生成本地 `.customskin`，另保留 Naruto/Kirito 专属皮肤。YSM 官方无 1.20.6 版本，且完整功能要求客户端与服务端同时安装；当前 Paper 服不安装 YSM。详见 `E:\MC\ops\LOCATOR_SKINS_032.md`。

构建产物为 `AgentFriend-0.3.2.jar`。隔离服和正式服均通过无 OP Mineflayer 1.20.6 实测：罗盘目标包随队友移动更新，手柄菜单传送抵达安全落点，冷却有效，画廊打开，选用 `afu_gnome` 返回皮肤已更新。2026-09-29 01:15 正式服上线，完整停服备份为 `E:\MC\backups\scheduled\20260929-011450`。基岩真机的指针与换装画面还需玩家验收。

## 0.3.1 六层地下城与找队友（已部署）

现有地面三波试炼场将作为六层地下城的入口，入口仍在 `(-590, 90, -305)`，石按钮仍在 `(-596, 92, -313)`。六层依次为苔藓洞穴、沙漠遗迹、冰雪洞窟、赤焰堡垒、海晶遗迹、深层宝库，Y 为 68、56、44、32、20、8。各层怪物数为 3、4、4、5、6、7，只用原版怪物、方块和物品；没有苦力怕或真正熔岩，方便六岁玩家及基岩端。一次只有一队，30 分钟整场、每层 8 分钟、结束后 3 分钟冷却。

每层清怪后，奖励只记入当层在场且存活玩家的**个人奖励箱**，不自动修改背包。每层和地面大厅都有实体箱子入口；打开后点箱子上排物品领取，背包满时留在箱中，离线及重启后仍可领取。第三层通关仍教授羽落与夜视。绿色石按钮下楼，红色木按钮回地面。Agent 可用 `/mycli arena start|status|next|rewards|leave` 操作相同流程；基岩手柄可全程用原版按钮和箱子。Minepacks 的 `OpenContainerOnRightClick` 需设为 `true`，使玩家手持背包快捷物品时也能正常点开奖励箱。

技能罗盘主菜单新增“找队友”：点在线玩家头颅可查看维度与坐标，并在画面顶部持续显示方向、距离和高低差；也可一键追踪同维度最近队友，或停止追踪。位置每秒刷新，队友下线时自动关闭。Goddess 及其他旁观者不显示。Agent/键盘玩家可用 `/mycli locate list|nearest|<玩家名>|off`。顶部状态条避开现有 AuraSkills 魔法值动作栏，菜单与状态条均由服务端原版协议发送，无需客户端模组。

构建命令仍为 `E:\MC\extensions\AgentFriend\build.ps1`，产出 `AgentFriend-0.3.1.jar`。最新部署、隔离测试、一次性施工、备份及回退以 `E:\MC\ops\DUNGEON_RUNBOOK.md` 为准。下文的 0.2.6 三波规则和备份记录保留作历史，不再作为六层的玩法说明。

源设计来自 `E:\minecraft-ai-friend` 的 `docs/SKILLS-UNIFIED-CLI.md`、`world/numen-actuator-src/.../GoddessBridgeCommands.java` 与 `world/botgate-src/.../SkillChestLayout.java`。旧项目是 NeoForge 1.21.1，不能把 JAR 直接放进当前 Paper 1.20.6。此扩展只移植统一命令、原版容器罗盘和传送入口；旧 Iron 法术、NeoForge GUI/语音模块不在此服运行。

**生产状态（2026-09-28 23:55）：** AgentFriend 0.3.1 已上线，六层地下城与找队友可用；部署前完整停服备份为 `E:\MC\backups\scheduled\20260928-235416`。原有统一魔力、女神技能和九个探索点继续运行。部署及回退见 `E:\MC\ops\DUNGEON_RUNBOOK.md`；竞技场事件与补偿见 `E:\MC\ops\INCIDENT-20260928-ARENA-REWARDS.md`。

部署 JAR SHA256 `2334D69E8EE682E784999C52ADCCA6CCED128B40CEABF408544F8C5DF5801A57`；源码快照在 `E:\MC\backups\source\AgentFriend-0.3.1-source.zip`。

## 构建与部署

在管家机运行 `E:\MC\extensions\AgentFriend\build.ps1`。脚本使用现服 Java 21、Paper 1.20.6 及现服 MagicSpells/AuraSkills JAR 编译，不下载依赖；当前产出 `AgentFriend-0.3.1.jar` 和 SHA256。探索点以 `E:\MC\ops\public-waypoints.json` 为坐标台账；`build-warps.ps1` 将其生成为本目录 `warps\*.yml`，部署时复制到 `plugins\Essentials\warps`。确认零真人玩家后用 `E:\MC\ops\manage-server.ps1 -Action Stop` 正常停服，再执行 `-Action Backup` 建立 `.complete` 停服备份；只保留一个启用的 AgentFriend JAR，复制新版 JAR 与对应 warp 文件，最后 `-Action Start`。从 0.2.1 跨版本升级时还要把 `spells-agentfriend.yml`、`spells-regular-unified.yml`（目标名 `spells-regular.yml`）、`mana-unified.yml`（目标名 `mana.yml`）作为一组复制到 `plugins\MagicSpells`，否则魔力可能重复扣除。不要用 `/reload`。配置在 `plugins\AgentFriend\config.yml`，`arena-built` 禁止再次覆盖原建造，`last-run` 保存冷却。

当前试炼场已安装在主世界 `(-590, 90, -305)`，按钮 `(-596, 92, -313)`；重复 `/mycli admin buildarena` 会拒绝。此命令仅接受服务器控制台或本机 RCON，不对游戏玩家开放。新环境部署前必须重新勘察场地；源码中坐标是固定的，绝不可在别的种子/世界上直接执行建造命令。

## 玩家/Agent 命令

- `/mycli help`、`spells`、`status`：文字接口，适合 mineflayer 和基岩聊天输入。
- `/mycli cast home|blink|selfheal|heal|food|give <物品>|fireworks`，也支持对应中文技能名。`selfheal` 圣愈术治疗自己 4 颗心、消耗 6 点 AuraSkills 魔力；`heal` 治疗队友，需面对目标、消耗 4 点。`give` 造物术只接受 `bread|torch|oak_log|cobblestone|crafting_table|chest|cake|glass`，每次消耗 4 点共享魔力；各配方数量固定、20 秒冷却。MagicSpells 负责效果和冷却，AgentFriend 用 AuraSkills API 在成功施法后扣费；`home` 去公共村庄 warp；`fireworks` 只显示原版粒子/声音，10 秒冷却、消耗 1 点。
- `/mycli compass` 领取原版指南针（带服务端标记），右键打开 27 格技能罗盘；`/mycli menu` 也能打开。菜单点击只会派发一次动作，不接受拖拽搬走菜单图标。Agent 应使用文字命令；基岩真人需实机确认触控菜单。
- `/mycli goto village|cherry|plains|arena`。前三项复用 EssentialsX 公共 warp；arena 到达北侧桥入口。私人地点复用现有 `/sethome`、`/homes`、`/home`，并提供 `/mycli waypoint add|remove <名字>`、`/mycli goto personal:<名字>`。此 Paper 版未迁移旧世界坐标或旧项目的 `shared:id` / `personal:id` 账本。
- `/mycli arena start|status|leave`。也可在场内按石按钮启动；必须人在场内。

### 0.3.4 造物术缺项申请

固定 8 种生活物资仍由 MagicSpells 消耗共享魔力并即时造出。输入 `/mycli cast give <其他物品>` 时不会直接发物品，而是把 1–60 字的愿望私聊给在线女神；申请每位玩家 60 秒最多一次。技能罗盘的造物子菜单还有“申请更多物品”，手柄可点选樱花树苗、船、灯笼、拴绳、命名牌、鞍、地图或花盆。任意其他名称需要文字输入。

`goddess-bridge.mjs` 把申请交给 QwenPaw `mc_godness` 判断。拒绝会在游戏内解释；批准只接受严格的 JSON 物品 ID 和 1–16 数量，由受保护的 Goddess OP 账号调用 `/mycli admin gift`。插件核对账号、在线玩家、原版物品、背包空间和一次性回执，禁止管理方块与刷怪蛋；成功后物品进玩家背包，失败不掉在地上。模型的文字不能直接变成任意服务器命令。若模型超时或发放回执不确定，不会自动重试，也不声称已经发放。审核礼物不扣魔力，日志记录发放玩家 UUID、物品和数量。

隔离 Paper 25585 已用 Mineflayer 验证：缺项申请到 Goddess 私聊、OP 批准后樱花树苗进入普通玩家背包、同回执重复调用被拒、命令方块被拒。正式服临时 LAN Agent `CreationQA` 申请樱花树苗，QwenPaw 女神返回批准，游戏客户端背包确实收到 2 棵；随后账号退出并从白名单移除。基岩手柄真机的新增菜单仍需点验。

### 0.2.0 女神技艺

`/mycli spells` 与罗盘原有能力保持原规则，新增无伤害的星尘术（`/mycli cast starlight`）。羽落（`feather`，45 秒缓降/90 秒冷却）和夜视（`night`，120 秒夜视/180 秒冷却）需学习；`/mycli goddess learn feather|night` 或罗盘点击未学的图标，每项消耗 5 级经验，首次通关试炼也会自动授予两项。学会后再次点击图标施放。学习状态写进玩家数据，由服务端对 Java、基岩和 Agent 统一判定。

`/mycli goddess pray <1–100 字>` 会在 Goddess 游戏账号在线时发私聊；离线时明确告知没有送出。玩家侧 30 秒冷却；回复由 `E:\MC\ops\goddess-bridge.mjs` 接本机 QwenPaw `mc_godness`。`/mycli admin teach <在线玩家名> feather|night` 仅控制台/RCON可执行，授课写日志，游戏内 OP 也不能执行。运维工具、权限和回滚见 `E:\MC\ops\GODDESS_RUNBOOK.md`。

### 0.2.1 服主旁观身份

Goddess 是白名单中的 4 级 OP，但插件只接受来自本机回环、准确离线 UUID、非 Floodgate 的登录；入服后强制旁观者模式、不可碰撞且无敌。游戏模式变更事件阻止她切换成有实体活动能力的模式。`E:\MC\ops\agent-lan-gateway.mjs` 在转发前拒绝 `ops.json` 中全部 OP 名称，防止局域网同名登录借权。QwenPaw `mc_godness` 的原生文件、Shell、浏览器等工具保持启用；游戏文字只作为不可信请求输入。

### 0.2.2 新玩家随身物品

普通玩家和 Agent 首次进入或重新登录后，插件检查背包；缺少带服务端标记的技能罗盘、命格书时各发一件。旁观者不领。背包满时不往地上丢，腾出空格后用 `/mycli kit`、`/mycli compass` 或 `/mycli book` 补领；重复命令不会在背包里制造副本。命格书是原版成书，右键时刷新并展示玩家实际生命、饥饿、等级、已学羽落/夜视以及探索指引；技能与传送的可执行入口仍是罗盘或文字命令。旧 NeoForge 魔力、天命和技能书仓库没有迁入 Paper，书页不伪造这些数据。

手柄/基岩玩家：把罗盘放到快捷栏，选中后按游戏内“使用物品”键，选中箱子菜单图标并确认。主菜单明确区分“圣愈术·治疗自己”和“治疗队友”，造物术另开固定物资子菜单；还包含归乡、闪现、饱食、烟花术、星尘术、羽落、夜视、传送地点和试炼场。未学的羽落/夜视点击一次学习：原版经验 5 级可支付，炼金等级达到 2 可免费学会；首次通关试炼也会自动学会。学会后再点施放，每次消耗 2 点共享魔力。传送子菜单可保存/覆盖固定的私人 `camp` 地点，并点另一图标返回；公共村庄、樱花林和试炼场也从这里选择。命格书选中后按使用键阅读，显示当前/最大魔力和炼金等级。文字聊天仍供 Agent 和键盘玩家使用；向女神自由文字祈愿仍需要能输入文字的设备。

隔离测试服 25566 已验证自动各发 1 件、右键发出打开书页数据包、重复补领不重复；Mineflayer 模拟玩家点击罗盘学习羽落时从 10 级扣到 5 级、菜单重开、再点击成功施法；EssentialsX 环境下菜单保存 `camp`，玩家传走后再从菜单回到该点。基岩真机书页、罗盘手柄点击和技能效果仍需上线后验收。

### 0.2.3 旧技能的跨端回归

旧项目的圣愈术是自疗，造物术是 20 秘术魔力换取白名单物资；旧项目后来把圣愈术归档到 NeoForge 原生治疗体系。本服没有 Iron 的客户端模组，故用 MagicSpells 的原版协议法术恢复“自疗”和限定物资造物。旧秘术魔力账本和旧世界等级不迁移；0.2.4 将这些法术与旧有闪现、治疗队友、饱食接到 AuraSkills 玩家魔力上。固定白名单不接受任意物品 ID 或数量，满背包不掉在地上。

隔离服已验证 MagicSpells 加载 21 个法术（原 12 个 + 新 9 个），`/cast selfheal` 实际生命 10→18，`/cast conjure_bread` 面包 0→4；0.2.3 罗盘点击自疗生命 9→17，造物子菜单面包 4→8。以上仅证明 Java 协议和服务端逻辑；基岩手柄实机需上线后点验。为降低误触和刷物风险，造物物资只选家庭探索常用品，其他旧技能仍按兼容性逐项迁移。

### 0.2.4 一条魔力、一条成长线

AuraSkills 是魔力与成长的唯一数据源：智慧属性提高最大魔力（基础 20，每点智慧增加 2），再生属性提高回复速度，AuraSkills 自身采集/战斗能力和罗盘法术消耗同一余额。MagicSpells 只执行已有闪现、治疗队友、饱食及新圣愈/造物的效果与冷却；其独立魔力系统已停用。原版经验等级仍用于附魔及羽落/夜视的可选学习成本；AuraSkills 炼金达到 2 级时学习这两项不扣原版经验。试炼首次通关的自动授课保持。

隔离服实测：自疗时 AuraSkills 魔力 20→14 且生命恢复；0 魔力造物被拒绝，补足后面包 +4、魔力 20→16；原有饱食 20→17；炼金等级 2、原版经验 0 时菜单学会夜视，施放使魔力 17→15。命格书仍以原版书页数据包打开。两套旧资源之间不转换玩家历史值；生产服 MagicSpells mana 已停用，不再作为第二个法力池。

### 0.2.5 群系探索罗盘

传送罗盘最上排增加九处：`yellowstone` 黄石奇境、`snow` 雪原、`bamboo` 竹林、`oasis` 沙漠绿洲、`lavender` 薰衣草谷、`mushroom` 蘑菇岛、`white_cliffs` 白色峭壁、`moonlight` 月光林、`ship` 海上大船。原有村庄、樱花林、平原村庄、试炼场及私人 `camp` 的槽位未变。Agent 与键盘玩家使用 `/mycli goto <地点ID>`；`/mycli waypoint` 列出公共 ID。地点白名单集中在 `AgentFriendPlugin.java` 的 `PUBLIC_PLACES`，Essentials warp 坐标和落脚地块记录在 `E:\MC\ops\public-waypoints.json`。增加地点时须更新两者，先实地核对地表群系、脚下方块和头顶空间，再生成 warp、隔离服测试、零真人玩家备份并重启；不要直接使用 `/locate biome` 返回的坐标作落点。

生产服已经用非 OP、1.20.6 协议的局域网 Agent 账号逐点传送 9/9 成功；隔离服验证九个罗盘图标、海船菜单点击和未知地点拒绝。基岩入口仍是原版物品/箱子 GUI，UDP Pong 正常；真实手机或手柄打开新菜单尚待真人点验。蘑菇岛、白色峭壁和海船旁有陡坡或海水，罗盘图标有相应提醒。

### 0.2.6 逐波奖励

旧版仅在三波全部结束且参与者仍活着、仍在场内时发一次奖励。生产日志证明一位基岩玩家曾两次在第三波死亡，旧版因此没有发奖。0.2.6 将相同总量分到每波清完时立即进入背包：第一波 1 铁锭、2 面包、5 经验；第二波 1 绿宝石、1 铁锭、2 面包、5 经验；第三波 2 绿宝石、10 经验。完整通关仍是 3 绿宝石、2 铁锭、4 面包、20 经验，且仍教授羽落、夜视。即使第三波倒下，前两波奖励也保留。每波有聊天、标题和服务端日志；背包满时余物掉脚边并提示。

隔离服用无 OP Mineflayer 账号验证完整三波逐波入包、无重复发奖；另一次在第三波死亡，重新登录后前两波物品仍在。正式服启动后，又用无 OP 的 Agent 账号完整跑通三波，逐波背包总数准确；测试账号已从白名单移除。脚本 `E:\MC\ops\arena-reward-smoke.mjs`，调查与日志路径见 `E:\MC\ops\INCIDENT-20260928-ARENA-REWARDS.md`。更新插件仍需零真人玩家时停服备份和重启；不得使用 `/reload`。

## 试炼规则与保护

场地使用石砖、磨制安山岩、铁栏杆、木栅栏、海晶灯、石按钮等原版方块。3 波怪物：3 僵尸；2 僵尸+2 蜘蛛；2 尸壳+1 僵尸+1 蜘蛛+1 骷髅。没有苦力怕或地形破坏技能。仅一队同时进行；开场时场内非旁观玩家是参与者。6 分钟超时、队伍全离场或全倒下会终止并清掉该场怪物。每波清完立即向仍在场内的开场参与者发放该波奖励；三波合计每人得 3 绿宝石、2 铁锭、4 面包和 20 经验，第三波倒下也保留前两波所得；结算后冷却 3 分钟。插件重启会清除带标签的旧试炼怪物。

建筑范围阻止玩家挖/放、火焰、流体、末影人改块和爆炸破坏，场外普通草地仍可采集。按钮只是原版交互，波次与奖励由服务端插件处理；没有给玩家服务器命令权限。

## 兼容性与运维边界

只用原版方块、物品、实体和箱子 GUI，不发送客户端模组物品或自定义协议。Mineflayer 1.20.6 可用文字命令和按钮；Java 客户端无需安装模组。Geyser/基岩可见原版内容，但实际手机触控菜单和按钮仍须真机验收。此扩展不提供跨端游戏内语音，也不移植旧 NeoForge 的 Iron 法术或语音长按法杖。

回退本次探索点更新：零真人玩家时正常停服，恢复 `E:\MC\backups\scheduled\20260928-211327` 中的 AgentFriend 0.2.4 JAR，移走 0.2.5 JAR 和本次新增的九个 Essentials warp 文件，再启动；统一魔力与既有世界保持。已建的原版试炼场方块会留在世界中。不要恢复整个世界快照来回退这次插件/配置，以免丢失后续玩家进度。
