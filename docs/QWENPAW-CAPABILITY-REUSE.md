# QwenPaw 能力与市场复用

核查日期：2026-09-14。范围是游戏 Docker 的 QwenPaw 18089；宿主 8088 不在本次范围。以下区分已经使用、值得接入和暂不安装。市场内容只做了只读下载与核对，没有安装第三方插件、启动额外模型循环或更换角色模型。

## 优先继续使用原生能力

| 能力 | 当前项目如何使用 | 这次核查后的选择 |
|---|---|---|
| 独立 Agent 工作区、人格、文件与记忆 | 每位现役角色保留自己的身份、会话及持久文件 | 继续复用；不另做一套人格和记忆服务 |
| Cron、后台任务、会话续接、工具回执 | 原 16 项班次、桐人生活会话、结衣生活信号 | 继续原循环；一个身体不增加第二条策划线程 |
| `file_reader`、文件工具、`make-skill` | 各角色保存笔记、资料和普通流程 | 升级官方 MakeSkill 2.0 的完整包及调用方式，见下文 |
| 原生角色创建、`list_agents`、`submit_to_agent`、`check_agent_task`、`spawn_subagent` | 现有团队工单、求助和专业角色招募 | 直接复用原生能力，保留工单身份和真实回执；游戏人物交流仍经游戏接口 |
| 技能池、工作区副本、渐进披露 | 角色只启用相关技能；参考资料逐篇读取 | 技能池可复用一份来源，实际运行仍是各工作区自己的副本；不把全市场装给每个人 |
| 统一市场与依赖检查 | 现有 `market_search/market_read` 只读查询 ClawHub | 管理界面可利用原生更多来源；角色自动搜索仍保留当前只读路径，下载、启用和执行不能混称成功 |

官方 2.2.1 原生市场源码包含 QwenPaw、ClawHub、ModelScope、阿里云供应源；URL 导入还支持 GitHub 等来源。依赖声明可以列出二进制、环境变量和已启用 MCP，加载时会检查；它不证明 MCP 连接、工具权限和实际游戏行为成功。原生 `spawn_subagent` 的临时任务和独立人格工作区不是同一种角色。相关依据：[技能文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/skills.zh.md)、[多智能体文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/multi-agent.zh.md)、[市场实现](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.1/src/qwenpaw/market)。

## MakeSkill 2.0 的升级兼容

2.2.0 的官方 MakeSkill 1.1 调用 `materialize_skill`；2.2.1 移除了这项专用工具，改为官方包内四个 Python 脚本。只更新一份 `SKILL.md` 会漏掉实际脚本，同时旧的角色 shell 策略也会拒绝执行。[官方 MakeSkill 2.0](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.1/src/qwenpaw/agents/skills/make-skill-zh)。

项目升级适配继续使用原生 `execute_shell_command`，只放行 `create_plan`、`init_draft`、`validate_skill`、`publish_skill` 的确切调用。本角色用原生文件工具保存 JSON 输入，使用 `python -B scripts/<阶段>.py --input <本角色 notes 或 drafts 中的 JSON>`，cwd 必须是自己的官方 MakeSkill 目录。工作区、技能保留名称、草稿绑定和官方包字节在执行前校验；不开放任意 shell。

四阶段分别规范化计划、创建私有草稿、检查文件/语法与内容摘要、通过原生 SkillService 安装到本工作区。`publish_skill` 不上传技能市场，也不执行草稿里的 Python/Batch；新游戏动作依旧需要原有实测和晋升。已授权的普通经验整理可以在当前任务中完成，角色无需为同一授权重复询问。

官方扫描器把其自带 `validate_skill.py` 中的 `compile(..., "exec")` 语法检查误判为危险执行。本项目保持扫描器 `block`，仅通过官方“名称 + 完整内容哈希”白名单接纳已核对的原包；其他技能仍扫描。`-B` 防止生成字节码缓存改变原包哈希。完整源文件哈希和该精确例外保存在 `world/ops/native-role-skills.json`，不采用只按名称放行。

隔离 QwenPaw 2.2.1、断网、零模型测试已覆盖原 2.2.0 官方包迁移、技能池与工作区同步、旧字节备份、用户改写拒绝，以及真实四脚本创建 `camp-review` 后被原生技能服务发现。两套原生权限包装器均验证；跨角色、错 cwd、管道、保留名称、篡改官方脚本被拒绝。证据在本机 `runtime/qwenpaw-upgrade-20260914/research-market/native-make-skill-2.2.1.json`。这些是软件能力验收，不代表角色已经自主创造并实测了新的游戏法术。

