2026-10-15自选任务路线0.4.42已正式上线：六条任选路线：战斗、制造、探索、补给、工程、生活；八张可配置入门/巡守/回补委托。新手三证为报名后读技能目录、成功施法、完整交付任意一项委托，农业不是前置。旧生活证明、在途冻结规则和奖励账本保留；带combat的讨伐按本人真实最后一击及实际攻击/发射时武器验收。服主确认“可以重启”后，180/60/10秒预告、真人/副本/PvP门禁通过；原Afu-MC-DailyBackup正常停启，E/F完整冷备份20261015-211316均先于安装完成。正式Paper1.21.1 build133 / AgentFriend0.4.42 / Eye0.1.16，31插件启用、52委托/7场地、欢迎修订12。正式状态30项、认证Java/Agent/真实Eye25项、原数据16项通过，29份原背包逐行与物品摘要一致。普通难度与三维度keepInventory=true保留。手机/Xbox真机、远端Web更新及16自主Agent长期负载未验。入口tasks --help，原guild/life/progress兼容。日常改route-contracts.yml后market reload；不代玩家接单/放弃/领奖，查询零副作用。详见TASK_ROUTES.md。下方候选为发布前历史。

2026-10-15 **0.4.42任务路线候选，未部署**：/mycli tasks list/info/status/menu 按需发现战斗、制造、探索、后勤、工程和生活；新手不再必须做生活加冒险两张委托。新增8张数据配置任务，真实击杀按怪物/数量/武器验收，补给沿既有公共库存事务。169项隔离检查通过，正式仍0.4.41、未重启或排队。后续运营修改route-contracts.yml并market reload，不改在途快照；玩法、旧字段兼容与回退见 [任务路线](TASK_ROUTES.md)。

2026-10-15主村庄道路/地面已在线生效：主村庄 X=-634..-458、Z=-530..-365（含边界）已修补坑洞、连接八条村路并加26处路灯、三处告示。29382个地面列按修复前历史地形冻结基线，在基线下3格设原版岩基层；原地下室和轨道处下绕，避免截断结构，普通地面上3层仍按原权限改造。原建筑、10581格结构、耕地、轨道和WorldGuard/领地名单保存核验通过。安全安置19位原村民及2只原铁傀儡，其中消失的一只经服主确认按原UUID/原属性恢复至100生命；另将自行进入下界的小林带回。45个原实体均可查，13位固定NPC留岗、原交易保留。隔离14项及正式原生保存18项通过，20TPS、短样本平均14.6ms；临时加载全部释放，Paper仍PID6372，无重启。新生营地全地坪保护与主村庄可改上三层是两种不同规则，必须按所在地解释。详见VILLAGE_GROUND_SAFETY.md。

2026-10-15营地地坪追加要求已生效：服主追加要求营地地面硬化、防挖坑后，在线铺装4581列石砖与安山岩边线，下方两层石质地基，低洼填实。独立 WorldGuard 区域 `qd_wayfarer_ground` 保护 X=-1146..-1078、Z=-638..-567、Y=-64..71（含边界）；门、床、NPC可用，采集建造到石质边线外。欢迎修订10、阿晴和告示牌同步。隔离24项及活塞/领地热载2项、正式认证Agent/真实Eye20项通过，625落点与4581列地基实查。E/F前后各10文件快照，25临时加载已释放；Paper仍PID6372，没有重启或移动真实玩家。原出生、床/锚、领地、难度和保留物品保持。手机/Xbox真机未验。详见WAYFARER_CAMP.md。下段首次建设中的“野地自由”现指营地边线之外。

2026-10-15 当前正式为Paper1.21.1 / AgentFriend0.4.41 / Eye0.1.16 / Freesia af2。城西旅人营地已在线建成，主世界出生(-1116,64,-600)、原版随机半径12；NPC阿晴介绍现有/mycli与罗盘，四处建筑保护，周边野地自由使用。旧玩家原位重连，床/锚优先，未重启；正式15项Agent/Eye与12项状态保存核验通过，E/F前后快照留存，详见WAYFARER_CAMP.md。YSM登录大厅提前握手修复已按服主确认、预告及E/F模型服务冷备份上线；原生Fabric模型界面仍待可米重连复测，按SERVER_UPDATES.md与YSM_LOGIN_PHASE.md回答。下方较早版本为历史。

2026-10-14 当前正式 **AgentFriend0.4.40 / Eye0.1.15**。服主批准后，180/60/10秒预告、原维护任务正常停启，E/F完整冷备份20261014-182425在安装前完成。AgentFriend **0.4.40** / CortiEyeMirror **0.1.15** 已上线。正式状态29项、真实认证Java/Agent/实际Eye联机27项、玩家保存8项通过。批量保护、短回执、通用CLI和三项自愿生活挑战生效。Goddess、ag_CorMy、ag_cormy_eye以原UUID恢复；普通难度及三维度死亡保留物品读回。手机/Xbox画面、远端Web和16个自主Agent未作本次验收。原0.4.38/0.4.39候选已随本版部署，后续新增CLI继续遵循CLI_CONTRACT.md。下方旧候选记录为各自时点。

本文是 `qiandengji-personal-stash` 分支的长期工作约定。目标是让 Agent 团队持续提出、制作、验证和运营新内容，同时让六岁玩家、手柄玩家、Java 玩家、基岩玩家和 Mineflayer Agent 在同一世界里获得可理解、可完成的体验。当前正式服的启停、备份、发布命令仍以 [维护与发布](OPERATIONS.md) 为准；本手册说明内容如何从想法进入这个流程。

## 先认清现状

2026-10-14：`ag_NarutoPi` 已热绑定原鸣人专属 `qiandengji_naruto/skin`。原生保存与实际游戏连接网页资源下发通过，无服务重启；基岩离线转换通过，但现役扩展源版本不匹配，未完成实际下发。细节和回退见 [YSM 外观桥接](YSM_ADAPTATION.md)。

2026-10-14：**0.4.39 CLI统一候选，未部署**，替代0.4.38候选。通用帮助按层发现，挑战create→start→status；全部挑战子命令支持JSON格式，默认短状态，详情/证据按需读，写入成功只确认一次。CLI49、规则64、原生CLI31、完整玩法26、基岩/热配置15、冷启动9共194项通过。正式仍0.4.37，未改生产或排队重启。**之后所有新增CLI按[统一交互约定](CLI_CONTRACT.md)开发**，不得另造查询/执行格式特例或把完整规则反复推给Agent。历史命令未适配JSON时明确标注并保留兼容；新增能力必须从通用帮助及status/progress发现。

