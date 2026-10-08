# 战法牧、技能点与传承（AgentFriend 0.3.92）

2026-10-08 16:09 已正式发布；正常 E/F 备份重启完成，五张试炼随后热加载。发布、21 项正式检查及原账号回连见 [维护记录](OPERATIONS.md) 和 [清单](../manifests/character-skills-0.3.92.json)。历史设计与插件比较见 [设计提案](CHARACTER_SKILLS_DESIGN.md)。

## 怎样开始

罗盘首页「职业与传承」选择战士、法师或牧师，再进入「技能学习与升级」。左键学习/升级，右键查看各级实际效果、费用与资格。原版箱子菜单和命格书适用于 Java、基岩与 Agent；不安装客户端模组，不改变 Agent 程序、配置或原施法命令。

```text
/mycli profession choose warrior
/mycli skills points
/mycli skills info sword_thrust
/mycli skills learn sword_thrust
/mycli skills upgrade sword_thrust
/mycli skills mine
/mycli skills prepare sword_arc
/mycli skills unprepare sword_parry
/mycli skills learnmenu
/mycli cast sword_thrust
/mycli skills respec confirm
```

`skills list/explain` 继续作为原图鉴别名。`profession status/list/menu/leave` 查询、打开菜单或离开职业；查询不施法。选职业只解锁入门技能的学习资格，需要本人花点学习。学习后自动在空槽准备，最多四项新增主动技能与一项传承。

命格书每次打开刷新：首页技能点简报，后面有职业、已获/已花/可用点数、上限和成长方法，逐项技能等级、下一等级费用、当前效果，以及未解锁技能的任务来源。新页按原版书本宽度与高度分页。学习菜单和命令详情提供完整等级数值。

## 技能点和洗点

默认初始 **6 点，总上限 30 点**。启用的 AuraSkills 技能等级减去初始 1 级后累计，每 5 级增加 1 点；已有成长也计入。按累计等级最高记录发放，降级再恢复、重新登录或切换职业不会重复获得。点数是一个玩家共用的池，战法牧不能各领一份。

基础图鉴的 20 项技能人人可学，新学习默认各花 1 点，沿用原施法魔力、冷却和熟练度。旧玩家的原基础资格在首次上线新版本时冻结保留，既有羽落/夜视学习标记保留。后来的新玩家不能靠重登获得旧资格。羽落/夜视的新学习仍须原版经验 5 级或炼金 2 级；原有试炼奖励继续保留。

职业技能通常 1/2/3 级分别花 **2/3/5 点**；传承一般 **5/6/8 点**；高阶圣愈为 **4/5/8 点**。每次升一级只扣该级价格，不能一次跳到满级。满级、重复学习、条件不足或余额不足不扣点。净化初版只有一级，其余职业技能最多三级。价格和等级数可配置，不能热删已学等级。

**可以洗点。** 罗盘底部磨石进入确认页；Agent 明确执行 `skills respec confirm`。默认消耗 **10 魔力、冷却 300 秒**，退回全部已花技能点，清除本轮花点学习的等级、准备及基础资格；保留旧基础资格、累计已获点数、职业选择、任务/事件解锁收据和唯一传承归属。已施放技能的冷却不清除。重新学习仍按原价格付点。魔力不足、无点可退或账本写失败不收费；试炼/PvP 中不可洗点。洗点不退羽落/夜视已花的原版经验。

## 三个方向

| 职业 | 入门学习资格 | 经历解锁 |
| --- | --- | --- |
| warrior 战士 | 突刺、架势格挡 | 弧光斩、步法斩、剑气、双剑觉醒；守村护阵与誓约 |
| mage 法师 | 奥术飞矢、霜寒束缚、秘法标记 | 炎流、秘法巡望 |
| priest 牧师 | 抚愈、净化 | 高阶圣愈术 |

首批三方向、十六项职业技能。生活玩法仍通用。一个当前主职；学习履历及冷却跨职业保留，实际施法需要当前方向、已学、已准备、正确装备、生存模式和足够 AuraSkills 魔力。游戏内 OP 也不能绕过。Goddess 和 Eye 旁观者不能施放。