## 可用候选与角色映射

| 来源与候选 | 适合的角色 | 复用方式与当前结论 |
|---|---|---|
| 官方 `multi_agent_collaboration`、`chat_with_agent`、`make_plan` | 女神、司灯、公会策划、天神 | 原生工具已经接入现有团队，可以参考官方协作正文。`make_plan` 会向其他 Agent 请求规划，并有默认角色选择；不能原样替代当前明确身份的工单路由，也不用于桐人与结衣的游戏对话 |
| 官方 **Agent Kanban 0.1.1** | 女神、司灯管理团队任务 | 有任务/角色视图、SSE 进度和审核列，很适合管理页面。但源码每 30 秒调度任务，并会接续重启后未结束事项；需先接入现有任务账本，避免与原班次同时派工。本次不安装 |
| 官方 **OMP Workflows 0.1.1** | 天神的临时工程分析、测试与评审 | 可参考 Team、UltraQA 等模式和角色工具划分。其 executor 默认继承全部工具，工作流会创建子任务；应仅在工程候选目录、受管工具内使用，不能直接接管桐人身体。本次不安装 |
| **FunPlay `game-concept-brief`** | 公会策划、司灯 | 体量较小，适合把活动想法整理成玩法目标、最小范围和可玩验收条件。模板可直接按需参考；随包 Node 脚本需另行审阅与准入，当前角色没有这项 shell 权限，因此不能称完整包已可运行 |
| **AlterLab GameForge `game-designer` 1.3.0** | 公会策划、游戏数值/体验专家 | 有成长、奖励、核心循环与试玩反馈方法。但单个正文约 41 KB，内含固定人物、Claude 的 model/context 字段、其他角色及共享文档依赖；只选用相关方法和模板，不整包覆盖现有人格 |
| **fcsouza `design-game-design-fundamentals` / `design-quest-mission-design`** | 公会策划 | 基础方法与任务树设计可供研究；任务技能还依赖世界设定、一致性和经济设计技能。仓库 GPL-3.0，不能当成 MIT 内容混入本项目；不作为本次直接安装项 |

