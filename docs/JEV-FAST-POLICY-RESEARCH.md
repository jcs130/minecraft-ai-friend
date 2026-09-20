# Jev 与可训练快策略：Minecraft 具身 RSI 调研

核查日期：2026-09-20；本项目源码基线 `f519f14a8beac62cb697eb4fdf1e1c94d98f2529`。本轮为文档、源码精读和参考项目离线测试，没有调用 Jev API、下载模型权重、训练模型或修改生产服务。下列频率、接口及训练阶段是建议，不代表现役能力。

## 1. 判断

用户提到的是 TypeSafe AI 的 **Jev**，与 JEPA 不同。它适合把已有状态转成快速、有限类型的决策；不负责生成长篇思考或聊天。我们的 Numen 已有原生输入驱动，因此可以在现有 L1 增加小模型策略，不必换成 Mineflayer，也不必重建另一套 Agent 框架。

优先采用“结构化感知 → 合法候选动作 → 本地小模型选择 → 有界原生执行”。Jev 可作为云端对照；自己的训练底座优先评估开放的编码器/决策头或 Laya。完整像素到键鼠策略属于后续视觉路线。

## 2. Jev 官方能力与边界

[官方发布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)发布于 2026-09-15：模型输出类型化概率决策，放弃自由文本生成，采用称为 RLCD 的训练方法。厂商公布端到端 70–500 ms，并说明测量主要来自美国西海岸；这不是本机到服务的延迟验收。“类型正确”不能推导为“游戏行为正确”。

