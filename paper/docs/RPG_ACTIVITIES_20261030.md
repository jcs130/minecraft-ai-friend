# 试炼引导与冒险者集结

2026-10-30候选：AgentFriend 0.4.47.32、QiandengjiRpg 0.2.12、Vortex qd30。实际发布以[部署清单](../manifests/current-deployment.json)为准；候选、源码与测试成功不能替代上线回执。

## 为什么没有去打塔

现场记录中，DeepFish和Yui在找组队委托的第2层，却传送到蔓生遗迹。旧委托把塔写成“地下城”，通用状态又推荐新RPG的tasks账本，无法引向旧guild委托。旧说明还错误地要求普通开场每人8魔力。生产迎新配置的release-notice为字符串，而原加载器只接受1至2项列表，启动时会退回包内旧说明。

修复保持原任务ID和进度，展示文字明确区分试炼塔与遗迹；status/intro能带回旧guild任务当前一步，真正战斗时明确requiresWorldAction，已完成则指向guild claim。不会替玩家放弃任务、领奖或虚构通关。

重复通关还复现了独立漏洞：同一游戏日领过层奖励时，旧逻辑提前跳过了公会任务记账。现在每次实际清层都先记真实通关条件，掉落仍按原每日限额，不能重复刷奖励。不会用手工补进度代替实际通关。

## 玩家最短流程

1. `/mycli arena status`：看本人装备、场次和当前一步。默认两行短文本，需要字段才加`--json`。
2. `/mycli goto arena`：成功6魔力，到主世界world入口。实际按钮(-596,92,-313)，不是艾恩葛朗特的同坐标。
3. 四件护甲、职业可用武器和口粮齐备；所有参与者到按钮12格内，一人`/mycli arena start`，**普通开场免费；每次新开从第1层开始，历史通关不自动跳层**。
4. 查实际参战名单，再真正清怪；10秒后自动下楼，第2层没有另一个入口。通关第6层解锁的角色，可另用`arena rest`付8魔力直达第7层驿站；这和普通start是两个入口。
5. 旧组队委托达标后`/mycli guild claim`，新RPG任务仍用`tasks claim <ID>`。

塔按附近合格玩家登记，不保证与Vortex party恰好相同；登记观战者和创造模式不参战。遗迹则沿原guild party及dungeon整队准入，二者各自保留已有规则。占用、装备不足、冷却、魔力不足、错误世界、场外和运行暂停均给实际原因及可执行下一步。

## 现有玩法按需发现

`/mycli world list --page 1`共3页，每页6项，涵盖18类现有入口：职业成长、技能天赋、任务、塔、遗迹、组队、活动、考试、交易回收、个人箱、NPC、地标、照片、日记档案、外观、语音、竞技和保护。没有新增顶层命令，不向每次status塞整份目录。JSON显式选择；未就绪组件和外部模型代理如实标注。

现役52个插件的用途核对如下。底层依赖不需要再造玩家命令；表中入口是既有能力的发现方式，不承诺第三方插件宣传的全部扩展已经运营。

