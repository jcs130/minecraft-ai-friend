# Jev 游戏控制源码复核：Minecraft 与 Street Fighter

日期：2026-09-24。问题：模型推理尚未返回时，游戏怎样继续，新的结果怎样接管，以及哪些能力可以迁入千灯纪。

## 研究边界与版本

阅读实际调度、候选、动作、失效与测试代码；没有连接这些项目的游戏服务器，也没有替它们调用模型。三个仓库只读克隆在本机忽略目录 `runtime/research-20260924/`，链接固定到本次读取的提交。

| 项目 | 固定提交 | 实际控制对象 | 许可核查 |
|---|---|---|---|
| rmalde/minecraft-agent | `78b40ed59514e5e2abde33a05ce398ecb2c39e05` | Mineflayer、Jev 候选选择、后台 LLM 计划 | 未发现项目级 LICENSE；研究结构，不复制代码 |
| akash-kamat/jev-craft | `18d25f199073544b4f0b5494900c52f5ab87cc7e` | Mineflayer，Jev 反应与战术循环 | README 明确声明 MIT，但未发现项目级完整 LICENSE 文本；内嵌 TypeSafe 技能的 MIT 文本只说明该组件许可，不能替代项目归属核查 |
| smartaces/jev-plays-streetfighter-2 | `8f046886ee76e6e36d647c9510da200cf0a5e0cb` | 模拟器帧与有界按钮序列 | 此提交未发现任何受 Git 跟踪的 LICENSE/LICENCE/COPYING 文件；研究结构，不据此假定复制授权 |

