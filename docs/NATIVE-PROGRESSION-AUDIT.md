# 原生成长、属性与铁魔法接入审计

2026-09-07；只读审计。核对当前 JAR、相关配置、源码及迁移清单中的原 59 份玩家数据，仅记录聚合数值。初始审计没有修改世界、玩家、技能状态或部署服务；后续按根任务授权修复了 D 项目等级同步源码，未触碰存档或部署。机器报告见 `reports/native-progression-audit.json`。

可复用现有模组做统一面板和施法入口；保留四套数据的原有职责，无需清空存档或再做一套等级系统。

| 系统 | 现有职责与存储 | 最小接入方式 |
| --- | --- | --- |
| 原版经验 | `playerdata/*.dat` 的 `XpLevel / XpP / XpTotal` | 当前等级直接读 `XpLevel`，作为显示及已有自研技能门槛 |
| Pufferfish Skills 0.18.3 | `data/puffish_skills.dat` 内按玩家保存战斗/采矿经验、解锁技能和点数来源 | 展示原生分类经验与可用点数，打开原生技能树，不另存一套技能树等级 |
| Pufferfish Attributes 0.8.3 | 原生实体属性及修改器，如采矿速度、生命恢复、近战伤害、抗性 | 属性面板读在线最终值；后续成长奖励使用已有属性修改器 |
| Default Skill Trees 1.1 | 两套技能树、经验来源和属性奖励的资源定义 | 保留分类和技能 ID，避免已学节点失效 |
| Iron’s Spells 3.16.3 | 法术书、法术等级、装备属性、原生魔力、施法和冷却 | 通过原生 API/交互选择和施法；面板读原生魔力及装备计算后的上限 |
| 自研魔法 | `world-data/magic-state.json` 的已学技能、自研魔力、永久加成、冷却及被动 | 保留原技能账本；先标明“自研魔力”，后续有映射再逐人切换魔力后端 |

