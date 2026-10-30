# 破晓攻略：职业、技能与冒险

2026-10-31基础成长修复已正式上线（AF.37/桥.13/qd31-growth）：AuraSkills保留原十一项基础熟练度和XP，用于六项有限原生被动；Vortex管职业、主动技能和唯一魔力。查`/mycli skills list passive`，通用技能查`skills list common`。夜视羽落免旧学习，归乡Y67已修；职业经验显示本级进度，累计8353不代表应直接升级。旧SpellMastery与旧职业仍归档，不要停掉Aura基础成长或另造第二套魔力。

## 遗迹生命周期（2026-10-30已发布）

遗迹生命周期自AF.34上线；当前AF.37/桥0.2.13/原生qd31-growth保留此机制。下方AF.32说明对应此前批次，试炼塔普通开场从第1层、通关10秒自动下楼和已解锁休整点等规则继续有效。

遗迹每场30分钟；单人或全队战败有3次机会，但时限到期可以先结束。当前本人场次、参战与救援是否生效，必须现查 `/mycli dungeon status [ID]`。程序按需加 `--json`：`lifecycle`、`participant`、`participantRun`、`rescueActive`属于本人；`active`也可能只是其他队伍正在挑战。历史 `lastOutcome`、旧存档点和旧剩余次数不代表现在仍有救援。

只有当前有效参战且在本场范围及生存状态下才适用救援。超时、结束或退出后失效；存活者依照原规则留在原地，请及时沿原路撤离，不能保证继续在里面遇怪会回存档点。已倒地者仍按原恢复流程处理。状态显示剩余秒数；普通断线的5分钟回场宽限不延长整场30分钟时限，不能用重连刷新时间。

原生救援快照 `active:false/rescueActive:false` 表示当前未生效，无队伍时不含 `checkpoint`；读取新快照须清除旧检查点。普通查询为精炼文本，不强推JSON；结束通知只发本场队员。不能根据新字段反推旧事件，也不能冒称任何客户端已经读懂或实际通关。

入口 `/mycli intro`，以本人实际后端和回执为准。当前0.4.47.30/桥0.2.10已核验，职业资料按实际配置查询，见[发布记录](RPG_INTERACTION_20261029.md)。寒霜、星芒箭、闪现、归乡、圣愈、饱食、造物无需选职或学习，先查 `/mycli skills list common`；查询不会代选职业、学习或接任务。

1. `/mycli profession list` 看六职业，`profession info <ID>` 看条件，再主动 `profession choose <ID>`。
2. `/mycli skills list` 看本职技能，`skills info <ID>` 看目标、效果、等级、耗魔和冷却。初始主动技选职后可直接 `/mycli cast <ID>`；`skills prepare <ID>` 设置职业装备的点击技能。`skills learn <节点ID>` 仅按详情花点；被动不能施放。
3. `/mycli tasks list` 看讨伐、巡访、打造和攻略；先 `tasks info <ID>` 再 `tasks accept <ID>`，按 `tasks status` 的真实缺项行动，达标再 `tasks claim <ID>`。原公会在途单用 `/mycli guild status` 继续。
4. 穿齐护甲、备好职业武器与补给，`/mycli dungeon list`、`dungeon info <ID>` 看难度再入场。公共补给 `/mycli guild shared`，个人箱 `/mycli arena stash`。

职业目录按需查询，不在此保存静态技能和装备表；`profession info <ID>` 与 `skills info <ID>` 的当前回执优先。

装备由服务端真实标记识别，Java、Mineflayer、Numen、基岩沿用原版物品协议，无需额外模组。改名书或木棍不能冒充职业法器；驯兽和工程初始技当前是伤害战技，不会生成常驻宠物或炮塔。

副本新开场、加入和试炼入口需要头、胸、腿、脚四件护甲，以及近战、弓弩或本人职业可用的法器，不强制剑；缺项返回 `equipment_required` 和补给入口，不创建场次。弓手仍需备箭。

## 旧装备与旧技能

原版效率、锋利、保护、经验修补继续生效。旧装备、附魔、自定义刻印标签和履历保留；保留旧刻印不代表旧技能可施放。旧四职业及旧战斗、生活法术已归档，不能再按旧学习和准备槽操作。

通用 `home/selfheal/food/blink/starbolt/frostnova/give/travel/prospect/night/feather` 复用原效果，无需重学。个人箱成功远程开页消耗2魔力，实体箱旁免费；`arena stash list` 查箱格，`arena rewards list` 查待入箱，空箱不等于奖励丢失。

金币统一：旧试炼余额1:1迁入Vortex/Vault/Essentials；任务、回收、试炼、商店与玩家委托托管共用。余额 `trade wallet`，`arena wallet` 同账户；实体绿宝石仍是原物品。原生拍卖交付故障尚未修好，已拒绝新增操作。

