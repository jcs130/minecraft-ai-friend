# 桐人的自主生活、任务与成长

2026-09-09 营地下施工范围补齐：原营地 `x[-645,-636], z[1050,1059], y[62,73]` 的最低高度精确改为55，其他施工范围与城镇保护不变。实际桐人在同营地下方Y56矿坑、背包44泥土，原生放置预检因施工最低高度拒绝；同样相邻石头顶面上的泥土动作在补齐范围后通过预检。配置与原目标文件已备份，更新事实通过原目标记忆和复盘队列进入同生活会话。单格预检不证明整条阶梯可行，脱困须由角色感知、使用本人材料、逐步执行后验收；没有系统传送或新物品写入。生活复盘与原生记忆见 [QwenPaw 生活记忆](QWENPAW-LIFE-MEMORY.md)。

源码与部署核对：2026-09-08。本轮把原有持续调度与可编程技能接到建造、农耕、容器、村民交易和公会生活。大脑仍是游戏 QwenPaw 的 `qd-survivor`，身体仍是原 `Kirito`；没有另起守卫大脑、替换原角色或另造一套经验与奖励系统。本文区分**接口已实现**与**生产实机已验收**。

总体架构与已有实验见 [自主生存 Agent](AUTONOMOUS-SURVIVOR.md)，研究原始出处见 [Minecraft AI 参考项目](MINECRAFT-AGENT-REFERENCES.md)。

## 当前模型真正能调用什么

[mcp_server.py](../world/survival/mcp_server.py) 的 `TOOL_NAMES` 和实际注册函数均为 **39 项**。这不是 39 个游戏动作：其中 **17 项**通过动作租约操作身体，其余负责观察、目标记录和程序学习。运行实例仍须同步 DriverCard 并验证真实工具清单；文档不能授予尚未加载的工具。

| 分组 | 当前 MCP 名称 | 作用与条件 |
| --- | --- | --- |
| 身体与环境（3） | `status`、`look`、`world_perception` | 真实身体/库存、附近实体与天气时间、缓存聊天和世界事件。`look` 半径 4–12；事件缓存不重复消费游标。 |
| 原有身体动作（5） | `move`、`mine`、`craft`、`eat`、`equip` | 一轮一次动作；移动保持 `walk_only_v1`，采矿/合成复用 Numen 和真实材料。 |
| 方块观察（2） | `inspect_block`、`scan_blocks` | 精查方块状态，或在已加载的有限范围查找实际 ID / 标签。扫描不能代替施工前精查。 |
| 建造与耕作（2） | `place_block`、`farm` | 建设区域内使用背包材料、锄与种子；核对实际方块、物品变化与地块归属。 |
| 容器（4） | `open_container`、`inspect_container`、`transfer_items`、`close_container` | 自己已验证放置或明确授权的实体储物方块；观察不占动作，开关和转移占动作。 |
| 睡眠（1） | `sleep` | 使用近处实际床，原生 `sleeping:true` 才是入睡证据。 |
| 原生交易（2） | `villager_offers`、`trade` | 分页读取近距商人报价；以指纹绑定一次真实交易。 |
| 公会（5） | `guild_board`、`guild_claim`、`guild_release`、`guild_deliver`、`guild_receipt` | 今日看板、本人合同、原系统收货与结算；查询与回执不占动作。 |
| 生活与历史知识（3） | `adventure_guide`、`knowledge_catalog`、`knowledge_read` | 按需读生活验收方法和原 Numen 知识，不把历史工具或路线当当前权限。 |
| 游戏法术（4） | `game_skills`、`game_cast`、`game_learn`、`game_skill_receipt` | 查询现有女神/铁魔法成长与法术；施法和技能书学习占动作，保留原生条件。 |
| 目标与经验（2） | `request_goal`、`remember` | 对话目标交给同一调度器；记录目标状态、经验与下次复盘时间，不解锁暂停或重置预算。 |
| 可编程技能（6） | `skill_catalog`、`skill_read`、`skill_draft`、`skill_test`、`skill_promote`、`skill_start` | 查看、编写、隔离测试、晋升准确版本，再由控制器有界执行。 |

MCP 的 `move/equip` 对应程序动作 `goto/equip_item`。其余游戏动作同名；程序必须使用当前 `skill_catalog().actionTools`，不能把 `inspect_block`、`guild_board` 等观察工具当成 `next()` 的动作，也不能直接发 Numen 或管理命令。一次规划选择直接动作或 `skill_start`；得到 `accepted` / `skill_queued` 后结束该轮，等待真实观察。

