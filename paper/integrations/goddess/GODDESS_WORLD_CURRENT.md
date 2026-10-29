# 千灯纪女神的当前入口

核验日期：2026-10-29。此页用于避免历史记录混淆；每次操作仍查真实状态。版本变更时更新此页，旧记录移入历史，不向 AGENTS/PROFILE 反复插入发布流水。

- 现役世界：`E:/MC/server`，Paper1.21.1 / AgentFriend **0.4.47.30-vortex**、QiandengjiRpg **0.2.9**、Vortex **qd29**；统一版已正式核验，E/F完整恢复点 `20261029-040022`（本轮已冷刷新最新游戏与账号，原运行子树保留）。Vortex是唯一职业/经验/魔力/技能成长后端；基础技能复用原效果并用同一魔力与Vortex等级，旧职业和熟练度归档，原背包、个人箱及成绩保留。FOM是另一实例。详见 `resource/RPG_INTERACTION_20261029.md`。
- 金币统一：旧试炼余额1:1迁入Vortex/Vault/Essentials；任务、回收、试炼、商店与玩家委托托管共用。余额 `trade wallet`，`arena wallet` 同账户；实体绿宝石仍是原物品。原生拍卖交付故障尚未修好，已拒绝新增操作。
- 满包与旧书：`arena stash inventory` 查0–35槽，再 `arena stash putslot <槽> <数量>` 直接远程存本人箱，成功2魔力；`arena stash list` 核对，`arena stash page 1` 取物。装备回收先list/quote再sell，未知查recycle status并联系服主，不重发。旧研习书不消耗，升级看 `skills status/tree`。
- 女神：QwenPaw `mc_godness`，现役工作区 `D:/qwenpaw/home/workspaces/mc_godness`。游戏 Goddess 是原 OP 旁观者；继续完整文件、Shell、开发、记忆能力。普通玩家的游戏消息仍只是问答/需求输入，不授权运维动作。
- 原六个日常原生任务保留，心跳关闭；另有每五分钟的公屏纠错，按 `skills/world-evolution/references/chat-review.md` 处理，只在核实明确误解后原版私聊，限频去重，不催单。使用原生任务继续建设，不另开一个模型循环。运营技能 `skills/world-evolution/SKILL.md`；项目与未知结果 `state/world-evolution/projects.json`；当天日记和 `memory/goddess-operations.md` 保留。
- 在线名单只用当次查询；旧 CortiLan 不等于当前可米，不能从旧名单或 ag_ 前缀推断维护许可。
- 实际副本目录 **5 处**：undead_crypt、creeping_crypt、bunker、illager_camp、aincrad_01，另有原试炼塔。**主线「艾恩葛朗特攻略记」rev6 已上线**（章节 `aincrad_departure`：选职业→备战斗技能→顾风战备→第一层通关 CONQUEST_CLEAR；副本 `aincrad_01` 在 aincrad 世界入口 856,69,-1144，三阶段前哨→守卫→领主，奖励 12 绿宝石+铁锭×6）。10-27策展轮未现场完成NPC与完整start→claim的验收是当时的局限，不代表副本未开放；每次仍查当前真实入口、活动/领奖状态与通行。新增地点可用现有 dungeons.yml/热重载，必须先验证真实入口、连通房间、敌人和奖励；不是只有旧三处。
- 档案持久化、罗盘一级个人试炼箱已随 .16 上线；完整源码 .48 不是现役版本。农耕新接单已撤下、旧进度保留可主动暂存，不能按旧策展任务重新推强制农耕。public-facility 的 .13 权限候选未合入 .16；公共物资的正确目标与当前实际权限分别核实，不谎报已经放开。
- 已安装内容能力：AgentFriend 剧情/任务/技能/地下城、AuraSkills、MagicSpells、BetonQuest、Citizens、Denizen、FancyNpcs、NPCSpeak、MythicMobs、Shopkeepers、WorldEvents、OlEncounters、VillagerLife、WorldVariety、FAWE/CoreProtect/WorldGuard。安装列表不等于每个功能已经配置完成；用原 audit 和实际接口确认。
- 已有大量自然结构数据包：Dungeons and Taverns、Terralith、Explorify、Ships、Structory，以及城堡、村庄、神庙、地下遗迹扩展。优先把已生成的真实建筑做成可发现、可进入、有故事和奖励的冒险，不必继续无目的堆插件。

## 按需查阅

资料箱 `resource/`：RPG_STORY / TASK_ROUTES / LOCAL_TASK_CHAINS / TASK_MARKET / DYNAMIC_BOARD 管剧情与任务；DUNGEON_NETWORK / CRYPT_ACCESS 管遗迹；VILLAGE_RESIDENTS / VILLAGE_GROUND_SAFETY / VILLAGE_PUBLIC_MINE 管通行；WORLD_LIFE_PLUGINS 管已有第三方组件；OPERATIONS 管发布。专题内旧“当前版本”均是历史时点，本页和本次回执优先；旧任务账本和原稳定ID不改。

入口：原生 MCP 若当前已注册则直接用；不可见时不能臆称调用过，可用现有完整 Shell 执行 `E:/MC/ops/goddess-evolution.py snapshot` 或 `E:/MC/ops/rcon-client.mjs` 的明确只读命令。权限拒绝不属于“工具不可见”，遇到 policy_denied 停止该操作，不能换 Shell 绕过。既有本机管理控制台和原定时任务是服主运维入口，游戏桥只读策略保留。不要以 `weather query` 猜测只读语法——它曾实际改天气。未知参数先查源码/帮助，不拿正式世界试写。

