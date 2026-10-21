# Mineflayer 工作脚本

七种内置脚本通过通用 `mc_script` 工具运行；它们随 `agent-mc-world` 核心发布，不要求服务端安装 NPC 模组。宿主负责目标与模型推理，脚本负责在一次明确任务中循环观察、操作、核对和停止。没有新增后台 Agent 或控制器。

移动类新增 `navigate_route`、`swim_to`、`flight_route`。参数示例、能力边界及第三方方案比较见 [移动脚本与调研](movement-routines.md)。四种生产/仓储脚本的接口保持。

## 查找、阅读、运行

先查目录，再读取所需脚本的参数 JSON Schema、适用条件、JavaScript 源码、版本和 SHA256：

```json
{"routine":{"op":"list"}}
{"routine":{"op":"read","id":"farm_harvest"}}
```

下面是 `mc_script` 的完整参数示例。坐标都必须是绝对坐标，`dimension` 必填；耕作坐标指植株占用格，箱子坐标指箱子方块。

```json
{"routine":{"op":"run","id":"farm_harvest"},"params":{"dimension":"overworld","crop":"wheat","cells":[[10,64,20],[11,64,20]]}}
{"routine":{"op":"run","id":"gather_logs"},"params":{"dimension":"overworld","block":"oak_log","cells":[[15,64,20],[15,65,20]],"tool":"iron_axe"}}
{"routine":{"op":"run","id":"deposit_surplus"},"params":{"dimension":"overworld","chest":[8,64,20],"items":[{"item":"wheat","count":8},{"item":"oak_log","count":4}]}}
{"routine":{"op":"run","id":"restock"},"params":{"dimension":"overworld","chest":[8,64,20],"items":[{"item":"bread","count":8},{"item":"wheat_seeds","count":4}]}}
```

| 脚本 | 执行与核验 |
| --- | --- |
| `farm_harvest` | 小麦、胡萝卜、马铃薯、甜菜根；只收成熟植株，先预留补种材料，再收割、拾取和补种，回读 age=0。未成熟植株保留。 |
| `gather_logs` | 逐格处理明确指定的原木，不扩展到附近同类；走已有通路，无法到达的树冠会受阻。调用方须确认是可采林木，材质不能识别所有未登记建筑。 |
| `deposit_surplus` | `count` 是随身保留量。例如有12块、保留4块，则存8块。只处理明确列出的物品；命名、附魔或已用耐久的同名堆需要改用底层 `stow pick` 明确选择。其余组件仍按原库存协议完整保留，不把网关传输标记当作专属装备。 |
| `restock` | `count` 是目标随身总量。例如已有3个、目标8个，只取5个；已有足量时不取。缺货、包满或未达到目标立即报告。 |

每次最多8格或8种物品，最多32次 SDK 调用、16组动作，默认120秒；可在顶层用 `durationMs` 缩短。每次存入最多64个，超大余料批次会报告未完成量，不能把它算成已全部入仓。低于 `minHealth`（默认6）、交战、身体受限、光标有物品、物品栏未同步、维度改变或读数未知时停止。物品名称必须是当前 Mineflayer 注册表中的精确 ID。

## 结果与恢复

运行先返回方法编号与 `execution.terminal=false`。让游戏继续执行，等待 `minecraft.method` 事件，从 `meta.work` 读取完成、受阻及库存净变化摘要，不必每格询问模型或轮询。需要逐格细节时再用 `mc_script {"runId":编号}` 查看完整结构化结果；持久化的 `work-run.json` 原回执也随事件保存，`{runId,call}` 可展开真实执行器回执。

内置工作脚本拥有的子任务保留完整回执，但使用 `piggyback` 投递；总方法终态使用 `flush`。反射自救、伤害等危险事件仍按原规则即时通知。普通自写脚本和独立任务的投递策略保持原合同，宿主应遵守 `agent-mc/v1` 的触发语义。

结果格式是 `agent-mc.work/v1`，包含：

