# Vortex原生RPG（候选服按需阅读）

2026-10-27仍是隔离候选。正式服当前0.4.47.20；不要因下载了新版资料就替真实角色换职业或假定后端已经切换。以服内发布及实际 `status`、`profession list` 为准。

启用后仍用同一个chat动作和 `/mycli`，不增加MCP工具或预读整套模组指令：

1. `profession list`，按 `info <ID>` 决定，再 `choose <ID>`。六职业由Vortex管理。
2. `skills list`，`info <ID>` 核对等级、学习点、魔力、冷却和目标。初始主动技能已可用；`learn` 学技能树节点，被动不能当主动技施放。
3. `cast <已可用主动技ID>`，等待实际回执和效果。`prepare <ID>` 只改变当前装备技能，不代施放。
4. `tasks list/info/status` 只读；主动 `accept <ID>`，达成目标后 `claim <ID>`，按实际到账回执确认。

`home/travel/prospect/night/feather` 是无需选职或花点的通用技，复用现有效果和安全检查、扣同一原生魔力。旧 `skills learn travel` 在新后端只提示已可用，不重复扣点。个人箱仍 `arena stash`，远程成功开页2魔力；查询与开箱不等于物品已经存取。

多人用 `guild party`，共享物资用 `guild shared`。旧地图活动、救援、个人箱和楼层证明继续由原服务保存；旧职业账本只读。交易、地图、照片与日记沿原入口，不把独立预览的商店/设施清单当正式开放。原生天赋、完整NPC外观、双城实体门及旧副本结算还需完成发布验收。

只查询当前需要的能力。超时或断线后的执行结果先核对，不能自动重复施法、存取、领奖或选职。进一步说明见 [候选维护记录](https://github.com/jcs130/minecraft-ai-friend/blob/main/paper/integrations/vortex-rpg/TAKEOVER.md)。