2026-10-14：AgentFriend **0.4.38 生活能力挑战候选，未部署**。新增行囊存取、三人供货、同队救援三项自愿记录，通过 `/mycli challenge`、统一 `progress` 和世界生活菜单发现；独立场次、冻结规则、实际证据、缺项与结束原因可查询。规则／存档64项、最终原生/Agent/Eye26项、热配置和基岩协议15项、正常冷重启9项通过，生产仍0.4.37。属于生活世界实测，不代表标准化排行榜或自主LLM验收。使用、数据、回退与后续验证见 [生活能力挑战](LIFE_CHALLENGES.md)。

2026-10-14：AgentFriend0.4.37已上线，群系交界修复、探索照片与旅行艺术厅开放，施工前后双盘完整冷备份已核验；看SERVER_UPDATES.md、BIOME_BORDER.md及EXPLORATION_PHOTOGRAPHY.md。远端可米的库存客户端修复需更新main@826a29ac，不能由服务器重启代替。

2026-10-14：AgentFriend0.4.36已正式上线，旧奖励入口、救援进度和私聊真实名生效；按原流程及双盘完整冷备份发布。当前规则以[更新说明](SERVER_UPDATES.md)和[地下城领奖](DUNGEON_PENDING_REWARDS.md)为准。

2026-10-13地下城旧奖励入口补充：现役可用 `/mycli dungeon claim <ID>` 领取已保存凭据后重新开场，不必重打旧场次。23:56按服主授权通过原命令为小鱼领取墓穴旧奖励，8个绿宝石与4个铁锭入队、原场次和日期六项读回核验通过；未手工改凭据或重启。0.4.36候选修正无结束详情时误导性的状态提示，追加准确领取命令和独立菜单入口；原奖励、每日去重规则保持，新代码尚未部署。见[旧奖励与再次开场](DUNGEON_PENDING_REWARDS.md)。

**2026-10-12当前0.4.32 / Eye0.1.15已上线：**保护拒绝精简，机器回执仅本人，Eye/live过滤JSON与旧字段格式；维护只广播中文。正式17项联机和29项状态检查通过，E/F完整冷备份20261012-211001先于替换。Goddess/可米及Eye同UUID恢复；yubeen稍晚完成登录，四个原在线账号已同UUID恢复。现役status只读、status full详细、分页及原玩法保持；规则和回退见[聊天范围](CHAT_AUDIENCE.md)。下方旧候选段落按历史时点阅读。

**2026-10-12 Agent CLI观察0.4.29 / LoginGuard0.1.1候选，尚未部署：**通用status保持只读，旧详细状态转status full；短中文迎新、帮助/JSON发现、完整分页、实际技能条件及本机可信认证观察已完成隔离验证。原生35、基岩协议8、重启旧玩家回读9项通过；分页/认证124断言、代理观察/密码/正版Eye及37项客户端回归通过。正式仍0.4.28/Guard0.1.0，没有生产维护；见[候选、兼容与回退](AGENT_CLI_OBSERVATIONS.md)。

**2026-10-12引导/气泡0.4.28已上线：**经服主确认、提前通知及E/F `20261012-092305`完整冷备份，正常维护成功。五类完整引导/考场补验、探敌方向统一与Java/Web不透明白底配色生效；相机固定宿主桥修复80格裁掉远端强制引导，普通粒子距离及各层预算保持。基岩转换仅显示文字标签，单独保留亮色可读性；自动资源包配置已开、当前packs为空，YSM走皮肤/几何包，专用白底框仍须资源包与扩展共同实现。最终原生30+30、基岩15、Web25及几何331通过，正式只读19项/状态7项通过，Goddess/可米/NEKO原UUID回连。远端网页仍须运行端更新，见[发布](GUIDE_BUBBLES_RELEASE_20261012.md)、[引导](TARGET_GUIDES.md)、[气泡及资源包边界](TEXT_BUBBLES.md)。

**2026-10-12 Agent交互0.4.27已正式部署：**统一入门/规则/能力发现/分项进度与查看/报名分离生效，欢迎修订7。可靠大背包客户端模块17项及原生延迟/断线验证通过，远端须自行接入；服务器更新不等于远端已更新。见[Agent交互](AGENT_INTERACTION.md)。

**2026-10-12 Web YSM动作已正式部署：**AgentAppearance0.3.2、当前共享相机资源和可米/NEKO原模型比例修正已生效。原手部/额外动作、原始曲线与双手物品按支持范围呈现，完整Java/基岩等价仍未验；远端网页需更新桥接与重建。见[YSM适配](YSM_ADAPTATION.md)。

**2026-10-12当前正式：AgentFriend0.4.28 / CortiEyeMirror0.1.13 / AgentAppearance0.3.2。**已按服主授权、180/60/10秒预告、真人/副本门禁和E/F完整冷备份正常上线。交易板、特色物品说明、完整引导线与新入门保留，新增气泡外观，原登录/角色进度保持。当前回退、测试及远端边界见[最新发布](GUIDE_BUBBLES_RELEASE_20261012.md)及此前[联合发布](COMPLETED_FEATURES_RELEASE_20261012.md)。下方较早有日期的状态仅作历史。

**2026-10-11 中文提示已热更、0.4.22/0.1.13未部署：**欢迎修订6、Essentials中文、管理员广播接收限制及三维度原版成就公屏关闭已生效。候选区分试炼塔/遗迹地下城、相机直接入口、交物私有确认/背包查询及Eye减少重复物品包；继承0.4.20箭头和0.4.21参战结算，33项真实协议隔离通过。正式仍0.4.19/0.1.12，本轮不重启、不排队部署；未改原客户端或独立模型服务。见[提示与同步](AGENT_FEEDBACK_AND_SYNC.md)。

**2026-10-11 罗盘追踪0.4.20候选，尚未部署：**左右/斜向箭头及多圈角度已修正，60项真实Mineflayer/附身Eye与12,882项方向检查通过。正式仍0.4.19/0.1.12；服主明确本轮不重启，未排队或部署。玩法见[技能罗盘](COMPASS_MENU.md)，上线沿[维护规则](OPERATIONS.md)。

**2026-10-11 Eye默认配对不再匹配IP，已上线：**服主明确要求不要严格限制来源，覆盖此前同来源默认规则及下方逐组登记的旧要求。本体成功在线后，名字_eye或名字eye按名字配对，内网/公网混用无需报IP；专用限制、别名/live/Goddess规则优先。原Watchdog只重连网关，Paper/YSM代理未重启，原客户端保持。6项隔离测试通过，含跨来源成功与实际登录拒绝原因；远端原机Eye状态另查回执。见[观战接入](AGENT_EYES.md)；E/F repairs/eye-default-pair-20261011。

