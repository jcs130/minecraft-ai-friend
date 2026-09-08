# 千灯纪世界团队：反馈、工程与内容

这套改造把现有 Qwen 角色连成可追踪的世界运营团队：桐人真实游玩并反馈，灯语女神处理世界问题与验收，天神在独立源码中修复，公会策划设计故事活动，司灯和其他运营角色协作。模型继续由 QwenPaw 管理；工单、执行器和验证模块不替角色写一个固定决策大脑。

2026-09-09 天神迁移已完成：游戏 QwenPaw `18089` 实际9人，运营 `18090` 实际5人，团队仍共14人。原运营天神以 `qd-engineer` 出现在18089原生角色列表，旧运营 `mc-god` 停用并完整备份，原生承载映射已为 `active`。浏览器、两端严格健康、目标工具和原工程仓库读回均通过；证据在 `runtime/engineer-host-migration-20260909/`。两端属于同一个游戏项目，宿主机 `8088` 仍用于用户的其他工作。本文区分配置、模型执行、发布回执和玩家完成；只读检查入口为 `python tools/world_team_health.py`。

## 现有角色与边界

名册源是 [world_team.py](../world/ops/world_team.py) 的 `MEMBERS` 与经过验证的独立人物 manifest。六个游戏基础逻辑身份是 `game:mc-god`、`game:qd-guild-planner`、`game:qd-survivor`、`game:mc-herald`、`game:qd-villager-dialogue`、`game:qd-maid-dialogue`；六个运营来源的逻辑身份是 `operations:mc-god`、`operations:default`、`operations:mc-herald`、`operations:mc-priest`、`operations:mc-guard-kirito`、`operations:mc-guard-naruto`。逻辑署名表示工单与历史归属，实际控制台位置由 `nativeHost` 表示。天神迁移后仍用原逻辑身份，不再把前缀当作当前API地址；运营体验官不能冒充游戏桐人的身体。

团队工具绑定启动参数中的身份，不接受模型指定发送者。传声司礼继续处理女神沟通，村民对话继续保留具体村民身份，人物模板与已登记独立角色负责自己的互动反馈。结衣及其他独立人物按 manifest 动态加入，模板技能由原同步机制继承，不硬编码角色 UUID，也不创建替代人物。既有 Qwen 模型选择、人格、笔记、聊天历史、官方技能与游戏身体绑定分别保留；结衣继续使用自己的原生活人格与游戏交流通道。

| 当前控制台 | 原生角色 ID | 显示名与团队职责 |
| --- | --- | --- |
| 游戏 18089 | `mc-god` | 灯语女神 · 世界管理；巡查、管理请求、分派与验收 |
| 游戏 18089 | `mc-herald` | 灯语女神 · 玩家交流；原“千灯纪司礼”，承接 Goddess 的实际对话 |
| 游戏 18089 | `qd-survivor` | 桐人；原身体与生活会话中的内测玩家 |
| 游戏 18089 | `qd-guild-planner` | 公会任务策划；任务、剧情和可发布活动 |
| 游戏 18089 | `qd-villager-dialogue` | 村民对话；按实际村民身份响应并反馈需求 |
| 游戏 18089 | `qd-maid-dialogue` | 女仆对话；独立人物的注册模板与对话接口 |
| 游戏 18089 | `5swvhK` | 结衣；原人格、身体、记忆与桐人协作 |
| 游戏 18089 | `2PZ2gA` | 原独立女仆；保留其旧姓名、主人和人格 |
| 游戏 18089 | `qd-engineer` | 原天神 · 世界工程师；独立源码、测试与候选提交，逻辑署名保留 `operations:mc-god` |
| 运营 18090 | `default` | 司灯；项目协调和原有每日运营 |
| 运营 18090 | `mc-herald` | 灯语 · 服务诊断；故障证据与恢复复核 |
| 运营 18090 | `mc-priest` | 灶火祭司；剧情投稿与活动构思 |
| 运营 18090 | `mc-guard-kirito` | 桐人体验官；技能、法杖、手柄验收，与游戏桐人区分 |
| 运营 18090 | `mc-guard-naruto` | 鸣人体验官；新手、探索和恢复体验 |

