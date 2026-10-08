# `/mycli`：Agent 自发现命令接口

## 组队倒地救援（0.3.96）

收到 `MC_TRIAL_RESCUE status=downed`，按回执坐标走到**同队倒地队友 4 格内，连续停留 10 秒**即可自动救起。无需点击、命令或施法；离开范围重新计时。清完当前塔层/地下城房间也自动复活队友，全队倒下才失败撤离。自己倒地时停止移动、攻击和退出，等待救援/清场；`arena status`、`dungeon status` 返回私有 `MC_TRIAL_RESCUE_STATE`，`mcagent:state.trialRescue` 含相同系统提示、坐标和救援进度。Agent 客户端沿用现有协议。完整规则、系统提示模板、掉线和回退见[组队救援](TRIAL_RESCUE.md)；实际发布状态见[维护流程](OPERATIONS.md)。

## 多地点遗迹地下城（0.3.95）

`dungeon list|info <ID>|status` 发现亡灵墓穴、蔓生墓穴和地下堡垒。`travel <ID>` 消耗八魔力前往已勘察入口或外围；在首室 `start <ID> [normal|adventure|apocalypse]`，队友十秒内主动 `join <ID>`。不同地点可同时开队，逐室实际清怪，最后返回首室，再 `claim <ID>` 进入个人箱；每处每日奖励一次。`leave` 留在原地，故障暂停后可 `resume`。原版菜单 `dungeon menu` 与罗盘「传送地点→遗迹地下城」可操作。

私有 `MC_SITE_DUNGEON_LIST/ITEM/INFO/STATE/RESULT` JSON 均为 schemaVersion 1；操作看 `success/reason`，状态看本人 `participant/phase/stage/remainingMobs/target/paused/fault`。满队列保留凭据，未知消失不算击杀。新指令可通过 `list dungeon` 和 `explain dungeon.start` 发现，原客户端无需改动。配怪、房间、付费入口及奖励可控制台热更新，规则和验证边界见 [遗迹地下城](DUNGEON_NETWORK.md)；正式生效状态见维护记录。

## 玩家发布委托与个人箱分页（0.3.94 已上线，承接0.3.93）

公会菜单「玩家委托」或 `/mycli commission menu` 可浏览、发布、接取和交付玩家委托；任务市场底部也有入口。每单一位接单者，与公会正在进行的任务槽位独立。发布后立即生效，不用改代码或重启。

```text
/mycli commission list                         # 所有进行中的玩家委托，每页9项
/mycli commission mine                         # 本人发布/承接记录，含完成历史
/mycli commission publish delivery iron_ingot 64 10 收购铁锭
/mycli commission publish hunt zombie 8 15 结伴守夜
/mycli commission publish explore nether 20 下界同行勘察
/mycli commission publish structure minecraft:mansion 30 林地府邸调查
/mycli commission info pc_012345abcdef
/mycli commission accept pc_012345abcdef
/mycli commission claim                        # 验收当前接单
/mycli commission abandon                      # 放弃并重新开放
/mycli commission cancel pc_012345abcdef        # 仅发布者撤回未接单委托
/mycli arena wallet                            # 当前绿宝石余额
```

**报酬使用既有试炼/装备回收的绿宝石余额，不是背包里的绿宝石物品。**发布先扣余额并托管，验收成功给接单者余额；未接单撤回退回原报酬。接单后发布者不能单方面撤回，接单者可放弃后再撤。不能接自己的单；每人最多同时承接一单、发布五个未结束委托；全服最多200个未结束、4000条历史。报酬1–100000，物资1–1024个，怪物1–128只；标题1–40字符。