**2026-10-11 女神世界观察0.4.19已上线：**正式AgentFriend0.4.19、CortiEyeMirror0.1.12。游戏问答自动附当前玩家位置/脚下方块；九项只读MCP查询真实地形、自定义群系、方块/生物/掉落物、公开地点、局部步行/门/梯路线、实际玩家保护规则及本人近期照片。Goddess保留房管OP旁观者身份，原管理工具保留，游戏聊天身份只增具名只读许可。相机同步最新Web渲染源码并核验实际bundle；远端Web仍须更新重建，视觉模型像素理解和手机/Xbox画面未验。沿原维护预告及E/F停服快照发布，原客户端与玩法数据保持。问答实际核验见收尾记录；规则见[女神世界观察](GODDESS_PERCEPTION.md)，私有回执E/F repairs/goddess-perception-20261011。下方日期记录按历史时点阅读。

**2026-10-11 新玩法0.4.18已上线：**正式AgentFriend0.4.18、CortiEyeMirror0.1.12，沿原维护任务完成180/60/10秒预告及E/F停服快照。七项验房、六项特色实练、跃击/御空/同行祝福、十种能力题与18阶主动晋级生效；云阶考场四项移动题已实建开放。Eye后缀自动配对、live按实际附身对象同步、移动/超距关闭真实窗口生效；live沿服主确认的可米电脑可信来源。原任务奖励、技能资格/点数池、背包与领地保持；YSM及0.4.17自动拍照/高处指引继续有效。远端Web仍须拉取重建，手机/Xbox真机及完整多阶段综合考试未验/未完成。见[发布规则](GAMEPLAY_RELEASE_0.4.18.md)及[清单](../manifests/gameplay-release-0.4.18.json)。下方有日期记录为历史。

实时版本、本人任务进度和相机就绪以服务器本次回执为准。高处和摄影的操作顺序见当前规则；不得把有日期的旧启动检查当成实时状态。

