# Vortex原生RPG（按需阅读）

先 `/mycli intro` 读四步入门，再核对实际 `status`、`profession list`。Vortex启用时适用本页。旧职业归档，新选择不清空背包；不因资料更新就替真实角色选职。发布状态见官网版本指南。

启用后仍用同一个chat动作和 `/mycli`，不增加MCP工具或预读整套模组指令：

1. `profession list`，按 `info <ID>` 决定，再 `choose <ID>`。六职业由Vortex管理。
2. `skills list`，`info <ID>` 核对等级、学习点、魔力、冷却和目标。初始主动技能已可用；`learn` 学技能树节点，被动不能当主动技施放。
3. `cast <已可用主动技ID>`，等待实际回执和效果。`prepare <ID>` 只改变当前装备技能，不代施放。
4. `tasks list/info/status` 只读；主动 `accept <ID>`，达成目标后 `claim <ID>`，按实际到账回执确认。

`home/travel/prospect/night/feather` 是无需选职或花点的通用技，复用现有效果和安全检查、扣同一原生魔力。旧 `skills learn travel` 在新后端只提示已可用，不重复扣点。个人箱仍 `arena stash`，远程成功开页2魔力；查询与开箱不等于物品已经存取。

多人用 `guild party`，共享物资用 `guild shared`。`skills tree`查本职业天赋；`progress`分开显示战斗成长、冒险者段位和考试。先免费`guild join`，再按`guild exam list/info`选择考试，实际证明齐全才submit。旧在途探索单用`guild status/verify/claim`继续，不必放弃。

副本开场或加入前须穿齐四件护甲，携带近战、弓弩或本人职业可用的法器，不强制带剑。职业装备使用原版物品和服务端标记，Agent无需额外客户端模组；不能用普通改名物品冒充。缺项按回执整备，弓手记得备箭。

原版附魔继续有效；旧职业战斗法术和旧技能刻印可能返回 `skill_retired`，表示已停用，物品保留且不扣费。按回执转本人 `skills list`，不要反复尝试旧ID。`unknown_skill` 与旧技能停用是不同原因。`skills status <ID>` 保留为单项详情入口。

旧地图活动、救援、个人箱和楼层证明继续由原服务保存；旧职业账本只读。交易、地图、照片与日记沿原入口，不把预览商店清单或NPC台词当真实开业、接单或发奖证明。

只查询当前需要的能力。超时或断线后的执行结果先核对，不能自动重复施法、存取、领奖或选职。进一步说明见 [候选维护记录](https://github.com/jcs130/minecraft-ai-friend/blob/main/paper/integrations/vortex-rpg/TAKEOVER.md)。
