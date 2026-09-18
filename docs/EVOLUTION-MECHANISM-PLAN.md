# 进化机制排期（2026-09-17 立项）

2026-09-16 以 CORAL 为参照做的对标调研提出三个缺口，当晚呈报、待立案。**本日立案并排期。**
排序依据不只是调研结论——**2026-09-17 的桐人 goto 循环现场证明了第 1 项的价值**（见文末"当日实证"）。

参照实现：`D:\Projects\CORAL`（1304 个 py 文件，完好）。关键文件：
`coral/hub/prompts/pivot.md`（pivot 提示词全文）、`coral/hub/heartbeat.py`（心跳配置；
`DEFAULT_TRIGGER = {"pivot": "plateau"}`——**pivot 是"停滞触发"而非"定时触发"**，这是与现有机制的
本质差别）、`coral/hub/prompts/consolidate.md`（对应我们的 Dream）。

## 五层体系中的位置

| 层 | 载体 | 状态 |
| --- | --- | --- |
| 1 脊柱反射 | numen-defense、TLM、引擎内置（被攻击自动战斗、HP<30% 进食、天黑睡觉） | 已有 |
| 2 小脑肌肉记忆 | 服务端编程技能（`farm_harvest_replant` 等，零 LLM，~1.4s/步） | 已有 |
| 3 大脑意识 | LLM 主循环 + Dream 复盘 | 已有 |
| **4 影分身 / 停滞重定向** | **Dream 内部分歧思考 + Pivot 心跳 + 环境惩罚触发** | **本次立项** |
| 5 离线进化 | Polar RL（历史轨迹 → 影子桐人并行训练 → 权重回灌） | 终极目标 |

明确**不采纳** CORAL 的并行多 Agent 搜索架构（同质 N 探索者攻同一问题）。千灯纪是异质角色分工：
一个主角自主生存 + N 个配角维护世界。群体多样性改由 Dream 周期内的内部分歧思考吸收。

## 排期

### P0 · 错误契约补齐（导航侧，独立小项）

**✅ 2026-09-17 完成**（commit `691f5f1`，实战验证见文末"落地实录"）。

不是进化机制，但与本轮故障直接相关，先做掉以免同类误诊复发。

- **落点**：`world/survival/world_actions.py`，`farm` 的 plant 分支。
- **内容**：给 `invalid_planting_target_or_seed` 补 details（请求格实读方块、期望语义"y = 土壤格 +1"、
  support 格），照隔壁已写好的 `plant_requires_farmland` 六字段范式。
- **验收**：针对"传土壤格坐标"的单元用例，回执含可自纠的 instruction；既有用例不回退。
- **边界**：只补错误信息，**不改已有的受理语义**（是否放宽受理见研究文档第五节 B 项，另行拍板）。

### P1 · 停滞重定向与**环境惩罚触发**（最大缺口）

**✅ 2026-09-18 落地**：环境惩罚触发行 `env_penalty`（层1，早前完成）；**本日补上层2 停滞检测 + pivot 注入 + 路由升 PLAN**——`world/survival/stagnation_detector.py`（目标跨 10 分钟不动（= 一轮复盘节奏） ∧ 环境同窗口报 no_output/repeated_rejection 才命中）、复盘注入四步 pivot、`adaptive_router` 加 `STAGNATION` 硬覆盖（升 Level 3）；实测零假阳性（他修复后的 productive 窗口不触发）。详见文末落地实录。

> 2026-09-17 造物主谕：「游戏环境应该是个完美的验证环境（类似于仿真），比如扣血、卡死都应该是进化的诱因。」
> 据此 P1 的触发器**分层**：**层 1 环境真值（零假阳性）为主，层 2 内部推断（有假阳性）为辅**。
> 完整设计见 [`ENVIRONMENT-PENALTY-EVOLUTION.md`](ENVIRONMENT-PENALTY-EVOLUTION.md)（含已实测信号盘点与实测数量）。

- **层 1 · 环境真值**：扣血 / 濒死死亡 / 徒劳（ok 但无产出）/ **同一拒绝码复发** / **同址无进展** /
  路径失败复发。这些是**世界说的**，不是猜的——24h 内实测 68 次扣血（含一次 20→2 濒死）、
  farm 88 次拒绝（其中约 66 次同一句"准星落在小麦上"）。**这些信号今天全都在记录，却没有一条接成诱因。**
