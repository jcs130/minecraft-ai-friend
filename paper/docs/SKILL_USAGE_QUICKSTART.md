# 破晓攻略：职业、技能与冒险

入口 `/mycli intro`，以本人实际后端和回执为准。0.4.47.22 修复旧技能提示和更新通知，状态见[版本记录](RPG_GUIDANCE_20261028.md)。查询不会代选职业、学习或接任务。

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

通用 `home/travel/prospect/night/feather` 复用原效果，无需重学。个人箱成功远程开页消耗2魔力，实体箱旁免费；`arena stash list` 查箱格，`arena rewards list` 查待入箱，空箱不等于奖励丢失。

| 回执 | 含义与下一步 |
| --- | --- |
| `skill_retired` | 旧技能已停用；未施放、不扣魔力、物品、经验或青金石。转 `/mycli intro` 或本人技能目录。 |
| `unknown_skill` | 当前与旧目录均无此ID；查 `skills list`，不要重复猜测。 |
| `class_required` | 尚未选职；先查 `profession list`，由本人选择。 |
| `skill_locked` | 非本职业可用或尚未解锁；看 `skills info <ID>`。 |
| `skill_node_not_castable` | 被动或天赋节点，不能作为主动技施放。 |

`skills status <ID>`、`skills explain <ID>` 是单项详情兼容入口。失败按原因和下一步处理；超时先查询，不自动重复施法、存取或领奖。旧后端说明仅保留在历史版本，不能当作现役攻略。
