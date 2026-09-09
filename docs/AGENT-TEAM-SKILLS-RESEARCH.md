# 游戏运营团队技能与插件核查

核查日期：2026-09-09。范围是游戏容器 `qiandengji-qwenpaw-1`（18089）与官方源码；宿主 QwenPaw 不在本次变更范围。本文记录调研与文档技能准备，不把发现插件、下载技能等同于运行验收。

## 推荐组合

继续以 QwenPaw 原生 Agent、工作区、文件/记忆、定时任务和后台协作管理世界团队。按职责补充技能；有独立长期职责时招募持久 Agent，单次审查或编码任务用临时子 Agent。官方已经提供这些基础能力，无需先部署另一套团队服务器。[QwenPaw 多 Agent 文档](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/website/public/docs/multi-agent.en.md)

| 选择 | 适合千灯纪的用途 | 核查结果与采用边界 |
| --- | --- | --- |
| 官方 OMP Workflows | 天神调用临时编码、评审、QA 专家；复杂工程采用 Team/UltraQA | 官方插件 v0.1.1，Apache-2.0；有 Python 执行代码，无额外依赖，声明支持 `>=2.0.0,<3.0.0`。复用 QwenPaw 模式与 `spawn_subagent`，不是持久游戏人物招募器。 |
| MistRain-1/game-design-skill 的 `game-production` | 公会策划判断核心循环、成长/奖励、内容疲劳，司灯检查制作范围与验收 | MIT；已准备原文技能、必需参考、LICENSE、NOTICE、来源锁。选中目录没有可执行脚本。内容简洁、中文、按问题读参考，适合先实际试用。 |
| GameDesignOS 的体验分析/体验浓度技能 | 以后用桐人的实测记录设计小规模玩法实验和复盘 | MIT；有实际 SKILL.md、references、templates 与 evals。整个仓库另含 Python CLI、模型示例与脚本，当前仅推荐按需选取文档子目录，没有安装或执行。 |
| 官方 Agent Kanban | 将来在 QwenPaw 里集中查看制作任务与执行输出 | 有真实 PawApp 实现，但现在不直接启用：它维护自己的 issues.json 和自动派单逻辑，需要先与现有世界工单统一。 |

OMP 的版本和模式来自 [plugin.json](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/plugins/bundle/omp_workflows/plugin.json)，临时角色与工具约束来自 [omp-roles/SKILL.md](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/plugins/bundle/omp_workflows/skills/omp-roles/SKILL.md)，授权依据为 [QwenPaw LICENSE](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/LICENSE)。它能辅助天神工作，但不能据此宣称已经具备完整游戏制作能力。

