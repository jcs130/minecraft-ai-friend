# 桐人的共享角色与独立身体执行器

这个目录将 QwenPaw 的规划、受验证的技能程序、Numen 的身体动作分开。真实 `qd-survivor` 角色在游戏 QwenPaw `http://127.0.0.1:18089/agents` 中显示为桐人；`survivor` 容器仅负责感知、持久调度、受限程序和鉴权 HTTP MCP，不再启动独立 18091 控制台。原游戏天神、司礼以及运营六角色的模型设置和用途保留。

## 从首轮原型迁入共享控制台

首轮原型已通过 `prepare_survival_agent.py` 建立隔离配置。已有部署应保留该目录，使用迁移工具将真实角色、会话和用量接入游戏实例；不重新初始化或生成另一个身体。构建当前 `qiandengji-survivor:2.2.0-qd2` 后，先只读检查：

```powershell
python tools/migrate_survivor_to_game.py --check
```

等待两个游戏会话角色无活动任务，暂停桐人并核对 `active:null`、无待确认身体动作后，停止精确的 `qiandengji-survivor-1` 与 `qiandengji-qwenpaw-1`，再执行：

```powershell
python tools/migrate_survivor_to_game.py --execute qiandengji
```

本机已经完成这次迁移，保留迁移时的 69 次模型请求，不能再次执行 `--execute`。工具先把两套配置、统计、桐人会话及身体学习状态备份到项目 `runtime/survivor-game-migration-backups`，再复制角色、重加密独立 provider、合并按 `agent_id` 归属的原始用量并禁用旧角色。另两角色配置、当前模型选择、现有 provider 和桐人的身体/技能/预算文件不改。

后续工具或角色提示更新时，待这两个容器停止且桐人暂停无活动模型任务，运行 `python tools/migrate_survivor_to_game.py --sync qiandengji`。同步只更新真实桐人的工具白名单、DriverCard 和 `AGENTS.md`，备份旧版本，保留模型选择、会话与全部用量。

在 `--network none` 的临时容器中挂载游戏状态到 `/state`、当前源码到 `/survival:ro`，使用原 Qwen 工作/secret 环境及 `QWENPAW_AUTH_ENABLED=0`，运行 `python /survival/verify_runtime.py --game --offline`，可验证真实 2.2 配置、provider 解密、三角色集合与 HTTP 工具策略；不连接模型或 Minecraft。

Compose 的游戏 Qwen 入口为 `game_service.py`，从只读 secret 文件取 MCP token，仅在子进程环境注入；Qwen DriverCard 使用 `Bearer ${SURVIVOR_MCP_TOKEN}` 引用。survivor 内部 8089 `/mcp` 校验鉴权，不发布宿主端口，`/livez` 仅返回无状态健康。`service.py` 监督 MCP 子进程和唯一调度器，使用 `QWENPAW_API_URL=http://qwenpaw:8088/api` 接入共享模型服务。

身体 `Kirito` 的 UUID 与 `workArea` 仍以私有运行设置验证。原角色在线时不得重复执行 `prepare_survival_body.py` 唤醒。重新创建的实例应先独立准备、核对旧身体、设置已观察的工作区，再迁入游戏；不能覆盖现有 `server/survival-agent-state`。启动服务和 `/survival/control.py resume` 是独立操作，暂停和未知回执会阻止新动作。

## MCP 工具

`mcp_server.TOOL_NAMES` 是初始化与验证共用的唯一白名单，当前源码注册 **39 项 MCP 工具**，其中 **17 项是受动作租约约束的游戏动作**；QwenPaw DriverCard 默认拒绝，运行实例须同步并验证实际清单。内置 shell、文件、浏览器、额外 Agent、后台记忆、标题、heartbeat、jobs 与失败重试都关闭。每轮最多 6 次迭代、输入 16384、输出 2048，模型并发 1、QPM 4；决策间隔和每日决策预算由控制器的持久账本执行，决策次数不等于模型调用次数。新增生活能力的完整契约与验收边界见 [自主生活、任务与成长](../../docs/SURVIVOR-ADVENTURE.md)。