剑士路线包含持剑突刺、扇形挥斩、安全步法与直线剑气。双剑觉醒要求主副手各持剑，约两秒四段攻击，总基础技能伤害按等级 8/12/16，只收费一次；每段重查距离、视线、装备与资格。传送、离线、死亡、换职业、洗点或取消准备中断后续攻击。不会重置原版受击无敌时间。

法师飞矢最高十二格，基础伤害 3/4.5/6；霜寒束缚按等级最多 1/2/3 个正面目标，附 1/2/3 秒原版缓慢；炎流不点燃实体和建筑。标记提供私有粒子及绝对坐标，本人或附近队友击败标记者形成真实合作证据。

所有新攻击只针对可见敌对怪物，经原版伤害和保护事件结算，不攻击玩家、村民或宠物，不破坏建筑。步法验证完整路径、安全落点、已加载区块、边界与区域进出权限。无目标、全部事件被取消、装备不对、不安全路径或账本写失败不执行收费效果。

### 高阶圣愈术（healer_beacon）

| 等级 | 本级技能点 | 每次魔力 | 治疗 | 额外保护 |
| --- | --- | --- | --- | --- |
| 1 | 4 | 10 | 八格内最多 2 名友军，各最多 8 HP | 无 |
| 2 | 5 | 14 | 最多 3 名，各最多 10 HP | 4 秒内抵挡一次怪物攻击，减半且最多减免 4 HP |
| 3 | 8 | 18 | 最多 4 名，各最多 12 HP | 6 秒一次减伤，最多 6 HP；另有 1.5 秒怪物攻击护佑 |

只治疗受伤的生存玩家，实际恢复事件可取消；保护只授给本次实际恢复生命的目标。护佑不豁免虚空、环境伤害、管理员操作或 PvP，也不会设置玩家永久无敌。治疗量和人数按实际等级执行；失败/过量恢复不计团队贡献。原基础 `selfheal` 圣愈术与 `heal` 范围治疗继续原入口，牧师高阶技能是独立升级方向。

## 任务和特殊事件

| 委托 ID | 验收条件 | 学习资格奖励 |
| --- | --- | --- |
| tm_sword_arc_trial | 3 次本人持剑近战击杀、2 次有效格挡 | sword_arc |
| tm_sword_road_trial | 已学弧光斩；第三层、组队第五层 | sword_step、sword_beam |
| tm_twin_legacy_trial | 已学弧光斩/步法斩；5 次格挡、组队第六层、第十层、8 次近战击杀 | twin_legacy |
| tm_healer_trial | 为其他玩家恢复 24 HP 近期真实怪物伤量、组队第三层 | healer_beacon |
| tm_mage_trial | 3 次标记合作击杀；下界 4 区域/64 格真实路线/20 秒有效行进并返程 | mage_flame、scout_watch |

本人一次任务，沿用接单、阶段交付、领奖和在途快照。接单时冻结条件与技能奖励；之后热改只影响新单。查询、挥空、只准备格挡、自疗、摔伤和重复证据不能刷进度。原群疗同样消耗真实怪物伤量，不能重复记功。四个新增 goal：`melee_kills/parry/healing/mark_kills`，可与现有工程、供货、探索和试炼组合。

原版 Raid 实际胜利可解锁战士守护阵及守村誓约，需实际伤害至少 10、队友怪物伤治疗至少 8 或减伤至少 4。首次贡献冻结奖励，离线按 UUID 结算；观察者、失败、仅路过或普通巡逻怪不算。重复终态与恢复不重发。

`world-limit: 1` 可限制某项传承全服一个 UUID，原子占位，在洗点后仍保留；默认首批为 0，其他玩家也能凭经历获得。初版无转让、退役或继承命令。

## 配置热运营

运行目录：`E:/MC/server/plugins/AgentFriend`。

| 文件 | 内容 |
| --- | --- |
| professions.yml | 三方向标题、图标及入门资格 |
| skills.yml | 稳定 ID、固定效果原语、装备、冷却及说明 |
| skill-points.yml | 初始/上限/成长间隔、洗点魔力和冷却、逐级点数与实际效果 |
| skill-unlocks.yml | 委托/袭击到学习资格的映射 |
| task-market.yml | 多步任务、方向和前置已学技能条件 |