| 系统 | 现在的内容入口 | 运行数据 | Agent 目前能怎样改 |
| --- | --- | --- | --- |
| 保护查询聚合（0.4.40已上线） | 原protect及protect batch；--help/--json/--verbose与通用page；[契约](PROTECTION_BATCH.md) | 不增加持久账本；每次读取本人实时权限，通知去重仅内存5秒 | 最多64目标逐块判定、规则/范围共用、重复坐标去重；Agent默认一份短JSON，实际Eye简短中文；未知不当允许，已按原维护流程上线 |
| 特色装备外观（0.4.33已上线） | 五件原战利品／法杖、原私有物品查询；[构建与兼容](ITEM_APPEARANCES.md) | 原物品只追加外观PDC与CustomModelData，保持耐久／附魔／刻印／归属；开容器时延后 | Java／基岩／Web共用原创源；E/F冷备份后正式发布，基岩自动资源、Java1.20.6手动资源。外机Web须更新重建；手机Xbox姿势未验 |
| Web HUD与大背包外形（源码已发布，相机已上线） | 共享可视化宿主/原profile纹理代理；[本次发布](ITEM_APPEARANCES.md) | 槽位与背包数据保持，按原profile展示 | 九格选中框、经验条和原蓝色背包菜单/手持/OBS/照片已验证；80项Node、27项浏览器、10项布局通过。女神相机已更新，外机宿主仍需重建 |
| Agent确定性交互（当前0.4.32已上线） | intro/rules/capabilities/progress、coach lessons/enroll/cancel、status/skills status/page；[规则与接入](AGENT_INTERACTION.md)、[观察兼容](AGENT_CLI_OBSERVATIONS.md) | 原主线/专项/任务账本及客户端UUID独立未知操作journal保持；候选只读观察有连接ID/时间、完整分页、本机认证来源 | 现役普通帮助、分项进度与明确报名已开放；客户端串行核对真实槽位/光标。status已为纯查询，status full保留旧详细及证明；远端须按协议接入 |
| 动态粒子引导（0.4.26候选，未部署） | 探矿、探敌、队友/商人定位、考场下一点；[规则](TARGET_GUIDES.md) | 内存短时指引，无新账本；原魔力/冷却/权限保持 | 完整动态方位线，整帧预算和实际Eye私有单播；原生47、基岩协议13、Web桥接/GPU15项通过。远端Web须更新重建，手机/Xbox画面未验，发布需本次Paper维护批准 |
| 特色道具识别（0.4.25候选，未部署） | 普通私有道具提示、inventory status/refresh/item；[规则](CUSTOM_ITEM_IDENTITY.md) | 只读原物品名称/纹理/PDC；id/baseId是材质，name/customId/usage是展示与用途 | 识别五类真实道具，同名仿制头颅不认作大背包；完整JSON分页防截断。4.39原生24、基岩6、正常重启复验23项；合并交易板复验20/8项通过。等待本次Paper重启批准，原客户端不新增改名补丁 |
| 商旅公会交易板（0.4.27已上线） | 溪畔商栈原门牌/掌柜、罗盘世界生活、trade menu/find/buy/sell/info/locate；[规则](TRADE_DIRECTORY.md) | 不新增玩家账本；村民和Shopkeepers真实报价/位置为事实源；别名配置只用于展示搜索 | 已加载商人只读聚合，3秒有界缓存、个人权限报价、售罄/附魔/双材料、方向定位；正常成交仍到场。同摘要原版协议34、基岩协议8、正常重启复验23项通过；Eye私有报价/定位已验，一般容器镜像沿既有客户端模组策略。已随联合发布上线，原隔离记录保留 |
| 原版私聊别名（2026-10-11热修） | `/msg`、`/w`、`/tell`、`/whisper`；[规则](PRIVATE_CHAT.md) | 新增 Denizen `qd_private_chat.dsc`，不迁移玩家数据 | 修复 Essentials 禁用却占用别名导致的误拒绝；使用发信玩家自身权限和原版 whisper，保留命令预处理。只更新此脚本并重载 Denizen；不授 OP、不重启 Paper |
| YSM外观桥接（2026-10-11已上线） | `/appearance status/list`；[规则](YSM_ADAPTATION.md)、[维护](YSM_LIFECYCLE.md) | 独立Worker真实分配、原始模型目录及私有状态快照；不含正式游戏存档 | 可分发原始文件夹/ZIP自动稳定转换；服主本机控制台分配。原Agent无需更新，远端Web需更新重建；基岩本人分配/完整动画/真机仍待验 |
| 基岩YSM高清资源（0.2.0隔离候选） | 同一原始模型上传与Worker分配；[配置与回退](YSM_BEDROCK_RESOURCE_PACK.md) | 原生玩家属性与每连接固定的不可变资源包；不迁移身份、物品或碰撞 | 保留可米2048贴图/272骨骼/比例，接原动作和手持装备；替换自动转换，重连通过原UDP下载。30项源码/编解码、15项真实联机通过，仅2193原型；正式未部署，手机/Xbox画面待验 |
| 职业进阶与能力认证（0.4.18已上线） | [三项职业技能、十种实操及18阶入口](SKILL_CERTIFICATIONS.md)；skill-assessments.yml、adventurer-grades.yml、SKILL_ASSESSMENT市场目标 | profession-ledger.json内按UUID的academy：冻结题目、原子证书/晋级、旧大段迁移；旧点数/任务奖励保持 | 控制台assessments reload/audit；热改不覆盖在途条件，异常配置保留有效目录，5tick限量采样。正式云阶考场四题开放；完整多阶段综合题库及真机验收后续 |
| 自然建筑保护与通行实练（0.4.7已上线） | `structure-protection.yml`、控制台 `structures reload/audit`、`world practice start/status/stop`；[规则](STRUCTURE_PROTECTION.md) | 已加载原生结构片段；本人PDC中的真实开门穿越、连续爬梯证明 | 六包命名空间及明确ID可热配置；禁止拆建，保留门梯、农耕和箱子权限。可选实练不代操作、不发奖；原Agent客户端保持 |
| 村庄生活（0.3.99） | `world list/menu/npcs/talk/end/guide/events/photos`、`/photohelp`、罗盘旅途指南；[插件包](WORLD_LIFE_PLUGINS.md) | UUID实习账本、BetonQuest数据库、NPC持久数据、本人ImageFrame图片；既有QwenPaw原生任务 | 已开放三步真实操作实习、村民对话/故事、补给商和正向活动。NPC/任务/精英可编辑配置后隔离热加载。默认女神相机自动拍摄，/mycli photo menu可选三个角度和海报，无需截图上传或公网接口；准备空地图、站稳等待交付。已有图片的内网导入仅为备用。 |
| 组队救援（原规则已上线；0.4.35视觉候选未部署） | 4格内停留10秒自动救起，当前层/室清场自动复活；`arena status`、`dungeon status`；[救援规则及系统提示](TRIAL_RESCUE.md)、[视觉反馈与团队技能](TRIAL_RESCUE_FEEDBACK.md) | config.yml的trial-rescue、原塔检查点和地下城场次ID；保留原奖励和物品 | 现役私发坐标/方法，Agent靠近等待；候选追加金色救援圈、稳定百分比/剩余秒数、复活粒子音效和原因日志，29项隔离检查通过，等待安全维护。全员倒地才失败，原断线/正常重启保存与部分计时重置保留。普通塔恢复原配怪，强化仅用于冒险/末日 |
| 玩家委托与分页箱（0.3.94） | 公会玩家委托、`commission list/mine/info/menu/publish/accept/claim/abandon/cancel`，`arena stash pages/page/list`；[玩法](MYCLI_AGENT_CLI.md) | config.yml的player-contracts.jobs/active、既有余额/待入箱队列和0–539槽位 | 已上线；玩家发布供货/同行无需代码或重启，每单一人、托管报酬、实物与真实探索返程验收。10页540格，待入箱队列1024组；客户端沿用现有协议 |
| 命名传送点（0.4.23入口修复已上线） | 罗盘地点页、`waypoint add/list/shared/menu`、`goto personal:名字/shared:分享码`；[命名地点](NAMED_WAYPOINTS.md) | `plugins/AgentFriend/waypoints.yml` 按主人/世界 UUID 保存，默认每人 32 点 | 玩家亲自到达后在线中文命名、改名、更新和撤回分享；记录免费，成功传送 6 魔力。主动分享公开发现者与坐标；不改代码、不重启。旧 home 保留；部署状态以维护记录为准 |
| 操作报错（0.4.3） | `ProtectionAdvisor`、`ProtectionArea`、`ActionFeedback`及MagicSpells七项文字；[规则](ERROR_GUIDANCE.md) | 原保护边界、主人/成员、私产与原业务账本保持；三处领地仅更新deny-message | 实际拒绝和查询给原因、真实边界及下一步，区外重查，建议不自动执行；新功能失败分支须提供正确做法 |
| Agent迎新（欢迎修订6及实练已上线） | `onboarding.yml`、`AgentCoach`原计时器、`FeatureTutorials`；[规则](AGENT_ONBOARDING.md) | 玩家PDC欢迎/限频/暂停、原实习/生活/公会账本；追加feature_lesson证明 | 文案介绍大背包/CLI、职业新技与认证；六项真实操作教学已开放。原实习毕业保持，不代学/接单/领奖，三份储物独立 |
| 技能编舞（0.4.5） | `skill-visuals.yml`、原版粒子单计时器；[规则](SKILL_VISUALS.md) | 无玩家账本；原成功事件/耗魔/资格保持 | `admin visuals reload/audit/preview`仅控制台；坏配置保留旧值、预算限流、导入工坊精确坐标，不安装客户端模组；手机/Xbox待真机 |
| 技能罗盘（0.4.1） | 原版45格五排、底排九项；`/mycli menu`；[布局](COMPASS_MENU.md) | 原罗盘PDC/技能账本保持，图鉴页码仅在线记忆 | 已学点击原施法，未学只打开学习页；图鉴每页36项，地点页36格。原Agent命令和客户端保持，基岩实际设备待验收 |
| 技能、法术、快捷施法 | 既有技能源码与 MagicSpells/AuraSkills；0.3.92 新增 professions.yml / skills.yml / skill-unlocks.yml / skill-points.yml；[职业与传承](CHARACTER_SKILLS.md)、[技能体系](SKILL_SYSTEM.md)、[位移](TRAVEL_MAGIC.md) | 既有魔力/等级/刻印/熟练度；profession-ledger.json 的 UUID 资格、学习等级、已获/已花点数、最高成长、冷却、唯一归属；config.yml pending 收据 | 旧效果发布流程保留；新职业固定效果、逐级点数/效果、洗点费用和解锁可整体验证热加载，失败保留旧目录，新效果仍需代码发布；战法牧与点数已于0.3.92上线，现役版本继续保留，原16项逐级简介保持，现增三项共19项，0.3.97的skills list profession或warrior/mage/priest直接发现职业技艺，skills info查逐级详情；学习菜单右键/命格书提供详情和个人状态 |
| 公会公共仓库（0.3.95） | 十二组原版双箱、648格；`guild shared`；[公共仓库](GUILD_SHARED_STORAGE.md) | 原版世界实体箱；`lands.yml`公共例外；`guild-shared-chests.yml` | 已启用供货跨同类箱、拒绝回退并合计库存；后续已建实体双箱登记用`land reload`和`sharedstorage reload`热更新，无需改代码或重启 |
| 公会任务与等级 | 静态 37 张仍在 `GuildManager.java`；0.3.78 起的动态卡模板在 `plugins/AgentFriend/dynamic-board.yml`；遗迹入口在 `DungeonExpeditions.java` | `plugins/AgentFriend/config.yml` 中的 `guild-players` 和 `dynamic-board.today`；动态模板文件 | 已支持的供货与日常目标可改 YAML 后用 `mycli admin board reload`、`replace` 或 `regenerate` 热更新；新判定类型仍需开发。正式服 0.3.86 已包含此功能，详见 [动态看板](DYNAMIC_BOARD.md) |
| 原图寻宝（0.3.98） | 任务市场`tm_map_hunt`、`guild map/verify/claim`；[规则](TREASURE_MAP_TASKS.md) | 在途原图目标/返程/自然开箱证明、原探索去重状态、本人目的地及建筑结算账本 | 直接复用现有原版/遗迹地图，不修改地图；实际探索后返程交记录，换新目的地可继续。文字、路线门槛和奖励可热配置；不调用locate、不自动生成目标区块，不改Agent客户端 |
| 村庄生活季（0.4.0） | `resident-contracts.yml`、`world-life.yml`、原市场和十个生活插件；[完整规则](VILLAGE_LIFE_SEASON.md) | 冻结任务、原格收割位置、本人新照片索引、调查收据与能力记录 | 九居民事务/三商人；服务器真实动作证明。`admin market reload`及`admin worldlife reload`热运营；Mythic精英仅增强模式，普通不改，客户端保持 |
| 任务市场（0.4.0） | `task-market.yml` 原35张加 `resident-contracts.yml` 九张，合计44张；[任务市场](TASK_MARKET.md)、[探索委托](EXPLORATION_CONTRACTS.md) | `config.yml` 的工程账本/本人评估、`guild-players.<UUID>.active.market` 的冻结条件与探索去重状态 | 热更新职业/已学前置、近战/格挡/真实团队治疗/标记贡献目标、维度、结构/群系键、路线门槛、步骤与奖励；工程登记基准，探索读已加载自然生成元数据。每人一次远行履历、返程和重启续接已验证 |
| 工程完工交接与公共地标（0.3.91） | BUILD 委托 handover；罗盘公共地标、`landmark list/mine/info/publish/update/unpublish/menu`、`goto landmark:<领地ID>`；[规则](PROJECT_LANDMARKS.md) | config.yml 完成与待交接收据、lands.yml 与 WorldGuard、landmarks.yml 公共点 | 热配置后验收完成者管理建筑，当前主人到场起名公开；访客传送 6 魔力，私产权限独立。已完工可凭原历史补交接不重发奖。2026-10-11服主将原CortiLan观景塔在线转给ag_CorMy，原施工历史保留，落点待现主人登记；指定礼物箱公共，其他储物私有 |
| 大背包、任务物品袋与奖励箱（0.4.7配置修复） | `commands.yml`、Minepacks、BetonQuest与原个人箱；[规则](BACKPACKS.md) | Minepacks `backpack.db`；BetonQuest `database.db`；AgentFriend个人箱及奖励队列分别保存 | `backpack`/`bp`普通储物、`questbag`任务专用物品；公会/试炼仍入540格个人箱。别名正常重启加载；查当前缓存再核对数据库，不整库回滚或按猜测补发 |
| 玩家领地与公会归属（0.4.7） | `LandManager/LandAccess/LandNoticeBoards`、现有WorldGuard和私产保护；[领地](LANDS.md) | `lands.yml`与`qd_land_*`区域是权限事实源；`land-boards.json`只索引原版牌位置；私产PDC保留 | 主人/女神/显式超管trust/untrust/manage；所有人members/board查名单和牌。控制台仍可reload/audit；女神两窄工具已重新发现，原来源策略保持。收到拒绝停止并查询/申请，公共箱与任务开放 |
| 生活公会（0.4.18验房已上线） | `LifeGuildManager`七类委托、`StarterHouseInspection/Validator`；四馆七导师；[验房规则](STARTER_HOUSE_TRAINING.md) | UUID life-guild及四馆地基、四份结构掩码；active.house-placed原生施工记录 | builder_home七项现存验房，status/claim均重查，旧已领奖成果保留；在途任务保留ID及进度，按新要求验收。结构快照随世界备份 |
| 试炼塔、地下城与奖励（0.3.95） | trial-waves.yml前六层；dungeons.yml三个真实建筑；罗盘地点页、`dungeon list/info/travel/start/join/status/resume/leave/claim/menu`；[规则](DUNGEON_NETWORK.md) | config.yml的旧试炼波次快照、site-dungeons.runs/receipts/claimed/cooldowns，既有个人奖励；世界实体和建筑 | 控制台`trialwaves reload`/`dungeons reload`整体验证热更，活动期间拒绝换目录；新地点可指定已勘察付费entry。逐室原生战斗和实际返程，每处每日一次奖励。全服新地点48怪/128飞行物，不根据文字直接覆盖世界生成建筑 |
| PvP 竞技场 | `PvpArenaManager.java` 的自愿匹配、同款装备和积分；[PvP 规则](PVP_ARENA.md) | `pvp-records`、`pvp-escrow.yml`、竞技场方块及 WorldGuard 区域 | 运营 Agent 可查看本人对局和排行榜；改地图或计分规则须隔离测试和完整备份，不可在有人对战时发布 |
| 女神运营 | QwenPaw `mc_godness`、游戏内 `Goddess` OP 旁观者、`ops/goddess-bridge.mjs` 与 `ops/goddess-mcp.py` | 女神会话、审核和审计记录留在主机；0.3.84 的 `goddess-gifts.jsonl` 持久发放账本 | 0.3.84 起正式生效，现役版本继承，可热更新附魔书/药水目录，真实库存核验后才报成功，超时查原回执不补发；MCP现共19项，新增九项世界观察工具；只读聊天身份具名许可和房管管理身份分开，见[世界观察](GODDESS_PERCEPTION.md)。验证与边界见 [礼物校验](GODDESS_GIFTS.md)。MCP 范围不代表 Agent 全部文件/开发权限 |
| 运维与发布 | `ops/manage-server.ps1`、Watchdog、E/F 双盘完整快照、隔离服测试脚本；AuraSkills 缓存修复见 [性能记录](PERFORMANCE.md) | 正式世界、白名单、密钥、日志和备份都在运行主机；缓存补丁已在正式重启自动激活；正式0.4.22/0.1.13及40连接上限，容量与边界见 [多 Agent 性能验收](MULTI_AGENT_PERFORMANCE.md) | 可检查、构建、测试、备份和发布；先完成 E/F 校验镜像，再替换 JAR；源码提交不会自动改变正式服 |

