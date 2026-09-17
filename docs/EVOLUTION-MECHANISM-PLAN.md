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
| **4 影分身 / 停滞重定向** | **Dream 内部分歧思考 + Pivot 心跳** | **本次立项** |
| 5 离线进化 | Polar RL（历史轨迹 → 影子桐人并行训练 → 权重回灌） | 终极目标 |

明确**不采纳** CORAL 的并行多 Agent 搜索架构（同质 N 探索者攻同一问题）。千灯纪是异质角色分工：
一个主角自主生存 + N 个配角维护世界。群体多样性改由 Dream 周期内的内部分歧思考吸收。

## 排期

### P0 · 错误契约补齐（导航侧，独立小项）

不是进化机制，但与本轮故障直接相关，先做掉以免同类误诊复发。

- **落点**：`world/survival/world_actions.py`，`farm` 的 plant 分支。
- **内容**：给 `invalid_planting_target_or_seed` 补 details（请求格实读方块、期望语义"y = 土壤格 +1"、
  support 格），照隔壁已写好的 `plant_requires_farmland` 六字段范式。
- **验收**：针对"传土壤格坐标"的单元用例，回执含可自纠的 instruction；既有用例不回退。
- **边界**：只补错误信息，**不改已有的受理语义**（是否放宽受理见研究文档第五节 B 项，另行拍板）。

### P1 · Pivot 停滞重定向（最大缺口）

- **问题定义**：Agent 在**动作上忙、在目标上不动**。CORAL 的判据是"连续若干次评测分数不涨"；
  我们的对应物是"目标相关的世界状态/背包/进度在连续 N 个回合内无净变化，且动作序列与目标不匹配"。
- **落点**：
  - 检测：`world/survival/pattern_detector.py` 旁新增 stagnation 检测（**与 crystallization 并列，不是替换**——
    前者看"动作是否在重复"，后者看"目标是否在推进"，二者可同时成立，本轮故障恰好两条都命中）。
  - 路由：`world/survival/adaptive_router.py` 增加停滞分数，命中时升 THINK/PLAN 级。
  - 注入：`world/survival/review.py`（Dream/复盘周期）注入 pivot 指令——**复用 crystallizationHint 那条
    已验证的通路**（行动层静默观察 → 复盘层收到提示 → Agent 自决），不再往主循环 prompt 里塞东西
    （这是 2026-09-16 被指正过的层次混淆）。
- **pivot 指令四步**（照 `coral/hub/prompts/pivot.md` 改写为我们的语境）：
  1. **诚实诊断天花板**——停滞是"该换方向"的信号，不是"该收尾"的信号；先看最近 N 回合的真实轨迹。
  2. **找最高 EV 的未试方向**——区分"被证据否掉"与"被不愿意否掉"；后者才是候选。
     （本轮实例：他把参数错误归因为站位问题后，从未质疑该归因本身。）
  3. **承诺、不许浅尝**——新方向至少 3 次真实尝试再判生死；每次标注 `1/3`、`2/3`、`3/3`。
  4. **声明赛道与姿态**——写 focus note（见 P3）防止重复劳动。
- **验收**：
  - 用本轮真实轨迹构造 fixture（同一 goto 目标重复、无背包/世界增量）→ 检测器在 N 回合内命中，pivot 指令进入复盘上下文；
  - **假阳性回归**：拿历史轨迹重放，正常的长任务（如连挖、长途导航）不得被误判停滞；
  - 不新增主循环 prompt 负担（复盘周期注入，主循环零新增）。
- **依赖**：无。既有 `pattern_detector` 通路即模板。

### P2 · 共享技能库 per-agent → per-world

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

## 未做 / 未验证

- 三项均为**本日立案排期**，P0–P3 尚未实现，无代码产出。
- stagnation 的具体判据（N 取多少、哪些状态算"净变化"、如何区分"长途导航"与"原地打转"）是设计草案，
  须以实现期的历史轨迹重放来定值，不能凭拍脑袋。
- Polar RL（第 5 层）不在本次范围。