## 怎样自主选择与改进目标

控制器向模型提供 `adventure` 事实摘要、原目标、近期经验、身体和世界观察。模型自行选择眼下有价值的目标，检查前置材料、工具、地点、权限与验收点；没有固定的“挖木头→建房→种田”剧情。食物不足、缺工作台、有可完成的委托或看到真实报价都可以成为动机，公会不是唯一任务来源。

[progression.py](../world/survival/progression.py) 的 `summarize_progression(...)` 是不调用模型、不读写世界、不分派任务的纯函数，输出最多 6000 UTF-8 字节。它保留资源的完整命名空间、实际装备、当前 `actionTools`、已晋升程序、可识别技能书和已知机会；模组物品未分类时保留在 `other`。`known:false`、过期来源与空库存不同；携带书不等于已学会，携带铁镐不换算为自创角色等级。

重复的多步方法适合写成 `next(state,memory)`，新快照和已确认结果推动下一步。缺前置条件、失败或无进展时返回重规划；程序不能靠记忆中的“已经发送”宣布完成。每次改版保留旧源码，增加能复现失败的 fixture，通过测试再晋升准确版本。原有 QuickJS 无 IO、时间/内存限制、最多 32 步与 900 秒仍生效。该学习方式是改善程序与经验，没有在线训练 Qwen 模型权重。

| 参考机制 | 本轮实际映射 | 尚未实现或不采用 |
| --- | --- | --- |
| Voyager：状态驱动的自动课程 | `adventure` + [ADVENTURE.md](../world/survival/ADVENTURE.md) 的目标/前置条件/验收指导，接入同一个持续规划器 | 没有独立付费课程 Agent；不复制原实验剧情或基准成绩。 |
| Voyager / Odyssey：可复用组合技能与反馈修正 | `skill_catalog/read` 按需检索；`draft → test → promote → start`；用失败样例改下一版 | 没有向量检索、自动依赖图或未经测试的主机任意代码执行。 |
| Mindcraft：持续但可中断的计划 | 暂停、忙碌、未知回执、目标更新和有界程序共用单调度器 | 不复制其 2 秒自提示频率，也不让多个模型同时控制同一身体。 |
| MineDojo：不同任务使用不同验收 | 位置、库存、方块、菜单、交易和合同回执分别核对 | 不用技能数量、聊天描述或视觉评分代替真实物品与合同账。 |
| Numen：外部大脑与真实身体分离 | 保留原本地改版、原生寻路/即时避险、合成及玩家交互；补窄桥读取缺失状态 | 不替换为旧 Mineflayer/Fabric 客户端，不把旧 numen-mcp 文档当生产 API。 |

上述映射是千灯纪的实现选择。参考项目的旧版本环境、论文成绩和长期探索能力不能直接归给当前服务器；原始仓库与论文链接、版本差异保留在[研究文档](MINECRAFT-AGENT-REFERENCES.md)。

## 生活动作的实际契约

### 建造、耕作和睡眠

[world_actions.py](../world/survival/world_actions.py) 在租约受理前与执行前分别读取身体和目标，核对生存模式、近距、工作区与已配置的 `constructionAreas`。放置复用原生手持交互，使用真实材料；只开放支持的建筑材料或明确配置的方块，目的格必须可替换且有支撑。床和门核对双格及朝向，放箱前拒绝与旁边箱子合并。执行后要看到目标方块和材料减少才记为已放置；不会把一块木板记为完整住所。

`farm` 的三种操作为：`till` 在泥土/草方块使用真实锄；`plant` 在耕地上方空气使用小麦种子、胡萝卜、马铃薯或甜菜种子；`harvest` 只破坏本人账本中已种植且达到成熟 `age` 的作物。作物消失与实际收到掉落分别记录。土地获准不等于种子、水源、成熟条件已满足，本轮没有自动灌溉、骨粉种植循环或任意模组作物适配。`sleep` 继续接受游戏的日间、敌怪等原生拒绝。

`constructionAreas` 与 `storageSites` 是配置授权；自然空地勘察只是证据，不会自动写入权限。存档能排除勘察体积中的建筑方块、容器和作物，不能证明玩家从未放置天然草/石。真实建设前仍要近距重观测，不能从历史存档或管理页面直接开始拆改。

### 容器与熔炉