`game-production` 的 [技能正文](https://github.com/MistRain-1/game-design-skill/blob/7ece53df48ebf6fa364660d7f67f4cc0b44dc97f/game-production/SKILL.md) 与 [设计参考](https://github.com/MistRain-1/game-design-skill/blob/7ece53df48ebf6fa364660d7f67f4cc0b44dc97f/game-production/references/design-lenses.md) 覆盖机制、故事与体验的一致性、规则公平性、玩家认知、重复疲劳和最小验证。它输出设计判断，不能替代千灯纪的资源白名单、真实发布与结算回执。独立空间布局仍需 `level-design` 专长；本次没有安装要求三个技能同时存在的 `game-design` 路由入口。授权见 [LICENSE](https://github.com/MistRain-1/game-design-skill/blob/7ece53df48ebf6fa364660d7f67f4cc0b44dc97f/LICENSE) 和 [NOTICE](https://github.com/MistRain-1/game-design-skill/blob/7ece53df48ebf6fa364660d7f67f4cc0b44dc97f/NOTICE.md)。

GameDesignOS 将观察证据、问题卡和实验方案分开，适合以后从真实受阻记录建立玩法改进实验；不能把其体验浓度公式当已验证的科学量表，也不能把单次内测当真实玩家留存数据。[体验分析技能](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/game-experience-analyzer/SKILL.md)、[体验浓度技能](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/game-experience-density-optimizer/SKILL.md)、[LICENSE](https://github.com/DY-2026/GameDesignOS/blob/ada4bf9e60c2c90a4c84866e4bfd191e3767d164/LICENSE)。

## 官方插件在本机的真实状态

本次只读检查时，18089 的 `GET /api/plugins` 返回空列表，`qwenpaw plugin list` 也显示未安装。官方 catalog 能找到 OMP Workflows 0.1.1 和 Agent Kanban 0.1.1；“官方提供”不能写成“容器已经装好”。这是检查时快照，后续安装状态应以实际 API 回执为准。

容器内 `qwenpaw/app/routers/plugins.py` 已实现 `POST /api/plugins/install`，JSON 为 `{"source":"<容器内目录或官方ZIP URL>","force":false}`；它可运行期热加载，随后重载各 Agent。安装是**该 QwenPaw 实例级别**，接口没有 `agent_id` 参数，不能声称只安装给某一个角色；角色实际工具、技能和工作模式仍要单独检查。网页文档里的 CLI 离线限制不能用来否定已安装版本的原生热加载 API。[官方插件路由源码](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/src/qwenpaw/app/routers/plugins.py)

官方目录在本次核查提供的锁定信息：

| 插件 | ZIP 来源 | SHA-256 |
| --- | --- | --- |
| OMP Workflows 0.1.1 | [官方包](https://download.qwenpaw.agentscope.io/files/plugins/bundle/omp-workflows/omp-workflows-0.1.1.zip) | `e235ada5ef0f9ae9cc14dc52125079b43087afac7771084b2c1ab2fe0406921c` |
| Agent Kanban 0.1.1 | [官方包](https://download.qwenpaw.agentscope.io/files/plugins/apps/agent-kanban/agent-kanban-0.1.1.zip) | `4fa764edb2593afe1cefce510a413ca727fb2739b916e712c43ffaed2bfb103e` |

这些哈希来自运行实例转发的官方 catalog，本文没有将“catalog 哈希存在”表述为已下载并验证插件压缩包。

Agent Kanban 的入口是 `/apps/agent-kanban`，前端和 Python 后端均为 QwenPaw PawApp。其源码包含每 30 秒派单、每 10 秒持久化的协程，重启后会重新调度孤立的 `in_progress`，并用 `ctx.chat` 创建执行。它不另开独立服务器，但会成为第二套任务账本和调度入口；接入前必须处理与 `/team` 工单、原生班次、稳定生活会话及未知动作不重放原则的冲突。README 标注 MIT，而仓库根 LICENSE 为 Apache-2.0，目录未提供独立 LICENSE；本次保留来源说明，没有复制或再分发该插件。[Kanban README](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/plugins/apps/agent-kanban/README.md)、[后端实现](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/plugins/apps/agent-kanban/backend/main.py)、[清单](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/plugins/apps/agent-kanban/plugin.json)。

## 文档技能已准备，原生安装方式

本次落盘 `world/ops/community-skills/game-production/`：

- `SKILL.md`、`references/design-lenses.md`：上游原文字节保留。
- `LICENSE`、`NOTICE.md`：保留授权和理论来源声明。
- `source-lock.json`：固定仓库、提交 `7ece53df48ebf6fa364660d7f67f4cc0b44dc97f`、各文件路径与 SHA-256，明确未包含可执行代码、未运行上游脚本。

完整安装应将该目录作为 ZIP 的唯一技能目录，经 `POST /api/skills/upload?enable=true` 上传 multipart `file`，并用 `X-Agent-Id: qd-guild-planner` 指定公会策划。此方式由原生扫描和 SkillService 处理，保留层级资源与许可文件，维护 skill.json，并只重载目标 Agent。只提交 SKILL.md 正文会遗漏 references/；仅将源码文件放在 D 盘也不等于已绑定到 QwenPaw。[技能上传实现](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/src/qwenpaw/app/routers/skills.py)

安装后的验收须读取目标 Agent 的 `/api/skills` 和技能详情，确认 enabled、原文摘要、reference 内容及许可证文件；在 QwenPaw 切换到同一角色后核对 Skills 页面。本报告作者未调用安装 API，实际安装由本轮集成流程执行并另留回执。

## 招募与问题反馈的接入原则

原生 `chat_with_agent` 技能已指导使用 `list_agents` 查询身份、`submit_to_agent` 提交后台工作、`check_agent_task` 查询结果，续聊保留 session，避免收到回复后回调同一来源造成循环。这里的原生协作与标准 A2A 协议连接应分开验收，不能只换工具名字就声称接通标准 A2A。[官方协作技能](https://github.com/agentscope-ai/QwenPaw/blob/a403b2433af6ac74404d69fc80a289658996226e/src/qwenpaw/agents/skills/chat_with_agent-zh/SKILL.md)

千灯纪建议：桐人多次受阻后以真实位置、动作回执、已试方法和需要的帮助生成问题反馈，运营 Agent 接受技术求助，回复先留在原感知上下文。日常桐人与结衣对话仍走游戏通道。持久招募必须分配新角色自己的身份、workspace、memory、learning/team 工具绑定；临时专家由原生子 Agent 服务执行，不为每个角色添加常驻循环。这是针对本项目的接入设计，不能当作上游已替项目实现的行为。

## 暂不采用的独立团队系统

HiClaw 的官方仓库现重定向到 `agentscope-ai/AgentTeams`，Apache-2.0。其 Manager/Worker、Matrix 房间、网关、文件存储及控制器适合独立部署团队基础设施，但对现有 QwenPaw 世界运营组会增加另一套管理与服务，当前优先借鉴组织和任务交接设计。[AgentTeams 官方仓库](https://github.com/agentscope-ai/AgentTeams/tree/eeaab64391ccaec9118e84977f538aefd40720d6)、[LICENSE](https://github.com/agentscope-ai/AgentTeams/blob/eeaab64391ccaec9118e84977f538aefd40720d6/LICENSE)。

`Yuki001/game-dev-skills` 有实际 `game-design-review/SKILL.md`，但本次 GitHub 元数据未给出许可证且仓库没有可核验的授权文件，因此未选作可复制安装来源。[该仓库](https://github.com/Yuki001/game-dev-skills)