许可事实按固定提交的受跟踪文件核查：jev-craft 的 [README 许可声明](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/README.md#L227-L229) 与 [TypeSafe 技能许可](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/.agents/skills/typesafe-ai/LICENSE) 是不同范围的证据。未找到许可文件不等于已判断所有权利状态。

Jev 接受文本/结构化文本，返回预定义类型及概率，不生成主播语言；概率校准不保证某次决策正确。使用它来选候选，解说仍交给现有 Qwen。依据：[TypeSafe System One 官方说明](https://docs.typesafe.ai/concepts/system-one)。官方 Doom 演示也说明输入是结构化状态，不能当成像素视觉游玩证明。[官方发布说明](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

## 1. minecraft-agent：最直接的异步计划参考

### 实际调用链

`spawn → main → 当前阶段生成候选 → Jev decide → 有界动作 → 真实位置/库存反馈`；独立定时器每秒尝试 `planner.refresh()`，默认每 15 秒允许一次同阶段规划。**首次无计划时等待；已有计划后不等待新的慢规划。** [主循环源码](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/nether-agent.mjs#L62-L80)

`asyncPlanner` 仅有一个 pending promise，不创建请求积压。计划返回时再次比较 stage；跨阶段结果丢弃，失败保留已有计划并延后约 3 秒重试，close 后不会应用旧结果。这正是“推理进行中仍保留可执行计划”的小型实现。[完整异步规划器](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/async-planner.mjs#L1-L19)

### 连续动作来自哪里

连续性并非仅靠 `async`。本地候选器保存 `collectionTarget`、`netherLeg`、阶段与资源缺口。远处目标先走约 24 格片段，下一轮仍保留相同采集目标；配方数量足够则不再制造。片段先按 24 格截断再取整目标坐标，不能当成严格的欧氏距离上界。动作通过 pathfinder 和物理接口执行，超时清路径、控制输入及挖掘。[候选、导航和采集](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/nether-agent.mjs#L25-L76)。实际入口从 policy 模块只导入 `selectUsefulOptions`，阶段/缺口由入口自身计算；该模块的 `planTrigger`、`craftNeeded` 等测试不能当作入口已集成这些辅助函数的证明。[策略辅助函数](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/policy.mjs#L1-L54)

### 不能直接照搬的地方

- 路线、箱子、传送门、下界路径来自已勘测种子；不能把它当作任意世界的自主探索能力。`state()` 明确把 `knownSeed` 放进模型输入。[路线与状态](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/nether-agent.mjs#L12-L23)
- 动作主循环依然等待 Jev 和当前动作完成；背景规划独立，不等于所有网络调用都没有空档。
- 按阶段拒绝旧计划比全不校验好，但不足以覆盖我们的身体重生、任务撤销、技能版本、世界权限与未知副作用。
- `Promise.race` 的超时不是通用副作用撤销证明。我们的原生任务必须用精确任务 ID、epoch 和终态，不复制“超时后重新做”。
- 此入口死亡后停止，没有证明长时间自动恢复；录制/镜像相机不等于主播语言或观众互动。

### 实际执行的上游测试

在固定提交运行 `node --test optimization/nether/async-planner.test.mjs optimization/policy.test.mjs`：**15/15 通过**，约 174 ms，零模型调用、零世界动作。覆盖 pending 合并、异步期间局部活动、过期阶段计划、失败保留已有计划、零距离与资源缺口。这里“活动”是离线测试计数器，不能据此声称我们或该项目已通过实服持续行走验收。[测试源码](https://github.com/rmalde/minecraft-agent/blob/78b40ed59514e5e2abde33a05ce398ecb2c39e05/optimization/nether/async-planner.test.mjs)

## 2. jev-craft：双循环与持续目标有用，边界较弱

### 实际调用链

启动后两个异步循环并行。反应循环 `decide → executeAction → sleep(600 ms)`；战术循环 `pickGoal → sleep(10 s)`。600 ms 是工作完成后的间隔，实际周期还包含网络与动作耗时，不能宣传成固定 600 ms 决策频率。[入口](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/src/index.js)

反应决策在同一请求问威胁分数、动作、是否吃饭、逃跑方向。投影包括小范围敌人、近几次失败、当前心境，而非每次送完整世界。多个互不依赖的问题可以批量处理，但组合是否合法仍须本地判断。[决策实现](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/src/decisions.js)

战术保存当前目标、步骤、开始时间、失败次数；从预设目标集合选下一目标，执行可运行的步骤，重复失败跳过步骤或放弃。比只有一条自然语言 nextFocus 更容易定位“想做什么、做到哪里、卡了几次”。[目标选择与步骤推进](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/src/tactics.js)

### 代码风险与迁移限制

- `runGoalStep` 会 await 步骤或 Jev；同期 `pickGoal` 可以改全局 `goalState`、当前目标和失败台账。旧步骤回来以后缺少明确的目标 revision 校验，不能原样移植进持久控制器。
- `isFailure` 根据返回字符串前缀判断；吃饭等待固定时间返回“ate”，弱于真实饥饿/库存与原生回执验证。它的“成功”不等于我们的 `completionConfirmed`。[动作实现](https://github.com/akash-kamat/jev-craft/blob/18d25f199073544b4f0b5494900c52f5ab87cc7e/src/actions.js)
- 动作文件中最近敌人选择按 `entity.type === mob`，不能仅凭函数名认为排除了和平生物。
- 断线令 running=false；入口只建一次 bot，loopsStarted 防重复，不是完整重连状态机。
- 没有在本机安装/启动该入口，因为会创建网络游戏客户端。此项目结论是源码审查，无独立长时游戏成功率或语音体验测试。

## 3. Street Fighter：游戏时钟独立与结果过期校验

### 实际调度

模拟器帧循环持续推进；推理在独立 worker 中，只有一个 outstanding 请求。结果到达检查归属与时效，真正应用前再检查一次；新局/重置使 epoch 变化，旧结果不再控制新局。[接收与派发](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/controller/app.py#L239-L352)；[帧推进](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/controller/app.py#L395-L465)

`Snapshot` 带 run、episode、epoch、frame、captured；`rejection_reason` 拒绝旧运行/旧局/旧epoch、未知动作、过期或来自未来的观测。结果对象采用 `frozen=True` 浅冻结，内含的 state/observation 等字典仍可变；worker 通过进程间消息交回结果，不直接按按钮。[契约](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/controller/contracts.py)

`FrameClock` 从墙钟累计应推进帧数，每次最多 5 帧；长停顿不追赶无限积压。动作执行器将复杂招式锁到短序列结束；普通移动有帧数上限，清理会释放输入。[时钟](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/controller/timing.py)；[动作执行器](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/controller/actions.py)

### 验证与适用性

阅读上游测试中“推理 pending 500 ms 仍推进约 30 帧”、慢旧结果丢弃、reset 失效、worker 失联等用例；完整套件依赖 `httpx2` 与 TypeSafe SDK，本轮没有安装运行，不能写成已全部通过。[测试源码](https://github.com/smartaces/jev-plays-streetfighter-2/blob/8f046886ee76e6e36d647c9510da200cf0a5e0cb/tests/test_controller.py)

另用固定提交的纯模块运行本机 `runtime/research-20260924/check_streetfighter_contracts.py`：**7 项通过**。实际验证新鲜结果接受、三种归属变化拒绝、过期/未来拒绝、500 ms 时钟推进30帧、长停顿不无限追帧、12帧移动释放、复杂动作锁及清理。零 SDK/模型/模拟器调用。这只证明这些纯契约，不证明打游戏胜率。

可借鉴游戏时钟/推理分离、两次复核、局部输入 TTL；Minecraft 由现有服务器 tick 推动物理，不应额外建立一个 60 Hz Python 物理循环。该项目也没有承担我们的长期 LLM 规划、人格记忆、伙伴和直播。

## 4. 对千灯纪的具体差距

| 维度 | 我们已实现 | 本轮发现的缺口 / 处理方向 |
|---|---|---|
| 快慢调度 | `controller.tick` 在 asyncMotor 分支先推进 motor，再查询/提交原生 Qwen；Jev 单 worker，原生 Numen 自卫与物理独立 | “线程活着”不足以证明有可执行候选；要测实际动作覆盖及推理期间进度 |
| 持续局部计划 | 已测试技能有 memory、observe、choose、单步回执、预算；mailbox 串行执行 | 普通单动作结束后没有自动生成后续目的地。当前 base_goto 依赖模型给 target；长路仍常退回慢模型。应优先让模型使用/编写可复用的分段程序，不能从旧文字猜坐标 |
| 快系统资格 | 精确 source/version/kernel/engine 凭证保证程序可执行 | 本轮真实发现旧 kernel 凭证把晋升程序静默排除。38版本/200fixture重测后 base_eat 才重新进入候选；需资格诊断与缓存失效修复 |
| 动作结果 | 精确 actionId/taskId/epoch、不可重放未知、真实库存/位移与实践证据 | 相同参数重复调用原先只读到旧动作；本轮增加已完成前驱令牌，允许明确的下一次相同动作，未知仍拒绝 |
| 长期停滞 | 有独立旧 stagnation_detector、运动进展唤醒 | 旧停滞检测没有接到 asyncMotor 分支；需要按真实动作证据提示下一慢轮，正常长动作和休息不能误报 |
| 解说 | 原 say/voice/party、只读 dialogue 与身体分离 | 提示模型 say 不能保证直播节奏；要以真实事件组织机会、记录文字/音频各自送达，不能广播模型内部过程冒充解说 |
| 稳定性 | 服务管理器、持久回执、身体恢复、暂停/drain | 需要跨死亡/服务重启/模型慢响应验证。单次十分钟观测无法证明24小时稳定或主播效果 |

本地关键实现：[`motor_loop.py`](../../world/survival/motor_loop.py)、[`policy_worker.py`](../../world/survival/policy_worker.py)、[`skill_router.py`](../../world/survival/skill_router.py)、[`skill_library.py`](../../world/survival/skill_library.py)、[`dialogue.py`](../../world/survival/dialogue.py)。此前设计见 [Jev 快循环](../JEV-FAST-LOOP-DESIGN.md)，该文件历史上标为“设计”的部分不能当作当前生产功能。

## 5. 验收方式

1. 慢模型延迟期间，已有合法任务持续推进；数 native ticks、坐标/库存净变化，不能只看 HTTP 健康和轮询次数。
2. 每个模型/程序/原生任务保留身份与版本。新目标、重生、暂停后旧决策不再接管，已知完成和未知结果分别处理。
3. 单目标无进度要给出失败证据与下一次重规划入口；不为“画面一直动”随机走路，也不把聊天当目标产出。
4. 文字 sent、伙伴 heard、音频 started/completed 分开验收。音频生成成功、旁观者已连接都不能代替实际播放回执。
5. 可持续运行评估至少记录空闲原因分布、无进度最长窗口、有效动作/总请求、模型 p50/p95、首条解说延迟、重复台词及观众回复时间；先做有界实服观察，再做长时观察。未测指标保持未测。

### 原生快反射在慢模型期间的证据链

静态调用链已确认：NeoForge `ServerTickEvent.Pre → CompanionTickDispatcher.tick → CompanionBrain.tick → TaskSelector.select`，没有查询 Qwen pending 状态再决定是否 tick 的分支。候选顺序是可运行的反射、同步任务、后台任务、空闲姿态；被反射抢占的任务槽冻结预算，每刻仍结算已终止任务。具体实现见本地 `world/numen-src/api/neoforge/src/main/java/com/dwinovo/numen/NumenMod.java:43`、`api/common/src/main/java/com/dwinovo/numen/task/CompanionBrain.java:111` 和 `TaskSelector.java:44`（后两项相对同一 `world/numen-src/` 根目录）。这是模型等待不阻塞原生调度的源码证据；反射还必须满足自己的 canRun 条件，不能推导出一定有任务进度，原生饥饿事件也不等于自动进食。

实服验收可沿现有只读观测关联，不新增动作：

- 用同一 `controller.active.taskId/turnId` 加原生模型任务的 running/pending 读回确定慢模型等待区间。模型 taskId 与身体的 `queuedTask.taskId` 是不同身份，不能互换。
- 在该区间采样同一 `bodyUuid/actorUuid + dimension + navigationEpoch`，保留墙钟 `observedAt`、`gameTime`、`bodyTickCount`、位置/库存变化及精确动作回执。递增的原生 tick 证明游戏推进，单看 HTTP 健康或位置变化不足以证明目标进度。
- `WorldNavigationSense` 读取现有 brain holder，返回 `bodyControl.available/code/sample/kind/name/nativeAvoidanceActive`，不会调用 `canRun` 改变调度。`sample=last_native_scheduler_selection`、`kind=reflex`、`name=mob_defense` 在上述等待区间出现，才是该时刻自卫持有身体的直接观测。连续新鲜样本与原生 reflex 事件可增强证据；这是最近调度结果，不是历史动作录像。实现位于 [`WorldNavigationSense.java`](../../world/irons-bridge-src/src/dev/qiandeng/irons/WorldNavigationSense.java) 的 `control`/`run`。
- `queuedTask` 非空同时 holder=reflex 能揭示原任务被抢占；后来 holder=background_task 与同一 nativeTaskId 的精确终态能证明回到该任务。`task.busy=false` 不能排除反射占用；位置变化也可能来自避险或击退。
- 原生 `[numen-defense]` 日志本身没有身体 UUID，不能仅凭时间归因桐人；优先关联事件外层身体 UUID、事件时间和 `reflex` 属性。没有危险的观测窗口未出现 reflex，只能记“未触发/未采到”，不能据此判定快系统失效。上述新增关联方法本轮仅经源码复核，未冒充实服触发验证。

研究结论：最值得吸收的是小而明确的并行调度、持续局部目标、真实进度判断和决策过期契约。没有证据支持换一个仓库或缩短一段提示词就能自动获得聪明的全天直播主播。
