# `/mycli`：Agent 自发现命令接口

## 职业与传承（0.3.92）

新增 `profession status|list|menu|choose|leave`、`skills mine|menu|prepare|unprepare`，沿用旧 `skills list|explain`。`list cast`、`explain cast.<ID>` 及 `spells` 动态发现新技能。两个状态频道保持 schemaVersion 1 和原字段语义，仅增加可选 `profession` 及本人当前合格的新 abilities；无需修改 Agent 客户端。私有回执、任务解锁、装备与魔力规则见 [职业与传承](CHARACTER_SKILLS.md)。部署状态以维护记录为准。

## 工程建筑与公共地标（0.3.91）

`landmark list|mine|info|menu|publish|update|unpublish|cancel` 和 `goto landmark:<领地ID>` 已接入 CLI 图鉴。主人登记免费，成功传送 6 魔力；解析 MC_LANDMARK_RESULT 的 pending/最终回执、MC_TRAVEL 与实际位置。完整 JSON 单播 mcagent:landmark，目录逐条短消息；权限与配置见 [工程地标](PROJECT_LANDMARKS.md)。


适用 Paper 1.20.6 的 AgentFriend 0.3.37 起。玩家账号通过原版聊天发送命令；Java、基岩和 Mineflayer 收到的文字回执相同。它不依赖客户端模组，也不把命令目录广播给别人。服主控制台的 `admin` 命令不在玩家目录内。0.3.38 新增 `/mycli coach status|on|off`，用于管理个人低频游玩提醒，规则见 [Agent 游玩提醒](AGENT_COACH.md)。

## 从发现到执行

```text
/mycli list                         # 顶层命令，第 1 页
/mycli list roots 2                 # 顶层命令第 2 页
/mycli list cast                    # 所有施法子命令，第 1 页
/mycli list cast 2                  # 下一页
/mycli list adventure               # 按玩法分类
/mycli list all 1                   # 完整目录
/mycli explain cast.prospect        # 稳定 ID
/mycli spells list 1                # 自研法术目录，第 1 页
/mycli spells explain starbolt      # 单项法术的完整效果、目标与成本
/mycli explain cast prospect        # 空格写法也支持
/mycli help arena.stash.take        # help <ID> 是 explain 别名
```

`list` 默认只列顶层命令，每页最多七项。`MC_CLI_LIST` 的 JSON 包含 `schemaVersion`、`filter`、`page`、`pages`、`total`、`pageSize`；之后每项是一行 `MC_CLI_ITEM`，有 `id`、`category`、`mode`、`summary`。未到末页时另给 `MC_CLI_NEXT /mycli list <过滤器> <下一页>`。过滤器可以是 `all`、`roots`、类别（如 `magic`、`adventure`、`storage`、`safety`）或顶层命令（如 `cast`、`guild`、`arena`）。

`explain` 返回一行 `MC_CLI_DETAIL` JSON：`schemaVersion`、`id`、`category`、`mode`、`usage`、`summary`、`requires`、`returns`。`mode=read` 仅表示该**目标命令**主要用于查询；`write`、`item`、`cast`、`teleport`、`gui`、`message` 分别提示可能修改状态、物品、施法、位置、界面或向女神发消息。`list`、`explain` 和 `help <ID>` 自己始终只读，绝不代执行目标命令。无效 ID、过滤器和页码只返回 `MC_CLI_ERROR` JSON 的 `code`、`hint`，不猜测相似命令并执行。

从 AgentFriend 0.3.76 起，`/mycli spells list [页码]` 每页最多七项，返回仅对本人可见的 `MC_SPELL_LIST`（`page/pages/total`）、逐项 `MC_SPELL_ITEM`（稳定 `id/name/category/mana/cooldownMs/command`）及可选 `MC_SPELL_NEXT`。`/mycli spells explain <ID>` 返回单条 `MC_SPELL_DETAIL` JSON，含 `effect`、`target`、`requires`、`onFailure`、`scaling`、`tip` 和准确施法命令；未知 ID/坏页码返回 `MC_SPELL_ERROR`。原有 `/mycli explain cast.<ID>` 现在还带 `spell` 子对象，内容与 `MC_SPELL_DETAIL` 相同。查询不会施法，不扣魔力，也不会写入其他玩家聊天。`mana` 和 `cooldownMs` 是该技能的静态成本和总冷却；当前魔力及剩余冷却以本人 `mcagent:state` 为准。造物术固定配方与向女神申请缺项的成本不同，以 `requires` 和 `onFailure` 为准。

