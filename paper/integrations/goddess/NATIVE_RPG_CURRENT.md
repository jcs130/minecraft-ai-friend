# 破晓攻略：职业、技能与冒险

入口 `/mycli intro`，以本人实际后端和回执为准。当前0.4.47.27/桥0.2.6已统一RPG技能、金币与背包引导，见[发布记录](RPG_UNIFIED_20261028.md)。寒霜、星芒箭、闪现、归乡、圣愈、饱食、造物无需选职或学习，先查 `/mycli skills list common`；查询不会代选职业、学习或接任务。

1. `/mycli profession list` 看六职业，`profession info <ID>` 看条件，再主动 `profession choose <ID>`。
2. `/mycli skills list` 看本职技能，`skills info <ID>` 看目标、效果、等级、耗魔和冷却。初始主动技选职后可直接 `/mycli cast <ID>`；`skills prepare <ID>` 设置职业装备的点击技能。`skills learn <节点ID>` 仅按详情花点；被动不能施放。
3. `/mycli tasks list` 看讨伐、巡访、打造和攻略；先 `tasks info <ID>` 再 `tasks accept <ID>`，按 `tasks status` 的真实缺项行动，达标再 `tasks claim <ID>`。原公会在途单用 `/mycli guild status` 继续。
4. 穿齐护甲、备好职业武器与补给，`/mycli dungeon list`、`dungeon info <ID>` 看难度再入场。公共补给 `/mycli guild shared`，个人箱 `/mycli arena stash`。

| 职业 | 初始主动技 | 初始装备的原版载体 |
| --- | --- | --- |
| 骑士 knight | fortify | 铁剑 |
| 法师 mage | arcane_bolt | 烈焰棒法杖 |
| 游侠 ranger | hunter_mark | 弓 |
| 牧师 cleric | mend | 书本圣典 |
| 驯兽师 beastmaster | beast_call | 骨头图腾 |
| 工程师 engineer | deploy_turret | 时钟工具包 |

装备由服务端真实标记识别，Java、Mineflayer、Numen、基岩沿用原版物品协议，无需额外模组。改名书或木棍不能冒充职业法器；驯兽和工程初始技当前是伤害战技，不会生成常驻宠物或炮塔。

副本新开场、加入和试炼入口需要头、胸、腿、脚四件护甲，以及近战、弓弩或本人职业可用的法器，不强制剑；缺项返回 `equipment_required` 和补给入口，不创建场次。弓手仍需备箭。

## 旧装备与旧技能

原版效率、锋利、保护、经验修补继续生效。旧装备、附魔、自定义刻印标签和履历保留；保留旧刻印不代表旧技能可施放。旧四职业及旧战斗、生活法术已归档，不能再按旧学习和准备槽操作。

通用 `home/selfheal/food/blink/starbolt/frostnova/give/travel/prospect/night/feather` 复用原效果，无需重学。个人箱成功远程开页消耗2魔力，实体箱旁免费；`arena stash list` 查箱格，`arena rewards list` 查待入箱，空箱不等于奖励丢失。

金币统一：旧试炼余额1:1迁入Vortex/Vault/Essentials；任务、回收、试炼、商店与玩家委托托管共用。余额 `trade wallet`，`arena wallet` 同账户；实体绿宝石仍是原物品。原生拍卖交付故障尚未修好，已拒绝新增操作。

满包与旧书：`arena stash inventory` 查0–35槽，再 `arena stash putslot <槽> <数量>` 直接远程存本人箱，成功2魔力；`arena stash list` 核对，`arena stash page 1` 取物。装备回收先list/quote再sell，未知查recycle status并联系服主，不重发。旧研习书不消耗，升级看 `skills status/tree`。

旧熟练度不再增长或提高技能等级；旧研习书归档保留，职业升级统一Vortex学习点和天赋。

| 回执 | 含义与下一步 |
| --- | --- |
| `skill_retired` | 旧技能已停用；未施放、不扣魔力、物品、经验或青金石。转 `/mycli intro` 或本人技能目录。 |
| `unknown_skill` | 当前与旧目录均无此ID；查 `skills list`，不要重复猜测。 |
| `class_required` | 尚未选职；先查 `profession list`，由本人选择。 |
| `skill_locked` | 非本职业可用或尚未解锁；看 `skills info <ID>`。 |
| `skill_node_not_castable` | 被动或天赋节点，不能作为主动技施放。 |

`skills status <ID>`、`skills explain <ID>` 是单项详情兼容入口。失败按原因和下一步处理；超时先查询，不自动重复施法、存取或领奖。旧后端说明仅保留在历史版本，不能当作现役攻略。
