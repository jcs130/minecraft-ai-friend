# Vortex原生RPG（按需阅读）

先 `/mycli intro` 读四步入门，再核对实际 `status`、`profession list`。Vortex启用时适用本页。旧职业归档，新选择不清空背包；不因资料更新就替真实角色选职。发布状态见官网版本指南。

启用后仍用同一个chat动作和 `/mycli`，不增加MCP工具或预读整套模组指令：

1. `profession list`，按 `info <ID>` 决定，再 `choose <ID>`。六职业由Vortex管理。
2. `skills list`，`info <ID>` 核对等级、学习点、魔力、冷却和目标。初始主动技能已可用；`learn` 学技能树节点，被动不能当主动技施放。
3. `cast <已可用主动技ID>`，等待实际回执和效果。`prepare <ID>` 只改变当前装备技能，不代施放。
4. `tasks list/info/status` 只读；主动 `accept <ID>`，达成目标后 `claim <ID>`，按实际到账回执确认。

基础生存技能恢复候选：`home`归乡、`selfheal`圣愈、`food`饱食、`blink`闪现、`starbolt`星芒箭、`frostnova`寒霜、`give`造物；再加原有`travel/prospect/night/feather`。以实际 `skills list common` 为准，未部署不能假定已解封。无需选职或花点，复用原效果/安全检查，扣同一原生魔力。施放基础技能不加`--json`，先info查目标、费用和冷却。旧 `skills learn travel` 只提示已可用，不重复扣点。个人箱仍 `arena stash`，远程成功开页2魔力；查询与开箱不等于物品已经存取。

多人用 `guild party`，共享物资用 `guild shared`。`skills tree`查本职业天赋；`progress`分开显示战斗成长、冒险者段位和考试。先免费`guild join`，再按`guild exam list/info`选择考试，实际证明齐全才submit。旧在途探索单用`guild status/verify/claim`继续，不必放弃。

组队由队长 `guild party create`、`guild party invite <在线玩家名>`，受邀者本人 `guild party accept`。组队不代表已进入副本，每位队员仍按集结期执行 dungeon start/join。先按该服实际帮助使用格式旗标，未支持时不强加 `--json`。

已学习节点先核对 info/status，不因详情中的学习入口就重复 learn。新版候选详情会区分已学生效、被动常驻和主动施放，`skills status` 可回查 activeSpell；旧回执没有该字段时不能猜已准备。报错先按 nextCommand 处理，冷却、缺魔力或无目标都不是连续重试的理由。

候选中锁定技能的详情会按本人等级、职业与学习状态给出下一步；不把“尚未解锁”的技能推荐为立即施放。骑士 `fortify` 成功后保留原恢复，并补8秒抗性I（原版可减免伤害降低20%，更强抗性保留）；未部署前不能仅凭文档推定有该防御。无目标失败的退款按实际回执和魔力核对，不把粒子或台词当命中证明。

副本开场或加入前须穿齐四件护甲，携带近战、弓弩或本人职业可用的法器，不强制带剑。职业装备使用原版物品和服务端标记，Agent无需额外客户端模组；不能用普通改名物品冒充。缺项按回执整备，弓手记得备箭。

原版附魔继续有效；旧职业专属法术和刻印可能返回 `skill_retired`，表示已停用，物品保留且不扣费。基础生存技不属于旧职业停用名单；若本服仍回此错误，核对发布状态，不反复重试。按回执转本人 `skills list`。`unknown_skill` 与旧技能停用是不同原因。`skills status <ID>` 保留为单项详情入口。

旧地图活动、救援、个人箱和楼层证明继续由原服务保存；旧职业账本只读。交易、地图、照片与日记沿原入口，不把预览商店清单或NPC台词当真实开业、接单或发奖证明。

只查询当前需要的能力。超时或断线后的执行结果先核对，不能自动重复施法、存取、领奖或选职。进一步说明见 [候选维护记录](https://github.com/jcs130/minecraft-ai-friend/blob/main/paper/integrations/vortex-rpg/TAKEOVER.md)。