2026-10-06 已修复女神附魔书字段错误和现存确认损坏的 1 本，并正式发布 0.3.84 校验入口：书必须使用 `stored_enchantments`，装备使用 `enchantments`。私聊与造物都使用同一受校验入口；女神只选礼物，服务器生成属性并核对实际库存。不要依据闪光认定铁砧可用，也不要把字段错误归咎于刻印保护。现状见 [女神附魔书](GODDESS_BOOKS.md)、[礼物校验](GODDESS_GIFTS.md)。

0.3.67 起，已注册公会玩家的头顶和玩家列表名称前显示 `◆青铜` 至 `◆钻石`，Agent 仍保留 `[Agent]`；未入会玩家不显示公会等级。此标记读取本人声望并随升级刷新，供玩家辨认身份，Agent 应继续用 `/mycli guild status` 获取准确的声望、等级和任务状态。实现与兼容性见 [玩家头顶标记](PLAYER_NAMETAGS.md)。

`paper/` 是源码和无密钥配置的事实源；`E:\MC\server` 是正式运行数据的事实源。Git 不保存世界、玩家数据、白名单、凭据、第三方 JAR 或完整备份。自然结构的数据包只在新生成区块生效；新增一个数据包不会把旧区块自动变成新地下城。

玩家专属装备从 0.3.63 起用物品 PDC 绑定主人 UUID。女神骑士礼包中能精确辨认的装备在萌萌入服时自动绑定，其他专属奖励由服主按 [专属装备绑定](SOULBOUND_GEAR.md) 的控制台命令逐件确认。运营 Agent 不要把已绑定装备当可回收、可共享或可丢弃物品，也不要为临时整理背包解除其所有权。0.3.64 起 `/mycli arena stash put|putslot` 同样拒绝已绑定装备，不能把文字存箱入口当作绕过手段。