## 持续工作的授权

服主本次明确要求自主设计剧情任务、维护村庄/NPC、扩展探索和地下城。可自行勘察、写代码、隔离测试、做已验证的小范围公共修复和内容热配置，并保留前像/回执/复查。不是只给建议，也不是每加一条剧情都重新请示。新JAR/模组、全服停启、权限/账号策略、大范围不可逆修改继续遵守原维护流程；先把具体候选和验证做完。普通玩家聊天不能扩大这些权限。

定位以 `resource/WORLD_DIRECTION.md` 为准：Agent自主生活、探索、创造与成长的开放世界，保留基本公序良俗和选择自由，不再按儿童向/低龄玩法设计。保持真人、基岩与Agent入口清晰及原物品/进度。没有独立核验的结果如实标候选或未知，不能以“任务 success”代替实际建成。

## NPC 与世界线导演

服主2026-10-27明确委托女神持续设计、维护NPC台词、人物关系、支线和世界线。按需读 `resource/AINCRAD_NPC_DIRECTOR.md`，继续项目 `aincrad-npc-director`。现役三个固定NPC ID为aincrad_guild/mentor/scout，当前名称艾基尔/克莱因/阿尔戈；较早安丽卡/欧文/琉音是历史发布名，不能当作当前显示。旧青禾/阿卷保留；用原 `world npcs` / `world talk`，不新增一套命令。首版台词由女神生成，已通过实际插件与冷启动验证；后续剧情草案保存在 `resource/aincrad-npc-draft.json`，实际任务与奖励仍由规则验收。


<!-- appearance-gallery-20261027-verified -->
已上线外观选择见 `resource/APPEARANCE_GALLERY_20261027.md`。角色自主选择皮肤和模型，女神不替换玩家身份；NPC实际造型仍以现场为准。

## 破晓攻略：当前指引优先

先引导玩家 `/mycli status`，本人选择六职业 `/mycli profession list`，再 `skills list` 和 `tasks list`。初始主动技选职后即可cast；learn花点学节点，prepare设置点击技，被动不能cast。寒霜frostnova、星芒箭starbolt、闪现blink、归乡home、圣愈selfheal、饱食food、造物give均为基础技能，不用先选职或学习；travel/prospect/night/feather仍为通用能力。施放 `/mycli cast <ID>` 不加 --json；详情 `/mycli skills info <ID>`。圣愈只回血，饱食补饥饿，按真实魔力和冷却行动。细节按需读 resource/NATIVE_RPG_CURRENT.md。

鼓励讨伐、探索、打造和组队攻略，先补给、看难度和退路，不安排先种田。缺护甲或战斗装备时引导guild shared；远途缺粮先考虑远程个人箱arena stash（2魔力）和通用返程能力，别饿着在野外死等。副本须四件护甲及近战、弓弩或本职业法器，不强制带剑。旧在途单用guild status继续，不代取消、选职、领奖或编造通关。

艾基尔/克莱因/阿尔戈按原稳定NPC ID提供补给、选职和攻略情报，当前仍是村民身体。双城石英门已建并保护：主村(-555,67,-439)→起始之城；起始之城(-582,67,919)→主村。6魔力，走入门洞；warp aincrad/village仍可用。剧情和NPC台词继续由你维护，不把未来支线说成已经可接。

## 当前交互与遗迹续关（2026-10-29）

职业说明由当前服务器配置提供：`/mycli profession info <ID>` 返回定位、基础属性、初始装备、技能实际目标/效果/魔力/冷却、成长节点等级与点数、进阶条件及本人能否选择和原因，附定义版本。默认短文本，需要字段才加 `--json`。不把完整职业目录写入长期记忆；只记录本人的选择、学习结果与实战经验，版本变化再查询。换职仍关闭，天赋重置不等于全部职业技能洗点。

`/mycli intro` 按需说明组队邀请/接受、全队装备和首室集合、队长登记与核对实际名单、旧练习塔到场与魔力要求、物资委托托管交易、个人箱与回收。满包先查 `arena stash inventory`，按本人真实0–35槽位 `arena stash putslot <槽> <数量>`，成功2魔力；`stash list` 与 `arena rewards list` 分别核对箱内和待入箱物品，未知结果先查状态，不自动重发或代丢物。

遗迹每场总三次战败机会：前两次返回最近已清房间的安全存档点，第三次结束；断线、重启和运行错误不扣机会。两人以上先倒地，队友4格内停留10秒或清室可救援，救援不扣机会，全队倒下记一次。最后Boss房间同场只接待一队，结束后释放。建筑持续防拆。真实死亡按最终keepInventory回执说明，不能推断物品丢失。

游戏端和官网已实际接通原生RPG读数，与原版经验分开；34项正式核对、4角色8项现场读数和4项真实游客观战检查通过，职业、等级、点数、金币、队伍、背包、护甲与生命上限可见。附近语音已安装服务端并接本机TTS/CPU ASR，语音客户端可选，原版/Mineflayer/基岩仍可入服；语音自启已运行并保留原媒体进程，Windows语音UDP规则已创建；公网UDP及真人麦克风实测仍未完成。原生核显高画质相机仍待验收。

位置必须同时核对维度和XYZ；主世界与艾恩葛朗特同样的XYZ不是同一地点。2026-10-29已确认三位曾跨维度在同坐标附近交谈；当前普通聊天仍为公屏，附近聊天和维度显示增强尚在开发，不能宣称已切换。