新增 [WorldMenuBridge.java](../world/irons-bridge-src/src/dev/qiandeng/irons/WorldMenuBridge.java)，协议为 `QD_WORLD_JSON` / `physical_menu_v1`。它读取实际菜单背后的 `BlockEntity`，返回身体 UUID、维度、实体坐标、菜单 ID、服务器 epoch、有效性、光标状态与分页槽位。不能仅凭“打开的是 ChestMenu”认定它就是计划中的箱子。

只支持已审查的单箱、桶、熔炉、高炉与烟熏炉；拒绝双箱、随身/未知模组菜单。开箱前双手须为空或受支持的无使用效果物品，避免手持方块或特殊物品触发其他交互。存取必须匹配当前实体坐标和已记录菜单身份。每次最多 4 项转移，明确源槽物品 ID；`to` 与 `count` 都为 `null` 才表示整栈自动路由。真实槽位与库存变化、空光标用于验收；可以为已有熔炉装料和燃料，熔炼等待仍由游戏运行。

当前没有通用模组机器自动化或任意 GUI 点击接口。完整炉内进程和产出仍须逐次观察，不把转入燃料视为已经完成冶炼。

### 一次真实村民交易

[TradeBridge.java](../world/irons-bridge-src/src/dev/qiandeng/irons/TradeBridge.java) 使用原生 `AbstractVillager` / `MerchantMenu`，协议为 `QD_TRADE_JSON` / `vanilla_merchant_v1`。商人必须在同维度 4.5 格内、可视、存活、非幼年且没有被别人交易占用；已有菜单先正常关闭。报价每页 4 条，最多开放前 20 条，返回原生库存与准确索引、报价指纹。

`trade(turn_id,entity_id,offer_index,quote)` 只买一次：指纹绑定身体、商人、索引及带组件的输入/输出；报价变化先拒绝。身体必须生存、在线存活，有至少 3 个主背包空槽和一只空手；正常交互打开菜单后允许原生声望折扣，不能静默接受涨价。使用一次 `PICKUP` 取结果，核对原生交易次数恰增 1，关闭菜单归还剩余付款和结果，再按物品组件核对全库存预期变化。Python 另核对商人 UUID、索引、输入/输出和库存差量。

没有自定义价格、免费发货、远程商店或循环快速购买。发生过效果但无法确认物品归还/最终库存时保留 `outcome_unknown`，不会改成普通拒绝后自动重买。报价指纹能防止把不同组件的物品当同一报价，但当前简短报价展示以 ID/数量为主，并非完整模组/附魔物品比较器。

## 同步有界扫描

旧 Numen 异步扫描可能先返回受理，后续回调没有留在当前 RCON 应答中。本轮 `scan_blocks` 改用 [WorldScanBridge.java](../world/irons-bridge-src/src/dev/qiandeng/irons/WorldScanBridge.java) 的同步只读 `QD_WORLD_SCAN_JSON` / `bounded_block_scan_v1`，不占用 Numen 动作任务。

- 以实际身体方块坐标为中心，球形半径 1–16；最多 8 个完整方块 ID 或 `#namespace:tag`，未知/空标签拒绝。
- 只取已加载区块缓存，不请求生成或加载区块；最多检查 35,937 格，保留最近 16 个匹配坐标。回执 JSON 最多 3000 UTF-8 字节，过长时删除最远项并标记截断。
- 每个身体 UUID 有 5 秒冷却。返回 `examinedBlocks`、`unloadedColumns`、`coverage`、`truncated`；未加载区域保持未知，只有完整加载覆盖才提供 `total_in_radius`。
- Python 核对身体 UUID、维度、中心轻微位移、半径、坐标距离与排序、覆盖一致性和回执大小。受理消息、缺字段或失配都不是空扫描结果；不得据此宣布“附近没有资源”。

这是有限空间内的真实方块查询，不是全地图透视、路径可达性判断或完整方块状态查询。水的 `source` 来自原生流体状态，具体交互前仍用 `inspect_block` 查目标；只读发现某块资源也不产生采集/建筑许可。

## 公会是原世界中的生活关系

[guild.py](../world/survival/guild.py) 通过带身体 UUID 的持久请求/回执桥接既有 [guild_requests.py](../world/sidecar/guild_requests.py)、NPC 与公会账本，不让模型从聊天中创建完成记录或直接写奖励。

`guild_board()` 返回最多 24 条当日合同，合同 ID 为 `YYYY-MM-DD:N`，包含当前承接者、物品/目标、原奖励、`rankRequired`、`claimable`、`blockedReason` 和验收方式；本人 `fame` 是 `{fame,done,rank,joined}` 对象。资格按真实阶位、活动合同上限、开放状态和柜台附近条件核对。看板公示不能代替正式 `guild_claim`，`guild_release` 也只能释放本人合同。

