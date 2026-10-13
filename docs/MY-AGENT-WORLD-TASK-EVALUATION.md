# 任务验收、监控和自我迭代

框架以“完成一个可验证任务用了多少次模型调用”为主要效率指标，同时保留成功率、失败轮次、纠错轮次、耗时、底层调用数和原生动作提交数。先看任务有没有真实完成，再比较成本。模型声明完成、动作受理、动作终态成功都不单独代表任务完成。

## 框架接口

`@my-agent-world/agent-mc-host` 公开导出 `TaskMonitor` 和 `evaluateTask`，不依赖特定角色名、模型供应商或 Agent loop。Mineflayer、Numen 或其他宿主均可接入；宿主传入同一个身体的实际快照及累计调用计数。该模块不会连接游戏、调用模型或另开网络端口。

首版声明式验收支持：

- `owned_item`：本人原生背包中的物品数量，可要求实际主手装备。
- `reach_position`：实际绝对坐标、维度及允许距离。
- `quest_completed`：本人原生公会委托的完成次数。
- `all`：多个条件同时满足。

当前没有通用的“看一句自然语言就能准确验收所有模组工程”能力。复杂机械、殖民地和长期生活目标应先补充明确的原生证据与验收器；不能用模型自评冒充自动验收。模块验证本人 UUID、快照时间和数据可用性，超过15秒的证据、其他玩家数据或缺失库存不能判成功。

```javascript
import { TaskMonitor } from '@my-agent-world/agent-mc-host';

const monitor = new TaskMonitor({ directory: 'D:/agents/kirito/private/task-monitor' });
monitor.start({
  id: 'wood-pick-001', bodyId: actualBodyUuid,
  criteria: { type: 'owned_item', itemId: 'minecraft:wooden_pickaxe', countAtLeast: 1, requireEquipped: true },
  scenarioId: 'wooden-pickaxe-equipped', scenarioVersion: '1',
  harnessVersion: sourceVersionHash, initialStateFingerprint: initialConditionsHash,
  startedAtCall: cumulativeModelCalls, startedAtRound: cumulativeDecisionRounds
});

// 在原工具调用后记下真实结果。所有内部查询、预检和动作也分别记 backend_call。
monitor.record('wood-pick-001', {
  kind: 'tool_result', round: currentRound, operation: actualOperation,
  mutation: wasMutation, ok: receipt.ok, code: receipt.code
});
monitor.observe('wood-pick-001', { body: freshNativeState, society: freshOwnSociety },
  { calls: cumulativeModelCalls, round: cumulativeDecisionRounds });

// 结束时重新采样；unknown=true 必须保留未确认结果，不可重放动作。
monitor.finish('wood-pick-001', {
  observations: { body: freshNativeState, society: freshOwnSociety },
  counters: { calls: cumulativeModelCalls, round: cumulativeDecisionRounds },
  reason: actualStopReason, outcomeUnknown: false
});
console.log(monitor.report());
monitor.close();
```

任务规格由宿主设定，任务开始后不可改写；模型工具不能修改成功条件或给自己评分。重连继续未结束的同一任务，必须沿用原任务规格及累计计数；结束后的任务不能重新打开或覆盖。新尝试用新 ID，旧失败保留。写入者使用独占锁，事件逐条落盘；异常退出留下的锁要先确认原进程退出并保留审计，不能由 Agent 删除绕过。

`events.jsonl` 保存开始、结果、进度、验收和结束记录。只读报告支持另一个维护进程查询，不占写锁：

```powershell
node agent-mc-host/task-report.mjs --directory D:/agents/kirito/private/task-monitor
```

报告包含 `succeeded`、`failed`、`inconclusive`、`cancelled`、`running`。`successRate` 的分母为所有已结束尝试，包含证据不足和人工中止；`evaluableSuccessRate` 另列可判断的成功/失败比例。进行中的任务单独显示。没有样本时返回 null，不返回100%。超过3分钟没有任务进展记录会报告 `stalledTaskIds`，命令退出码为1；它只报警，不擅自重做游戏动作。

