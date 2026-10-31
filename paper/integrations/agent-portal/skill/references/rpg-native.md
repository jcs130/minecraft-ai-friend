# 原生 RPG：只读当前需要的一步

AF.43 自动参战规则为待部署候选，先看实际 `/mycli dungeon --help`。服务端说明自动同队后：一人在首室开场，进入同一遗迹挑战区且装备、职业等级达标者自动参战；不需要create/invite/accept或join。中途加入、离开与断线不抹去真实参战记录，通关后有贡献者均生成个人奖励凭据，直接claim，无需返回首室。首次查询确认participant；日常长期队伍仍用guild party，不能把旧队伍或历史场次当现在的参战身份。

2026-10-31结伴探索候选未上线：正式仍以实时帮助为准。新队伍查询会区分未组队、有效邀请、只有自己、集合中和已集合；聊天答应和在线玩家名单都不代表入队。用 `/mycli guild party status`，发起者create/invite，对方本人accept。`skills info team`说明原队友传送 `/mycli locate tp <名字>`（8魔力/20秒），不需要另装工具；重启后先查实际队伍，不能靠旧记忆继续假定同队。

登高是山地探索，不能只垫到指定Y。服务器启用本轮规则后，去开阔山脊、核对周边地形并落地横向走动；观景台和合影可选，不是硬门槛。`guild engineering <ID>`应直接给标题和阶段提示；先看说明再接取，当前阶段按guild status/claim继续。查不到就先换附近任务，不重复搭柱或刷查询。

成长分工更新候选：AuraSkills基础熟练度与Vortex职业等级分开，原版绿色经验条又是附魔经验。服务器帮助列出`skills list passive`时可只读本人基础等级和自动被动；`skills list common`仍是通用主动技能。状态新增`xpProgress/xpRequired/xpRemaining`时按其显示本级进度，旧`xp`是累计、`nextLevelXp`是剩余，不可把二者相除或因累计大就自行要求补等级。未返回新字段时保持未知。参考源已更新不代表公共Skill旧包重发或服务器已切换。

2026-10-30活动更新的配套说明：六职业、职业技能成长、魔力及金币统一，旧研习书/SpellMastery归档，AuraSkills基础熟练度保留；基础生存技能继续可用。先查服内帮助和本人实际回执，旧客户端资料不能覆盖服务器规则。

先用 `/mycli intro` 或 `/mycli status`。如果回执带 `guide`：`nextAction` 是当前目标；有 `nextCommand` 才执行该命令，仍须等实际结果。`requiresWorldAction:true` 表示该走路、击杀或制作了，使用自己框架的现有动作完成；`verifyCommand` 只核对，不会推进任务。不要反复查询代替行动，每完成一步或条件变化后再查。

## 生存和职业

饥饿用随身食物或 `cast food` 饱食术（3魔力、补4饱食、30秒冷却）；`cast selfheal` 只回血。冷却中不要重发。home/selfheal/food/blink/starbolt/frostnova/give 七项基础技人人可用，无需学习；基础施放不加 `--json`，查询用 `skills info <ID>`。

闪现先按本人实时 `skills info blink` 瞄准和等待冷却。服务器说明支持“瞄准优先、前方最远”后，瞄准安全地面到该处，平视空气则按水平朝向选25格内最远安全地面；不穿墙、封闭天花板或危险地面。拒绝后按原因换目标，不循环重发。2026-10-31这项仅为已验证候选，不能用Skill源码替代正式服回执。

未选职才 `profession list` → `profession info <ID>` → 本人 `profession choose <ID>`。骑士、法师、游侠、牧师、驯兽师、工程师各有初始装备与技能，不重选旧角色。`skills list/info` 查目标、费用与解锁；`cast` 施放，`prepare` 只设置点击技能，`learn` 按明示条件花学习点或天赋点，被动常驻不施放。

配套桥0.2.9的 `profession info` 从当前加载配置返回定位、属性、装备、技能实际效果、成长等级和点数、本人能否选择及原因，带 `catalogVersion`/`definitionVersion`。World只查询和传递；只记自己的选择、学习和实战经验，不把整份目录塞进记忆。版本变化后重查。驯兽师不保证召出常驻宠物，工程师不保证部署常驻炮塔；以服务器实际说明为准。

`starterSpell` 是初始主动技；完整 `skills` 还列出本职业的成长技能，不表示已经学会。解锁条件看 `growth` 的等级和学习点，能否施放再查本人的 `skills status/info`。

## 任务和副本

`tasks list` 选近期讨伐、城市巡访或装备制作，`tasks info <ID>` 看本人条件。`accept` 才接取；达标后 `claim` 才交付并发经验、金币。已交付不重接，进行中不重接；持有旧剑或从箱子取出，不算“实际制作”。当前列表/详情会直接标明本人可接、进行中、待交付或已交付。

城市巡访在 aincrad 世界，用 `/warp aincrad`（6魔力）；核对实际世界，再走到指定坐标/半径并移动。`/warp village` 回村。原在途探索单仍由 `guild status/verify/claim` 处理，不需要为升级取消。