- **层 2 · 内部推断**：动作重复（crystallization，已有）+ 目标停滞（pivot）。保留为**辅助证据**——
  层 1 命中时它用于解释，单独命中时只提示不改向。当日 `goto×6 repeats=3` 的假阳性（他其实在正常走动）
  正说明它需要"环境无惩罚"这道滤网。
- **问题定义（修正版）**：不是"动作重复"，而是**"动作被受理、位置也在动，但目标相关的世界状态无净变化"**。
  今天那个循环若只判"位置不动"会整个漏掉——他位置一直在动。
- **落点**：
  - 检测：`world/survival/pattern_detector.py` 旁新增环境惩罚检测器（**与 crystallization 并列**）。
  - 路由：`world/survival/adaptive_router.py` 增加停滞/惩罚分数，命中时升 THINK/PLAN 级。
  - 注入：`world/survival/review.py`（Dream/复盘周期）注入 pivot 指令——**复用 crystallizationHint 那条
    已验证的通路**（行动层静默观察 → 复盘层收到提示 → Agent 自决），不再往主循环 prompt 里塞东西。
  - 提级：`perception.py` 的 `damage_observed` 现被归为低优先级，复发时应提级。
- **pivot 指令四步**（照 `coral/hub/prompts/pivot.md` 改写为我们的语境）：
  1. **诚实诊断天花板**——停滞是"该换方向"的信号，不是"该收尾"的信号；先看最近 N 回合的真实轨迹。
  2. **找最高 EV 的未试方向**——区分"被证据否掉"与"被不愿意否掉"；后者才是候选。
     （本轮实例：他把参数错误归因为站位问题后，从未质疑该归因本身。）
  3. **承诺、不许浅尝**——新方向至少 3 次真实尝试再判生死；每次标注 `1/3`、`2/3`、`3/3`。
  4. **声明赛道与姿态**——写 focus note（见 P3）防止重复劳动。
- **验收**：
  - **回放本轮循环**：以 2026-09-17 的 `actions.jsonl` 为输入，层 1"同一拒绝码复发"应在第 3 次命中
    （实际 15 次 / 20 分钟）→ 把发现时间压到分钟级；
  - **零假阳性**：他修复后的正常往返（5 个不同 goto 目标、有 farm 产出）不得触发；
  - 扣血不误报（正常战斗不算），除非同址复发或濒死；
  - 不新增主循环 prompt 负担（复盘周期注入，主循环零新增）。
- **依赖**：无。既有 `pattern_detector` 通路即模板；**采集无需新增**（信号已在 `episodes.jsonl`）。

### P2 · 共享技能库 per-agent → per-world

**✅ 2026-09-18 落地**：`SkillLibrary` 增加**只读的 world 根**（`world_root`，环境变量 `WORLD_SKILLS_DIR`，本服 = `/party-state/skills-world`，与 npc 侧同目录）。读取回落到共享库并在回执标注 `shared: true`，`run` 亦可用；**写只走显式 `publish()`**，draft 永不触碰共享库；**本地同名技能永远遮盖共享版**（本 agent 的修正不被覆盖）；publish 只拷贝自己已 promote 的技能、幂等、无 world 根则完全关闭。8 项跨 agent 验收测试（容器内跑，需 QuickJS）。

- **问题**：桐人的技能锁在自己 workspace（`server/survival-agent-state/survival/skills/`），
  结衣与其他角色无法复用。CORAL 数据：跨 Agent 继承占 66% 新最优、此类改进率是平均 2 倍。
- **落点**：`world/survival/skill_library.py` 增加 world 级共享根；私有技能仍可保留。
- **验收**：桐人编写的技能可被结衣/队伍侧加载并执行；现有技能测试（含 `farm_harvest_replant` 的 4 个版本）不回退。
- **依赖**：无。**与 P1 独立，可并行**。

### P3 · world-notes/ 与 focus notes

- **问题**：各 Agent memory 隔离——女神看到的问题桐人看不到，反之亦然。
- **落点**：新增 world 级共享笔记目录，分类照 CORAL：`experiments/`、`synthesis/`、`open-questions/`、
  `focus/`；`goals.md` 升级为 focus note，字段 = Posture / Lane / Budget / Abandon-if / Why-this-has-positive-EV。
- **验收**：任一 Agent 能读到另一 Agent 写的笔记；goals.md 带上述五字段；有定期清理/去重（对应 CORAL `lint_wiki`）。
- **依赖**：P3 的 focus note 是 P1 第 4 步的落脚点，**建议紧随 P1**；也可与 P2 并行。

### 顺序