前四份通过控制台 `mycli admin professions reload` 整体校验/交换，任务用 `mycli admin market reload`。失败保留上一有效目录。已学/已解锁 ID 与身份、在途奖励、活动袭击引用不可热删；上限不能降到已经发出的点数以下。改价格不倒算退款，洗点退回实际记录的已花点数。新增伤害/事件原语仍需代码发布，已支持的效果变体和委托不需重启。

AuraSkills 为唯一魔力池；点数是 AgentFriend 的学习分配层。现成 [MMOCore 技能树](https://docs.phoenixdevt.fr/mmocore/features/skill-trees.html) 支持树点、节点价格和树内消费上限；本服沿用已有 [AuraSkills 成长](https://wiki.aurelium.dev/auraskills/skills/) 与原客户端入口，避免同时引入另一套角色和魔力账户。

## 账本、回执与失败恢复

`profession-ledger.json` 以真实 UUID 保存职业、旧资格快照、技能点已获/已花/等级最高记录、学习等级/实际支出、解锁来源、准备、绝对冷却、唯一归属、能力计数及活动袭击贡献。临时文件强制落盘后原子替换，写失败保留旧状态。坏账本留原文件，新职业写入关闭，原基础规则仍可用；禁止删账本重新发资格/点数。

公会提交先持久保存 `profession-pending`，再原子保存解锁资格，成功后标记 applied；启动、领奖和 `mycli admin professions recover` 幂等恢复。账本、公会完成历史和 pending 必须一起备份/恢复。

私有 JSON：`MC_PROFESSION` 含 `combat/life/prepared/points/available`；`MC_SKILL` 含等级、学习资格、下级费用、逐级 `levels[]`、实际效果、装备和冷却；`MC_SKILL_POINTS` 含 `earned/spent/remaining/cap/levelHighWater/respecMana/respecCooldownMs/respecRemainingMs`；`MC_SKILL_UNLOCK` 代表学习资格，不能当作已学；`MC_SKILL_ASSESSMENT` 为实际伤害、治疗和减伤。操作用 `MC_PROFESSION_RESULT`，看 success/reason，不能把发出命令当作生效。

旧 `mcagent:state/mcviewer:state` 保持 schemaVersion 1 和原字段语义，仅追加 profession/points 和当前合格技能，技能等级反映实际购买。旧前者 cooldownMs 仍为总冷却、后者仍为剩余冷却。技能成功继续原 `mcagent:event`；现有 CortiEyeMirror 只转发给实际附身的登记 Eye。本次不新增配对、不修改或重启 Agent 客户端程序。

控制台 `mycli admin professions audit/reload/recover/assign <UUID> <方向>`；按 UUID 分配，不按名字或 OP 授权，没有任意发放传承/点数的玩家命令。

## 验证与发布边界

隔离脚本：`probe/profession-skills-stage.mjs`、`probe/profession-skills-operations-stage.mjs pre|post|load|corrupt`、`probe/skill-points-stage.mjs pre|post`。前者为遍历效果使用 200 点隔离夹具；点数专测使用正式 6/30 规则，验证扣点、上限、洗点与高阶圣愈真实效果。辅助插件只允许 25567，不进入正式服。

真实 Mineflayer 验证命中、格挡、治疗、原命令、菜单、Eye、写失败、热配置、正常重启及 16 连接受控负载。Raid 使用真实原生 Raid 对象与胜利回调适配，试炼续交使用已有过层回调适配，不代表完整自主袭击波次或整塔通关。16 个受控连接不能代替 16 个 LLM 长期自主游戏；基岩手机/Xbox 真机画面和手柄仍待验收。具体哈希与检查数以发布清单为准，失败证据保留在 E/F 私有维修目录。

初次代码部署通过正常维护任务完整 E/F 备份后重启，连接短暂重连，日常配置调整无需重启。正式市场只增加五张任务，保留原 29 项和 7 场地、在途定义、领地、公会私产、皮肤和传送点。

回退前暂停新单并处理在途/pending，0.3.91 不认识新 goal，不能直接换旧 JAR。保留账本、唯一归属与完成收据，优先前向修复。若确需完整数据恢复，使用同一个完整快照并说明快照之后的进度损失。