本轮支持原系统的个人 `gather` / `hunt` / `visit`：收购合同需要到指定发单人附近交付真实物品；狩猎以接单基线后的实际新增击杀验收；到访/远方探索以实际位置与目标半径或离广场距离验收。后两类不靠 `guild_deliver` 消耗物品，返回的 `automatic_acceptance` 表示应等待原规则核对。旧造景、召唤首领和组队战利品合同没有因此开放。

交付与奖励沿用共享锁、持久交易屏障、原生收货/奖励回执和功勋账。`rewardOutcome` 的预留、完成或不确定阶段需要分别判断；材料已交、绿宝石到账和功勋记录不是同一件事。未知结果不重发，`guild_receipt(request_id)` 只读本身体已有回执，不清理动作锁。

旧 NPC 身份适配按已存在角色的准确 UUID、实际载体及职业核对，不能仅凭旧显示模型或缺少旧标签判断 NPC 消失。`issuer` 和 `receptionist` 将实时 `position` / `positionFresh` 与 `lastKnownPosition` / `lastKnownObservedAt` 分开：未加载时历史坐标仅可供导航参考，不能用于实时“已到柜台”判断。`availability` 与健康状态区分未加载、已加载但缺失和在线，缺真实角色时不能虚构一套任务柜台。

## 管理页面和预算

`19091/#survivor` 新增生活与机会卡，显示食物、工具、材料、种子、实际装备、公会公示、附近商人与配置建设范围。本人合同由准确角色/UUID 匹配的历史查询缓存投影，显示历史状态、所需物资与缺少条件。当前携带量不是已交付量，授权区域不是建成住所；缺源显示未知，陈旧来源显示历史。当前卡不直接展示 `guild.fame` 对象或实时 NPC 位置，声望及位置以 `guild_board` 的真实查询为准。

页面采用有界白名单投影，不能将原始日志、技能源码或凭据输出到浏览器。新增生活摘要/建设范围的健康探针和真实 DOM 冒烟断言；它们检查接口与呈现，不代替游戏里完成任务。详情见 [read-model.mjs](../world/admin/read-model.mjs)、[survivor-panel.test.mjs](../world/tests-ai/survivor-panel.test.mjs)。

本轮没有提高既有模型限额或重新选择模型。公开默认仍为身体/事件每 15 秒观察、环境每 60 秒刷新；滚动 24 小时最多 48 次决策、至少间隔 180 秒；自主复盘 180–3600 秒，默认 1800 秒。原 QwenPaw 并发 1、QPM 4、每轮最多 6 次迭代、输入 16384/输出 2048 的限制保留，具体部署以当前角色配置与账本为准。一次决策可能包含多次模型请求，48 次决策不是 48 次请求。

扫描、观察、公会结构化查询、页面与健康检查自身不调用模型；已晋升程序的每一步也不调用模型。Qwen 选择目标、阅读结果和改写程序仍计入模型消耗。沿用已有 Coding Plan 角色配置及历史用量，不清零失败/暂停记录，不引入嵌入检索、第二个规划模型或高频自提示来完成这轮扩展。

## 验证状态与尚未证明的部分

源码和离线验证围绕以下证据展开；工具加载与正向游戏效果分别记录。

| 验证对象 | 对应验证与实际边界 |
| --- | --- |
| 39 项接口和程序动作白名单 | `mcp_server.TOOL_NAMES`、实际 `@server.tool` 注册与 `numen_gateway.TOOLS`；运行环境还须验证 DriverCard 的 39 项完整启用。 |
| 建设、农耕、容器、交易、扫描 | [test_survival_world_actions.py](../tests/test_survival_world_actions.py) 覆盖前置拒绝、身份/菜单/方块绑定、回执与不重放；真实物品与地形效果另需实机记录。 |
| 原生交易规则 | [TradeRulesTest.java](../world/irons-bridge-src/tests/TradeRulesTest.java) 覆盖索引、报价、价格和组件差异；Java 编译通过不等于已经成功交易。 |
| 原公会合同与库存 | [test_survival_guild.py](../tests/test_survival_guild.py)、[test_guild_inventory.py](../tests/test_guild_inventory.py)；完整接单→执行→交付→原奖励/功勋链需另验。 |
| 成长摘要与页面 | [test_survival_progression.py](../tests/test_survival_progression.py)、管理页 DOM 冒烟及 [test_survivor_health.py](../tests/test_survivor_health.py)；没有把页面数据显示当成生活目标完成。 |
| 原有自主能力 | 早先实机已记录木棍/铁剑合成、程序修改、严格步行与进食，保留原始历史说明；这些不能代替本轮新增能力验收。 |