| 插件 | 实际职责与使用入口 |
| --- | --- |
| VortexRPG、QiandengjiRpg、AgentFriend | 原生成长唯一权威及CLI适配；profession、skills、tasks、arena、dungeon、guild |
| AuraSkills、MagicSpells | 保留原能力适配和通用效果；使用当前skills info，旧职业和旧熟练度不恢复写入 |
| MythicMobs、BetonQuest、Denizen、ConditionalEvents | 既有Boss/任务/脚本内容；从当前任务和副本入口进入，不在客户端猜后台脚本命令 |
| WorldEvents、WorldVariety、OlEncounters | 原生随机调度、结构/遭遇；world events、waypoint、dungeon目录 |
| VillagerLife、Named-Villagers | 居民行为与命名；村庄实际交互，不承诺自主LLM行动 |
| Citizens、Sentinel、FancyNpcs、NPCSpeak、Shopkeepers | NPC、守卫、对话及原版村民交易；world npcs/talk/shops，先核对人物ID和位置 |
| ImageFrame、Minepacks | 照片、书档案展示与独立大背包；photo/archive、minepacks:backpack open |
| Essentials、EssentialsChat、Vault、TAB、PlaceholderAPI | 传送、同世界48格聊天、统一金币及显示；goto/warp、!全服、原版msg、trade wallet；村民实体交易仍用实物 |
| numen、numen_api、NumenBedrock、QiandengjiMcbot | 不同Agent宿主/客户端接入；沿原鉴权、工具和版本协商，不提供服主模型Key |
| AgentVision、WorldObserver、CortiEyeMirror、SpectatorPlus | 感知、网页数据及实际观战目标转发；只读，不能以查询当完成任务 |
| Freesia-Backend、SkinsRestorer | 原模型/皮肤链；外观代理的appearance及skins，Paper本体不代确认外部同步 |
| QiandengVoice、voicechat | 可选近距语音；voice help，外部音频优先，本机TTS可选；原版和基岩仍可进服 |
| Geyser-Spigot、floodgate、ViaVersion、ViaBackwards | 客户端/协议兼容；不要求普通玩家安装RPG模组 |
| WorldGuard、CoreProtect、FastAsyncWorldEdit、Multiverse-Core | 拆建保护、审计与地图/世界运营；玩家protect查询，城区可放不可拆，副本建筑不可拆 |
| LightAntiCheat、QiandengjiAntiCheat、LuckPerms | 实际权限及保守反作弊；不因ag_名字自动授管理权限 |
| Chunky、spark、ProtocolLib、CommandAPI | 预生成、性能诊断与底层API；管理员运维，不增加玩家学习负担 |

## 不定时活动

复用WorldEvents 1.8.30的现役原生40分钟调度、一次最多一个事件、60分钟单事件冷却及低TPS暂停。三个新增集结各10分钟：试炼至少2人、遗迹至少2人、探索至少1人；与既有速度/夜视事件随机选择。实际参与仍可单人或自行组队，公告不代接单、传送、开战或领奖。集结结束不终止已经开始的挑战。原农耕事件保持禁用。

`/mycli world events`直接查原生正在进行的事件，给剩余时间及下一步。保留原生限频Boss条配置，不增加逐秒聊天推送。原生命令参考[WorldEvents官方说明](https://mbaconz.gitbook.io/world-events/getting-started/commands-permissions)；本次在实际1.8.30逐个启动/查询/结束验证，不只照宣传页猜API。

## 原生资料加载修复

冷启动首位玩家可能在快照读取完成时仍isValid=false。qd29只延后一轮再提交实体任务，拒绝后没有再调度，loadingPlayers会永久保留。qd30只重试该次已读取的、带原会话/对象身份校验的快照回调，最多200tick；不重复读盘，不重放玩法。退出或超时停止，未加载角色不能保存或在插件关闭时覆盖原存档。

`build-profile-readiness.py --base <qd29.jar> --server <隔离Paper目录> --java-home <JDK21目录> --output <新文件>`固定输入摘要，只改PlayerProfileService一个类并增加ProfileJoinDispatch；原生其他2853条目及资源、汉化和元数据保持。历史profile_load_patch.py是更早构建步骤，不能单独当最终修复。仓库不分发第三方JAR。

## 验证与边界

TrialGuide、GameplayGuide、JourneyContext及原任务规则覆盖装备、世界、门槛、状态、旧账本、分页、纯查询与错误参数；实际Paper双普通角色使用原生出怪、真实攻击和清层回调，验证到第2层、排除创造观战者、原任务记账、私有回执和重启后保留。敌人在独立QA冻结并移到合法攻击范围，**不等于自主战斗或难度平衡验收**。资料加载测试同时验证拒绝未加载存档写入与正常角色仍可保存；旧qd29负例能复现失败。

完整换职、完整职业技能洗点、拍卖实物交付、100层地图、全部NPC皮肤、原生核显高画质相机和各客户端真人语音耳听不属于本次完成项。18类目录表示现有入口可发现，不把这些未完成项标成已开放。女神资料及Skill源码同步不等于远端旧包已自动更新或每个Agent已经读过。

发布需正常停启Paper，不使用Bukkit全服/reload；提前提醒、真人/活动副本门禁、最新E/F冷备份、原账号/物品及其余49个插件摘要保持。无须替换登录代理、网站、LLM或TTS。发布结果与准确测试数字记入本批清单。
