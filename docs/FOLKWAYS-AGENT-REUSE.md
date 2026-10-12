# Folkways 寻路、农务与建筑脚本复用

审阅 [Folkways 源码](https://github.com/IzakyL/folkways/tree/5567e84e872a674b1e5a3c764d226bcab348d63b)，MIT，2026-10-13。此次桥通过公开 API 调用，玩家工具独立实现，没有复制上游 Java 寻路器或建筑素材。

## 哪些可以复用

| 源码 | 机制 | 我们的接法 |
| --- | --- | --- |
| `plugins/farming/Crop.java` | 原生注册表识别作物与种子、成熟度、可种植条件 | 当前可见方块增加原生 `crop` 数据，已进入普通玩家种田工具 |
| `HarvestNode.java` / `PlantNode.java` | 每格重新检查、真实产出与种子消耗、满足技能后补种 | 玩家仍走既有 `world.dig/place` 和原生事件；不照搬 NPC 直接改世界方块的方法 |
| `FieldChores.java` / `FarmNode.java` | 批次站位、前置依赖、工作预占、只有真实完成才结算 | Agent 可维护批次任务和账本；居民代耕直接调用 Folkways 区域委托 |
| `ResidentNodeEvaluator.java` | 门/栅栏门、梯子/藤蔓/脚手架、禁区和危险入口 | 后续给玩家导航移植站位与通行判断；当前未替换 Mineflayer 寻路器 |
| `ResidentPathNavigation.java` | 爬梯路径起点与高度；Create 动态结构坐标转换 | 不能用代理石头外形替代原生碰撞；当前原生碰撞查询尚未接入 Mineflayer 物理/寻路 |
| `OnFoot.java` | 真实站位才算抵达、重寻路、无进展退出、移动工作量 | 现有 SDK 已有服务端位置复核和有界超时；可以继续借鉴无进展提前退出 |
| `TravelBudget.java` / `PathfindingLoad.java` | 分片寻路、按 tick 期限退避、统计搜索节点与耗时 | 居民继续用上游预算；多 Agent 压测后再调整，不无限扩大寻路预算 |
| `data/folkways/folkways/pattern/*.star` | 道路、拱桥、铁路、矿井、梯田等 Starlark 建筑样式 | 是建造描述脚本，不是控制玩家走路或种田的脚本；先走原生建造委托，未来可暴露受控样式参数 |

上游 `Walker`、`OnFoot` 等以 `Mob` 为身体。Mineflayer 是网络玩家，Numen 是 `ServerPlayer` 型假玩家，不能强转后装上同一套 Mob AI。稳妥做法是共用任务语义、作物知识和站位策略，再分别调用现有身体适配器；保持一个身体一个动作控制器。

## 已可供 Agent 使用的种田工具

`world/src/native-sdk/farming.cjs` 提供 `planCropHarvest(observation, menu)`，是一个不派发动作的规划辅助函数，供现有 Agent 调度器调用。

服务端 `world.look` / `world.lookAt` 只对本人准星可见作物返回：

```json
{"crop":{"source":"native_crop_block","mature":true,"maxAge":7,"seedItemId":"minecraft:wheat_seeds","seedPlacesThisCrop":true}}
```

成熟度来自真实 `CropBlock.isMaxAge`，种子来自原生拾取物品，不使用代理注册表编号猜测。不是 `CropBlock` 的甘蔗、树苗、瓜藤等暂不套用该单格工具；专属收获机制也需单独验证。

```js
const { planCropHarvest } = require('../world/src/native-sdk/farming.cjs')
// observation = 已完成 world.lookAt 的 result；menu = 本人最新 menu.current
const plan = planCropHarvest(observation, menu)
if (plan.ok) {
  // nextAction 提供 world.dig 参数，完整保留绝对位置、方块全部属性和手持 SNBT。
  // 由原调度器用唯一 action_id 提交和等待，不在此另起控制循环。
  console.log(plan.nextAction, plan.replant)
}
```

工具拒绝未成熟作物、其他账号数据、打开的箱子/菜单、光标持物和无种子的收割。必须先留一颗真实种子；不假设掉落物已经捡到。确认收获后重新看暴露的土壤、查最新库存、用 `inventory.select/equip` 持种，再通过 `world.place` 种在上表面，并核对作物实际出现和种子减少。

完整玩家流程已在隔离服实测：原生成熟度 `false → true`，成熟小麦真实移除，实际种子消耗 1，原位置小麦变为 `age=0`。这证明一格玩家农务闭环，不代表无限面积自主农场、所有模组作物或 NPC 全季代耕都已完成。

## 寻路的下一步

优先把“工作位置”拆成“目标格”和“可站立格”，并在路线变化、门关闭、脚手架高度变化时重新观察。超过进展期限应给 Agent 明确失败和实际位置，让模型改选路线；避免以自动挖墙、传送或强制加载区块掩盖问题。

上游 NPC `OnFoot` 以 0.5 格靠近视作进展、200 tick 无进展退出，并有 5 tick 重寻路间隔。这些是其 NPC 参数，不是已应用到我们玩家 SDK 的新配置。正式移植前需要门、梯子、台阶、动态机械和保护区的真实玩家走路验收。

运输与建筑可复用上游完整居民机制。列车要求唯一站名、至少两站、只使用定时停站条件、有列车长和空座；货物网络要求同维度、已加载、同一转动链网、打包机只对接旁边蛙港和有人值守柜台。能力入口存在不等于这些实物条件已经达成。
