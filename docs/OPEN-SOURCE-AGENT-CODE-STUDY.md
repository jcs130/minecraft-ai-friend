# Minecraft Agent 源码对照：Cortico 优先

研究日期：2026-09-20。本地对照基线：`706317f`，独立分支 `codex/rsi-code-study`。
这是关键链路的源码精读与第一批诊断修正，不是四个仓库逐行审计，也不是游戏能力排名。
外部源码仅在忽略的 `runtime/reference-repos/` 阅读；未启动它们的机器人、模型或服务。

2026-09-20 后续补充：精读 ModularRSI 论文方法、实验与关键实现，并核查 Plan4MC、MineDojo、MineCLIP。最新三层落地设计及现役工程角色缺口见 [RSI-AGENT-DESIGN.md](RSI-AGENT-DESIGN.md)；本页早期“已有/缺少”判断须结合后续具身部署记录阅读。

## 判断

千灯纪已经有 QwenPaw 角色、原生身体身份绑定、持久动作回执、技能版本与练习证据、环境反馈和提案通道。
这些基础应保留。但“产出了技能文档”“动作受理”“某个版本测试通过”，分别不等于学会技能、完成生活目标或证明改动有效。
目前还不能把项目称为完成了 ModularRSI 式可归因的 harness 自我演化。

最合适的组合是：Cortico 的事件与任务连续性作为主要参考，Neko 补身体协调和监督，MineEvolve 补失败经验与局部修复，ModularRSI 补受控实验和版本晋升。
这四层复用现有 QwenPaw / Numen / ReMe / 技能库，不引入第二条模型驱动循环，也不把 NeoForge 1.21.1 身体整体换成 Mineflayer。

## 固定版本与阅读范围

链接都固定到实际阅读的提交，避免以后主分支变动使结论失真。