- `outcome`: `completed`、`partial`、`blocked`、`noop`。
- `goalCompleted`: 本批明确工作目标是否满足；脚本线程 `status=completed` 本身不代表工作成功。
- `reason`、`remaining`：停止原因及仍需核验的绝对坐标或物品请求。
- `records`：逐格/逐物品的任务编号、现场方块或实际数量与原回执。
- `inventoryDelta`：本批观察到的库存净变化；其他玩家的拾取等也可能影响净变化，不能凭这个单独认定每件物品的来源。
- `startedAt`、`sampledAt`、`connectionGeneration`、`dimension`、`position`：观察边界。

采木还向执行器声明 `expect:{block:"air",at}`，在指定格挖掘并拾取后核验。下层原木移除后，上层原木可能挡住对空格的再次观察；此时 `block:null` 仍表示当前不可见，`verification.source=executor_postcondition` 单独保存刚才动作已核验的空格及时间，不能把它当成穿墙观察。

`stop:true`、`mc_stop`、死亡、断线、超时和新的控制任务沿用现有撤销机制。收割与补种占同一个执行器步骤；若中途取消，可能已经收割但尚未补种。没有自动回滚或自动重放，应重新观察 `remaining`，对空田单独播种，再提交尚未处理的目标。请求去重沿用 SDK 的 `requestId`，同一个请求不能换参数后重用。

方法库 `library` 仍保存 Agent 自己编写的版本；内置脚本是引擎提供的工作配方，不会写成 Agent 已学会的个人方法。宿主可通过 `agent-mc-world/extension` 的 `listWorkRoutines`、`readWorkRoutine`、`prepareWorkRoutine` 读取或准备请求；实际执行仍须交给现有身体队列。

## 继续组合已有能力

新增精确操作也可由 Agent 自写 JS 调用：

```js
const result = await mc.do([
  {skill:'harvest', block:'wheat', at:[10,64,20], replant:true}
]);
return result; // 仍须读现场或使用内置脚本的结果核对
```

`harvest` 只处理一个指定格，目标改变不换地方；保留保护区、登记蓝图、视线、工具、真实掉落和右键回读。原 `collect` 保持“附近可见资源搜索”语义，依旧拒绝 `at`，避免坐标意图被忽略。

钓鱼、合成、冶炼、畜牧交互、交易、蓝图施工和导航已经有 `fish`、`craft`、`smelt`、`use`、`build`、`goto` 等执行技能。村民交易先用 `use target:"villager"` 看报价，再加 `index` 和 `times` 成交；先用 `mc_help` 查询实际参数，再通过 JS 条件/依赖组合。当前四个配方没有实现自动经营养殖场、Create 物流规划、NPC 社会管理或所有模组作物。FOM 网关的原版投影不能替代真实模组物品身份；模组专用工作仍须其原生操作与回执。

## 借鉴来源

研究了安装版本与锁定源码的工作生命周期、成熟度复查、站位/工作站选择、预算和串行执行方式，用本核心现有 Mineflayer 动作重新实现，没有移植 NPC 的 Java Goal 或切换脚本语言：

- [SmartNPC：FarmCropGoal](https://github.com/PlaIsMe/SmartNpc/blob/298d93e041caf63462396ee55d7778330dac0c1c/src/main/java/com/pla/smart_npc/entity/goal/FarmCropGoal.java)、[工作预算](https://github.com/PlaIsMe/SmartNpc/blob/298d93e041caf63462396ee55d7778330dac0c1c/src/main/java/com/pla/smart_npc/util/PlayerNpcAiWorkBudget.java)。
- [车万女仆：任务选择及真实工具条件](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/agent/tool/implement/SwitchWorkTaskTool.java)。
- [Numen：Lua 组合原子动作](https://github.com/Dwinovo/minecraft-numen/tree/2a5753cbde3edd342fb50e0b2a4d52dff4269d38)。
- [Folkways：道路 Starlark 样式](https://github.com/IzakyL/folkways/blob/5567e84e872a674b1e5a3c764d226bcab348d63b/src/main/resources/data/folkways/folkways/pattern/road.star)。它描述建筑形状，不能直接当作 Mineflayer 寻路脚本。

一个已知小批工作只需一次模型派发，内部串行执行和核对，不用每挖一格、每取一个再唤醒模型。实际成功率和轮次仍由宿主记录，确定性联机测试不等于大模型长期自主生存验收。
