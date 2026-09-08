# QwenPaw 人物文件、生活记忆与复盘

2026-09-09 已在游戏容器 QwenPaw 2.2.0、随包 ReMe 0.4.1.10 上部署。桐人与结衣保留原角色、身体、人格和生活会话，启用官方记忆检索、Auto-Memory 与 Dream；桐人的十分钟复盘由原生 Cron 发信号，进入现有生活会话。survivor 使用 `2.2.0-qd15`，没有新增服务或宿主后台进程。

当前已验证原生自动定时信号、同一会话消费复盘、桐人真实读写目标与记忆文件、结衣 Auto-Memory 生成带来源的日记。材料是否准确、游戏技能是否真正掌握仍以逐项回执为准，写入记忆本身不能证明这些结果。

## 文件分别承担什么

| 文件或目录 | 应保存的内容 | 实际加载方式 |
| --- | --- | --- |
| `SOUL.md` | 人物价值观、语气、对同伴的态度、行为原则 | 默认进入系统提示 |
| `PROFILE.md` | 名字、定位、重要关系、称呼与长期背景 | 默认进入系统提示；不宜仅存端口或绑定 JSON |
| `AGENTS.md` | 短操作约定、工具边界、如何读取记忆和技能 | 默认进入系统提示；长接口示例可逐步放入按需技能 |
| `MEMORY.md` | 少量经核实的长期事实、重要决定、短索引 | 默认不注入；用 `read_file` 按需读；不属于 ReMe 搜索索引 |
| `memory/YYYY-MM-DD.md` | 当日日记与日期子目录的索引 | ReMe 搜索覆盖；自动 `notes:auto` 区块以外可人工补充 |
| `memory/YYYY-MM-DD/{name}.md` | 原生 Auto-Memory 从一个会话提炼的经历 | 原生后台维护；通过搜索或日期索引逐步展开 |
| `digest/personal/`、`procedure/`、`wiki/` | 由 Dream 整理出的关系/偏好、方法、知识 | 原生搜索覆盖；仍需核验事实与来源 |
| `memory/goals.md` | 本项目的持续成长目标、当前阶段、下一验收点 | 是普通 Markdown，可被 ReMe 索引；不是官方专用目标文件，也不会自行调度 |
| `notes/`、`skills/` | 背景资料、参考页、可复用方法 | 按需读取；默认不在 ReMe `memory/`、`digest/` 搜索范围 |
| `mem_session/`、`mem_metadata/` | 原生提炼的来源对话、可重建的检索派生数据 | 由原生组件管理，不作为人物档案 |

职责依据官方 [v2.2.0 人设文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.0/website/public/docs/persona.zh.md) 与实际安装模板。该人设文档对 MEMORY 搜索有宽泛说法；以同版 [记忆文档的目录表](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.0/website/public/docs/memory.zh.md) 和实际源码为准：`memory_search` 只索引 `memory/`、`digest/` 的 Markdown，不索引根目录 `MEMORY.md`。

实际安装根为 `/usr/local/lib/python3.11/site-packages/qwenpaw/`。`runtime/prompt_contributors.py:33,89–102,215–255` 按 `system_prompt_files` 顺序加载，缺字段才回退默认，空数组表示不加载文件；`49–83` 去掉 YAML frontmatter。`runtime/builder.py:457–499,512–554` 为请求重建提示后恢复原会话状态，`agents/middlewares.py:109–122` 补入记忆使用说明，不把记忆全文塞入提示。编辑人物文件不等于抹掉旧聊天；旧称呼仍可能在原会话历史出现，应由新事实纠正，不能为改名清空经历。

## 部署前发现的问题

核查时桐人与结衣都使用 `AGENTS.md, SOUL.md, PROFILE.md`，人格与专属会话已经存在。桐人 SOUL 保留 SAO 关系设定，结衣 SOUL 已明确称桐人为爸爸并保留独立判断。