玩家身份的 Agent 可先用 `/mycli list` 分页发现顶层命令、`/mycli list cast|guild|arena` 列子命令，再用 `/mycli explain <ID>` 读取用法、前提和回执类型。0.3.37 起这些查询返回只发给本人系统聊天的 `MC_CLI_*` JSON，不执行目标动作；详情见 [Agent CLI 指南](MYCLI_AGENT_CLI.md)。新增或变更玩法命令时，同步更新 `AgentCliCatalog.java` 的稳定 ID 与说明，并让客户端收集系统聊天回执。手柄玩家仍以罗盘、书本和原版菜单为主。

生活委托还可用 `/mycli list life` 发现。Agent 先读 `/mycli life board|status`，再 `accept <任务ID>`，按实际方块／物品动作推进，完成后 `claim`。`mcagent:life` 只发本人连接，回执需按任务 ID、进度和领奖状态处理；不能把聊天提示或菜单图标当作已经完成动作。写书任务允许无法编辑书本 GUI 的 Agent 使用 `/mycli life write <书名>|<正文>`，它会消耗真实的书与笔，产生一本真实署名成书。生活公会的声望独立于冒险者公会，日奖进入个人试炼箱或其待领取队列。

村庄地表巡逻队或真实袭击的活敌人连续确认 4 秒后，向已登记 Agent 发一条 `MC_VILLAGE_ALERT` 私聊，完整敌情单播到 `mcagent:village`。先用 `/mycli village threat` 核查事件、本人生命、装备和魔力，再执行警报 `cmd` 或状态 `supportCommand`：支援传送术 8 魔力、20 秒冷却，过期警报/无敌人/无安全落点不传送、不扣费。到场按回执 `enemy.uuid` 确认并攻击敌对实体；清场重查。真实 Raid 波次等待可 `active=true,count=0,phase=waiting_wave`，这时不支援；未加载不等于安全。副本战斗或低血量先自救。村民收购任务 `trader_supply` 仍需亲自向两种职业出售真实物资。详见 [村庄守望与支援传送](VILLAGE_SUPPORT.md)。

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

技能应有稳定 ID、展示名、解锁条件、魔力消耗、冷却、适用目标、效果、粒子/音效、失败提示和 Agent 可读说明。0.3.76 起自研法术的玩家/Agent 说明集中在 `SpellGuide.java`：Agent 先 `/mycli spells list`，再 `/mycli spells explain <ID>` 读取私有 `MC_SPELL_DETAIL`；旧 `/mycli explain cast.<ID>` 也嵌入同一份 `spell` 对象。图鉴数据是静态成本和规则，当前魔力与剩余冷却继续从本人 `mcagent:state` 读取。修改技能时同时核对图鉴、`/mycli focus list`、技能罗盘/命格书、MagicSpells 配置、AuraSkills 魔力扣费和 `mcviewer:state` 的每人状态同步。现有 `ViewerStatePublisher` 已按玩家连接发送本人状态；新技能需要确认它能正确显示等级、经验和剩余冷却，无法提供的值按既有协议留空。任何新增的主动瞬移、远程取物等非原版捷径都应先按 [位移与远程物品操作](TRAVEL_MAGIC.md) 定义资源成本与成功特效，不得免费开放。

0.3.36 的八项原生法术熟练度是独立成长线：成功施放累计 8/24 次到 2/3 级，进度文件与世界一起备份；Agent 可用 `/mycli mastery` 读取本人 `MC_MASTERY`，手柄可在罗盘点「技能成长」。不要把这项法术等级说成 AuraSkills 等级或公会等级；MagicSpells 治疗/造物、女神学习技能尚未进入这套熟练度。新增技能应按 [技能体系](SKILL_SYSTEM.md) 明确分类、成功归因、等级效果和上限。

面向手柄玩家，关键技能须可由原版物品使用、罗盘选择或按钮触发；面向 Agent，须有稳定的文字命令和可解析回执。高伤害、飞行、召唤物与传送要在村庄保护、组队、世界边界和性能负载下测试。不能把只有 Java 客户端模组能渲染的特效作为完成条件；基岩玩家至少要看见原版标题、粒子、音效或聊天反馈。

