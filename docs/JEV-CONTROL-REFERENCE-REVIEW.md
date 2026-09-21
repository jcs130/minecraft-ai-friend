# Jev 控制项目源码对照：驾驶、机器人与 Minecraft

核查日期：2026-09-21。本项目基线 `5d51ba6`。本轮克隆了7个公开仓库，阅读关键控制链路并做有限离线验证；没有启动第三方游戏/机器人服务、调用真实模型或修改生产控制器。克隆为固定提交的 shallow/sparse checkout，未下载所有视频与可选资源；不是全仓逐行审计或真实机器人复现。

## 对现有方案的修正

Jev 的用途可以进一步下沉：**除了监督“继续/修复/重规划”，它还可以直接选择短运动片段**。较强的参考实现把难点放在局部感知、候选表示、本地执行和反馈上，而不是给模型更多历史文字。

本项目采用“Qwen 目标与技能 → Jev 选择当前阶段的运动/交互候选 → Numen 本地闭环执行”，外层才是继续/修复/重规划。两种判断能独立提出时同批调用，无法预先定义后续候选时再根据新感知串行调用。原生导航和技能与短输入并存，依据任务选择合适粒度。

## 固定源码与阅读范围

以下链接固定到本次实际克隆的提交。源码只在忽略目录 `runtime/jev-control-references-20260921/`，没有拷进生产。