| 项目 | 提交 | 主要读过的实现 |
|---|---|---|
| [Cortico](https://github.com/Pal-AI-Lab/Cortico/tree/7d20a1029d69e5f8b3a968d476419d0ddfe6b786) | `7d20a102` | core/loop；Minecraft executor、goal-plan、receipt、round、body-lease、mineflayer-fixes；对应目标和执行测试 |
| [mc-agent-neko](https://github.com/wehos/mc-agent-neko/tree/23f5971203e3f4d15ef416ff8e5cc67965845d82) | `23f59712` | arbiter、kernel、triggers、tool_lanes、action_manager |
| [MC-MineEvolve](https://github.com/xzw-ustc/MC-MineEvolve/tree/a0a5f9b36626fd544dfd3c05e5ec27a1c1b48081) | `a0a5f9b3` | server/agent、monitor、buffer、typed feedback、repair、curator validation/retrieval |
| [ModularRSI](https://github.com/IQuestLab/ModularRSI/tree/06fdcce711cb588f75630bc8ac847074ac80e13c) | `06fdcce7` | protocols、k_roll、trajectory_analysis、promotion、action_gate、manifest、verification/margin_gated |

### Cortico：真正有价值的是执行语义

1. **框架管理事件，角色决定意义。** [core/loop.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/core/loop.ts) 的 `noteHandled` 只推进已处理事件的连续前缀；`requeueUndelivered` 在重启时补未投递的外部事件。回调受 generation 约束，外部正文进入事件工具回执或 user 数据，不提升成 system 指令。重放有条数上限，因此不能称为无限可靠投递。
   我们的 `controller.py` 已有事件游标和提交确认，应对照测试断线、迟到结果、游标空洞，复用现有 QwenPaw 请求身份，而不是再搭一套会话服务。

2. **接受任务、运行步骤、终态是不同事实。** [executor.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/executor.ts) 的 `submit → pump → run → finish` 保留任务与步骤账本。`suspend` 区分可重做步骤与可能重复扣材料的步骤；`freezeBeforeStep` 则记录尚未开工，不能与“做一半”混同。`resumedCollect` 扣除已采集数量。
   对我们应落到 `skill_library.py + controller.py` / `numen_gateway.py` 的中断证据和续做点；结果未知的合成、交易、丢物品不能自动重放。先观察、再让角色修复剩余计划。

3. **恢复权有归属。** executor 的 environment/fall 两个 hold 槽各持令牌，`releaseHold` 验证令牌，另一槽仍占用时不放开队列；死亡、断线等使旧持有关系失效。执行 epoch 阻止旧任务回调继续生效。
   这比增加一个固定“饥饿优先级”更值得借鉴。我们已有 lease、原生 task ID 和 epoch，应补同一所有者下的暂停原因集合与原生停止确认，防止旧回调恢复新任务。

4. **目标由旁证推进，也能退回。** [goal-plan.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/goal-plan.ts) 的 `coordinateGoalPlan` 区分机械核验与主观判断。未加载区域里的“没看到村民”是 unknown；库存等前沿条件失效会退回。它只复核最近被承接的机械前沿，允许更早的材料被后续步骤正常消耗，不会把所有历史库存条件永久锁死。
   [目标测试](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/tests/worlds/minecraft/goal-plan.test.ts) 覆盖失去物资、未加载实体、消耗船只、判断步骤顺序。我们 `practice.py` 已有 objective 检查与 skill 绑定；生活目标的里程碑、证据时效和显式重开应扩展这套机制。模型仍能选择目标和审美判断，机械旁证不替它决定生活。

5. **回执陈述事实，不臆测原因。** [receipt.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/receipt.ts) 区分 blocked/noop/aborted；寻路预算耗尽不等于目标永远不可达。[mineflayer-fixes.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/mineflayer-fixes.ts) 等服务端方块/库存确认，而不是仅看客户端预测。
   我们对应 `navigation_sense.py`、`food_actions.py`、原生回执与 before/after 观察。应保留真实失败原因、未知态和原生绑定，不能将成功返回值直接升级成目标完成。

6. **节省上下文但不丢变化。** [round.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/round.ts) 的 `RoundOnceGate` 对同轮、同工具、同读数指纹压缩重复结果，状态改变则重新返回。可用于我们只读观察工具；不可跨轮盲目缓存，更不可套到有副作用的动作。

**不能照搬的部分：** [body-lease.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/body-lease.ts) 明确为 shadow 模式，`observeLegacyCommit` 记录拒绝后仍调用 `fn()`。因此其中评分、迟滞测试不能证明实际执行互斥。其客户端/观察插件与我们的服务端原生身体也不同。

### Neko：学习协调机制，别继承所有监督器

[arbiter.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/framework/arbiter.js) 保留每个身体的 owner、危急生存底线、成对冲突裁决、异步模型仲裁与短期缓存。
这有助于让跟随、工作、战斗和进食共享执行权。我们需要的是 action ID / generation 绑定的权限，以及停止被确认后交接；固定分数不是自主性的替代物。

[kernel.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/framework/kernel.js) 的 no-delta 与失败冷却可给角色证据；距离、库存、维度变化的启发式不能证明完成目标。
[triggers.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/framework/triggers.js) 的 bot 范围注册和定向取消值得借鉴，避免某个角色清理掉别人的订阅。

限制很具体：[tool_lanes.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/framework/tool_lanes.js) 用 Promise.race 结束等待并不自动终止旧函数；[action_manager.js](https://github.com/wehos/mc-agent-neko/blob/23f5971203e3f4d15ef416ff8e5cc67965845d82/src/agent/action_manager.js) 的中断等待/强制释放也不能单凭 JS 状态证明身体停止。上游普通动作路径与本地实验中的 owner 补丁不可混为一谈。

我们已有 `environment_penalty.py`、`stagnation_detector.py`、`adaptive_router.py`，优先完善反馈内容和所有权，不再平行堆一组 supervisor。Neko 并非“模型不再决定行为”：模型仍参与选择与仲裁。此前设计把 LLM 限成聊天/求援/提案，过度解读了它。

### MineEvolve：成功技能与失败补救分开记

[monitor/feedback.py](https://github.com/xzw-ustc/MC-MineEvolve/blob/a0a5f9b36626fd544dfd3c05e5ec27a1c1b48081/src/mineevolve/monitor/feedback.py) 让反馈有任务、状态变化、进展、失败类型；[monitor/buffer.py](https://github.com/xzw-ustc/MC-MineEvolve/blob/a0a5f9b36626fd544dfd3c05e5ec27a1c1b48081/src/mineevolve/monitor/buffer.py) 区分连续成功片段和跨子目标重复失败。
借鉴到我们：从真实回执生成适用条件、失败原因、证据引用和失效条件，分别进入 skill 与 remedy。让角色检索到“这类办法在什么条件下失败”，而不仅是成功步骤。

[adaptor/repair.py](https://github.com/xzw-ustc/MC-MineEvolve/blob/a0a5f9b36626fd544dfd3c05e5ec27a1c1b48081/src/mineevolve/adaptor/repair.py) 冻结完成前缀，只接受模型给出的后缀。适合修复生活计划，同时必须复核当前世界是否仍满足衔接条件；任务已消耗的材料不能重复购买/合成。

不能借其验证器给技能盖章：[curator/validation.py](https://github.com/xzw-ustc/MC-MineEvolve/blob/a0a5f9b36626fd544dfd3c05e5ec27a1c1b48081/src/mineevolve/curator/validation.py) 的执行检查主要是字段/动词启发式，`v_match` 默认仍可能返回 true；monitor 的 success 来自调用方，不是独立游戏验收。
保留我们 `practice.py` 的不可变绑定、原始回执 hash、`skill_library.py` 的版本/内核/fixture 晋升链；其 STEVE-1/MineRL 执行环境不能直接适配 Numen。

### ModularRSI：先能归因，再谈自我改进

[k_roll.py](https://github.com/IQuestLab/ModularRSI/blob/06fdcce711cb588f75630bc8ac847074ac80e13c/src/harbor/agents/terminus_2_modular/self_evo/k_roll.py) 冻结首次实际选择的模块 bundle，其余 rollout 使用私有快照和同一 manifest，避免边评估边变代码。
[trajectory_analysis.py](https://github.com/IQuestLab/ModularRSI/blob/06fdcce711cb588f75630bc8ac847074ac80e13c/src/harbor/agents/terminus_2_modular/self_evo/trajectory_analysis.py) 将任务、分数、异常、成本、bundle 与原始轨迹关联，精确命令参数参与重复统计，缺失分数不能伪造为成功。

[promotion.py](https://github.com/IQuestLab/ModularRSI/blob/06fdcce711cb588f75630bc8ac847074ac80e13c/src/harbor/agents/terminus_2_modular/self_evo/promotion.py) 区分可继承的相同 diff 审查与合并后必须重跑的整树检查；[action_gate.py](https://github.com/IQuestLab/ModularRSI/blob/06fdcce711cb588f75630bc8ac847074ac80e13c/src/harbor/agents/terminus_2_modular/self_evo/action_gate.py) 检查申报的模块改动与实际文件；manifest 留谱系。

我们已有技能级版本与证据绑定，但尚缺 **harness bundle + 同任务/初始世界 + 模型/预算 + 独立 evaluator + baseline/candidate** 的完整实验清单。随机挑两次 goto，即使参数相同，也不能归因给代码变化。
其命令行任务验证器和速度阈值不适用于 Minecraft。实际实验应使用独立存档副本、相同任务与预算，多次基线/候选运行，报告结果未知率、目标达成、耗时、调用成本和副作用，再晋升。

## 本轮具体修正

原始路径：`numen_gateway.py` 写每阶段 `actions.jsonl`，另写每 action ID 的持久回执；`controller.py` 的 `action_observed` 表示获得观察，不代表动作成功。
旧 `coherence.py` 误用阶段日志，把 `accepted` 计好、漏掉一些 `executed`，并按动作名字统计重复和叠加重合片段。

新 `execution_evidence.py` / `coherence.py`：

- 使用留存回执，区分 succeeded / failed / rejected / pending / unknown；异步 goto/eat 校验原始任务终态绑定，保留 observed_ended 为未知。
- 使用身体、维度、工具、完整参数计算连续重复；覆盖位置取并集，增加最长相同动作连击。重复不自动判停滞，也不触发重试。
- 缺失来源返回 null/错误；损坏回执不允许把两段记录拼成连续重复。决策时间按时区解析并去重，不称其为卡住时长。
- 面板区分旧口径与新口径，缺失值显示证据不足。schema 2 与旧历史不可直接拼成趋势。

`tools/audit_survival_evidence.py` 是离线只读工具，每条证据带原始文件 SHA-256；同参成败只生成观察性对照片段，`causallyComparable=false`，列出真正受控评测缺少的条件。输出禁止落回输入证据目录。
它不发动作、不改历史回执、不调用模型、不自动晋升技能。

固定本机快照的清单 hash：`f881d099855169e8b56c5c9d4553a3811244e6d13a7b736b3ebb2343ff772143`。

| 同一快照的不同口径 | 旧统计 | 修正统计 |
|---|---|---|
| 数据 | 400 条阶段日志；43 条 episode 动作 | 200 条留存动作回执 |
| 成功相关读数 | 168/400，42% | 确认成功 152/200，76% |
| 未成功细分 | 仅 code 频数 | 失败18，拒绝22，未知8，待定0 |
| 重复 | 43/43，100%，只看动作名 | 16/200，8%，同身份同参连续重复；最长4 |
| 同参成败片段 | 无 | 8 组；均非因果对照 |

**这些数字是测量口径修正，不是能力提升。** 回执有留存上限，不能代表全天成功率；世界增量也不能排除他人/原生 AI 的影响。原始运行材料留在忽略目录，不进公开提交。

本轮验证：新增 24 个离线回归用例覆盖受理≠完成、终态身份错配、未知结果、参数变化、重复去重、损坏来源、hash、时区和对照资格。外部项目测试只阅读，未声称运行其整套测试或复现其游戏表现。

现有 `test_survival_practice.py` 24 个、`test_environment_penalty.py` 19 个也通过，合计 67 个通过。
`test_survival_gateway.py` 42 个中 27 个失败：从未修改的 `706317f` 导出独立基线复跑，同样 27 个用例失败，主要出现 `survival_body_unavailable`。这是已复现的基线问题，本轮未修改网关或掩盖断言；不能报告整个回归集全绿。
面板验证为实际内联脚本的 4 组 DOM 渲染用例（新口径、旧口径、空值和无数据），不是在线浏览器或上线健康验收。21 个固定提交的源码链接均对照克隆目录核实存在。

复核命令（Windows，输出放忽略目录）：

```powershell
.\run-python.bat -X utf8 -m unittest discover -s tests -p test_execution_evidence.py
.\run-python.bat -X utf8 -m unittest discover -s tests -p test_survival_practice.py
.\run-python.bat -X utf8 -m unittest discover -s tests -p test_environment_penalty.py
.\run-python.bat -X utf8 tools/audit_survival_evidence.py --state runtime/rsi-evidence-snapshot --output runtime/rsi-evidence-audit.json
```

最后一条依赖本机已冻结的快照；其他机器须提供自己的证据副本，不能把缺失快照补造成成功结果。

## 后续实现顺序与验收

| 顺序 | 本项目落点 | 验收需要看到什么 |
|---|---|---|
| 1 生活目标证据 | controller + practice/objectives | 角色自选里程碑；未加载为未知；前沿条件失效可重开；消耗过的历史材料不误回退 |
| 2 连续执行与恢复 | skill_library/controller + numen_gateway + 原生桥 | 战斗/进食暂停后只续未完成部分；重启/旧 epoch 不能恢复新动作；未知交易不重放 |
| 3 失败经验 | environment_penalty + practice + 现有共享记忆 | 同类失败跨子目标可检索；补救方案带适用/失效条件与原回执；由角色选择是否采用 |
| 4 受控演化 | controller.evolution_candidate + 现有工程工单 | 固定初始存档、任务、模型预算及 bundle；基线/候选重复实验；合并后重测，失败候选可回退 |

首批诊断改动在独立工作树验证；未部署到当前游戏服务，未改同时进行的 standing_task/controller 工作。上述四项属于后续行为改造，不因文档写完或统计修正就标成已上线。

## 来源使用边界

Cortico 与 Neko 仓库提供 MIT LICENSE。MineEvolve README 标示 MIT，但本次固定树未找到独立 LICENSE 文件。ModularRSI 另有 `LICENSE-MODULARRSI.md`，研究原创部分标为 CC BY-NC 4.0，Harbor 派生部分沿用 Apache-2.0。
本轮独立实现我们自己的回执诊断，没有复制第三方实现；如以后移植具体代码，逐文件核对声明并保留所需归属，不把所有仓库默认当成同一种许可证。

## 2026-09-20 补充：具身技能、实验环境与视觉表征

本次研究的新增克隆在开发工作区忽略目录 `runtime/embodied-references/`。保留了仓库随附文件，包括 Plan4MC 的策略权重；未安装学习依赖、运行模拟器、加载策略权重或复现论文成绩，也未另行下载 MineCLIP checkpoint。

| 项目 | 固定阅读提交 | 官方论文 |
| --- | --- | --- |
| [Plan4MC](https://github.com/PKU-RL/Plan4MC/tree/217e938c928dc5fc3e78b6b1cf7546cbe421029e) | `217e938c928dc5fc3e78b6b1cf7546cbe421029e` | [2303.16563 v2](https://arxiv.org/html/2303.16563v2) |
| [Plan4MC 的 MCEnv 分支](https://github.com/PKU-RL/MCEnv/tree/0ed52d65811d734e028f6491abd2f5a4c8261dc3) | `0ed52d65811d734e028f6491abd2f5a4c8261dc3` | Plan4MC 指定依赖 |
| [MineDojo](https://github.com/MineDojo/MineDojo/tree/2731bc27394269643b43828d9db8ab3a364601f0) | `2731bc27394269643b43828d9db8ab3a364601f0` | [2206.08853](https://arxiv.org/html/2206.08853v1) |
| [MineCLIP](https://github.com/MineDojo/MineCLIP/tree/e6c06a0245fac63dceb38bc9bd4fecd033dae735) | `e6c06a0245fac63dceb38bc9bd4fecd033dae735` | MineDojo 论文中的视觉/语言模型 |

同时核对旧参考仓库远端：ModularRSI `06fdcce7` 和 Neko `23f59712` 与当时远端 HEAD 相同；Cortico 远端 `9a35e4a` 相对已阅读的 `7d20a102` 仅更新两个 README 的横幅，运行代码相同。

### Plan4MC：把“能做什么”组织成可执行计划

[skills.yaml](https://github.com/PKU-RL/Plan4MC/blob/217e938c928dc5fc3e78b6b1cf7546cbe421029e/skills/skills.yaml) 区分 `consume/require/equip/obtain`；材料消耗和可复用条件有不同语义。
[task_decompose.py](https://github.com/PKU-RL/Plan4MC/blob/217e938c928dc5fc3e78b6b1cf7546cbe421029e/skills/task_decompose.py) 的 `skill_search` 从目标搜索依赖、推演库存；探索/移动之后，某些“附近有工具”的假设失效。其模块级可变 `possess` 不适合直接复制进我们的并发控制器。

[test.py](https://github.com/PKU-RL/Plan4MC/blob/217e938c928dc5fc3e78b6b1cf7546cbe421029e/test.py) 的渐进模式每次执行一个技能，再用真实库存经 `convert_state_to_init_items` 重建条件并规划。LLM 在论文中帮助建立技能关系，在线执行并非每一步调用 LLM，也不是技能图自主持续进化的完整框架。

[load_skills.py](https://github.com/PKU-RL/Plan4MC/blob/217e938c928dc5fc3e78b6b1cf7546cbe421029e/skills/load_skills.py) 将 Finding、Manipulation、Crafting 分开执行，并区分 `skill_done/task_success/task_done`。Finding 用分层导航和模拟器 lidar，Manipulation 调预训练策略，Crafting 使用环境原语。因此它不是从视觉像素学习完整键鼠合成流程；底层接口不同，不能直接替换 Numen。

对我们的取舍：在原 SkillLibrary 与实践台账补条件、效果、适用世界和真实验证记录；计划结束一个片段后检查状态再继续。图来自当前模组配方和已验证技能，不能导入旧物品表或把模型推测的关系当事实。现 README 仍写 24 任务，而当前 `hard_task_conf.yaml` 和 v2 论文为 40；本次没有复现这些任务。

### MineDojo：实验协议可借鉴，世界重置必须核实

[build.gradle](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/sim/Malmo/Minecraft/build.gradle) 固定 Minecraft/Forge `1.11.2-13.20.1.2588`；Plan4MC 的 MCEnv 分支也使用此版本。[官方安装说明](https://docs.minedojo.org/sections/getting_started/install.html) 使用 JDK8，不能直接嵌入当前 NeoForge 1.21.1 / Java21 模组服。

[MinecraftInstance.launch](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/sim/bridge/mc_instance/instance.py) 可选端口、创建临时目录并启动独立游戏进程；[sim.py](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/sim/sim.py) 暴露初始物资/位置/天气、世界来源和 reset/step。独立实例不等同隔离任意不可信 Python 代码的安全沙箱。

[FastResetWrapper](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/sim/wrappers/fast_reset.py) 的快速重置会处理复活、传送、天气等，但不还原改动过的方块、不清零统计，并存在非默认健康/饥饿初始化限制。它不能直接证明两次试验拥有相同初始状态。

[success_criteria.py](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/tasks/meta/utils/success_criteria.py) 从库存、击杀、物品使用等状态变化判定；[MetaTaskBase](https://github.com/MineDojo/MineDojo/blob/2731bc27394269643b43828d9db8ab3a364601f0/minedojo/tasks/meta/base.py) 将 reward、success 和 episode termination 分开。多个 success criteria 在其钩子中以 `any` 组合，多条件目标不能误配成任一条件满足就过关。

对我们的取舍：复用任务规格、初态清单、episode 身份和独立目标判据。正式改进先在同版本 Numen 世界副本验证；MineDojo 可作为第二 backend 检验通用部分，不加载现代生产存档。Agent 与评测器允许观察的信息分别声明，尤其要记录是否使用原生 voxel/lidar 等额外信息。

### MineCLIP：视觉特征与相关信号，需要真实画面和校准

[官方示例](https://github.com/MineDojo/MineCLIP/blob/e6c06a0245fac63dceb38bc9bd4fecd033dae735/main/mineclip/run.py) 输入 RGB 序列 `[B,16,3,160,256]` 和文本，产生视频/文本的 512 维特征与相似度。16 帧是该示例窗口，不代表只能接受这一长度；相似度 logits 不是天然校准的成功概率。

[VideoRewardBase](https://github.com/MineDojo/MineCLIP/blob/e6c06a0245fac63dceb38bc9bd4fecd033dae735/mineclip/mineclip/base.py) 分开图像编码、时序聚合和文本相关评分，也支持复用缓存特征。固定任务文本和重叠窗口帧特征可复用，异步评分的吞吐/显存收益仍需本机测量。

模型可消费现代游戏渲染帧，但这不证明模组材质、新实体、GUI 或不同视角的准确性。当前 `world/survival/scene_view.py` 输出语义俯视地图，不是第一视角 RGB；直接送入预训练 MineCLIP 会改变输入分布。

对我们的取舍：保留 Numen 精确感知，待具备真实视角视频后先离线/影子评分。每段视频记录身体、维度、位姿、帧时间、游戏 tick、模型/checkpoint 和目标文本版本；用当前模组正反例对照原生结果，再决定用于感知检索、经验挑选还是未来 RL 奖励。最终任务验收保持独立，候选不能通过修改相似度阈值给自己判成功。

三者的接入不应阻塞首个 L3 闭环：先让现有角色在自己的游戏任务上取得可归因改进，再验证视觉与跨环境能力。