- 桐人 PROFILE 只有端口、角色和调度说明；结衣 PROFILE 是身体/owner JSON。真实身份绑定应继续由注册表维护，人物档案应补成名字、定位与关系。
- 桐人 AGENTS 约 18 KB，混有完整程序示例和旧“每日额度/180 秒冷却”句子，与前面的不设人工模型额度冲突；这不是官方加载故障，而是已有提示内容过长且过期。整理时只做精确迁移，不把未知用户补充覆盖掉。
- 两人的 `notes/` 都只有原作背景页，没有实际经历索引；`memory/`、`digest/`、`mem_session/` 均无文件。桐人 `MEMORY.md` 不存在，结衣仍是未填写的官方模板。
- `running.memory_manager_backend="remelight"`，但 `auto_memory_interval=0`、`dream_cron_enabled=false`、`memory_search_enabled=false`、`auto_memory_search_config.enabled=false`。后端存在不等于自动记忆已启用。
- 当前上下文策略为 `light_context_config.strategy="native"`。持久聊天、原生上下文压缩、自研 `remember` 都不能冒充已启用的 ReMe 知识库或 Scroll 历史检索。

## 已部署的原生参数

只对已经绑定的桐人与结衣启用官方自动记忆和角色级检索，保留各自模型选择、身份、原生活 session、所有旧笔记。原生内嵌 ReMe 在 Qwen 进程中运行，不需另外部署记忆服务。其他游戏角色、运营角色与宿主 Qwen 的记忆策略没有随此变更开启。

| `running.reme_light_memory_config` 字段 | 已部署值及原生语义 |
| --- | --- |
| `auto_memory_interval` | `5`：每累计五个外部用户回合提炼；`0` 或 `null` 关闭周期提炼 |
| `memory_search_enabled` | `true`：向该角色注册原生 `memory_search` 工具 |
| `auto_memory_search_config.enabled` | `true`：普通会话模型调用前自动检索相关片段 |
| `auto_memory_search_config.max_results` | `3`：限制一次注入的检索结果数，不是模型调用额度 |
| `dream_cron_enabled` | `true`：注册原生 Dream 维护任务 |
| `dream_cron` | `0 * * * *`：每小时，Qwen 时区为 Asia/Shanghai；原生启动带 0–60 秒随机延迟 |
| `daily_paper_cron_enabled` | 保持 `false`；论文订阅不是游戏成长的前置条件 |
| `embedding_model_config`、`reranker_config` | 可保持未配置向量、关闭重排，先使用本地 BM25 |

配置出处是安装包 `config/config.py:854–987`。提炼和 Dream 经 `agents/memory/reme_light_memory_manager.py:347–359,670–695,787–796` 复用该角色当前 Qwen 模型。它们是原生的额外推理工作，不应声称零调用；来源、失败和结果需要记录。关闭 Inbox 通知不等于关闭任务本身。

`agents/middlewares.py:44,124–219,527–533` 明确跳过 `source=cron/heartbeat` 的自动检索与周期提炼。普通生活请求仍通过现有 console 主会话提交；十分钟 Cron 只投递复盘信号，不能把 Cron 自己的提示当作已成功捕获生活经历。五回合不是五分钟或模型内部五次工具迭代，必须累计原生外部回合后检查记忆任务结果。

### 没有向量模型也能检索

安装版 `agents/memory/reme_config.py:660–677,710–721` 在模型名为空时移除 embedding 组件，保留关键词索引。ReMe 的 `components/file_store/local_file_store.py:821–827` 无向量直接返回空向量结果，`869–889` 仍执行 BM25 关键词检索。官方同版 [ReMe 配置源码](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.0/src/qwenpaw/agents/memory/reme_config.py) 可核对。

这允许先把已有能力用起来，不需要新增 embedding 密钥或模型供应商。BM25 是关键词匹配，不能说具有与向量检索同等的语义召回；搜索结果仍应按路径读原文。直接检索在当前关闭 reranker/embedding 的前提下不需要生成式模型。

### Dream 的变化检测和边界

安装版 ReMe `steps/evolve/dream/extract.py:31–104` 默认扫描最近两日的日期索引和日期目录，用文件修改时间与 Dream catalog 比较。没有变化时在进入提炼模型前成功跳过；有变化才提炼并整理，最多五个单次整理单元。`memory/goals.md` 虽可索引，却不属于这个默认两日 Dream 扫描范围；应把当天有证据的目标进展记入日期日记。

Dream 不自动改写根目录 `MEMORY.md`，也不替代当前游戏执行或长期目标调度。原生流程可能有自身的一次恢复尝试，不能笼统承诺整个后台完全不重试；它没有身体工具，不得借记忆整理重放未知游戏动作。

## Goal 的准确定位

