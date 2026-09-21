# 截图中的 Astra + Jev Minecraft 仓库：源码核查与迁移判断

2026-09-21；本项目基线 `e83dbd1`。截图对应 [rmalde/minecraft-agent](https://github.com/rmalde/minecraft-agent)，固定提交 `78b40ed59514e5e2abde33a05ce398ecb2c39e05`。已核对远端仍为该提交，并将此前只检出根目录的参考副本展开为全部 **238 个 Git 跟踪文件**。本机路径：`runtime/jev-control-references-20260921/minecraft-agent`。

本次是代码研究和离线验证，没有接入本服、传入真实模型密钥或更换现役模型/身体接口。此前[七项目概览](JEV-CONTROL-REFERENCE-REVIEW.md)读的是通用 `agent.mjs`；截图最新成绩对应 **`nether-agent.mjs`**，本次重点核查这个入口。

## 结论

值得重点参考。高效之处主要是把动作执行、候选有效性、阶段记忆和规划等待处理好，而不只是让 Jev 更快。我们已经有程序技能、原生身体任务、异步分类、独立交流和真实回执，可以沿这些现成模块继续改进。

该实现并不是每 80 ms 从画面预测 WASD。模型读结构化状态；Jev 选择一个现成动作，动作内的寻路、转向、等待战斗窗口由本地代码完成。慢规划与行动可以重叠，但主动作循环仍依次等待 `decide()` 和被选动作完成。[入口代码](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/nether-agent.mjs#L62)

## 实际控制链路

| 模块 | 源码行为 | 对我们有用的部分 |
| --- | --- | --- |
| `async-planner.mjs` | 一个在途慢规划；首次等待，之后保持旧计划；同阶段默认 15 秒可刷新；阶段变化丢弃旧答复；请求失败不清现有计划 | 只读规划可以后台做，已有有效技能继续运行 |
| `nether-agent.mjs:candidates` | 根据阶段、真实库存和位置提供可行动作；已满足物资不继续采集；掉落物优先；远目标分段接近 | 候选先满足前置条件，目标在多段行动中保持，减少来回切换 |
| `optimization/policy.mjs` | 有实际工作时过滤普通 wait；完成准备后不因消耗几块材料倒退回准备阶段 | 持久化阶段进度与资源缺口，避免重复劳动 |
| `end-combat.mjs` | Jev 选择一次床攻击，执行器最多等 16 秒，每 tick 看龙头距离、掩体、床和龙息；条件满足后只触发一次 | 用有终止条件的小技能包住连续控制，不能把时机判定全交给网络 |
| `breath-reflex.mjs` | 物理 tick 发现危险即停止路径/挖掘并短程逃离；检查停滞和超时 | 原生执行层处理及时停止与局部恢复；必须纳入我们唯一身体所有权 |
| `camera-control.mjs` | 本地计时器平滑视角；限转速/加速度，按视角映射移动输入 | 视觉流畅度来自执行器，不等于模型推理频率 |
| `patch-pathfinder.mjs` | 取消时清旧目标，用 epoch 拒绝延迟回调；空失败路径不当作到达 | 继续保留我们已有原任务 ID、navigationEpoch 和终态回执 |

关键源码：[后台规划](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/async-planner.mjs)、[候选过滤](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/policy.mjs)、[一次床攻击](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/end-combat.mjs#L59)、[局部反应](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/breath-reflex.mjs)、[视角控制](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/camera-control.mjs)、[路径修复](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/patch-pathfinder.mjs)。

## 模型实际决定多少

`models.mjs` 的慢规划只返回 objective、targets、waypoint、notes，不生成执行代码。最新入口的阶段机、床/箱子顺序、下界路线、物资目标主要来自固定配置及候选生成器；`currentPlan` 被送给 Jev，但候选并不直接由 planner 的 waypoint/targets 驱动。不能把所有路线优化都归给慢模型自主发现。[模型请求](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/models.mjs)、[固定配置](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/nether/config.json)

局部状态删去显示/录制信息，最近记录只保留五次动作、结果和位置，避免重复携带历史背包。请求仍附当前状态与路线先验，不是跨请求仅发 delta，也没有依靠聊天 session 的 KV 缓存。Jev 请求没有加入模型历史思考。

对于“持续学习技能”，已读到开发过程中多轮失败分析、代码修订、单测、独立战斗测试和再录制；公开的运行入口里没有发现运行时自动编写、测试、晋升技能的闭环。仓库还保留后续 Easy 难度研究及失败记录，不能混为截图中已成功的 Peaceful 路线。我们可以借其试验方法落实 L2/L3，但不能把这些开发记录本身当成无人干预的 RSI 证明。[开发记录](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/NOTES.md)、[路线验收](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/nether/REVIEW.md)

## 不能直接照搬的边界

1. **成绩条件。** 作者报告 8 分 43.300 秒、131 次 Jev、35 次 Astra；使用 Java 1.16.5 Survival/Peaceful、预勘测种子、已知物资坐标和天然开启的末地传送门。原始最终视频、运行日志与世界保留在作者本地，不在 Git；截图费用和该成绩未由本次独立复现。[README](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/README.md)
2. **低置信处理不同。** `decide()` 检查 choice 是否存在于候选，没有检查 confidence/probabilities。我们不能为追求流畅直接删除现有阈值；应先按动作类别校准。模拟 confidence=0.01 时仍选中动作的行为已复现。
3. **旧规划绑定较弱。** 后台规划只比较 stage。同一阶段内目标更换仍可接收旧计划；阶段 A→B→A 也缺少独立 generation。前一种情况已用模拟状态复现。我们的目标/程序/身体绑定应保留。
4. **执行前复核不等价。** 主循环拿到 Jev 结果后只先检查 won/stopped，动作内部虽有很多局部复核，仍不能替代我们完整的目标、身份、维度、时效和租约检查。
5. **超时不必然取消 Promise。** `bounded()` 在到期时清输入、停寻路/挖掘，但竞速超时不会自动取消所有底层异步函数。不要把它直接当作我们“原动作已终止”的证据。
6. **接口语义不同。** 此仓库 `bot.craft(recipe,count)` 的 count 是配方批次；我们 Numen `craft` 的 count 是希望获得的物品数量。工作台也必须实际可达，背包持有不等于可用。不能原样迁移配方参数或成功判断。

## 对本项目的优先改进

### 1. 先完善候选与局部状态

复用 `SkillLibrary` 的程序、`sense(scene/block/menu)`、配方查询及现有 `choose.context`。由 Agent 在技能内记录目标缺口、已完成阶段、目标实体/位置、最近实际进展，生成具备前置条件的候选。像“有工作台物品就合成面包”这种错误，应通过已有感知核验与失败 fixture 修订技能，不给核心控制器不断添加玩法特例。

实践先选工作台准备/补给、连续采矿或短程到达这类真实任务；检查目标达成与回执，不把程序返回 done 当作成功。我们已有 `PracticeStore` 和版本化晋升，不另建账本。

### 2. 把后台规划做成只读建议

我们现在异步的是 Jev 分类；普通 Qwen 身体规划持有行动权限，不能直接和程序同时驱动身体。可沿现有原生 Qwen task/会话增加只读规划用途，输出下一段计划提议；旧技能在条件仍成立时继续。新提议绑定 goalRevision、技能版本、bodyUuid/维度、观察时刻，交接时由原控制器检查并采用。不能照抄另一个拥有身体工具的并发 Agent。

这一点是后续设计，**本次没有上线后台 Qwen 规划**。

### 3. 改进执行节奏，而不只缩短 HTTP

复用 `InputDriver.java` 与 Numen 任务调度，将短程移动、瞄准、持续交互表达为有条件、有时限、可核对原任务终态的执行片段；本地逐 tick 检查，Jev 在有新分支时选择下一行为。视角平滑可独立改执行器，不需要每个鼠标变化都问 Jev。

原服务分类返回后的主循环接收延迟，应拆成身体获取、感知更新、原生 task 查询、发布等分项测量，再决定怎样分频；不能照抄更短 sleep 或删掉新鲜度检查。已有快慢控制测量见 [部署与实测](JEV-FAST-SLOW-CONTROL.md)。

### 4. 用原有运营工程角色推进 RSI

沿 QwenPaw 原工单提出单模块假设（候选、状态投影、技能或执行器），固定源码/目标/初始世界，对比旧版与新版，再在未参与调优的场景验收。记录动作之间空档、规划期间完成动作数、有效进展、重复失败、总费用和聊天响应。参考仓库的 `analyze-timing.mjs`、`freeze-run.mjs` 值得借其测量方法，但我们已有回执和源 hash，不另造整套实验框架。

## 本次验证

使用 Node 22.22.1，清除子进程中的项目凭据环境变量，执行原仓库的 `evidence.test.mjs`、`optimization/policy.test.mjs`、`optimization/nether/{async-planner,camera,corner}.test.mjs`：**25/25 通过**。另外两个模拟核查复现了同阶段旧目标接受、低置信直接选择；零真实模型请求、零世界动作，未修改外部源码。

更完整依赖安装尝试使用隔离 Node 容器和 `npm ci --ignore-scripts`，Docker 返回 `error waiting for container: unexpected EOF`，因此没有宣称完整依赖测试通过，也没有运行其 postinstall、游戏服务器、录制器或战斗脚本。原始输出与模拟脚本在 `runtime/minecraft-agent-review-20260921/`；公开文件哈希与验证范围见 [核查清单](research/jev-astra-minecraft-20260921.json)。

附带环境异常：12:20:40 Docker VM 日志出现 `sdd` 的 I/O error，随后 engine 接口超时；现场 D 盘仅余约 5 MB。已精确删除本次新生成的 `node_modules`（约 206 MB 文件），D 盘恢复约 220 MB 可用，外部仓库跟踪源码保持不变。未进行全局 Docker 清理、旧备份删除或生产服务重启；这不算基础环境已恢复。原始诊断在上述 runtime 目录的 `docker-environment-failure.json`，不是 Jev 推理失败或 Agent 逻辑回归。