成功任务的模型调用数提供中位数和P95；单任务保留累计计数起点、全部失败轮次和恢复记录。纠错轮次当前定义为失败后，同一个操作首次成功的轮次差，是操作恢复指标，不等于整个目标已经恢复。所有内部 `mc_help`、快照、预检、`mc_do` 和等待也进入调用统计，不能靠包装多个操作隐藏成本。

另外，库存/装备、整格位置、生命/饥饿、公会进度连续8轮不变时，产生 `noProgressRounds` 和 `progressAlert`，给模型重新规划的反馈；只转头和重复读取不清掉提醒。该提醒不证明玩家绝对没做有用的事，也不会自动取消动作。格式错误的纠正统计到下一次合法成功工具回执，其他操作错误统计同操作恢复。

v8 增加 `describeActionEffect({operation,args,before,after,receipt})`：比较同身体、同维度的动作前后原生坐标。只对明确请求位移的 `body.move` 和移动/跳跃按键标记 `noDisplacement`；不把原地转头、潜行或点菜单误判成失败。小于0.05格的净位移记为没有可测位移，不代表过程中绝对静止（可能走出后又回来）。跨维度、不同身体、陈旧/缺失末状态或未知动作明确不可判断。它不会改原动作回执、自动重试或判任务完成。

宿主将反馈放入 `tool_result.effectFeedback`，监控另列 `noDisplacementRounds`、`effectObservedRounds`、`ineffectiveHotspots`，与接口失败分开。旧事件没有该字段时视为未采集，不倒填成“已测且正常”；比较不同版本时应同时看覆盖轮数。

## 接入现有桐人宿主

有限宿主 `world/src/agent-mc-runner/trial.mjs` 已接入该模块。私有配置可加入：

```json
{
  "task": { "id": "wood-pick-001", "type": "owned_item", "itemId": "minecraft:wooden_pickaxe", "countAtLeast": 1, "requireEquipped": true },
  "scenarioId": "wooden-pickaxe-equipped",
  "scenarioVersion": "1"
}
```

每次决定前使用最新身体快照核验；条件满足后结束，无须再调用模型自报成功。停止时再次采样，生成私有 `task-report.json`；原始模型请求、对话、工具回执和物品组件仍完整保留。修改文字目标需要 `previousObjectiveSha256` 绑定原目标，另写修订记录；不会重置角色、历史或计数。

模型常用入口 `host_act` 自动发现真实操作签名，并区分只读查询与变更动作。对世界交互、选择和装备物品，从本人实时状态补齐缺省的完整组件/方块属性比较条件。模型仍决定操作、绝对坐标、物品类型、材料、配方及数量；显式给出的比较条件不被覆盖，类型不匹配时返回真实观察供它修改计划。菜单光标有物品时不自动关闭。未知动作仍进入原有对账流程，不能当作普通可重试失败。

给模型的菜单视图直接保留槽位、名称和说明/价格，完整SNBT及渲染数据保存在带哈希的原始制品。新任务上下文从任务边界开始，带入前次验收摘要和失败热点，避免照抄旧任务的过期指令；完整历史、个人记忆及原始账本没有删除。

有限宿主还会从本人原始 `mc_do`/终态回执提取最多16项历史产物经验，包含原操作、菜单上下文、库存增减、时间及原 `actionId`。只接受同UUID、已确认的成功终态；这是动作期间观察到的变化，不证明唯一因果，更不证明现在仍有那些材料。模型需重新读当前库存/菜单，不能重放历史ID。