官方候选来源：[Agent Kanban](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.1/plugins/apps/agent-kanban)、[OMP Workflows](https://github.com/agentscope-ai/QwenPaw/tree/v2.2.1/plugins/bundle/omp_workflows)。Kanban README 声明 MIT，父仓库为 Apache-2.0；实际再分发应保留所用包随附许可证。OMP 随官方 Apache-2.0 仓库发布。插件安装使用应用中心的完整发行包，或 `qwenpaw plugin install <已核对的本地完整目录或 ZIP>`，源码目录缺少前端构建产物时不能当作完整插件。[插件官方文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/plugins.zh.md)。

外部候选已定位原作者固定提交，未使用转载注册表作为代码来源：

- FunPlay：提交 `a34905cae1d24cde1d9933b4d3c115f746a78e0f`，MIT；[技能正文](https://github.com/FunplayAI/funplay-skill/blob/a34905cae1d24cde1d9933b4d3c115f746a78e0f/skills/game-concept-brief/SKILL.md)、[许可证](https://github.com/FunplayAI/funplay-skill/blob/a34905cae1d24cde1d9933b4d3c115f746a78e0f/LICENSE)。没有声明独立技能版本，不能把提交日期当成版本。
- GameForge：提交 `5f5148d61986b32299070e87fcd4a1ab3718eacf`，MIT，技能版本 1.3.0；[技能正文](https://github.com/AlterLab-IEU/AlterLab_GameForge/blob/5f5148d61986b32299070e87fcd4a1ab3718eacf/skills/agents/game-designer/SKILL.md)、[许可证](https://github.com/AlterLab-IEU/AlterLab_GameForge/blob/5f5148d61986b32299070e87fcd4a1ab3718eacf/LICENSE)。
- fcsouza：提交 `e0a3dde8c1d865ef5b430040caab8e533f16d28e`，GPL-3.0；[任务技能](https://github.com/fcsouza/agent-skills/blob/e0a3dde8c1d865ef5b430040caab8e533f16d28e/plugins/game-dev/design/quest-mission-design/SKILL.md)、[许可证](https://github.com/fcsouza/agent-skills/blob/e0a3dde8c1d865ef5b430040caab8e533f16d28e/LICENSE)。未声明独立技能版本。

确认选用某个包后，优先原生 `qwenpaw skills install <固定提交的技能目录 URL> --agent-id <具体角色>`；安装仍需整个被引用包齐全、许可证保留、扫描与依赖通过。这里给出的是可审阅候选，不是已安装清单。

## 本次市场实查中不直接采用的内容

分别在官方 QwenPaw 和 ClawHub 公共接口查询了 `game design`、`quest`、`minecraft`、`self improving`，每来源每词最多 5 条。官方 QwenPaw 市场没有返回直接匹配游戏设计/Minecraft/自我改进的候选；`quest` 命中两个非游戏任务技能。ClawHub 有游戏设计和 Minecraft 相关条目，但本次返回的多条版本字段为空，也没有原仓库链接，因此不能仅凭热度和卡片名就声称已核验可安装。

尤其不直接接入 `openclaw-minecraft`：其说明采用 Mineflayer 控制器加 Cron 自主循环，会重复现有 Numen 身体与生活调度。`self-improving` 类还提供另一套整理/记忆流程，应先确认具体缺口再选择，当前优先原生 ReMe、Dream、文件与 MakeSkill。`quest` 搜索中的日常习惯积分技能不是公会任务引擎。市场查询和原文哈希保留在本机 `research-market`，安装状态均为未安装。

后续实际价值最高的顺序是：先让现有官方记忆和技能创建在原会话中可靠使用，再给公会策划按需补少量活动/任务方法，最后将 Kanban 的任务视图接到当前真实工单与班次。是否有帮助，应比较实际完成的任务、失败反馈和新技能验收，不能只比较安装数量。

## 2.2.1 记忆与上下文如何复用

游戏生产容器已于2026-09-14升级为2.2.1，部署验收见 [升级记录](QWENPAW-221-UPGRADE.md)。原桐人、结衣继续使用 ReMe：每五个外部回合提炼、每小时 Dream、按需检索和最多三条自动召回；十分钟成长信号进入原生活会话。人物、日记、来源对话及这些参数保持原样。2.2.1 将后台记忆生命周期与动作接口统一，继续复用角色模型；原生队列仍不等于跨重启持久任务。[原生记忆接口](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/agents/memory/base_memory_manager.py)

随包 ReMe 0.4.1.11 已修复 Dependency 导致的统计错误。当前核验版本和原函数后直接使用官方实现，退休新环境的统计补丁，保留旧版回滚路径。但原生历史格式仍只提取文本，不能证明游戏动作成功；两角色的精确工具回执证据扩展继续保留。[官方统计修复](https://github.com/agentscope-ai/ReMe/pull/510)、[历史格式源码](https://github.com/agentscope-ai/ReMe/blob/v0.4.1.11/reme/steps/evolve/_evolve.py)

Scroll 保存逐字经历到 `history.db`，通过 `recall_history` 按需展开；ReMe 提炼可复用知识，两者互补。它适合之后试点桐人的长会话，本次保持现有 `native` 策略。切换时官方会回填仍存在的 `sessions/*.json`，原文件不删改；默认只保留30日，需要全部经历时须明确设 `history_retention_days=0`，也不能恢复早已丢失的原文。[上下文文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/context.zh.md)

新增 Auto Fin 实际采集财经新闻并生成研究报告，继续关闭；游戏复盘用原 Auto-Memory、Dream 和成长信号。PowerContext、ADBPG 是可选插件后端，需要额外服务或存储，不自动迁移现有 ReMe 笔记，当前不切换。[Auto Fin说明](https://github.com/agentscope-ai/QwenPaw/pull/7441)、[后端文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/memory.zh.md)

`SOUL.md`负责人格，`PROFILE.md`负责身份关系，`MEMORY.md`按需读取；不要重新初始化来升级。原生 Goal 仍把执行状态存在进程内，适合有限任务，不能代替持续生活调度或把普通 `memory/goals.md` 自动变成运行目标。[人物加载源码](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/runtime/prompt_contributors.py)、[Goal源码](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/modes/goal/goal_mode.py)