```
P0（即时，小） ──► P1（最大缺口）──► P3（focus note 是 P1 第4步的容器）
                        │
P2（独立，可并行）───────┘
P5（终极，另立项）Polar RL 离线进化 —— 依赖 P1–P3 沉淀出的轨迹与技能资产
```

## 当日实证（为什么 P1 排在最前）

2026-09-17 桐人在农田连续 20 分钟死循环，根因是 `farm plant` 的 y 坐标语义用错（详见
`NAVIGATION-ARRIVAL-RESEARCH.md`）。全过程：

- 每次 goto 都报成功；他在**动作上一直很忙**（20 分钟 85 次 goto、6 次进食、2 次换装）；
- 但在**目标上零推进**（同一目标 15 次重复，无一次种植）；
- 系统自己的 crystallization 探测器命中了（连续 15 次重复）并在提示"考虑结晶为技能"——
  **但那条提示只覆盖"动作重复"，覆盖不了"目标停滞"**：他完全可能把这段 goto 循环"正确地"结晶成一个
  自动技能，从此**更快地**做无用功。这正是需要的第二条判据。

P0 消除的是这一次的具体误诊；P1 消除的是这一类——**任何**原因造成的原地打转。

## P0 落地实录（2026-09-17）

- **改动**：`world_actions.py` not-air 分支补 `farm_preflight` 观测（requested / target / expectedTarget /
  instruction，含 `(x,y+1,z)` 更正指引）；`numen_gateway.py` 模型可见闸从只认 `plant_requires_farmland`
  放宽到两个码，`expectedTarget` 入白名单。**这是有意翻转既有决定**（原测试 `..._preserves_other_rejections`
  断言 not-air 不带 details）；翻转理由是两分支同属一类观测。测试已同步改写并写明缘由。
- **验证分层**：容器内 96/96 测试通过（本地跑网关套件有 26 项环境性失败，pristine 代码同样 26 项——
  已用 baseline 对照排除是我引入）。
- **实战**：经女神正门递出更正指引后，桐人自己改写 memory 教训、按 y=65 重种，
  **世界实测** `(-639,64,1054)=farmland`、`(-639,65,1054)=wheat`；同坐标 goto 循环停止
  （指令后 6 次 goto 仅 2 个不同目标 vs 此前 27 次打转）。
- **反证（重要）**：agent 面向文档本来就说对了（`farming.md`「不把土格当作播种位置」；工具描述
  「改变站位不会纠正错误的目标高度」）。**拿着正确答案仍然踩坑**——单靠文档不够，这是 P1 的必要性证据。

## 未做 / 未验证（2026-09-18 更新）

- **P0** 已完成（2026-09-17，见上方落地实录）。
- **P1** 已落地（2026-09-18）：层2 停滞检测 `stagnation_detector.py` + 复盘四步 pivot 注入 +
  `adaptive_router` 的 `STAGNATION` 硬覆盖。验收：单元测试以**他的真实 goal 文本 + 真实惩罚类型**
  钉住命中；**零假阳性已用活体数据实测**（productive 窗口不触发）。
  **生产尚未真实触发过**——需要"目标停滞 ≥20 分钟 ∧ 环境同窗口报 no_output/repeated_rejection"
  这个组合真的发生（也就是他真的一次卡住 20 分钟），所以该分支只由单测保证、未跑过生产。
- **P2** 共享技能库 per-world：**未实现**（`SkillLibrary` 仍是单 agent 单根）。
- **P3** world-notes / focus notes：**部分落地（2026-09-18）**——结构（`server/agents/work/world-notes/{focus,experiments,synthesis,open-questions}`）、约定（`docs/WORLD-NOTES.md`，含 focus note 五字段）、lint（`tools/world_notes_lint.py`：字段完整性/赛道去重/过期）、以及 **P1 第④步的落点**（停滞触发时写 focus note 记录，落在角色自己的 state 里）都已完成；**未完成的是"跨角色可读"**——角色的文件权限是默认拒绝 workspace 之外（`QD_NATIVE_FILE_SCOPE` 负向断言），要让 A 角色读到 B 角色的笔记，必须改那条生成规则（及其生成器与健康断言），属松绑权限模型，待造物主拍板。**P2 共享技能库卡在同一处**（`agent_learning` 的 root 是 per-workspace）。
- stagnation 的判据阈值（10 分钟、冷却 15 分钟、32 个目标上限）是**按当日真实数据定的初值**，
  须随更多真实回放继续调。
- Polar RL（第 5 层）不在本次范围。