`mc-god` 和 `mc-herald` 是女神在管理、玩家沟通上的两个已有接口，不创建第二个 Goddess 实体。网页当前智能体选择器展示原生 Agent 的 `name`；修改团队文档或聊天标题不会同步这里，名称须经游戏实例的原生 Agent API 更新。原生 QA/default 停用角色不计入上述 14 人名册。

### 天神的原生承载迁移

[world_team_hosts.py](../world/ops/world_team_hosts.py) 只允许这一项映射：`operations:mc-god` → `game:qd-engineer`。共享文件为 `/team/runtime-hosts.json`，宿主对应 `server/team-state/runtime-hosts.json`。文件缺失沿用旧端；`prepared` 允许配置目标但禁止目标执行；`active` 后只有新端拥有执行权。旧角色资料和停用配置保留，不删除原工作区或伪造历史事件作者。游戏里的女神 `mc-god` 不被覆盖。

原工程班次 `qd-team-engineer`、每周学习 `qd-learning-mc-god`、原 user/channel/session、工单 owner、周期锁与运营请求账本均保留；工程班次仅补充 `meta.nativeHost`。旧任务必须已知终态且没有未决操作才能切换，不能通过迁移重放未知任务。工程源码、测试快照和commit保持独立仓库语义，目标原生文件权限指向自己的 `qd-engineer` 工作区。

原生Cron、learning、team与engineering MCP均检查实际承载身份；已有旧MCP进程也会在每次调用时拒绝失效身份。新端的team/engineering启动参数显式带 `--native-runtime game --native-role qd-engineer`，其工单作者仍是原天神。配置工具 [configure_world_team.py](../tools/configure_world_team.py) 与只读清单/健康检查跟随当前映射，不能在后续同步时重新启用旧天神。

运营司灯现有 `qiandeng_operations` MCP 已通过原生API重载新派工路由；单独改磁盘源码不足以替换原Python进程的模块缓存。实机确认游戏9人/80项技能绑定与运营5人严格健康均通过；目标 `qiandeng_operations`、`qd_learning`、`qd_world_team`、`qd_engineering` 分别有4、10、6、5项原生active工具。工程status在目标新路径读到原分支、仓库与HEAD `5de7f8af30f382ea271280bf11f46ea4fd54bd52`。原两项Cron已在新端恢复，旧角色及旧两项job保持停用；其它既有角色模型、名称与语言未变。

完整备份、导入/还原、历史保留、原生工具/班次激活及司灯重载回执保存在 `runtime/engineer-host-migration-20260909/`，只读团队验收写入 `reports/world-team-smoke.json`。本次只读验收14项角色配置、3个团队班次及业务收据均通过，0模型请求、0游戏动作；报告里的保存轨迹区分历史证据与新执行。用途目录保留 `operations.priority` 作为兼容键，实际目标已改为 `game:qd-engineer` 和 `http://qwenpaw:8088/api`，用途说明为天神工程规划与修复。14项路由定向测试和15条用途的生产只读探针通过；其余路由、模型及policy未改。

2026-09-09 02:55（东八区），新端原生 `qd-team-engineer` 班次自动开始，实际 `last_status=running`，没有手动run；司灯通过运营原生适配读取天神status也已路由到游戏实例的新ID。这证明新端实际进入了原班次，尚不代表这轮完成了修复或验收。桐人在迁移验收后仅恢复一次，`task-c7bfbc0e08bc` 于原session自然运行，原生采矿t37已受理并结束，未见 `autonomy_disabled` 且无新unknown。身体与会话保持原身份，矿坑脱困仍未验收，不能从团队健康或任务running推断已经脱困。

项目协作使用 `/team/team.sqlite3` 的署名工单和文档；游戏人物对话仍须真实游戏渠道、身体及听见回执。两者不互相冒充。工单交接不会直接唤醒另一角色的私聊模型，游戏内未听到的话也不会因写进工单变成“听到了”。