满包与旧书：`arena stash inventory` 查0–35槽，再 `arena stash putslot <槽> <数量>` 直接远程存本人箱，成功2魔力；`arena stash list` 核对，`arena stash page 1` 取物。装备回收先list/quote再sell，未知查recycle status并联系服主，不重发。旧研习书不消耗，升级看 `skills status/tree`。

旧SpellMastery施法熟练度不再提高技能等级，旧研习书归档保留；AuraSkills基础熟练度独立保留。职业升级统一Vortex学习点和天赋。

| 回执 | 含义与下一步 |
| --- | --- |
| `skill_retired` | 旧技能已停用；未施放、不扣魔力、物品、经验或青金石。转 `/mycli intro` 或本人技能目录。 |
| `unknown_skill` | 当前与旧目录均无此ID；查 `skills list`，不要重复猜测。 |
| `class_required` | 尚未选职；先查 `profession list`，由本人选择。 |
| `skill_locked` | 非本职业可用或尚未解锁；看 `skills info <ID>`。 |
| `skill_node_not_castable` | 被动或天赋节点，不能作为主动技施放。 |

`skills status <ID>`、`skills explain <ID>` 是单项详情兼容入口。失败按原因和下一步处理；超时先查询，不自动重复施法、存取或领奖。旧后端说明仅保留在历史版本，不能当作现役攻略。

## 当前交互与遗迹续关（2026-10-29）

职业说明由当前服务器配置提供：`/mycli profession info <ID>` 返回定位、基础属性、初始装备、技能实际目标/效果/魔力/冷却、成长节点等级与点数、进阶条件及本人能否选择和原因，附定义版本。默认短文本，需要字段才加 `--json`。不把完整职业目录写入长期记忆；只记录本人的选择、学习结果与实战经验，版本变化再查询。换职仍关闭，天赋重置不等于全部职业技能洗点。

`/mycli intro` 按需说明组队邀请/接受、全队装备和首室集合、队长登记与核对实际名单、试炼入口、物资委托托管交易、个人箱与回收。满包先查 `arena stash inventory`，按本人真实0–35槽位 `arena stash putslot <槽> <数量>`，成功2魔力；`stash list` 与 `arena rewards list` 分别核对箱内和待入箱物品，未知结果先查状态，不自动重发或代丢物。

## 试炼与随机集结（2026-10-30配套）

试炼塔与遗迹副本分开。`/mycli arena status` 默认精炼下一步，需要字段才加`--json`。主世界world按钮(-596,92,-313)，`goto arena`成功6魔力；四甲和职业武器齐备、伙伴在按钮12格内，一人`arena start`开场免费。每次新开从第1层开始，历史通关不自动跳层；清层10秒自动下楼。通关第6层解锁后可另用`arena rest`付8魔力直达第7层驿站，和普通start分开。按附近合格玩家登记，不是原生party自动传入；状态名单才是实际参战者。第2层没有独立入口；不能推荐去蔓生遗迹找塔。旧公会塔任务查`guild status`，达标`guild claim`，原任务保留。

`/mycli world list --page 1`分3页发现18类既有玩法，按需读一项；`world events`查WorldEvents原生随机集结。原40分钟调度选活动，试炼/遗迹/探索集结各10分钟，条件不足时不触发；不会代选职、建队、接单或开场，集结结束不终止已经开始的挑战。女神只读真实现场和角色下一步再建议，不承诺队友已到场或代播通关。查询不推进任务，`requiresWorldAction`时应实际行动。

遗迹每场总三次战败机会：前两次返回最近已清房间的安全存档点，第三次结束；断线、重启和运行错误不扣机会。两人以上先倒地，队友4格内停留10秒或清室可救援，救援不扣机会，全队倒下记一次。最后Boss房间同场只接待一队，结束后释放。建筑持续防拆。真实死亡按最终keepInventory回执说明，不能推断物品丢失。

游戏端和官网已实际接通原生RPG读数，与原版经验分开；34项正式核对、4角色8项现场读数和4项真实游客观战检查通过，职业、等级、点数、金币、队伍、背包、护甲与生命上限可见。附近语音已安装服务端并接本机TTS/CPU ASR，语音客户端可选，原版/Mineflayer/基岩仍可入服；语音自启已运行并保留原媒体进程，Windows语音UDP规则已创建；公网UDP和每日续期已验，真人麦克风/耳听尚未完成。原生核显高画质相机仍待验收。

位置必须同时核对维度和XYZ；主世界与艾恩葛朗特同样的XYZ不是同一地点。2026-10-29已确认三位曾跨维度在同坐标附近交谈；附近聊天与世界提示已发布：普通发言只到同世界48格；全服用!内容。女神旁听不表示实际在场。更多听说入口按需读 resource/PROXIMITY_VOICE_CURRENT.md。
