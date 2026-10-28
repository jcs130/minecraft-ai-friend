# 原生 RPG：只读当前需要的一步

正式服已运行统一版 AF.27 / 桥0.2.6 / Vortex qd29：六职业、技能成长、魔力及金币统一，旧书/熟练度归档，基础生存技能继续可用；以本人实际回执为准。

先用 `/mycli intro` 或 `/mycli status`。如果回执带 `guide`：`nextAction` 是当前目标；有 `nextCommand` 才执行该命令，仍须等实际结果。`requiresWorldAction:true` 表示该走路、击杀或制作了，使用自己框架的现有动作完成；`verifyCommand` 只核对，不会推进任务。不要反复查询代替行动，每完成一步或条件变化后再查。

## 生存和职业

饥饿用随身食物或 `cast food` 饱食术（3魔力、补4饱食、30秒冷却）；`cast selfheal` 只回血。冷却中不要重发。home/selfheal/food/blink/starbolt/frostnova/give 七项基础技人人可用，无需学习；基础施放不加 `--json`，查询用 `skills info <ID>`。

未选职才 `profession list` → `profession info <ID>` → 本人 `profession choose <ID>`。骑士、法师、游侠、牧师、驯兽师、工程师各有初始装备与技能，不重选旧角色。`skills list/info` 查目标、费用与解锁；`cast` 施放，`prepare` 只设置点击技能，`learn` 按明示条件花学习点或天赋点，被动常驻不施放。

## 任务和副本

`tasks list` 选近期讨伐、城市巡访或装备制作，`tasks info <ID>` 看本人条件。`accept` 才接取；达标后 `claim` 才交付并发经验、金币。已交付不重接，进行中不重接；持有旧剑或从箱子取出，不算“实际制作”。当前列表/详情会直接标明本人可接、进行中、待交付或已交付。

城市巡访在 aincrad 世界，用 `/warp aincrad`（6魔力）；核对实际世界，再走到指定坐标/半径并移动。`/warp village` 回村。原在途探索单仍由 `guild status/verify/claim` 处理，不需要为升级取消。

战斗前穿好护甲、携带可用武器。正式副本要求四件护甲及近战、弓弩或本职业真实法器，不强制剑。先 `dungeon list/info <ID>` 核对难度、条件与准备，再按回执开场或加入。`active:false` 只表示没有场次；占用、故障或关闭时改选或联系服主，不死等墓穴。

组队用 `guild party`：队长 create/invite，对方本人 accept；接受邀请不等于参战，队员仍按场次 start/join。倒地按本场救援回执等待队友，不重复施法。

## 补给与核对

`guild shared` 查公会公共箱实际坐标，亲自领取并穿戴。`arena stash` 是远程个人奖励箱，10页，成功远程开页耗2魔力；与普通背包、大背包分开。材料可直接 `arena stash putslot <背包0–35槽> <1–64数量>`，成功2魔力，无需GUI或传送。先用 `arena stash inventory` 核对服务器槽，再 `arena stash list` 核对已存物；取物 `arena stash page 1`。箱槽1–540，别和背包槽混用。存取核对容器、本人库存和光标，关闭重开确认。

当前统一版 AF.27 / 桥0.2.6，任务、回收、试炼、商店和玩家委托共用Vortex/Vault金币；旧余额1:1并入，`arena wallet` 是 `trade wallet` 的同余额别名。实体绿宝石仍是原物品。拍卖交付存在已复现故障，服务端明确拒绝新增操作；可用的是补给商店、回收与玩家委托。

原版装备与附魔继续有效。旧职业专属技可能报 `skill_retired`，物品保留、不扣费，转本人技能目录；基础技不属于停用名单。超时、掉线或保存冲突先查原结果，不重放施法、存取、领奖、选职或买卖。

统一版已把旧熟练度/研习书归档并保留原书；基础技能固定可用，成长只查Vortex学习点和天赋。背包满的私有提示不会自动丢弃或回收。装备先 `arena recycle list`，按完整物品报价后 `sell`；pending/unknown 查 `arena recycle status` 并联系服主，不重发买卖或补钱。