| 项目 | 提交 | 本次阅读的关键文件 | 控制粒度与证据边界 |
|---|---|---|---|
| [JevPilot](https://github.com/standardagents/jevpilot/tree/e1beeb13b9a928fb76f167f86af584f4ce9cf180) | `e1beeb13` | `src/planning.js`、`jev-request.js`、`main.js`、`background-planner.js`、`simulation.js`、`server/jev.js`、三组tests | Three.js驾驶仿真；选择带预测结果的转向/速度短轨迹，物理持续运行 |
| [driving-jev](https://github.com/chahero/driving-jev/tree/f8bb635b0907a9a6ee0e22e3787361c49851346a) | `f8bb635b` | `src/driving_jev/app.py`、`policy.py` | HighwayEnv变道/调速；等待API时暂停物理，不能当实时驾驶频率 |
| [jev-autopilot](https://github.com/arielweinberger/jev-autopilot/tree/3292bbc6acfa2bcc8a4373c984f6420af5f47fd1) | `3292bbc6` | `server/pilot.ts`、`src/autopilot.ts`、`types.ts` | Three.js无人机；多轴分类概率映射摇杆，渲染帧平滑执行 |
| [EmbodiedJev](https://github.com/FBddcz/embodied-jev/tree/59a00c60e0f80fa32d14df1a365166267505980c) | `59a00c60` | `src/embodied_jev/incremental.py`、`runtime.py`、`policies.py`、`perception.py` | MuJoCo固定增量动作及执行后反馈；可选仿真预演过滤，不能等同实物机器人 |
| [Askable arm](https://github.com/TarunTomar122/jev-askable-arm/tree/bef98b31a122a7033dd4bfb52867cd6ccb2d7e67) | `bef98b31` | `jev_robotics/primitives.py`、`ask_session.py` | ManiSkill Franka；模型组合现成原语，局部位置执行器完成动作，无在线权重训练 |
| [typesafe-minecraft-demo](https://github.com/ellistev/typesafe-minecraft-demo/tree/1cce66aaa7533b59a0feab30b1fbf8e9ed8de2c8) | `1cce66aa` | `src/direct-actions.cjs`、`direct-control.cjs`、`fresh-decision.cjs` | Mineflayer直接WASD脉冲/瞄准/交互；与上轮阅读为同一提交，未重复跑旧20项测试 |
| [minecraft-agent](https://github.com/rmalde/minecraft-agent/tree/78b40ed59514e5e2abde33a05ce398ecb2c39e05) | `78b40ed5` | `agent.mjs`、`models.mjs`及README验收说明 | 慢规划可与旧计划执行重叠，Jev选择完整候选动作；有预设种子坐标和详细攻略，不是无先验从像素学会通关 |

## 1. JevPilot：先形成动作的局部后果，再做选择

[`planning.js`](https://github.com/standardagents/jevpilot/blob/e1beeb13b9a928fb76f167f86af584f4ce9cf180/src/planning.js) 定义候选上限12、预演跨度3秒，候选带速度、路线偏差、车道偏差、道路占用和预计冲突。Jev不回归任意方向盘值，而是从本轮候选中选择，执行器跟踪该机动。

[`jev-request.js`](https://github.com/standardagents/jevpilot/blob/e1beeb13b9a928fb76f167f86af584f4ce9cf180/src/jev-request.js) 将完整局部状态投影成表格：公共列只发一次、候选缩为本轮短ID、按需加入路口/恢复信息、仅一个合法答案时本地解决。它发送的是独立完整请求，不依赖远端保存前一帧。默认节拍250/650ms是调度意图，不是实际网络吞吐保证。

[`main.js:decide`](https://github.com/standardagents/jevpilot/blob/e1beeb13b9a928fb76f167f86af584f4ce9cf180/src/main.js#L648) 防止并发重入，校验generation、route version、候选批次和1800ms有效期，再应用结果。候选计算另有worker；物理不等待模型。连续请求失败三次会关闭autopilot，这不适合直接当我们“持续自主生活”的最终恢复策略。

一个值得借鉴的细节是将“行驶/停下”和“如果行驶，选哪条轨迹”分开，避免许多相近轨迹分散类别概率。其合成 `selection.confidence` 实际取所选motion的概率，另有乘积形式的路径分布；这是项目自定义语义，**不是官方confidence或已经校准的动作成功率**。我们应分字段保存，并用自己的任务校准。

迁移到Numen：给候选增加本地可核实的预计终点、接近目标程度、占位/触达、地形未知和资源代价。第一阶段用已有碰撞/可达信息和原生任务事实，不在正式世界复制整套物理去“试走所有动作”，也不让模型查询任意远处未观测实体。

## 2. 无人机：概率可以变成控制量，但不能任意混合行为

[`autopilot.ts`](https://github.com/arielweinberger/jev-autopilot/blob/3292bbc6acfa2bcc8a4373c984f6420af5f47fd1/src/autopilot.ts) 每轴计算 `sum(probability × predefinedValue)`，再按帧平滑逼近目标摇杆；后端同次评估油门、偏航、俯仰、横滚及两个着陆判断。1500ms无新结果逐渐回中，超过2000ms响应丢弃；前向障碍、低空和下降限制由代码处理。180ms是最小发起间隔，`inFlight`保证单请求，不能称固定5.6Hz。

适合借鉴：分类标签可映射到小幅、受限的视角/移动增量；网络决策和物理执行分频。不能直接迁移：两个不同绕障路线做概率平均可能正好撞中间障碍；不能混合攻击与交互，不能平均不同目标ID。默认应选完整联合动作，只有可组合、同一局部动作族的连续控制轴才研究期望值/平滑。这里的概率是类别判断，不是训练好的连续控制分布。

代码只按请求耗时丢弃旧答案；`reset()`未提供generation校验，需额外防止旧飞行请求在新任务reset后落地。我们保留原设计的生命/目标/策略版本校验，不照抄演示的生命周期。

## 3. 机器人：区分固定小步、语义原语与仿真特权

EmbodiedJev的[`incremental.py`](https://github.com/FBddcz/embodied-jev/blob/59a00c60e0f80fa32d14df1a365166267505980c/src/embodied_jev/incremental.py) 提供XYZ各方向40/10/2mm，加张开/闭合/保持；观测附最近6次真实尝试和实际位移/接触变化。`incremental`这里指机器人位移增量，**不是模型session只传delta**。越界动作不通过裁剪变成另一动作。

[`runtime.py:_run_incremental`](https://github.com/FBddcz/embodied-jev/blob/59a00c60e0f80fa32d14df1a365166267505980c/src/embodied_jev/runtime.py#L394) 选择后可在克隆仿真上预演接触，拒绝结果也进入history；完成仍读world.success，连续三次同一步且无位姿/接触变化停止，未偷偷改成规则策略。其运动生成器在选择后才推进物理，不是持续真实环境的延迟验收。

感知文件明确区分渲染RGB-D的颜色检测、已知方块尺寸先验和仿真本体/接触信息。`choose_plan`对Jev附图片直接拒绝，原生图像规划走chat/Claude provider；不能把所有UI视觉演示都算作Jev直接看图。借鉴来源标注、真实结果和小步接口，不能把带仿真真值/接触预演的成绩当无特权泛化能力。

Askable arm的[`PrimitiveChooser`](https://github.com/TarunTomar122/jev-askable-arm/blob/bef98b31a122a7033dd4bfb52867cd6ccb2d7e67/jev_robotics/primitives.py#L216) 同次询问kind与target，再由`PrimitiveExecutor`的多步位置控制完成hover/descend/press等原语。这个“语义原语 + 低层小步”组合值得保留；不必为证明具身而把成熟技能全部拆成逐键推理。

需要修正其接口习惯：同批独立问题并不知道对方答案；源码在需要目标却选择none时默认取第一个物体。这在我们这里不接受：应使用联合 `(primitive,targetId)` 候选，或复核匹配后重新感知。模型选择done与环境success在其会话中是分开的，但自由文本目标的`infer_success`仍有关键词启发式，并非通用任务裁判。

## 4. Minecraft：直接键鼠与慢快分层都已有具体实现

[`direct-control.cjs`](https://github.com/ellistev/typesafe-minecraft-demo/blob/1cce66aaa7533b59a0feab30b1fbf8e9ed8de2c8/src/direct-control.cjs) 将前后左右/跳跃选择映射成250ms脉冲，每50ms检查局部通行；转向30°、瞄准、装备、挖一个方块、放一个方块都分开，finally释放输入。执行前再查目标与射线，挖/放后核对方块。我们可以映射到InputDriver及原生交互任务，不需要引入Mineflayer。

[`fresh-decision.cjs`](https://github.com/ellistev/typesafe-minecraft-demo/blob/1cce66aaa7533b59a0feab30b1fbf8e9ed8de2c8/src/fresh-decision.cjs) 在超时/过载或旧状态失效后重新观察，再有限重试推理；拒绝过的答案不会执行。其阈值和固定脉冲不能直接抄：以我们约0.7–1.2秒网络等待，每次只走250ms会出现明显空档。可以改为本地逐tick检查的短片段/现有原生任务，按条件续行，遇到未知前方或TTL到期松开输入；不能盲目延长按键来掩盖延迟。

该示例的可用动作筛选、目标和338格旗帜蓝图来自代码；不是Jev凭空学会施工。现有技能库应允许Agent创建新的候选生成器和小技能，经测试晋升，而非固定复制旗帜脚本。

[`minecraft-agent/agent.mjs`](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/agent.mjs) 在仍有可用旧计划时异步请求新慢计划；Jev选择“采一个方块/装备/进食/朝航点前进”等候选，失败有冷却，连续失败清计划。它说明连续行动不要求每步重新找大模型。`models.mjs`含固定种子路线、物资目标和攻略提示；执行中可能等待较长原生任务，且API等待后主要查stop/dead/won，不能作为我们细粒度感知新鲜度/目标revision的替代。

借鉴旧计划不中断、失败后只修局部、真实回执验收；保持我们现有Qwen会话和唯一身体写所有权。该项目使用OpenRouter，并不意味着我们需要改变已经接好的官方Jev服务或角色模型。

## 5. 离线验证与未解决事项

JevPilot固定提交原测试命令：

```text
node --test tests/jev.test.js tests/traffic-safety.test.js tests/road-recovery.test.js
```

结果：**20项，13通过、7失败**。保留原始日志，不修改外部仓库使其表面通过。失败包括旧测试构造缺少新motion/别名协议、候选过滤/随机批次断言，以及三项交通预测断言；并非七项都已证明只是过期测试。没有实车或真实API实验，不能宣称该仓库已全面可靠。

额外以当前实际请求criteria构造mock响应，对seed42/123各核查：正常候选映射、错误batch拒绝、修改控制量拒绝、选中项确实存在，共8个检查通过。这解释了部分协议测试失配，不消除交通预测失败。没有给第三方代码传真实key。

| seed | 原始状态bytes | 投影状态bytes | 含问题整次请求bytes | 真API调用 |
|---|---:|---:|---:|---:|
| 42 | 19132 | 1845 | 2363 | 0 |
| 123 | 19154 | 1801 | 2319 | 0 |

两例均本地解决唯一motion选项，只询问7个vector候选。压缩来自领域投影和表格共享，并非通用无损压缩整个世界；详细本地状态仍用于执行。不能将bytes减少直接当token减少或游戏成功率提高。原始记录在忽略目录的`jevpilot-tests.txt`、`current-contract.json`；[公开核查清单](research/jev-control-references-20260921.json)保存提交、文件、统计与边界。

## 本项目实施增量

1. **候选带结果描述。** 在现有技能choice协议旁设计版本化运动候选：绑定本轮感知/目标，包含动作映射、预计效果和未知项。保留不带预测的旧技能兼容；参数和几何计算来自本地真实能力。
2. **按动作家族拆问题。** 先表达是否继续当前行为，再在适用家族内选择完整 `(动作,目标,片段)`；能条件式并行就同次评估。候选数量变化后重新校准，避免直接套统一0.75。
3. **分频与身体持续。** 模型事件驱动，原生执行逐tick；复用当前任务/租约与受限异步请求。身体小状态高频，完整环境低频；新鲜度按行为而定。提前计算候选可以后台进行，正式世界不能做有副作用的预演。
4. **结构化对比证据。** 测“无模型本地控制 / 原生产choose / 新候选分类”三组；记录网络等待时世界是否继续、动作占空比、聊天响应、原生干预次数、目标达成与服务器负载，避免只看视频流畅。
5. **RSI演化候选和技能。** 学习哪些感知足够、何时使用小步/高层技能、哪些失败修复有效；改进状态投影或候选生成器时单模块对照。问题、模型、候选和执行器分别有版本；原始输入到真实结果可追溯。

上述补充并入[Jev快循环设计](JEV-FAST-LOOP-DESIGN.md)。本轮是研究交付，尚未部署新运动候选、原生按键接口或训练新模型。
