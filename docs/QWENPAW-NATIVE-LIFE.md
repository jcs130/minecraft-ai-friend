# 原生能力接入持续生活

2026-09-14，范围为 D 项目 Docker 中的游戏 QwenPaw 2.2.1（18089）。保留原桐人、结衣及运营团队的模型、人格、身体绑定、历史和16项班次。没有部署第二套 Agent 平台或常驻调度器。

## 历史与经验各司其职

两生活角色使用原生 Scroll，`history_retention_days=0`。官方启动钩子按 `chats.json` 回填仍存在的注册会话；保留原 `sessions` 文件。角色可以用结构化 `recall_history` 按问题查找、展开旧经历；不注册 Python 历史执行工具。ReMe 继续每5个外部回合整理、每小时 Dream，自动召回最多3条。

Scroll 的逐字历史与 ReMe 的经验笔记互补。原生压缩和回忆使用当前角色的模型，不能声称零额外模型开销。稳定人格和工具顺序保留，资料逐篇读取；记忆输入移除了重复的通用政策与能力卡，近期实践只投影有界事实。[官方上下文机制](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/context.zh.md)

会话数据库永久保留不等于所有附件永久保留：2.2.1 公开配置要求 `tool_result_pruning_config.offload_retention_days` 为1–365天，本次保持原30天。过大的工具结果可能只有索引和摘要留在历史中；过期附件无法从索引重建。首次设置附件0天被原API以422拒绝，读回两角色未变，修正为仅修改策略和会话保留期后才重新提交。没有修改原生校验或抹去失败记录。

## 实践结果进入原生记忆

已有 ReMe 扩展现在识别真实 `skill_read.practice`：匹配角色、技能版本、实践ID和原始回执，分别记录程序自报结束、目标观测结果、身体动作数和熟练度。`stepCount` 是身体动作账本，不是观察次数；catalog摘要、排队回执、模型自述不升级为成果。缺失或不匹配的证据明确记录覆盖缺口。

桐人的 `farm_harvest_replant` 版本 `72324f4…` 是本次回归实例：程序自报 done，但农耕目标未达成、身体动作0、熟练度未验证。对应程序内部5项标记不能替代独立方块观察。结衣旧笔记“没有农耕能力”也追加了纠正：应查当前 `task_catalog`，目录提供工具仍不证明已经工作成功。

这两类纠正已通过原生工作区API写入各自 notes、当天 memory 与相关旧笔记，保留原内容和来源。新增的 `notes/qiandeng-native-capabilities.md` 给出历史回查、文件积累、MakeSkill、工单求助的按需入口；`notes/index.md` 只增短索引。Dream仍用自己的原生读写工具，不获得游戏动作权限。

## MakeSkill与团队协作

十个现役角色已有官方 MakeSkill完整包。本次修复了两个请求级缺口：运营工单和负责人 `spawn_subagent` 的白名单都还使用2.2.0的旧入口。现在按实际版本选择：2.2.0用 `materialize_skill`；2.2.1用原生 `execute_shell_command` 运行官方四脚本。收件人原有工作区、命令、包哈希检查继续执行。

已用同版原生 `SkillService` 在断网独立工作区走完 create_plan → init_draft → validate_skill → publish_skill，并通过最终子任务工具过滤验证。这里的发布是个人工作区安装，不是上传市场；软件链路通过不代表角色已经自行创造并实测新游戏技能。[官方 MakeSkill](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.1/src/qwenpaw/agents/skills/make-skill-zh)、[原生子任务](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/agents/tools/agent_management.py)

女神、天神、公会策划已有原生临时子任务；司灯可按现有接口招募专业角色。游戏人物互聊继续经过游戏，运营故障沿持久工单求助。没有因装有技能就扩大角色权限，也没有新建第二条生活循环。Goal保留为有限任务能力；它的进程内状态不能替代现有持久生活会话。Kanban、OMP等市场候选仍见[核查清单](QWENPAW-CAPABILITY-REUSE.md)，未安装。

## 部署与验收

`tools/configure_life_context.py` 默认只读预览；应用要求原生活排空、原班次暂停、NPC准入暂停。工具备份两角色配置、会话、聊天注册表和已有历史数据库，使用原API更新并完整读回比较。随后一次游戏Qwen启动执行官方回填；原16个班次与准入恢复后续接旧会话。宿主Qwen、Minecraft进程和存档不随之重启。

健康检查验证实际Scroll策略、历史库结构/完整性/同步标记和已加载记忆证据v2；管理页冒烟要求这些现场字段。未知身体动作仍不重放。回退须保留新历史库及新会话，不能用维护前的旧session覆盖新增经历；改回native也不会自动把已驱逐原文塞回上下文。

本机证据在 `runtime/native-capabilities-20260914`；配置备份在 `runtime/life-context-configuration`。隔离验证包括官方旧会话回填及幂等、结构化原文召回、finisher写穿、原生API配置校验、MakeSkill两种子任务入口、记忆实践投影及原生formatter。生产数据、日志和凭据不提交Git。

21:54官方启动回填完成：桐人53会话/338行，结衣1会话/89行，共427行；所有原session与chats字节相同。21:56–21:57两角色恢复原会话并实际构建Scroll，只注册结构化召回工具。全10角色、96项技能绑定、16项班次保留；模型QPM0、iteration关闭保持。停机备份7,604文件，版本和模型未切换。针对性测试：原生上下文10项，MakeSkill协作37项，记忆投影与formatter29项，相关健康28项，原实践34项与收件箱19项；不同测试组可能覆盖相同基础合同，不将它们当作独立游戏成果。

恢复后原会话实证：桐人 `task-660e7acfaac6` 于21:58:44完成，主动调用 `recall_history`，继续查方块、移动与农耕；制作请求遇租约结束，不能把该次制作算成功。结衣 `task-cdf55c161c6e` 于21:59:08完成，调用本体身份与原生 `append_file` 留生活记录。两项都来自既有生活循环。Qwen、实践与收件箱现场探针通过；这些回合不证明所有职业目标或长期技能进化均已验收。

宽泛旧运营健康测试仍有历史fixture缺少运行标记/未模拟新增探针的问题，不把它们列为通过；本次相关健康用例和现场探针单独核验。整体管理页仍须按各项真实证据展示，不能用本次原生能力上线代替全部玩法完成或长期自主成长验收。