2026-09-08 本机部署后，实际 HTTP MCP 与 QwenPaw Driver 都加载了全部 39 项接口。读取到六份真实公会合同、原桐人身份及接待员的实时位置；无 Bearer 的内部请求及人工暂停期间的动作均被拒绝。六位现有 NPC 仅恢复准确 UUID/标签绑定，没有生成替身或移动原实体。原 Numen 本地分支保留；后续只对本次导航涉及的类族追加精确补丁，无关条目逐字节校验。扩展桥重新编译部署，网页资产同步后世界服务健康。

实际三次同步扫描中，16 格半径检查了 17,077 个方块，返回最近 16 处；原木标签找到两处橡木，抽查坐标与逐块查询一致。最大原生耗时 2.832 ms、最大 JSON 1,585 字节（本机本次样本，并非性能保证）。五秒冷却、未知 ID 拒绝、实际 46 槽菜单和不存在商人拒绝均通过；这些验收未调用模型或改变世界。浏览器读取真实管理台，生活卡显示库存、营地与公会公示，390 像素宽度无横向溢出或脚本异常。

恢复自主后，Qwen 自行调用 `look`、`guild_board`，选择去公会办理面包合同，并执行了一次上岸步行。原生 `t1` 与服务器 epoch 匹配，位置从约 (-519,62,863) 到 (-524,63,861)，收到成功终态；随后进入原有冷却继续规划。不是在正文里模拟调用。详细本机证据保存在被忽略的 `server/survival-agent-state/adventure-scan-smoke.json`、`adventure-autonomy-rounds.json`、`server/agents/work/adventure-http-smoke.json`、`runtime/adventure-panel-smoke.json` 与 `reports/survivor-adventure-smoke.json`。

连续观察暴露旧水平导航回执的限制：一次水面到点之后身体沉到同列水底，下一轮又自主游上平台。为公会楼层和安全落脚加入 `walk_only_strict_arrival_v2`；`move` 可选可靠观察到的实际脚高 `y`，保留旧 x/z 程序参数。三维目标不能靠水平接近宣告成功，水平路标到点也须干燥、有碰撞支撑并连续三个游戏 tick 稳定；途中游泳仍保留。历史 `ground_y` 只是实际 Y 向下取整，不能作为地面证据。详见 [Numen 导航补丁](../world/numen-patches/README.md)。

严格到达补丁通过 54 项原生断言及 5 项构建器测试，480 个无关原分支条目内容保持不变。随后在原身体上做两次不调用模型的原生导航断言：同 x/z、上方 8 格且无支撑的 Y77 目标明确失败，身体保持 Y69；当前实际有支撑的 Y69 目标得到匹配新服务器 epoch 的成功回执。背包未变。证据为本机 `server/survival-agent-state/strict-arrival-smoke.json`，这两次是运维验收，不记作模型自主完成的目标。

北京时间 10:50，Qwen 在真实自主会话中调用 `guild_board` 后，用原桐人身体正式承接 `2026-09-08:1`「收购·面包」：向静水交付 3 个面包，约定 1 绿宝石及 1 功勋。动作租约、持久 `claimed` 回执和随后重新读取的原公会看板都确认承接者为 Kirito；这一步没有发奖、完成合同或增加功勋。旧 `guild.json` 是带 `historicalQuery` 标记的查询快照，不会随着身体移动自动更新，不能用旧的 `claimable:false` 判定当前距离接口出错；办理前读取 `guild_board`，办理后以动作回执和新查询为准。

本轮没有把接口测试算作完整建房、持续耕作收获、熔炉生产、正向村民交易、完整公会履约或新法术学习的实机通过。它们需要桐人实际满足材料、空间、位置和游戏条件后逐项累积证据。只读扫描成功也不能推导后续施工成功；半砖、农田的碰撞探针测试也不能代替完整场景的实际导航验收。

持续无人值守荒野生存、主人离线后的死亡恢复、任意模组配方与容器、跨场景程序可靠性、建筑视觉质量和完整动态依赖图仍不在当前验收结论内。普通 `goto` 已有逐任务禁止挖搭/放水的实现，但采矿、自卫反射和其他模组物理效果不是全局地理硬隔离。模型能按真实条件选择下一目标并改进方法；长期生活是否可靠，需要连续实际运行证据。