| 工具 | 用途 |
|---|---|
| `status()`、`look(radius)` | 无模型、只读身体和周边事实 |
| `world_perception()` | 读取控制器持久感知缓存：聊天、发给自身的消息、周边及世界摘要 |
| `move(turn_id,x,z,y=None)`、`mine(turn_id,block_ids,count)`、`craft(turn_id,item_id,count)`、`eat(turn_id,item_id)`、`equip(turn_id,item_id,slot)` | 一次受租约限制的直接身体动作；可靠观察实际脚高时可传 y，要求原生严格三维到达能力 |
| `inspect_block(x,y,z)`、`scan_blocks(block_ids,radius)` | 精查真实方块，或同步扫描半径最多16格的已加载世界；最多8种ID/标签、16处最近匹配、同身体5秒冷却，未加载区域保持未知 |
| `place_block(turn_id,item_id,x,y,z)`、`farm(turn_id,operation,x,y,z,item_id)` | 建设区内使用真实材料放置与耕作；床/门核对双格，收获要求本人已种植的成熟作物 |
| `open_container(turn_id,x,y,z)`、`inspect_container(x,y,z)`、`transfer_items(turn_id,x,y,z,moves)`、`close_container(turn_id)` | 自己/授权实体容器，绑定坐标、菜单ID和服务器epoch；单箱/桶/熔炉，拒绝双箱与未知菜单；查询不占动作 |
| `sleep(turn_id,x,y,z)` | 使用实际床并核对原生入睡状态，保留日间/敌怪等限制 |
| `villager_offers(entity_id,offset)`、`trade(turn_id,entity_id,offer_index,quote)` | 近距分页查原生商人报价，按准确指纹成交一次，以原生次数与实际物品变化验收 |
| `guild_board()`、`guild_claim(turn_id,quest_id)`、`guild_release(turn_id,quest_id)`、`guild_deliver(turn_id,quest_id)`、`guild_receipt(request_id)` | 查询原公会、承接/释放本人合同、按原规则交货与核对奖励；查询和既有回执不占动作 |
| `adventure_guide()` | 按需读取自主生活、前置条件、真实验收与程序改进方法，不指定固定剧情 |
| `skill_catalog()`、`skill_read(name,version)` | 查看已有程序和版本 |
| `game_skills(scope)` | 通过原 `/mycli` 查询真实已学/可学/锁定法术及等级法力状态 |
| `game_learn(turn_id,skill_id)`、`game_cast(turn_id,skill_id,params)` | 使用真实技能书学习或正常施法，共用单动作租约 |
| `game_skill_receipt(request_id)` | 只读当前身体的原施法/学习回执，不重新执行 |
| `knowledge_catalog()`、`knowledge_read(...)` | 阅读明确提供的旧世界知识包，保持只读，旧文档不构成新的事实或权限 |
| `request_goal(goal)` | 将 QwenPaw 会话中的明确新目标交给原调度器，不直接操作身体或重置预算 |
| `skill_draft(turn_id,name,source,fixtures,description)` | 保存纯 JS `next(state,memory)` 草稿和测试 |
| `skill_test(turn_id,name,version)` | 使用无 IO、有限 CPU/内存的 QuickJS 测试 |
| `skill_promote(turn_id,name,version)` | 晋升通过当前内核验证的准确版本 |
| `skill_start(turn_id,name,version,memory,max_steps)` | 排队执行已晋升程序，与同轮直接动作互斥 |
| `remember(turn_id,goal,lesson,next_focus,goal_state,review_after_seconds)` | 保存有界经验、目标状态和下次复盘时间，保留最近 16 条历史 |

身体动作、程序学习和记忆写入共享 `action_lock`：控制器已启用、同一未过期租约、状态为 `open` 或 `used`，且没有不确定动作标记时才允许。草稿、测试、晋升和记忆不消耗身体动作次数；`skill_start` 要求 `open` 且 `actionsUsed=0`，先关闭本轮直接动作，再写 `skill-job.json`。得到 `skill_queued` 后结束模型轮次，MCP 不运行程序或触发 RCON。程序执行由控制器在该模型任务结束后启动。`request_goal` 仅排队一条明确会话目标，控制器保留当时的暂停状态和原预算，不创建第二个驱动。

技能输入使用真实快照，背包计数为 `state.counts`。程序输出 `{action,memory,done?,replan?,reason?}`，当前17项动作是 `goto`、`mine`、`craft`、`eat`、`equip_item`、`game_cast`、`game_learn`、`place_block`、`farm`、`open_container`、`transfer_items`、`close_container`、`sleep`、`trade`、`guild_claim`、`guild_release`、`guild_deliver`。以 `skill_catalog().actionTools` 的当前清单为准，移动/装备不能写成 MCP 的 `move/equip`，扫描等观察工具也不是程序动作。例子及 fixture 结构见 `AGENT.md`。测试和晋升证明程序通过有限样例，不能代替真实世界验收。法术学习保留原等级、技能书、法力、冷却和铁魔法装备规则，不能凭名称授予法术。

新增 `adventure` 摘要把真实资源、装备、当前能力和公示/附近机会提供给规划器，不排序或自动派目标。`19091/#survivor` 的生活卡区分未知、历史与当前观察，展示配置建设范围和本人合同缺条件；持有物品不是已交付，配置范围不是已建成房屋。原公会缓存的 `fame` 对象与全局声望榜分别处理，实时 NPC 位置和历史导航位置也不混用。最终生产加载与实机结果由 [生活能力验证记录](../../docs/SURVIVOR-ADVENTURE.md#验证状态与尚未证明的部分) 补记，不能从工具数量推断已完成建房、收获或交易。

`accepted` 只表示 Numen 受理；`skill_queued` 只表示排队。技能任务完成、库存变化、位置变化与模型自述分别保存。不确定结果禁止重放，技能程序也不能绕过身体身份、工作区、工具白名单或暂停门。记忆和环境文字始终作为数据传给规划角色，不注入系统提示。

控制器每 15 秒观察身体与事件、每 60 秒刷新周边，模型决策至少间隔 180 秒，滚动 24 小时最多 48 轮。新目标、世界事件、生命/饥饿/库存变化、明显位移或动作结果可触发下一轮；持续模式也按模型安排的 180–3600 秒间隔复盘，默认 1800 秒，短目标完成后继续提出下一目标。平静期间进入 `observing`，没有事件也会在下次复盘继续；`idle` 仍可用于单任务模式。复盘不会绕过暂停、不确定结果或预算。

聊天和目标消息从既有 append-only 世界通道按字节游标读取，待提交的事件在冷却与重启后保留，只有实际纳入模型请求的事件才确认。环境中的文字不构成系统指令；无法读取的通道和未接入的模组内部状态明确记为缺口，不宣称全知。正常移动的完成结果不受 8 格水平 / 4 格垂直的被动位移阈值限制，附近实体的小幅推挤不会额外唤醒。