[官方模型文档](https://docs.typesafe.ai/models)当前列出 `jev-1.13.0`，输入仅文字/JSON，不接受图片、音频或视频。官方明确不提供客户数据微调或 LoRA；本次核查未见官方开放权重。开放 SDK 不等于模型开源。价格为每百万输入 token 0.042 美元，输出免费；生产评测应固定版本，不能依赖会移动的 `jev-latest`。

[接口说明](https://docs.typesafe.ai/introduction)提供 Choice、Score、Noul，可在一个请求中共享状态并并行回答多个问题。问题之间不能假设存在串行依赖；例如先选目标再瞄准，应由程序组合，或选择一个联合动作候选。[已知弱点](https://docs.typesafe.ai/model-jaggedness/jev-1.13)包括数值精确性、无关上下文和输入干扰。因此距离、角度、材料数、冷却由游戏代码计算，模型负责条件判断与选择，不负责数值伺服。

按当前价格，全部输入合计 500 token/次、5 次/秒的纯输入费用约 0.378 美元/小时；1,500 token/次约 1.134 美元/小时。此为算术示例，包含状态和问题的 token，总费用还取决于实际频率、重试及其他服务；不表示单请求延迟足以持续达到该频率。

## 3. 已克隆并精读的实现

第三方源码位于本机忽略目录 `runtime/jev-research-20260920/`，没有作为本项目源码重新发布。

| 项目与锁定提交 | 实际查看内容 | 可借鉴点与限制 |
| --- | --- | --- |
| [jev-craft](https://github.com/akash-kamat/jev-craft/tree/18d25f199073544b4f0b5494900c52f5ab87cc7e) | `src/index.js`、`decisions.js`、`actions.js` | 反应/战术分层；结构化健康、敌人、目标等状态；动作由代码执行。反应循环是等待推理和执行结束后再等 600 ms，不是固定 600 ms 周期。没有训练策略权重。 |
| [typesafe-minecraft-demo](https://github.com/ellistev/typesafe-minecraft-demo/tree/1cce66aaa7533b59a0feab30b1fbf8e9ed8de2c8) | `src/direct-actions.cjs`、`direct-control.cjs`、`decisions.cjs`、`fresh-decision.cjs` 及两组测试 | 同时存在高层动作与直接控制模式；后者包含 250 ms WASD 脉冲、跳跃、30° 转向、瞄准、挖掘和放置。每次完成或取消释放输入，过期推理结果不能执行。 |
| [Laya](https://github.com/NandhaKishorM/laya/tree/d113dca2512fb3eaca313534bc54c7162d87c1d4) | `laya/common.py`、`agent.py`、训练 notebook | Apache-2.0 的开放模型/代码路线；编码器、两层 Transformer 决策头、候选打分与 act/escalate 输出。可以训练，但不是官方 Jev 权重或其已验证复现。 |
| [Brain Doom](https://github.com/swedishembedded/brain/tree/ad8ea1c636c3a4311f094f5640875d198ad4cfce/samples/decision/doom) | `README.md`、`src/action.rs`、`src/main.rs` | 默认冻结 MiniLM 编码器，训练候选决策头；行为克隆 → 可选 DAgger → PPO。游戏在决策间暂停推进，与我们的持续运行服务器不同。 |

### Minecraft 直接控制示例的真实分工

`direct-actions.cjs` 定义候选；`direct-control.cjs` 将选择转成 `setControlState`、`look/ lookAt`、挖掘和放置。移动期间每 50 ms 检查，`finally` 释放控制。模型选转向或瞄准目标，具体角度及射线由代码处理；不是模型直接从画面回归操作系统鼠标像素。

代码提供邻近目标、遮挡/触达判断和合法动作筛选；旗帜任务的 338 格蓝图也由代码提供。不能把这些示例描述成模型自主发现所有规则或创造整张蓝图。`fresh-decision.cjs` 对超时、过载和陈旧答案重新观察后有限重试；其 5 秒新鲜度边界不能直接用于本项目近战。

### Laya 的训练与推理细节

[作者模型卡](https://huggingface.co/convaiinnovations/laya)提供英文 421M 和多语言 322M 等模型。作者报告的 T4 毫秒级推理是其测量，本机尚未复现。英文默认上下文 512 token，多语言默认 1024；不能原样塞入我们的长提示词。

精读发现 `build_sequence` 把类型/指令、候选标记及状态拼接，候选和状态都受截断预算影响；多问题批处理仍逐问题构建完整输入，不等于状态只编码一次。Choice 的 confidence 在代码中由归一化熵计算，不可当作实测任务成功概率，需重新校准。默认路由仅驻留一个模型时，语言切换可能造成重新加载，快循环应固定并预热选定模型。

训练 notebook `notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb` 实际创建编码器/决策头两组 AdamW 参数，使用 DDP、梯度检查点、梯度累积和 proper-scoring reward；它是通用 typed-decisions 数据上的训练示例，不是现成 Minecraft 训练集。没有在本机运行，也不据其作者训练时长承诺我们的费用或收敛时间。第一版游戏策略可采用更易诊断的监督学习基线。

### Brain 的证据边界

`Option_` 把候选说明绑定命令、持续 tics、标签和房间等字段；例如攻击选项仍可由执行层组合转向和射击。`ControlPipeline` 的训练入口保存模型后，用相同 episode 种子比较策略和脚本。这比仅看累计 reward 更适合本项目借鉴。

项目明确记录 PPO 尚未超过行为克隆、策略未超过脚本以及泛化未被充分证明。其 Doom 感知和环境也有几何辅助。借鉴其可复核训练流程，不把 lockstep 推理耗时当作真实联网 Minecraft 的控制频率。

### 本轮实际验证

在 Node 22.22.1 下运行 Minecraft 示例的 `decisions.test.cjs` 和 `fresh-decision.test.cjs`，使用模拟 API。首次因克隆目录缺少 `vec3`，一份测试文件加载失败，另 13 项通过；通过进程内 `NODE_PATH` 复用本机已有依赖后，**20 项全部通过**。两次原始日志分别保留在本机 `reference-tests.txt`、`reference-tests-with-dependencies.txt`。没有真实 Jev 请求、游戏连接或 Minecraft 任务完成验收。

## 4. 对照本项目：复用什么，补什么

| 现有代码 | 已具备 | 仍需补齐 |
| --- | --- | --- |
| [InputDriver.java](../world/numen-src/api/common/src/main/java/com/dwinovo/numen/entity/InputDriver.java) | `zza/xxa` 移动输入、跳跃、潜行、视角、骑乘控制，走服务端玩家物理 | 通用输入帧与持续时间、仲裁、取消及到期全量释放；目前 `stepToward` 固定向前，`halt` 只清移动和疾跑 |
| [mcp_server.py](../world/survival/mcp_server.py) | `move` 导航、`interact_at` 左右键及 `hold_ticks`、原生感知 | 没有统一公开的任意 WASD/视角输入帧工具；`move` 不能当作该接口 |
| [fast_execution.py](../world/survival/fast_execution.py) | 本地程序执行与状态读取，可复用现有生命周期 | 没有已训练的神经快策略，也没有逐 tick 输入标签数据集 |
| [现有三层架构](RSI-AGENT-DESIGN.md) | QwenPaw 会话、技能学习、工单及原工程角色 | 训练权重的版本、数据来源、独立评测和晋升记录，不能等同于现有源码交付 |

`view_scene` 当前提供语义俯视图，不能当第一人称视频训练样本。Numen 是服务端假玩家，输入可等价映射键鼠行为，但不具备真实客户端的所有渲染/UI/模组按键；新增模组交互仍需逐项检查事件链。

## 5. 建议的控制契约

```text
QwenPaw：长期目标、技能创造、聊天、异常处理
    ↓ 短目标 + 按需技能
L1 本地策略：当前结构化状态 + 合法候选 → 一个动作
    ↓ 同一身体的既有任务/租约
Numen：有界输入，随游戏 tick 执行，生成真实回执
    ↓ 状态变化与结果
L2：条件经验、程序技能、训练样本
    ↓ 跨任务对照
L3：更新一个策略/感知/调度模块 → 固定场景评测 → 晋升或回退
```

聊天和策略可以异步，但同一身体只能有一个行动控制者。先把 2–5 次/秒作为局部决策实验目标；执行层沿用正常 20 tick/秒的游戏节拍，卡服时实际频率降低。模型调用不可阻塞 MC 主线程，也不应为每 tick 走 Python/RCON 请求。

拟议动作载荷（**尚不存在此工具**）：

```json
{"forward":1,"strafe":-1,"jump":false,"sprint":false,"sneak":false,"yawDeltaDeg":-5,"pitchDeltaDeg":0,"attack":false,"use":false,"holdTicks":4}
```

协议必须明确正负方向、角度是整帧一次应用还是按 tick 应用、斜向归一化，以及 attack/use 的点击和持续语义；不能把上述示意当成已定接口。外层绑定身体 UUID、维度、控制租约、输入序号、观察版本和有效期，取消/到期时清除所有持有输入，不能只调用当前 `halt`。

候选可以是联合按键或短技能；先选择候选，避免几个独立问题产生“前进与后退同时按”等冲突。Agent 后续可创造新的有界输入程序和技能说明，测试通过后进入候选集；新增说明不等于模型已经学会该技能。长距离移动继续复用原寻路，近距离绕障、交互和战斗节奏才是首批快策略对象。

本地状态缓存可接受传感器增量，再构建小而完整的当前状态。每次推理只需子目标、相关感知和少量最近结果，不必传长思考过程；无持久状态的模型不能仅凭孤立增量理解世界。低置信度可以等待、继续已验证程序或升级给 Qwen，不要把尚未校准的置信度直接当成功保证。

新策略必须复用原生交互权限、实际物品与冷却、主城保护和任务回执。模型调用的配置、预算、身份和审计继续归现有运行体系；新增非生成式本地推理适配也应先登记用途，不能借此创建绕开 QwenPaw 管理的供应商直连或另一个无主循环。

## 6. 自训路径与验收

本机只读硬件查询为 RTX 3090，显存总量 24,576 MiB，采样时空闲 15,584 MiB。训练小型决策头、尝试数亿参数小批量微调在工程上有可行性；这是资源估计，尚无本机吞吐、显存峰值或收敛实测。现有推理服务也使用 GPU，不能按独占 24 GB 规划。

1. **先建立输入记录和固定基线。** 记录感知版本、实际下发输入、实际持续 tick、随后状态和结果。现有宏动作回执可训练宏选择，无法凭空成为逐帧键鼠标签；位置轨迹也不能唯一反推按键。真人演示若参与，需要额外同步输入采集。
2. **训练结构化候选选择。** 冻结小编码器并训练决策头，或对 Laya 的头/部分骨干微调；对照原脚本和原 Qwen 策略。先用监督 CE/KL/排序目标学习可靠演示，不必第一轮就实现 RLCD 或 PPO。中文模组名称须实际测评，多语言模型与规范化状态表示都可作为候选。
3. **迭代真实失败样本。** 保留失败及 unknown；模型选择后的状态由环境验收。DAgger 需要给学生真正到达的状态补标签。强化学习先在隔离世界试验，奖励来自真实物品、命中、进度和损失，不以模型自报成功或单纯移动距离计分。
4. **接入原 L3 工程链。** 保存数据版本、模型哈希、感知 schema、模组/世界版本、训练参数、运行源码与回退点。每次只修改一个待评估模块，使用冻结的独立评测器；达到预先定义的收益门槛再晋升。现有工程 Cron 原为关闭状态，本轮保持不变。

最小样本记录应包含：episode/seed、tick/dt、身体/维度、任务、观察、候选及合法掩码、选择、实际执行输入、下一状态、客观结果、行为策略版本。无需储存长思维链作为必需标签。推理时不能把动作后事实混入动作前观察；教师用到的额外游戏真值也不能偷偷进入只声明使用可见感知的学生评测。

验收按不同地图/种子/任务及模组组合划分训练与测试，不能随机拆相邻帧。记录任务成功率、受伤/死亡、误交互、卡住率、恢复率、置信度校准，以及从感知到执行的 p50/p95 延迟、TPS/MSPT 和共享 GPU 干扰。低延迟、正确格式或训练集高分，都不能单独证明比现有系统更好。

## 7. 视觉到键鼠的后续路线

[STEVE-1](https://github.com/Shalev-Lifshitz/STEVE-1)提供 VPT 动作模型、MineCLIP 目标表示及训练实现；[VPT](https://github.com/openai/Video-Pre-Training)和 [JarvisVLA](https://github.com/CraftJarvis/JarvisVLA)也适合作为像素/动作路线参考。这与 Jev 的文本决策输入不同。本轮没有对后三者全部训练代码复现实验。

它们不能直接保证适配当前 1.21.1 NeoForge 模组世界。先有同步第一人称帧与真实动作数据，才能评估动作映射、材质/模组偏移和训练成本。当前先用 Numen 结构化感知训练快策略，保留未来视觉编码器插槽，能更快获得可验证的 Minecraft RSI 闭环。