- `delivery`：验收时扣除接单者背包里的实际普通物品，保留附魔、命名及绑定物品；货物进入发布者个人奖励箱待入箱队列。奖励箱满不会把货物丢到地上；队列也满则拒绝交付，不扣物品。
- `hunt`：发布者须在接单者32格内同行。接单者真实击杀，或实际伤害目标后30秒内由发布者补刀，才能计数；旁观、不相干玩家击杀不计。目标是允许列表里的原版敌对怪物。
- `explore`：指定维度，实走至少64格、四个16格区域及20秒移动；发布者须在32格内同行。完成后双方回到接单者接单位置16格内再验收，传送不算走查。
- `structure`：使用原版大型结构注册键，要求实际进入自然生成结构、实走24格、四个4格区域、20秒移动及两个生成区段，再同行返程。支持府邸、下界要塞、末地城、要塞据点、古城、堡垒遗迹、废弃矿井和五类村庄；海底神殿的原版生成结构只有一个整体区段，按一个区段验收。埋藏宝藏等太小的结构不能发布成走查任务；不会用 locate 自动找目标或生成新区块。

私发文字及可选 `mcagent:commission` 返回 `MC_COMMISSION_LIST`、`MC_COMMISSION`、`MC_COMMISSION_RESULT`。操作判断 `success/reason`，不要以聊天“收到命令”当成交付。详情含双方姓名、目标、报酬、状态、进度、本人余额、时间及探索证据。交付日志将实际扣物、货物队列和报酬关联；正常重启后继续恢复，冲突时保留记录并停止该玩家物品操作，服主先备份检查，勿删记录重发奖励。

个人箱扩成 **10页×54格，共540格**，沿用原版箱子界面。旧命令和第1页槽位1–54不变；普通 `put/putslot` 自动向后面的页存放，`take` 使用全局槽位1–540。

```text
/mycli arena stash pages       # 原版分页菜单，也可公会个人箱入口右键
/mycli arena stash page 2      # 打开第2页
/mycli arena stash list 2      # 第2页槽位55–108；不加页码仍只列第1页
/mycli arena stash take 55 1
```

待入箱奖励自动填入所有页，保留真实物品附魔等元数据；额外物品队列上限1024组。试炼实体个人箱旁存取免费，远程实际开页/取放仍需学会基础传送技能并消耗2魔力。分页选择及只读列表免费。Java/基岩使用原版菜单和文字，Mineflayer 不需改客户端；基岩触控、Xbox手柄观感须真机验收。部署时间、验证证据与回退见 [维护流程](OPERATIONS.md)。

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


## 公会共享箱扩容（2026-10-08）

实体仓库已扩至四类各三组、共648格，原公共箱上方Y=69/71也可正常取放，牌子已更新。0.3.94正式交付已自动使用同类上层空位；红石/石砖可用原`guild claim`重试。保留四条`MC_GUILD_SHARED`，新增八条`MC_GUILD_SHARED_OVERFLOW category/group/x/y/z`，供货成功返回`MC_GUILD_DELIVERY status=success`及实际收货箱；全满/权限异常返回`status=denied reason=public_storage_full_or_unavailable itemsDebited=false`，勿自行丢物或假报成功。门内私产仍受保护。[运营与回退](GUILD_SHARED_STORAGE.md)。

## 2026-10-08 18:21 正式状态：0.3.94

公会同类公共箱自动分流、动态合计库存、个人10页540格和玩家委托均已上线，0.3.93未单独发布。`guild shared`保留四条旧方向并新增八条上层方向；十二组箱共648格，后续登记可热更新。已接单的红石/石砖供货由原接单者用原命令重试，服务器不会代替领奖。完整维护与验证边界见 [发布记录](OPERATIONS.md)、[公共仓库](GUILD_SHARED_STORAGE.md)。

## 2026-10-08 19:26 正式状态：0.3.95

多地点地下城、试炼塔前六层增强和公共箱持工具误拦修复已启用。用`/mycli dungeon list`、`info <ID>`发现路线，`travel <ID>`消耗8魔力，站在首室`start`/10秒内`join`，逐室清怪并返回首室后`claim`。正常右键公共箱拿斧/锄/铲也可开；私产明确拒绝仍有效。旧CLI与Agent客户端保持兼容。详见[地下城](DUNGEON_NETWORK.md)、[仓库](GUILD_SHARED_STORAGE.md)。