持续停滞时，每8轮最多建立一次 `HOST REPLAN BOUNDARY` 工作上下文，携带原任务标准、最近12条操作结果和实际位移，并保留最近3条真实工具回执（包括菜单与制品引用）；原对话和制品完整保留。H轮实测发现只保留操作名会丢失刚打开的商店内容，最终版已补回这些证据。这不增加额外模型请求、不自动选游戏路线、不限制工具，只避免重复的失败动作示例占满当前计划。`context_replan` 事件可审计。`body.observe` 的模型视图明确说明：固定全方向48条首命中射线不随转头改变，受遮挡且不是完整地图；可见方块坐标不是可站立位置。

原试玩健康检查在启用任务时增加3项：任务监控健康、当前尝试存在、任务成本未超过原累计账本。它与原有进程心跳/看门狗共同覆盖任务和进程状态；未启用任务时保持原10项检查。

## 迭代闭环

1. 固定任务条件与场景版本，保存初始状态和框架版本；运行并记录所有尝试。
2. 根据 `failureHotspots` 和 `iterationCandidates` 查原始证据，区分接口/状态同步问题、规划错误和能力缺口。
3. 将复现条件加入回归测试，修改宿主、工具描述或能力实现，再运行同一任务。
4. 先确认成功率没有下降，再比较成功任务的模型调用数、失败和恢复成本；检查底层调用及耗时是否反而增加。

不同初始资源、地形、任务条件或模型配置的结果不能直接计算“优化了百分之多少”。中途改宿主版本会标记为混合版本，不冒充完整单版本基准。候选建议是供开发/运营 Agent 使用的结构化输入，不会自动改验收标准、替换生产代码、改变权限或清除失败记录。

宿主版本指纹也包含实际模型、JSON模式、推理开关、推理/输出长度及模型桥源码，避免改变模型配置后与旧样本混成同版本。CodingPlan桥可显式配置 `enableThinking`、`thinkingBudget`、`maxOutputTokens`；默认保持原非思考模式，实验配置单独启用。每次请求把这些参数、实际usage和是否收到推理字段写入原调用账本；不保存/显示推理正文，不更换模型、不自动降级或重投失败请求。参数依据[百炼深度思考文档](https://help.aliyun.com/zh/model-studio/deep-thinking)和[官方Coding Plan示例](https://help.aliyun.com/zh/model-studio/qwen-code)核对，qwen3.7-plus同时支持[JSON输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

最终v10实验还把实际SDK安装清单中的核心归档和原生源码哈希加入宿主指纹，SDK升级不会与旧版混算。大制品的分页支持数组、Unicode文本和对象字段；参数拒绝后的位移报告也不会因非数组按键参数再次崩溃。

本次框架复盘还修正了原生放置验证：看到支撑方块不等于看到了指定点击面。`world.place` 在消费物品前核对实际命中面；不匹配返回 `native_placement_face_not_visible`、实际面和原始观察，保持已知失败。默认放置后最多7次在不同表面取原生射线证据，必须确认目标绝对坐标、真实方块ID及物品消耗；薄模组方块的显式 `verificationOffset` 保留。不会靠代理材质断言成功，也不重发放置包。旧 `kirito-486` 已消耗工作台但被遮挡的回执继续保留unknown；仅在原进程退出、本人三次稳定只读状态、控制台只读方块检查确认后审计放行独立新动作。这份人工核对不计为Agent自主验收成功。

线上实测及缺口持续记在 [CORE-LIVE-TRIAL](MY-AGENT-WORLD-CORE-LIVE-TRIAL.md)。当前仍是小样本、有界测试；报告支持后续批量场景和回归评测，不把一次成功当作全模组可自主运营的证明。

电脑重启后先核对原进程已退出、原生账本没有新未决动作、原身份/目录和累计计数保持，再启动原登记的游戏守护。生产基准内的守护 `runId` 会随合法新进程改变：应先保存旧基准与冷态健康记录，核验配置、JAR和账本前缀，再记录新旧owner映射；不能为了健康检查通过而盲目覆盖基准。已结束的任务用新ID继续，不能重开原任务抹去失败。