解析时去掉行首固定前缀后按 JSON 读取，不能依赖中文说明的标点或输出顺序。目录是**命令契约**，不是实时背包、当前任务或世界状态。实际执行前按需查询 `/mycli status`、`guild board`、`arena status`、`waypoint`、`focus list`、`arena stash inventory|list`。`explain` 的前置条件是摘要，真正能否执行仍以该命令当次回执为准。

0.3.89 可用 `/mycli list waypoint` 发现命名地点管理：`add 下界营地` 记录亲自到达的位置，`goto personal:下界营地` 每次成功耗 6 魔力；`share` 返回 `shared:分享码`，`unshare` 立即撤回。中文命名、默认私有、分页、改名与更新见 [命名传送点](NAMED_WAYPOINTS.md)。查询用 `MC_WAYPOINT_LIST`，操作用 `MC_WAYPOINT_RESULT`；传送的 `status=pending` 需继续等待最终 `success/denied` 和实际 `MC_TRAVEL`，不能当作已抵达。旧 home 仍走原路径。

建议 Agent 在首次进入或服务器版本变化后 `list` → `explain`，缓存稳定 ID 与用法；准备施法时再用 `/mycli spells explain <ID>` 核对目标、魔力、冷却及失败条件。有动作前仍检查当前状态。挖掘、放置、开箱或使用前使用 `/mycli protect break|place|container|use <绝对x> <绝对y> <绝对z>`，从本人连接的 `mcagent:protection` plugin message 读取 JSON；0.3.90 也发 `MC_PROTECTION` 聊天回执。`deny` 不操作、`unknown` 暂缓、`allow_likely` 才尝试；实际事件仍是最终判定。箱子优先按原版容器协议操作实体箱，`arena stash` 是远程辅助接口。`MC_CLI_*` 仍仅通过系统聊天发给发命令的玩家。

0.3.90 用 `/mycli land here|list [页码]|info <ID>|menu` 查询主人与自身权限；发现入口 `/mycli list land`。查询聊天拆为 `MC_LAND_INFO` 和 `MC_LAND_PERMISSIONS`，分页为 `MC_LAND_LIST` + 逐条 `MC_LAND_ITEM`，原始 `mcagent:land` JSON 带同名 `type`。实际拒绝 `MC_LAND_ACCESS allowed=false` 后停止重试，公会物资转 `/mycli guild shared` 的公共箱；旧 `MC_GUILD_ACCESS` 继续可用。授权和撤权在线生效，不能缓存一次允许就永久操作。规则及回执字段见 [玩家领地](LANDS.md)。

0.3.81 起，Agent 主动传送前需从本人 `mcagent:state.mana.current` 预留魔力：归乡、地点、公会和竞技场入口 6；队友、遗迹和深层驿站 8。`MC_DESTINATION` 只是目标坐标，成功瞬移以 `MC_TRAVEL` 和实际位置为准；失败不扣费。远程开个人箱或用文字指令成功远程存取、领取一次消耗 2 魔力，返回 `MC_STORAGE_MAGIC`；到实体箱旁按原版容器协议操作免费。详情见 [位移与远程物品操作](TRAVEL_MAGIC.md)。

目录元数据在 `AgentCliCatalog.java`，实际命令派发仍在 `AgentFriendPlugin.java`、`GuildManager.java`、`DungeonManager.java` 等。新增、改名或修改行为时必须同步目录中的 ID、前提、回执说明；不要把控制台管理命令加入玩家列表。隔离服回归脚本 `plugins/AgentFriend/mycli-catalog-stage.mjs` 用 Mineflayer 检查翻页、两种 explain 写法、错误码及查询无状态副作用。客户端画面与手柄操作仍需真实客户端体验验收。

## 0.3.92 技能点与职业（发布状态见维护记录）

`profession choose warrior|mage|priest` 只解锁入门学习资格。`skills points/info <ID>/mine` 查询；`skills learn <ID>` 与 `upgrade <ID>` 明确花点，`prepare/unprepare` 调整四项主动和一项传承。`skills respec confirm` 默认10魔力、5分钟冷却，退回实际已花点数，保留解锁资格、唯一归属和旧施法冷却。旧基础资格保留，新玩家需学习通用技能。

新增私有 `MC_SKILL_POINTS` 和 `MC_SKILL.level/maxLevel/nextPointCost/levels[]`；`MC_SKILL_UNLOCK` 表示资格，不表示免费学会。旧状态 schemaVersion 与频道保持，profession.points 为增量字段。命格书、原版学习/洗点确认菜单提供真人入口。详情见 [战法牧与技能点](CHARACTER_SKILLS.md)。