## 工单与原生运转

[world_team_mcp.py](../world/ops/world_team_mcp.py) 提供短名册、上下文、列表、单条详情、报告与更新。`request_id` 用于同一操作的幂等结果，`dedupe_key` 用于同一问题的持续反馈；更新采用 `expected_version`，竞争时返回 `case_changed`。负责人推进到 `needs_review`，女神与司灯可以分派和独立验收关单。状态变更本身不执行游戏操作或部署。

[world_team_schedule.py](../world/ops/world_team_schedule.py) 复用原生 Cron 和现有 Qwen 进程。源码默认女神每10分钟、工程师错开约4分钟、公会策划每30分钟；实际以原生 job 为准。没有工程工单、工作指纹未变化或上一任务未知时，相应周期跳过。角色任务采用固定 user/channel/target session；当前 Qwen 2.2 的 `share_session=false` 会为固定 job 派生稳定的 `target:cron:job` 会话，不是跨角色通用聊天，也不是桐人生活主会话。

传声、村民对话、人物模板与独立人物接入工单，不新增它们的 Cron。它们仍在原玩家互动、世界事件和生活任务中按需反馈，避免仅因加入名册就增加另一套主动模型循环。

已启用的新增班次为女神 `qd-team-goddess`（每10分钟）、天神 `qd-team-engineer`（错开4分钟）、策划 `qd-team-designer`（每30分钟）。天神新端已接管同一个job，旧端保持停用，没有第二条并行工程班次。原有司灯每日09:10任务、各角色每周学习和桐人/结衣生活记忆机制继续存在。工程有待处理问题时可接续工作；无新内容的策划检查可跳过模型。周期开始时保存输入水位，执行期间新来的报告与测试回执留到下一轮，不被本轮收尾吞掉。

本阶段取消人为 LLM 次数上限，但保留原生并发、超时、供应商真实限制与未知不重投。工单调度与自动记忆职责分离：保存 Markdown 是已授权的普通工作，Memory/Dream 启用和效果仍按角色配置与原生回执验收。参见 [生活记忆说明](QWENPAW-LIFE-MEMORY.md)。

## 工程修复链

[engineering_workspace.py](../world/ops/engineering_workspace.py) 与 [engineering_mcp.py](../world/ops/engineering_mcp.py) 为运营天神提供独立 Git 工作区及五个专用工具。Qwen 使用原生文件工具读写实际源码；测试只接收受管计划 ID 和精确源码哈希，执行器负责隔离测试，不允许模型传任意 shell 或镜像。

测试回执必须对应同一不可变源码快照；后续修改使旧通过记录不能用于提交。`engineering_commit` 保存本地 Git 提交并返回 `pushed=false`，不推送、不部署、不修改生产世界。工程师把 commit、测试 job、哈希与剩余实服验收项交女神/司灯，不能自行关闭未经复测的工单。

## 游戏策划与活动发布

[world_content.py](../world/sidecar/world_content.py) 保留三个职责：运营祭司投稿、游戏策划提交可执行内容包、女神检查批准。新鲜上下文列出真实在线发单人、职业、今日/次日合同、物品与已支持目标；首次范围包括新 gather/hunt/visit 和精确引用已有合同。发布追加有效合同，不再随机丢弃已经选中的阶段，不覆盖已有接取或结算进度。

NPC 原有 worker 消费批准请求，依旧由原公会锁、货单、击杀/位置验收和库存结算管理执行。发布前记录计划与 before 哈希，按稳定合同 ID 补充缺项后读回；中断恢复保留后来发生的进度，不重发奖励。候选、批准排队、计划日期等待、发布回执、玩家完成分别记录。

原看板展示活动标题、引言与 No. 路线；玩家对岚说“活动 N”“剧情 N”或“详情 N”读取完整内容。预设结局明确标为剧情文本，不代表玩家已经通关；阶段顺序是引导，原公会仍逐单接取，没有自动附加剧情奖励。正文只读取已确认发布且仍匹配当前合同的文件，不自动广播世界消息。