官方 [`GoalMode` 源码](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.0/src/qwenpaw/modes/goal/goal_mode.py) 在 `53–94` 定义默认二十轮、三十万 token 与进程内 `_sessions` 字典；`147–154` 在会话重置时删除该目标。它使用完成判定与停止条件，适合一个明确任务的连续推进。

因此不能把原生 `/goal` 宣称为跨进程重启可恢复的长期生活账本，不能只写 `memory/goals.md` 就认为 Goal 已激活。当前最小方向是：原生活 session 保持连续，文件记录目标与下一验收点；已有生活控制器处理真实世界事件、串行与未知回执；原生 Cron 发复盘信号、原生 ReMe 管记忆。十分钟或真实入睡后的复盘每次挑一个实际改进，不再增加一条独立生存模型循环。

## 人物迁移与部署

`world/ops/life_persona.py:prepare_files(role,name,existing)` 只计算差异，不读写生产：

- PROFILE 精确移除已知旧技术句或仅绑定字段的旧生成 JSON，保留未知文本，再写一个受管人物块。
- SOUL 完全不改，保留 SAO 人设和用户补充；AGENTS 增加或更新一个短记忆块，并精确迁移两处已知旧额度/冷却语句，与当前 `world/survival/AGENT.md` 保持一致。离线角色同步复用同一纯替换，不整文件覆盖。
- `MEMORY.md`、`memory/goals.md` 仅在不存在时创建；已有内容包括空模板均不覆盖。初始目标统一标待核实，不伪造已经完成的生活经历。
- 调用方仍须验证精确角色、body、owner、generation 和原生活 session，再以原生文件 API 的 ETag 做 CAS。纯函数不提供角色授权。

部署工具为 `tools/configure_life_memory.py`。默认只预览；`--apply qiandengji` 要求原控制器暂停、原生任务空闲、NPC 输入服务已停止，备份后用官方文件 API 的 ETag 写入已存在文件、新建 API 创建缺失文件，再通过 `PUT /api/agents/{id}` 更新完整保留的 running/security。该 API 必须带原 `id` 和 `name`，不能只传 memory 片段；模型和 embedding 不变，读回再次核对。无需切换人物语言或重新 init，这些路径可能重建模板。

复盘任务使用固定 ID 的原生 `PUT /api/cron/jobs/{id}` 创建，初始暂停；POST 创建会生成新 UUID，不能用它实现固定 ID 去重。现有任务的时间和暂停选择保留。更新后的 survivor 就绪后，`--activate qiandengji` 为原 MCP 的 allow-policy、DriverCard 和 legacy mirror 同步增加 `request_review`（43→44项），核对工具就绪才恢复该任务；保留原连接、凭据和其他任务。工具白名单 API 只改 DriverCard，必须通过原生 Agent API 同步 legacy mirror，否则严格健康检查会失败。

所有写入有本机忽略目录的备份与分步日志，重复执行不会覆盖角色后来写下的记忆。配置成功回执位于 `runtime/life-memory-configuration/20260908T155857091722Z/receipt.json`，最终工具激活记录位于 `runtime/life-memory-activation/1788883432026456300/`。首轮配置在写入七个文件后因原生缺少 name 校验返回422，补齐 name 后重跑并成功；这些文件没有重写或丢失。

## 复盘、睡觉与原生心跳

在 Qwen 18089 选择桐人，定时任务页可见“桐人 · 每10分钟成长复盘”。默认每十分钟，支持保留暂停选择或改为每五分钟。它是原生文本 Cron，被现有进程内适配转为一个 MCP 信号，不请求模型、不另建聊天、不操纵身体；后续真正复盘会使用桐人当前模型。

`world/survival/review.py` 在原状态目录保存 SQLite 信号队列。时间窗生成稳定 request_id，重复信号去重、忙碌时合并；原控制器在安全边界将快照加入当前生活 session，按明确原生任务终态确认消费。任务执行中晚到的信号不会被旧任务吞掉，未知结果不会重复提交。

原生成功 sleep 回执也能排队，但只证明进入睡眠，不证明睡满一夜或已经醒来。下一轮先观察身体休息状态，不为复盘打断睡眠。当前验收没有强制角色睡觉，真实睡眠触发仍待自然生活回执验证；合并与回执判定已有针对性测试。