Agent 在挖掘或放置前使用 `/mycli protect break|place <x> <y> <z>` 查询本人当前维度、附近已加载的目标方块；只解析本人连接收到的 `mcagent:protection` UTF-8 JSON plugin message。`deny` 换目标，`unknown` 暂缓，`allow_likely` 才尝试，实际事件拒绝后立即停止。保护查询不再发 `MC_PROTECT` 聊天行；0.3.90起同时私发 `MC_PROTECTION` JSON，0.4.3拒绝追加边界与正确下一步。协议、范围和原因见 [Agent 保护查询](AGENT_PROTECTION.md)。

AgentFriend 0.3.33 已在正式服提供该查询；Cortico 的自动挖掘入口尚未接入，运营 Agent 不能仅因为服务端有接口就假定 CortiLan 已自动避让。接入客户端时要覆盖手动挖掘、路径清障及放置动作，并用真实服务器回执测试。

试炼状态要先读 `MC_DUNGEON status participant=<true|false> selfState=<participating|not_participating> globalActive=<true|false> globalState=<idle|waiting_reconnect|cleared|fighting|preparing> globalFloor=<0..15> maxFloor=<6|10|15> selfFloor=<0..15> remainingMobs=<数量> trackedMobs=<数量> missingMobs=<数量> outsideMobs=<数量> anomaly=<原因> searchAdvice=<建议> lastOutcome=<won|failed|none> lastFloor=<0..15> lastReason=<原因> lastRunParticipant=<true|false>`。这是发给命令请求者的本人身份与全服快照：`participant=false` 时，即使 `globalFloor=4`，也不能推断自己位于第 4 层、正在参赛或将获得该轮奖励。`remainingMobs` 是本轮仍然有效且存活的怪物数；`trackedMobs` 是服务端记录的 UUID 数；`missingMobs` 表示记录中的实体已不存在或死亡；`outsideMobs` 表示怪物当前在楼层边界外，将由服务端拉回。`anomaly` 可为 `none|participant_outside_floor|mob_outside_floor|missing_mob_entity`。`searchAdvice=stop_no_active_run` 时停止搜怪；`return_to_floor` 时须在 15 秒宽限内回到本层；`wait_spawn|wait_next_floor|wait_clear|wait_reconnect` 时不要反复攻击或按按钮。`last*` 是最近一次全服结局，只有 `lastRunParticipant=true` 才属于该账号。第 12、13 层水/岩浆凹槽的玩家脚部高度仍算在楼层内。后续 `MC_DUNGEON entrance` 的 `scope=public` 是公共入口；`MC_DUNGEON floor=...` 的 `scope=global` 是活动队伍所在层，不是请求者坐标。两种查询 `/mycli status` 和 `/mycli arena status` 使用同一规则；玩家自己的精确位置仍应读实体位置或独立导航回执。服主可用 `mycli admin dungeonaudit` 查看当轮怪物 UUID、类型、绝对坐标、是否位于楼层、AI、目标和受伤来源；生成、死亡、失踪与越界拉回会写入服务端日志，供事后排查。

0.3.69 候选修复中途到场后不能随队下楼：本层内存活的生存／冒险玩家会自动加入本轮参赛名单，收到本人 `MC_DUNGEON_JOIN`；战斗中加入可领本层奖励，清怪结算后才加入只从下一层领奖。旁观和创造模式不会自动加入。Agent 收到 `participant=true` 后仍要保持在本层范围，等清怪倒数结束自动下楼，不需要反复按按钮；正式服发布前此行为仍以旧版为准。

0.3.70 候选把试炼入口石按钮改为原版难度菜单：玩家选自动／普通／冒险／末日，菜单确认当前选择，再点「开始」组队入场；手柄无需从罗盘跨页寻找。Agent 仍可先读 `/mycli arena difficulty list`，用 `/mycli arena difficulty <档位>` 设置，再在入口调用 `/mycli arena start`。实际发起者决定全队难度，开场后每位队员收到本人 `MC_DUNGEON_START difficulty/starter/partySize/floor`；不能把自己保存的选择当作已开场的全队档位。

导航回执统一使用当前世界的绝对方块坐标。`/mycli waypoint` 的 `MC_WAYPOINT id=... dimension=... x=... y=... z=...` 列出公共和本人私人地点；`/mycli goto` 对 Essentials 地点返回 `MC_DESTINATION` 目标坐标，**实际成功**另有 `MC_TRAVEL id=... mana=... dimension=... x=... y=... z=...` 与 `mcagent:event`，不能把仅有 `MC_DESTINATION` 当作已抵达。`/mycli locate list|nearest|<玩家>` 返回 `MC_PLAYER name=...`；追踪条会继续显示方向、距离与持续刷新的目标坐标。`/mycli cast sense` 返回最多五个最近怪物的 `MC_HOSTILE type=...` 坐标；`/mycli guild travel <遗迹ID>` 的 `MC_SITE` 给出已抵达的安全落点 `x/y/z` 和仅有水平勘察精度的 `centerX/centerZ`。`/mycli arena status` 的 `MC_DUNGEON` 给出入口、个人箱及活动层坐标。`dimension` 是 `minecraft:overworld` 等注册维度键，坐标为方块整数；移动玩家和怪物的位置是回执时刻的快照，算路前应重新查询。探矿术已有绝对矿块坐标，保护查询的 `mcagent:protection` JSON 包含目标世界与坐标。除保护查询专用 plugin message 外，上述导航信息沿用原版聊天和 BossBar，Java、基岩和 Mineflayer 均能接收；不要把旧的“前方几格”文案当作机器坐标。

0.3.80 的 `sense` 仍使用原有 ID、魔力、冷却和熟练度；新增 8 秒私有怪物轮廓及持续墙面粒子指引。Agent 仍解析 `MC_HOSTILE` 绝对坐标并重查移动目标；已登记且正在附身的 Eye 可见同一轮廓和私有消息。探矿术也每半秒刷新给本人看的粒子指向线，延伸到第一处遮挡墙并留下光框。Geyser 基岩不支持 Java 的发光轮廓，因此靠原版 END_ROD 粒子、BossBar 和坐标找目标；粒子线只标示方向，不计算安全行走路线。

0.3.55 起试炼默认按公会冒险者等级自动匹配：青铜/黑铁普通，白银/黄金冒险，白金/钻石末日。Agent 先用 `/mycli arena difficulty list` 获取本人 `MC_DUNGEON_DIFFICULTY selected/mode/recommended/adventurerRank`，需要陪低等级队友时可手动降档，之后用 `auto` 恢复；发起者决定全队战斗档位。`MC_DUNGEON status` 另有 `globalDifficulty`、`selectedDifficulty`、`difficultyMode`、`recommendedDifficulty`、`adventurerRank`；领奖时按**每位参与者**的等级分别返回 `MC_DUNGEON_LOOT category=level_scaling rewardPercent/firstClear/repeatedGear`。高等级刷低档的重复补给、保底装备和首领宝藏会减少或跳过；不能因为全服结算消息相同，就推断队友拿到了相同物品。准确数值见 [试炼难度与怪物行为](ARENA_DIFFICULTY.md)。