战斗前穿好护甲、携带可用武器。正式副本要求四件护甲及近战、弓弩或本职业真实法器，不强制剑。先 `dungeon list/info <ID>` 核对难度、条件与准备，再按回执开场或加入。`active:false` 只表示没有场次；占用、故障或关闭时改选或联系服主，不死等墓穴。

日常结伴用 `guild party`：create/invite，对方本人 accept。副本按正在运行的帮助选择：旧版本仍需登记，自动参战版本到场即可；不要先要求真人和Agent都操作组队菜单。查 `dungeon status <ID>` 确认本人参战和 `rescueActive`；原生队伍不等于已在副本。装备不足按缺项整备，不能站在现场却把无伤害当怪物过强。

试炼塔是另一个地点，不要去遗迹找第2层。先 `arena status` 看真实下一步；`goto arena` 成功6魔力到主世界入口，按钮 `(-596,92,-313)`。穿齐四甲、带本职业可用武器，参与者到按钮12格内，一人 `arena start` **开场免费，每次新开从第1层开始，历史通关不自动跳层**；清层后10秒自动下楼，无需另找第2层入口。已通关第6层解锁的角色，可另用 `arena rest` 支付8魔力直达第7层驿站，和普通start分开。塔按附近合格玩家登记，不能只凭原生队伍推断名单；用 `arena status` 核对实际参战。状态要求击杀时应实际战斗，查询不推进任务。旧公会的通关委托完成后 `guild claim`，不要误用新RPG的 `tasks claim`。

`world list --page 1` 是现有玩法目录，共3页，每页6项；只读需要的一项。`world events` 查当前随机集结，公告自愿参加，不会自动接单、传送或发奖；没有公告也可自行开塔或探索。`arena status` 默认两行短提示，需要结构字段再加 `--json`。

本场两人以上时致命伤害先倒地，队友4格内停留10秒或清室可复活，成功救援不扣机会。遗迹单人战败或全队倒下，前两次回上个已清房间的存档点，第三次结束；查剩余次数，断线和重启不扣命。每地点仍只开启一场挑战；自动参战版本允许达标者中途进入并协作，实际参与首领战才获得正式楼层通关资格。倒地不是死亡，不要寻找掉落物。真正死亡也先读最终死亡结果、重生后核对库存；`keepInventory=true` 时背包装备保留，不能凭死亡自行推断丢失。金币/经验另查状态。建筑拒绝表示沿原门、楼梯通行，不能凿墙绕过。

## 补给与核对

`guild shared` 查公会公共箱实际坐标，亲自领取并穿戴。`arena stash` 是远程个人奖励箱，10页，成功远程开页耗2魔力；与普通背包、大背包分开。材料可直接 `arena stash putslot <背包0–35槽> <1–64数量>`，成功2魔力，无需GUI或传送。先用 `arena stash inventory` 核对服务器槽，再 `arena stash list` 核对已存物；取物 `arena stash page 1`。箱槽1–540，别和背包槽混用。存取核对容器、本人库存和光标，关闭重开确认。

当前统一版 AF.30 / 桥0.2.10，任务、回收、试炼、商店和玩家委托共用Vortex/Vault金币；旧余额1:1并入，`arena wallet` 是 `trade wallet` 的同余额别名。实体绿宝石仍是原物品。拍卖交付存在已复现故障，服务端明确拒绝新增操作；可用的是补给商店、回收与玩家委托。

两人交易无需丢物：买方 `commission publish delivery <物品ID> <数量> <金币报酬> <标题>` 托管金币，卖方 `accept <ID>` 后 `claim <ID>` 交付普通实物。买方 `arena rewards list` 查看待入箱货物，双方核对实际金币和委托终态；不把报价或接单当作成交。

原版装备与附魔继续有效。旧职业专属技可能报 `skill_retired`，物品保留、不扣费，转本人技能目录；基础技不属于停用名单。超时、掉线或保存冲突先查原结果，不重放施法、存取、领奖、选职或买卖。

统一版已把旧SpellMastery/研习书归档并保留原书；基础技能固定可用，职业成长查Vortex学习点和天赋，基础熟练度独立保留。背包满的私有提示不会自动丢弃或回收。装备先 `arena recycle list`，按完整物品报价后 `sell`；pending/unknown 查 `arena recycle status` 并联系服主，不重发买卖或补钱。

任务不做时先查 `/mycli tasks --help`：服务器列出 `abandon` 后可用 `tasks abandon <ID>`，重新接取会重新计数，未领取奖励不发放；超时先 `tasks status <ID>`。旧公会单用 `guild abandon`，玩家委托用 `commission abandon <ID>`。退出遗迹是 `dungeon leave`（不带ID，留原地），回村另用 `cast home`（成功6魔力）。

## 遗迹场次与救援有效性（2026-10-30服务端已上线）

`/mycli dungeon status [ID]` 现查本人场次；程序按需加 `--json`。`active`可能指他人的场次，本人须核对 `participant/participantRun/lifecycle/rescueActive`。整场30分钟，普通断线的5分钟回场宽限不延长总时限；超时、结束或退出后存档点救援失效，存活者仍在原地，应及时沿原路撤离。历史结果和旧存档坐标不能作为现在的救援保证；原生新快照为无队伍时，应清除旧checkpoint。本包1.3.5包含当前操作说明；原1.3.4下载字节不改，实际玩法仍按服务器回执核对。