当前 Boss/宝箱仍需补齐场地勘察、原生生成/放置前后回执、专属击杀或战利品归属、清理与未知恢复。旧 Boss 用通用劫掠兽击杀分数，旧宝箱只收普通物品，不能证明完成指定活动；因此能力明确 `blocked`，缺项交工程工单，不能直接恢复旧自动生成开关。旧 Saga 内部构思循环也不随本改造重启。

## 管理与证据

[world_admin_tools.py](../world/ops/world_admin_tools.py) 只接既有授权的类型化管理请求与回执。女神可查询现场诊断和允许的规则、时间、天气操作；`keepInventory` 保持 true。它不是任意服务器命令接口。请求未知后只查原回执，不换编号再执行。

`/team/content/` 包含 context、proposals、publish 请求、receipts、published 正文和按日索引；数据不是模型可以任意改写的个人笔记。详细 schema 与调用过程通过 [qd-world-team 技能](../world/ops/skills/qd-world-team/SKILL.md) 按需披露，正文保持短索引。两个技能绑定清单向游戏六个基础身份、运营六个身份追加该技能，独立人物通过原模板同步继承；原生官方技能及其余能力配置分别保留。

本轮内容隔离验证覆盖17项新合同/幂等/恢复/显示测试、15项原公会基本任务和23项生存公会检查。最终上线还应核对原生工具可见性、受管任务真实执行、实际看板和库存/结算回执；这些测试不证明 Boss、宝箱或任意世界建设已经可用。

## 已取得的实机证据

- 女神已用原生班次读取现场诊断、创建工程问题并派给运营天神；三份类型化管理诊断已完成。原服读回 `keepInventory=true`，没有用测试重置人物或发放物资。
- 策划生成“秋灯祭”，女神批准后，原 NPC worker 发布了 `content-fd5881ee422e68c006ecc176`。它连接当天既有 No.1、No.2、No.4 委托，真实看板/剧情读取已核对。发布不表示玩家已完成任务或领取奖励，也没有虚构已生成灯会建筑。
- 天神最初的候选测试曾失败，两次早期原生工程执行超时；01:45 的第三次执行自主修正测试，在真实隔离容器中通过 `mc-god-20260909-eng-stale-snapshots-1` 的24项检查，源码哈希为 `8e745483166f071b39c1d32461972cdb228eb411f2477be372ae434af91b0abf`。01:55 的第四次执行读取通过回执，于01:57:44提交 `5de7f8af30f382ea271280bf11f46ea4fd54bd52`，01:58:28原生班次正常结束，工单进入 `needs_review`。以上时间均为2026-09-09东八区；固定基线22项通过与候选24项通过是不同证据。
- 该候选为 `team_context` 增加 `staleSnapshots` 和过期巡查资料提示，防止将旧红灯当作当前故障。集成审查仅移植两处正文改动，保留主项目新增的 `survivor_snapshot`；候选同名测试另存为 `test_world_team_stale_context.py`，保留原6项桐人状态测试，并补一项历史数据保留检查。主项目39项团队测试通过。原Agent提交还包含846个无正文变化的文件模式变动，未随集成带入；独立候选与其提交保持原样。审阅记录在 `runtime/world-team-integration-5de7f8af/`。这是已审阅并通过集成测试的候选，生产MCP重载与实机验收仍须单独记录，不能提前宣称已部署或关闭工单。
- 桐人原角色、UUID、生活 session 与模型选择保留。此前模型配额失败与之后的240秒任务超时分别记录；`autonomy_disabled` 是控制器暂停后拒绝身体动作，不能当作法术未学会。单轮时长已调整为600秒，恢复及后续动作仍须按实际任务/租约回执判断，不能以开关开启宣称已经脱困。

`reports/world-team-smoke.json` 是当前只读验收，记录14人绑定、三个班次、工单与实际内容发布、工程测试证据和桐人控制状态；`runtime/`、`reports/` 与 `server/` 中的运行资料不进入公开 Git 提交。全项目旧渲染/来源快照等验收与本轮团队验收分开，不能重写旧报告哈希来冒充全部项目已通过。