原生 Heartbeat 当前固定使用 `main/main` 会话；`target=last` 只决定输出位置，不能保证进入角色的原生活会话，也没有身体入口互斥。因此保持关闭，使用上述原生 Cron 与现有会话入口。没有额外启动自研计时进程。

## 实机证据与验收边界

- 00:10 原生 Cron 自动执行成功，下次时间读回00:20；它产生 `review-2`，由原生活任务 `task-349d71ef63bc` 消费。此前手动运行一次原生任务只验证信号链路，未直接发起模型或游戏动作。
- 首条 `review-1` 在原聊天 `cd4f732b-b343-43de-93eb-437b7ec96ac3` 的 `task-c55d625759a0` 完成。原生 `read_file`、`edit_file` 回执证明桐人更新了 `memory/goals.md` 与 `MEMORY.md`，磁盘读回一致；这些是模型总结，不作为所有装备、技能和通路结论的独立认证。
- 结衣的 Auto-Memory `task_1` 于00:10完成，来源消息10条，生成日期索引和 `memory/2026-09-09/maid-yui-inner-monologue-interaction.md`，`mem_session/` 保留来源对话。桐人验收时尚未累计五个外部完成回合，没有伪造自动日记。
- 结衣真实会话的 ReMe SearchStep 返回 keyword_hits=1/vector_hits=0，证明现有本地关键词检索可用。
- 00:00 两角色的原生 Dream 实际运行，因没有近期日记变化而成功跳过。Dream 是原生 APScheduler 服务任务，不能因为 `/cron/jobs` 没有 Dream 条目就判断未启用；需看原生日志、digest 与元数据。
- 为验证有变化分支，在原任务全部空闲、生活控制器暂停、NPC输入服务停止后，只向结衣原会话提交一次官方 `/dream`。`task-cfe371a1ec90` 于00:23完成，原生 DreamFinishStep 为 success=true、checkpointed=2、failed_units=0、errors=0，新增 procedure/wiki 两份 digest 和兴趣资料。来源是已有自然对话日记，内容主要是表达和配置交互经验，不能据此宣称学会了采矿或新的女神技能。证据在本机 `runtime/yui-dream-native-once-20260909/`。

上线验收区分：开关和工具就绪、实际笔记保存与检索、Dream 新材料提炼、游戏行为技能通过测试和晋升。没有把 `/goal` 开成跨重启无限循环，也没有把记忆摘要自动转换为已学技能、物品奖励或权限。

### 记忆状态页兼容修复

实际 `/api/agents/{role}/memory/status` 曾返回500：原生统计函数递归访问保留在 `_binding_specs` 的 `Dependency` 元数据，触发其故意抛出的“accessed before start”。实际关键词搜索已成功，不能据此断言索引未启动。

`world/ops/reme_status_compat.py` 通过现有进程启动入口，在统计函数中跳过 `Dependency` 声明，其他对象和统计方法仍用原版。锁定 Qwen/ReMe 版本与原函数 SHA，升级必须重新核对；不改组件初始化、检索、模型或 site-packages 文件。真实安装包测试复现原异常，并验证原生 StatusStep 能返回统计。

可运行 `python tools/smoke_life_memory.py` 读取两角色配置、实际记忆统计、原生Cron状态、文件哈希和复盘水位；结果写入本机忽略文件 `reports/qwen-life-memory-smoke.json`，不会调用模型或触发Dream。内存中的 Auto-Memory 任务列表在重载后可能为空，持久日记、来源和本次验收回执仍保留，不能把列表为空当作笔记丢失。

最后重载后两角色真实 memory/status 均成功返回，原生游戏健康和 `tools/audit_agent_runtime.py` 通过（游戏8角色、运营6角色）。旧NPC服务在维护中停止，Qwen已保存但未激活的4个NPC相关MCP连接在目标恢复后，通过原生API重存相同白名单重新连接，配置与权限逐项保持；不能只启动NPC就假定已自动重连。桐人恢复后在同一原生活session开始 `task-4f137d35750c`，暂停期间的 `review-3` 保留并进入任务。

本轮验证：生存复盘相关191项回归、原生Qwen配置/权限/调度/人物/统计兼容91项回归（其中3项环境条件跳过）；统计补丁另在实际安装包中复现异常与恢复，部署和角色运行由上述实机回执独立验收。
