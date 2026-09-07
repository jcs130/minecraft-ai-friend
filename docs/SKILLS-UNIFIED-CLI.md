# 技能罗盘、咏唱与 Agent CLI

2026-09-07 按用户要求精简旧技能。战斗、治疗和常见增益使用 Iron’s Spells ’n Spellbooks；自研系统默认只开放以下 8 项特色秘术。原 72 条定义保留作迁移档案，其中 57 项旧主动施法已停用、7 项被动继续保留历史解锁，不能把“仍有数据”理解成“仍可释放”。

| 秘术 | CLI ID | 基础消耗 | 罗盘图标 |
|---|---|---|---|
| 归乡 | `home` | 20 秘术魔力 | `minecraft:compass` |
| 空间传送 | `tp` | 20 秘术魔力 | `minecraft:ender_pearl` |
| 造物术 | `give` | 20 秘术魔力 | `minecraft:crafting_table` |
| 燃血术 | `blood_mana` | -15 秘术魔力，6 生命值 | `minecraft:redstone` |
| 化水术 | `spring` | 12 秘术魔力 | `minecraft:water_bucket` |
| 御空术 | `sky_walk` | 30 秘术魔力，2 饥饿值 | `minecraft:elytra` |
| 羽落之靴 | `feather_boots` | 20 秘术魔力，1 饥饿值 | `minecraft:leather_boots` |
| 烟花术 | `fireworks` | 5 秘术魔力 | `minecraft:firework_rocket` |

负魔力表示补充秘术魔力；空间传送另按距离计费。以实际状态和回执为准，界面中的数值是打开时快照。

## 游戏中使用

真人咏唱使用自制言灵杖：长按右键 / LT 举起，窗口默认语音，说“咏唱烟花术”等咒语，松开使用键释放。左右肩键（键盘 Page Up / Page Down）可在语音与 8 个快捷槽间切换，松手释放所选槽位；不用打开聊天框。技能罗盘 → “编辑快捷栏”可设置、清空和恢复推荐。完整操作与验收边界见 [语言即接口](LANGUAGE-INTERFACE.md)。

右键带 ✦ 标记的技能指南针，或 F6，打开三行技能罗盘。顶栏固定“铁魔法”和“传送阵”，中间显示已学精选秘术；底部提供档案、刷新、翻页与关闭。档案仅展示旧技能及原生替代说明，不会点击施放或发放物品。F7 仍为千灯手札。普通指南针不带技能标记时不被接管。

- `/mycli spells`：查看自己实际装备的原生法术。装备法术书或手持卷轴后才能使用。
- `/mycli spells legacy`：查看 8 项特色秘术；`/mycli spells archive`：查看全部 64 项档案。
- `/mycli cast irons_spellbooks:firebolt`：原生火焰弹；`/mycli cast fireworks`：特色烟花术。
- `/msg Goddess 咏唱：铁魔法：隐身术`：完整中文原生咏唱；`/msg Goddess 咏唱：烟花术`：特色秘术咏唱。
- `/mycli cancel`：取消原生施法；`/mycli status`：查询生命、原版等级、铁魔法属性与 Pufferfish 成长。
- `/mycli skillbar set 8 fireworks`：配置第 8 槽；`skillbar clear 8` 清槽，`skillbar auto` 推荐精选技能。

八槽快捷配置与罗盘九个技能展示位是两个用途不同的布局。已有归档技能绑定在视图中空置，原始绑定记录保留；重新配置该槽才明确替换。被动能力不占主动槽。

Controlify 使用 Minecraft 标准容器导航，A 确认、B 返回；这些是罗盘编辑操作，举杖期间不需额外确认。实际菜单与防止长按重复触发的逻辑已纳入验收；实体手柄、真人麦克风与扬声器听感仍单独验收。上面的 CLI 保留供 Agent、调试及偏好命令的玩家使用。

## 传送阵

继续使用原公共地点和每人的私人地点，保留公共在前、私人在后的列表顺序。罗盘中传送阵单独分页，超过旧界面的 8 个地点也能选取。

```text
/mycli menu waypoints
/mycli waypoint
/mycli waypoint add 山间营地
/mycli goto personal:6
/mycli goto shared:1
/mycli waypoint remove personal:6
```

固定编号 `shared:id` / `personal:id` 用于菜单与 Agent，删除其他地点不会使其指向不同地点；私人编号删除后不再复用。原数字与完整名字入口继续可用，但重名会列出候选，不会擅自传往第一个结果。旧的 `waypoint 删 2` 仍表示个人列表第 2 项，而非全局第 2 项；优先用明确的 `personal:id`。

新增点读取当前角色真实维度和坐标。实际传送由服务端检查目标维度、世界边界、碰撞、地面与危险方块，在原坐标水平 2 格、上下 4 格内找安全站位；没有安全站位则拒绝。只加载明确选中的地点附近，不扫描或修建地形。旧世界位置若已不再适用，应抵达合适地点后重新记点。

各入口共用 3 秒原生传送冷却。成功回执包含真实维度与抵达坐标；连接或回执不确定时返回 `outcome_unknown`，不重放。正本损坏时保留原文件并停用写入，不再用初始地点覆盖；正本和菜单镜像分别原子更新。

## Agent CLI

```powershell
python tools/skill_cli.py --actor Naruto spells
python tools/skill_cli.py --actor Naruto cast irons_spellbooks:firebolt
python tools/skill_cli.py --actor Naruto spells legacy
python tools/skill_cli.py --actor Naruto cast fireworks
python tools/skill_cli.py --actor Naruto waypoint
python tools/skill_cli.py --actor Naruto goto personal:6
python tools/skill_cli.py --receipt <requestId>
```

必须先连接既有身体，CLI 不自动召唤角色。原档含同名鸣人/桐人身体，原生接口遇同名在线角色会拒绝选择；使用准确 UUID 查询或施放。特色秘术账本仍按唯一登录名管理，本轮不合并历史同名账本。

MCP `goddess_cli` 使用相同持久化请求通道，`skill_receipt` 查询回执。白名单包含 help、commands、status、skills、spells、cast、cancel、skillbar、menu、waypoint、goto；未知命令不交给语言模型猜动作。

每个请求只执行一次。重复 ID 查询返回已有回执，`pending` / `outcome_unknown` 不代表未发生动作。`casting_started` 仅代表原生模组受理施法，不保证命中；继续查询原生状态确认。原生装备、法力、冷却、目标、打断和卷轴消耗均由铁魔法处理。

## 原进度与精简边界

停用的旧主动技能返回 `skill_archived` 和原生参考 ID；参考表示类似用途，可能范围或机制不同，不自动解锁、发书或替换玩家装备。新角色天赋、推荐栏及女神建议只取当前精选秘术。

原被动、已有附魔装备、永久生命/魔力奖励、已学与天赋记录保留。精选秘术仍使用旧魔力账本；原生铁魔法只使用原生法力，不会再扣一份秘术魔力。原版等级只读 XpLevel；Pufferfish 等级、经验与点数读取其 API。进一步合并奖励与资源需明确迁移规则。

详细逐技能去留见 `SKILL-CONSOLIDATION-AUDIT.md`，传送方案见 `TELEPORT-ARRAY-AUDIT.md`。本轮实际结果以 `reports/skill-compass-smoke.json`、`reports/waypoint-travel-smoke.json` 和 `reports/skill-compass-deployment.json` 为准；此前 72 技能阶段的羽落测试属于历史基线。
