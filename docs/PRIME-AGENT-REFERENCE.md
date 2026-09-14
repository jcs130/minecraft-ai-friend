# Prime Agent 与千灯纪的长期自主成长

核查日期：2026-09-14。结论：优先借鉴可修订的经验、持久目标、结果验收及程序化上下文；继续由游戏 Docker 内 QwenPaw 承担模型调用，Numen/TLM 承担身体执行。本次完成源码研究和接入设计，没有安装 Prime、切换运行框架、修改角色配置或发起生产模型实验。

研究固定于 Prime 官方提交 [`4a4a2305eb58ab1081f72b3a85da4c962acf70bd`](https://github.com/PrimeIntellect-ai/prime-agent/tree/4a4a2305eb58ab1081f72b3a85da4c962acf70bd)，仓库采用 [MIT](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/LICENSE)。本文没有复制第三方实现。以后移植源码应记录固定来源并保留相应许可证。

## 官方机制与实际边界

| 机制 | 核查结论 | 对千灯纪的价值 |
|---|---|---|
| 持久 Python 上下文 | 每个 session 有 kernel。成功单元后安排磁盘快照；不可序列化对象会跳过。断开终端时 worker 继续运行，进程崩溃只能恢复已保存状态；压缩也可能清理过大变量。 | 大量轨迹、地图和配方留在可查询资料里，模型按需筛选。不能把活连接或“动作已发出”当作可恢复的游戏事实。 |
| RLM 子 Agent | Python 接口回调 TypeScript 宿主，由宿主管模型和子会话。当前接口为 `rlm.spawn`，源码还支持 `rlm.collect`；文章中的 `rlm(...)` 已过时。 | 临时调查、分析、代码评审可以并行；身体动作仍需一个明确拥有者。 |
| 持久 Goal 与 autonomous gate | 目标写入 JSONL 并恢复。`goal.complete()` 是模型报告完成；另外配置的 gate 才执行命令核验。到达停止上限不等于完成。 | 为长期目标保存前置条件、验收依据和进度；把真实游戏验收接到继续/完成判定。 |
| Continual Harness /refine | 修改补充提示、记忆、技能描述和子角色规格；默认只影响本 session，稳定经验可显式推广。保留修改前后内容，并避免覆盖规划期间已变化的条目。 | 把反复发生的问题变成小范围、可回退的策略改动；在当前动作收尾后应用。 |

上述事实的固定来源：[kernel 快照](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/src/core/kernel/repl-manager.ts#L869)、[快照限制](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/src/core/kernel/state-snapshot.ts)、[RLM Python 接口](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/prime-agent-runtime/src/rlm/__init__.py#L318)、[Goal 持久化](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/src/core/agent-session.ts#L1988)、[autonomous gate](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/src/core/autonomous.ts#L390)。

`/refine` 的验证目前主要是结构与冲突检查，记录的 `outcome` 直接取自模型的 `expectedOutcome`。它没有在应用该条目时执行游戏技能、测量收益或验证下一次任务。因此“已保存改进”与“经实践有效”必须分开。它的回退恢复经验条目，不回滚游戏世界或工程代码。[refine 应用与回退源码](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/src/core/refinement/refinement.ts#L804)

官方 Factorio 案例同时记录了有效经验积累和利用 RCON 直接生成资源的奖励作弊。由此得到本项目的设计判断：管理员救援、修复与真实生存所得应分别记账；不能把救援发放的物资当成学会了生产。该案例并不证明 Prime 已能长期稳定玩本服的模组 Minecraft。[官方案例](https://www.primeintellect.ai/blog/prime-agent)

Prime 有 TypeScript SDK 和 MCP 接入能力，但完整调度、provider、kernel 与持久化属于其自身宿主。它不是一个安装到 QwenPaw 技能页即可生效的插件；Python `rlm` 包也不能独立提供完整子 Agent 系统。[SDK](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/docs/sdk.md)、[宿主架构](https://github.com/PrimeIntellect-ai/prime-agent/blob/4a4a2305eb58ab1081f72b3a85da4c962acf70bd/packages/coding-agent/docs/rlm-runtime.md)

## 现有基础与具体缺口

| 本项目已有 | 实际边界 | 建议补齐 |
|---|---|---|
| [原生活会话](../world/survival/life_session.py)、[持续控制器](../world/survival/controller.py)、[成长事实摘要](../world/survival/progression.py) | 模型能够选目标和继续工作，但没有完整的、按已验证能力维护的成长课程账本。 | 在原目标上补目标版本、先决条件、实际验收项及证据引用，由模型自主调整课程。 |
| 原生 ReMe、Dream、经验文件及 [真实生活证据](../world/ops/life_memory_evidence.py) | 原生记忆可运行；旧推断、过时环境和模型的错误总结仍需要纠正。 | 经验补充适用条件、来源、过期/被替代关系；用新证据提出小改动。 |
| 官方 MakeSkill 2.0、[角色学习](../world/ops/agent_learning.py) | 能创建并发布本角色工作流程；学习反馈仍明确为 agent_reported。 | 将预期改进与实际表现分开，不能仅凭文档发布提高“掌握”计数。 |
| [程序技能版本、测试与晋升](../world/survival/skill_library.py) | QuickJS 测试检查给定样例的输出，并非真实游戏成功率。截至本次只读检查，持久库只发现 `craft_sticks` 一种程序的 head，三个历史晋升版本。 | 对准确技能版本连接实际执行回执、失败案例及跨场景复验，推动技能库真正增长。 |
| Qwen 原生团队、结衣原生活信号、[对话累积](YUI-DIALOGUE-INBOX.md) | 具备协作和异步收件；收到请求、完成模型回合、游戏 heard 与实际产出各有不同含义。 | 临时研究复用原生子任务，人物互动保留游戏通路，结果带任务与证据身份。 |

QwenPaw 2.2.1 自带 Scroll：历史写入 SQLite，`recall_history` 按需查询；另有 `recall_history_python` 用于程序化历史分析。本次在现役游戏容器中确认这些实现存在，Python 分析工具没有注入沙箱时默认拒绝执行；这不证明当前角色已启用或通过端到端验收。本次未迁移当前上下文配置。[官方上下文文档](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/context.zh.md)、[原生 Python 历史工具](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/agents/context/scroll/repl.py)

因此“把上下文当作可查询数据”可以先复用原生能力。Scroll 保留经历，ReMe 整理知识，MakeSkill 保存方法，现有执行器验证身体动作。实现细节和已部署状态继续以 [Qwen 能力复用](QWENPAW-CAPABILITY-REUSE.md) 与 [升级记录](QWENPAW-221-UPGRADE.md) 为准。

## 接入顺序：在原生活循环内学习

以下是后续实施设计，尚未作为新的生产功能部署。

1. **先建立一次完整的练习记录。** 使用现有 `remember`、目标和动作记录，关联本轮的目标、环境、技能准确版本及真实回执。模型自行选择有价值的小目标，不把固定的挖矿/建房顺序写成行为规则。
2. **在原复盘时提出一个改进。** 重复失败、真实任务结束或新方法成功时积累复盘素材；原十分钟信号在当前轮完成后触发读取。让原 Qwen 角色提出局部经验修订或技能草稿，不新增另一条同时控制身体的模型循环。
3. **把改进假设与事实分开。** 建议记录 `expected_outcome`、`observed_outcome`、`evidence_refs`、`skill_version`、`verification_status`。没有实测先保留候选；旧经验被新证据否定时标明替代关系，不抹去原失败记录。
4. **按改动类型验证与生效。** 普通方法用官方 MakeSkill；可执行程序沿 `skill_draft → skill_test → skill_promote → skill_start`，晋升只代表可受控执行，之后还要验实际效果。新增法术、物品或模组逻辑交天神在工程候选里编码、测试，再按现有发布流程处理。改动在动作边界生效，保留原版本用于回退。
5. **把验证结果带入下一次选择。** 记录物资收益、耗时、失败、救援和跨场景结果；只有有证据的经验才进入可复用能力目录。重复做日记或单纯新增技能文件不能代替成长。

持久化内容应携带人物、身体、世界、任务与版本的绑定。世界重启后重新读取现实状态；未知动作继续查原请求，不因“恢复目标”重发已经可能执行的交易、放置或施法。这是本服原有执行契约，不能被新的记忆或目标机制绕开。

上述方向不需要修改当前模型选择或重新加上 LLM 调用总上限；时间和用量用于观察实验效果，已有单身体串行及真实终态要求继续保留。

## 角色分工与首个验收目标

| 角色 | 在成长过程中的职责 |
|---|---|
| 桐人 | 自主选目标、使用已有游戏工具实践、编写可组合程序、记录内测反馈。 |
| 结衣 | 观察环境和伙伴进展，参与分工，必要时救援；救援带原因与实际措施，进入世界改进记录。 |
| 女神 | 处理环境、权限和运营问题，核对世界状态与救援需求。 |
| 公会策划 | 根据真实能力与世界进展提供可玩的任务机会，验收与奖励沿原公会系统。 |
| 天神 | 处理代码缺陷、补游戏接口或新法术，复用原生子 Agent 做调查/评审，在工程候选中验证改进。 |

运营后台可以复用 Qwen 原生 A2A/子任务；桐人与结衣的角色交流仍通过游戏私聊/TLM/队伍接口及 heard 证据。临时分析子任务不等于自动招募一个有身体、有独立人格的新居民。[Qwen 原生多 Agent](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/website/public/docs/multi-agent.zh.md)

首个建议的实验目标是“建立可持续食物来源”，不是替角色预先规定动作。允许模型在耕作、现有物资加工或真实交易之间选择。验收应至少覆盖真实材料来源、实际产出与再次补给；选择耕作时，要看到成熟收获和补种，而不止一次种植。首次形成的办法还应在条件变化后复验，并把失败反馈用于下一版本。

短期先验完整闭环，再延长到多小时自主观察。每轮比较实际目标达成、获得的资源、重复卡点、外部救援和同版本复用效果；本次没有运行这个实验，也没有把旧的生活任务完成记录作为新机制的实验成绩。
