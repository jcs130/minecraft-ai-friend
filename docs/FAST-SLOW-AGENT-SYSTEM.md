# 慢系统选目标，快系统持续执行

2026-09-08：用户明确将 QwenPaw 定位为 LLM 慢系统，将模组原生 AI 和编码能力作为快系统。本轮把这一分工落实到现有桐人执行器。女仆独立人格与 MCP 模组桥仍按 [女仆设计](MAID-AGENTS-DESIGN.md) 推进，不能把桐人执行器改进称为女仆桥已经上线。

## 参考女仆的实际结构

女仆的传感器定期收集附近可见物品并写进 Brain memory；工作任务读取这些状态，检查条件、选择目标、执行并恢复。工作点搜索带检查间隔、可达性判断与最近工作点缓存。进食任务也是原生条件检查后调用物品行为，不要求先发一句聊天。

这些模式可以用于千灯纪；`EntityMaid` 的 Brain、背包和主人接口不能直接安装到 Numen 玩家身体。桐人仍复用 Numen 的原生导航、任务执行、抢占、自卫与脱困。核查当前部署代码时实际只注册 MLG、Breath、MobDefense、Unstuck；旧注释的自动进食并未注册，walk-only 模式下 MLG 放水也禁用。没有借架构改名宣称这些缺项已补齐。

| 层 | 执行职责 | 何时运行 |
| --- | --- | --- |
| 原生身体 AI | 导航、自卫、换气、退避、脱困与游戏动作 | 按原生游戏节奏，不调用 LLM。 |
| 本地程序执行器 | 执行模型选定且已测试的多步技能，检查回执，等待和读取必要状态 | 按观察间隔或程序的下次检查时间运行。 |
| QwenPaw Agent | 理解明确指令、选择目标、编写/改进技能、处理新条件与复盘 | 实质变化或低频复盘触发，保留冷却及预算。 |

模型仍决定目标和策略，不把整条生存流程写死。模型可以编程，把反复使用的流程沉淀为经过测试的快层程序。程序执行不要求 QwenPaw 每一步在线；没有已选定程序时，不能擅自从技能目录挑一段代码运行。

## 本轮执行合同

现有 `next(state,memory)` 保留 action/memory/done/replan/reason，并增加两种互斥返回：

```javascript
// 等待一段时间，下次检查仍使用新身体快照。
return { memory, waitSeconds: 60 };

// 提议一次只读查询；不把网络、游戏对象或宿主函数注入 JS。
return { memory, observe: { tool: "inspect_block", args: { x, y, z } } };
```

等待范围为15–300秒，观察仅开放 `inspect_block` 与 `inspect_container`。显式等待和观察不消耗原有动作步骤；仍受任务总时限、停止、已知目标切换和程序版本校验约束。原无动作返回的旧计步语义保留。未决动作在重启后不会重放。

观察经过现有 `WorldActions` 距离、区域和实体容器检查。容器必须已经物理打开并符合原绑定；观察不会代替开箱动作或扩大物资归属。方块接口底层没有单独的 `hasChunkAt` 防加载检查，只能称近距离有界只读，不能保证绝不加载邻近区块。

`state.execution.observation` 保存最近查询的工具、参数、身份、维度、时间及结果，`fresh` 在60秒内且身份/维度一致时为真。程序需要同时检查 `fresh` 和 `result.ok`，旧缓存不能证明完成。失败结果交回程序决定等待或请求新计划，不自动重试动作。`lastResult` 仍是原动作回执；`lastExecution` 另保存具有关联标识的执行观测，导航只接受当前 task ID 与 epoch 匹配的终态，accepted/observed 不等于成功。

原生动作仍受原有任务预算。程序总时限在程序空闲执行边界检查；本轮没有把它改成抢占正在运行的原生任务的硬期限。

## 慢层唤醒与服务依赖

保留精确身体和环境事实供程序和模型查询；慢层使用独立语义信号，避免普通回血、饥饿小波动和周边环境进出反复绕过长复盘间隔。普通公屏内容仍进入观察队列，但不会仅因增加一条闲聊就唤醒模型。明确点名指令、重要回执和状态恶化优先进入有限提示词，只有实际送入且完成处理的事件才确认消费；思考期间到达的新事件继续保留。

失败动作的请求 ID、时间戳等用于回执关联，不应单独构成一个新决策理由。同目标、同条件的重复失败使用语义指纹，真实库存、目标或危险变化仍能唤醒。既有180秒决策冷却、滚动24小时48轮以及 QwenPaw 迭代和并发约束不变。

survivor 外部模式启动只等待自己的本地 MCP。独立受监督线程每30秒检查并恢复 Qwen 工具连接；控制循环不再同步等待该检查。付费提交前仍实时核对 Qwen/真实工具就绪，未就绪不占决策额度；未知提交不重投。离线时不反复拉取用量，取统计失败同样节流60秒，未知值不写成零。Qwen 不健康仍在全局健康检查显示，快层可继续运行与服务整体健康是两个状态。

## 验证与后续

新增回归覆盖等待/观察合同与真实 QuickJS、预算耗尽下的程序推进、等待持久化、消息优先级/裁剪/确认、同义失败、模型离线执行与恢复。当前技能库的每个已晋升原版本须在新内核下重新运行原用例，保留原源码、晋升记录及模型调用历史，不更改“测试通过”标记来绕过验证。

实机证据单独写入忽略的 `reports/survivor-fast-system-smoke.json`，包括原技能重测及不调用模型的身体只读程序；测试通过不等于已学会长期建房、农耕或贸易。当前技能库较少，后续应让慢系统把经过验证的生活流程编成可复用程序，并补独立的进食反射和女仆实体接入。

参考作者源码：[传感器](https://github.com/TartaricAcid/TouhouLittleMaid/blob/1.21/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/sensor/MaidPickupEntitiesSensor.java)、[工作点与检查节流](https://github.com/TartaricAcid/TouhouLittleMaid/blob/1.21/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/task/MaidMoveToBlockTask.java)、[原生进食](https://github.com/TartaricAcid/TouhouLittleMaid/blob/1.21/src/main/java/com/github/tartaricacid/touhoulittlemaid/entity/ai/brain/task/MaidHealSelfTask.java)。已对照本机安装版本；这些分支会继续变化。