### 公会委托与声望

现有委托目录在 `GuildManager.CONTRACTS`，六级声望门槛也在同类中；进度按 UUID 存在运行配置。新增委托先复用现有 `FLOOR`、`KILLS`、`PARTY_FLOOR`、`CLAIMS`、`EXPLORE` 目标；新目标类型必须同时实现进度事件、重复计数防护、看板/书本提示和领奖。保留旧 ID 与含义，不能为了改标题直接重命名已发布 ID；需要停用时先规定在途任务怎么交付或转移。

每项委托都要让手柄玩家通过原版公会看板完成接单与领奖，也要给 Agent 一个 `/mycli guild` 路径。奖励进入个人箱，需验证玩家退出、死亡或重启后不会丢失或重复发放。价格、声望和稀有物品要与同等级试炼奖励比较，避免一个低风险任务无限产出高阶装备。

0.3.61 起公会门内有接待员，右键打开任务、购买、装备回收和实体绿宝石交易；她调用现有余额与报价流程。0.3.86 将门内实体储物、展示物和掉落物归萌萌所有，其他人实际操作由服务器拒绝并返回 `MC_GUILD_ACCESS reason=guild_owner_only`；开箱前可 `/mycli protect container <x> <y> <z>` 查询，拒绝应停止并改去门口公共箱，见 [物品归属](GUILD_PROPERTY.md)。大厅东南侧四组原版公共双箱每组 54 格，所有人可存取，按武器、护甲、补给、杂物挂牌。Agent 先用 `/mycli guild trader|shared` 获取绝对坐标，走到公共箱旁后用 Mineflayer 标准 `openContainer`/`deposit`/`withdraw`，每次重新读取箱内库存；不要把公共箱当成个人存储，更不能自动出售他人捐赠物。公共箱体及地台保护阻止破坏结构，箱内物品可共享。坐标、施工与回退方式见 [公会接待与共享箱](GUILD_SERVICES.md)。

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
3. 发布前读 `Status`、在线名单和活动挑战，计划维护先按 [维护公告](OPERATIONS.md#计划维护的提前提醒与更新说明) 发出倒计时，确认无人类玩家在场；完成 `manage-server.ps1 Backup`，核对 E/F 两处 `.complete`。有建筑施工时留施工前和施工后两份完整快照。
4. 按 [维护与发布](OPERATIONS.md) 只启用一个版本的插件，正常停启；不使用 `/reload`。更新配置和 JAR 时核对版本与 SHA256，复查 Java、Agent 网关、基岩、Goddess、CortiEye、Watchdog 与 `mspt`。
5. 观察上线后的挑战完成、奖励重复/缺失、玩家掉线、服务端错误、MSPT 和真实体验。问题只在代码/配置层时回退 JAR 或配置并保留玩家进度；问题改写世界时从同一完整快照恢复，并告知快照之后的进度会回退。保留事故现场副本。

发布完成后还要同步女神的资料箱与知识：

1. 先核实运行服版本与实际生效的热配置，再更新玩家手册 [版本更新说明](SERVER_UPDATES.md) 的已上线内容、当前玩法和被取代的旧规则。构建成功、提交 Git 或尚未部署的提案不能写成已上线。
2. 将手册原文同步到女神**现役**工作区 `D:\qwenpaw\home\workspaces\mc_godness\resource\SERVER_UPDATES.md`，核对源文件与资料箱副本 SHA256 相同。不要继续写入旧的 `C:\Users\lzl19\.qwenpaw\workspaces\mc_godness` 镜像。
3. 工作区 `AGENTS.md` 的受管理区整体更新为[当前答疑规则](GODDESS_CURRENT_RULES.md)，`MEMORY.md` 首页保留当前资料入口与核心长期记忆；旧部署摘要完整归档到私有`memory/archive/`，不反复前插互相冲突的“当前版本”。`E:\MC\ops`手册同步现役规则并指向历史归档。资料箱只放玩家说明，不放凭据、审计日志和玩家私密数据。
4. 用女神实际对话入口询问本次变化，保留她读取资料文件的工具回执和答复；至少核对新入口及一项被修订的规则。游戏答复遵守桥接单条 140 字符上限，先回应所问主题，再按追问展开。玩家询问后回答；仅同步资料不主动群发。服主已授权的计划维护按下节提醒/更新说明流程公告，不替玩家学习、花点或发物品。

资料与指引的同步无需重启 Minecraft。2026-09-30 曾因知识同步缺失，女神沿用 0.3.19 笔记，错误声称正式服没有公会、只有六层且不能续关。旧笔记不能覆盖新资料；个人资格、物品和活动状态仍以本人当次查询为准。

女神每次完成自己的运营工作后，还须记入当天日记并更新 `memory/goddess-operations.md`，记录实际结果及证据；历史问答先用原生记忆检索，再展开原始记录。旧答复和自动摘要不是操作证据，冲突要纠正摘要及索引，保留原始对话。检索设置、只读验收与回退见[女神操作记忆](GODDESS_MEMORY.md)。

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


## 历史与现役资料

2026-10-16考试接取审计及0.4.43候选见[EXAM_TASK_DISCOVERY](EXAM_TASK_DISCOVERY.md)。当前正式仍0.4.42；候选仅修正资格发现、拒绝回执和调查续接，不代玩家接单、不重置一次性领奖或授予证书。以后增加需要外部委托的考试时，必须同时给本人可接清单、明确阻塞原因和准确下一步；资格与真实接取规则共享，不把所有带“遗迹”名字的任务算作走查证据。

以前堆在首页的[发布摘要](history/AI_WORLD_OPERATIONS-before-guidance-20261011.md)完整保留作追溯。玩家答疑读当前规则及对应专题，勿从历史摘要提取旧默认流程。

2026-10-16考试材料0.4.44候选（未部署，正式仍0.4.42）见[EXAM_SUPPLIES](EXAM_SUPPLIES.md)。新题必须说明前置材料、来源、操作步骤与实际冻结要求，必要地图必须有真实目标；供考试的原物品、发放记录和待领队列一起备份。材料免费取物不能依赖玩家尚未学会的远程箱技能；本轮40联机/7正常冷重启/55CLI通过，真实手机/Xbox、Eye及新的完整摄影自主考试未验。