Pufferfish 的经验曲线按分类配置，与原版经验独立；技能奖励可直接指定原生属性 ID。铁魔法的成长围绕法术等级、法术书和装备展开，不能把它的法术等级当成玩家 `XpLevel`。[Pufferfish 经验配置](https://puffish.net/skillsmod/docs/creators/configuration/files/experience)、[属性奖励](https://puffish.net/skillsmod/docs/creators/configuration/rewards/built-in/attribute)、[铁魔法成长说明](https://iron.wiki/progression/)。

## 原存档已有内容

- 原 59 份玩家文件全部仍在；持久化原版等级范围为 0–48。
- 43 名原玩家已存在 Pufferfish 分类记录。采矿经验最高 1049、最多解锁 3 个节点；战斗经验最高 825、最多解锁 16 个节点。报告中的点数来源合计不是“剩余点数”，剩余值应通过 `CategoryData.getPointsLeft` 或原生查询命令获取。
- 8 份原玩家文件已有 `neoforge:attachments/irons_spellbooks:magic_data`，保存魔力范围为 11–112。未出现 attachment 不表示缺失模组，默认/未使用状态可能没有该持久化条目。
- 玩家 NBT 的属性数组实际为小写 `attributes`，元素字段为 `id/base/modifiers`。仅靠存档中的条目无法得出装备、临时修改器和默认属性共同计算后的当前属性；在线面板应读 `AttributeInstance`。
- 自研状态当前包含 28 个角色（含 QA，不能当作原玩家人数），魔力上限 100–683，4 个角色有永久魔力加成，5 个角色有已学技能记录。已学技能、书、冷却和永久奖励都应保留。

## 已有代码复用与风险

`world/src/mc-magic.ts:1777` 已在施法时读原生 `XpLevel`。其 `maxManaFor`（1167 行）另外计算 `maxManaDefault + 12 × max(0, level − 1)`，再叠加 `maxManaBonus`；1090 行每次取状态都重算上限，并使用自研恢复逻辑。这部分与铁魔法的魔力属性、恢复和消耗重复，当前不能把两个数字直接混成一个。

`world/src/mc-god.ts:2353` 的冥想已经调用 Pufferfish 分类经验命令，2365–2366 行的成长查询也复用了原生经验/点数。冒险者 F–S 段位（1345 行起）是活动的汇总展示，可继续保留为称号。不要把段位再回写成原版等级。

**已在 D 源码修复、尚待统一部署的既有问题：** `world/src/mc-god.ts:3363` 按 `XpTotal` 推导所谓正确等级并自动执行 `xp set ... levels`，与“只读原生等级”的注释相反。本机 Minecraft 1.21.1 `Player.onEnchantmentPerformed` 和 `giveExperienceLevels` 字节码确认：正常扣除等级时不会同步减少 `totalExperience`，仅等级变成负数时才重置。因此 `XpTotal` 不是当前等级必须满足的严格不变量，当前自动修复可能退还正常附魔/铁砧花掉的等级，或修改命令产生的合法等级。应取消自动写回，保留只读诊断；不能凭此批量“修复”原玩家。随后按授权移除了该函数的所有自动经验写回，只读 `XpLevel` 并保留每玩家最多 5 分钟一次的诊断。`node tests/test_xp_level_sync.cjs` 使用实际函数及隔离 I/O 回归，验证花级不返还、命令等级不误降、诊断限频、离线不覆盖缓存以及升级公告保留；本任务没有部署服务或修改玩家数据。

Default Skill Trees 内仍有旧式 `puffish_skills:player.*` 属性 ID。当前日志显示 Pufferfish 配置与数据加载成功，尚未证明旧别名损坏。应在独立 QA 上验证节点生效值后再改定义，不能仅凭名字旧就批量替换技能 ID。

## 最小迁移路线

1. 先统一展示：原版等级、战斗/采矿经验及可用点数、生命/护甲等在线属性、铁魔法当前/最大魔力和选中法术。自研魔力在切换前单独标识。
2. 铁魔法技能走模组自身选择、目标判断、消耗、冷却和网络同步；自研工具技能继续原执行器。不能仅凭相似中文名称将原 72 项技能映射成铁魔法法术。
3. 新的成长奖励尽量用 Pufferfish 原生属性奖励，保持旧分类和节点 ID。必要的“学技能树节点→解锁自研技能”桥接必须按节点和玩家幂等。
4. 需要统一魔力时，先快照，在新 QA 角色上试用可选原生魔力后端。旧 JSON 保留；永久奖励可使用明确命名、可逆且不会重复添加的属性修改器。不能覆盖 Iron 属性基础值或把装备加成再算一遍，也不宜无说明地把旧公式的数百点上限全变成 Iron 永久加成。
5. 迁移角色只允许一个魔力扣费/恢复来源，保留迁移版本、旧值及应用的修改器 ID。原生 `MagicData.setMana` 的存在不代表单独调用就完成客户端同步，应复用原生服务器线程和同步路径。

已从安装 JAR 核实 `MagicData.getPlayerMagicData/getMana/setMana/addMana`，以及 Iron 的 `MAX_MANA/MANA_REGEN/SPELL_POWER/CAST_TIME_REDUCTION/COOLDOWN_REDUCTION` 等属性；Pufferfish 提供分类查询、可用点数、解锁事件和打开技能树 API。可据此做小型桥接，无需重写模组内部系统。[Iron 官方属性注册源码](https://github.com/iron431/irons-spells-n-spellbooks/blob/1.21/src/main/java/io/redspace/ironsspellbooks/api/registry/AttributeRegistry.java)。源码分支可能高于本机版本，实现仍需以已安装 3.16.3 API 为准。

部署前应在隔离 QA 验证：重登数据保留、花费原版等级不被退还、换装备属性联动、一个 Iron 法术的原生魔力和冷却、一个旧自研技能、技能树消费点数，以及原玩家和原节点数量不减。本报告属于静态审计，不代替其他任务正在制作的原生桥接运行验收。
