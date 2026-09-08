# 千灯纪世界团队：反馈、工程与内容

这套改造把现有 Qwen 角色连成可追踪的世界运营团队：桐人真实游玩并反馈，灯语女神处理世界问题与验收，天神在独立源码中修复，公会策划设计故事活动，司灯和其他运营角色协作。模型继续由 QwenPaw 管理；工单、执行器和验证模块不替角色写一个固定决策大脑。

本文描述源码合同与本轮隔离验证。是否已在生产启用、任务真正运行和内容已发布，必须以原生任务、运行健康与对应实服回执为准；技能文件或配置同步成功不能代替上线验收。

## 现有角色与边界

名册源是 [world_team.py](../world/ops/world_team.py) 的 `MEMBERS` 与经过验证的独立人物 manifest。游戏六个基础身份是 `game:mc-god`、`game:qd-guild-planner`、`game:qd-survivor`、`game:mc-herald`、`game:qd-villager-dialogue`、`game:qd-maid-dialogue`；运营六个身份是 `operations:mc-god`、`operations:default`、`operations:mc-herald`、`operations:mc-priest`、`operations:mc-guard-kirito`、`operations:mc-guard-naruto`。两个 mc-god 按前缀区分女神管理员与天神工程师，运营体验官不能冒充游戏桐人的身体。

团队工具绑定启动参数中的身份，不接受模型指定发送者。传声司礼继续处理女神沟通，村民对话继续保留具体村民身份，人物模板与已登记独立角色负责自己的互动反馈。结衣及其他独立人物按 manifest 动态加入，模板技能由原同步机制继承，不硬编码角色 UUID，也不创建替代人物。既有 Qwen 模型选择、人格、笔记、聊天历史、官方技能与游戏身体绑定分别保留；结衣继续使用自己的原生活人格与游戏交流通道。

项目协作使用 `/team/team.sqlite3` 的署名工单和文档；游戏人物对话仍须真实游戏渠道、身体及听见回执。两者不互相冒充。工单交接不会直接唤醒另一角色的私聊模型，游戏内未听到的话也不会因写进工单变成“听到了”。

## 工单与原生运转

[world_team_mcp.py](../world/ops/world_team_mcp.py) 提供短名册、上下文、列表、单条详情、报告与更新。`request_id` 用于同一操作的幂等结果，`dedupe_key` 用于同一问题的持续反馈；更新采用 `expected_version`，竞争时返回 `case_changed`。负责人推进到 `needs_review`，女神与司灯可以分派和独立验收关单。状态变更本身不执行游戏操作或部署。

[world_team_schedule.py](../world/ops/world_team_schedule.py) 复用原生 Cron 和现有 Qwen 进程。源码默认女神每10分钟、工程师错开约4分钟、公会策划每30分钟；实际以原生 job 为准。没有工程工单、工作指纹未变化或上一任务未知时，相应周期跳过。角色任务采用固定 user/channel/target session；当前 Qwen 2.2 的 `share_session=false` 会为固定 job 派生稳定的 `target:cron:job` 会话，不是跨角色通用聊天，也不是桐人生活主会话。

传声、村民对话、人物模板与独立人物接入工单，不新增它们的 Cron。它们仍在原玩家互动、世界事件和生活任务中按需反馈，避免仅因加入名册就增加另一套主动模型循环。

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
