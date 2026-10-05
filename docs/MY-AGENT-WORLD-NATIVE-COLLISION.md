# My Agent World：原生碰撞查询契约与验收边界

2026-10-05。本文件记录本轮新增的只读碰撞查询底座。整体开放条件仍以 [外部接入准备度](MY-AGENT-WORLD-EXTERNAL-READINESS.md) 为准；后续完整玩法验收顺序见 [可玩性验收清单](MY-AGENT-WORLD-NEXT-PLAYABILITY-ACCEPTANCE.md)。

`nativeCollisionQuery` 是已安装客户端适配器的接口能力。服务器是否部署、该次查询是否可用，应检查实际回执。当前 `physicsIntegrated=false`、`pathfinderIntegrated=false`、`globalStateCacheSafe=false`。本轮未将这些形状注入 Mineflayer physics 或 mineflayer-pathfinder；普通导航仍可能使用代理方块的形状。收到正确形状不等于已通过模组楼梯、半砖、门或细薄方块的导航验收。

## 请求与身份

复用本人连接的 `maw_agent:world_query` / `maw_agent:world_state`，没有额外连接、管理员代执行或扫描接口。请求为 UTF-8 JSON 原始字节：

```json
{
  "schemaVersion": 1,
  "kind": "collision",
  "requestId": "native-collision-01",
  "playerUuid": "11111111-2222-3333-4444-555555555555",
  "dimension": "minecraft:overworld",
  "position": {"x": -425, "y": 65, "z": 411},
  "expectedBlockId": "domum_ornamentum:panel",
  "expectedProperties": {"facing": "south", "half": "bottom", "open": "false", "waterlogged": "false"}
}
```

示例属性仅演示格式。实际请求必须提供当时完整的原生属性对象，取自本账号原生 `look.block.properties` 或原生 state 映射；不能用代理方块的属性替代。无属性方块传 `{}`。只绑定 ID 不能区分同 ID 的上下半砖、朝向、开关状态等。

属性值使用实际 `Property.getName(value)` 序列化。例如当前 Macaw 桥楼梯的 ConnectionStatus 原生值是 `base/double/left/right`，它的 Java 枚举 `toString()` 却是 `BASE/DOUBLE/LEFT/RIGHT`。不能把枚举显示字符串当成协议 state 值；原生 registry、look、collision 必须保持同一序列化语义。

服务端比较当前真实 ServerPlayer 的 UUID、当前维度、目标坐标、原生 ID 与完整属性。坐标是绝对整数。只查询本人当前准星方向 8 格内第一个可见方块；被遮挡、状态改变、目标不是第一可见方块、未加载上下文都返回不可用。请求不能指定另一玩家的上下文。共享 world_query 路由保留每玩家限流。

SDK：

```js
const collision = attachCollisionClient(bot)
const state = await collision.query({
  position: { x: -425, y: 65, z: 411 },
  expectedBlockId: nativeBlock.id,
  expectedProperties: nativeBlock.properties,
  dimension: 'minecraft:overworld'
})
```

`dimension` 可从已识别的本连接当前维度读取；未知维度要求明确提供，不能猜测模组维度。`requestId` 可选；显式 ID 不能重复用于旧回执，显式历史有界。默认自动生成 UUID。

`collision.lookAtBlock(block, {expectedBlockId, expectedProperties, dimension?, requestId?, aimOffset?})` 先校验参数，再 forced lookAt，等 1 个 physics tick 发出视线，然后查询。它只旋转视线，不移动或修改世界。不先发送 `world.look`，避免紧接同频道查询被限流。需要原生身份或属性时先独立获取，不能将原生 look 与 collision 当成无限并发查询。

## 回执形状与时效

成功回执 `kind=world_receipt`、`query=collision`、`ok=true`、`available=true`，包括：

- `playerUuid`、`dimension`、`requestId`、绝对 `position`。
- `block.id`、原生 `stateId`、完整 `properties`、实际 `javaClass`、`dynamicShape=false`、`hasOffsetFunction=false`。
- `context.source=CollisionContext.of_actual_ServerPlayer`、`capturedTick`、字符串 `gameTime`、实际姿势、宽高和玩家位置。
- `boxes`：`[minX,minY,minZ,maxX,maxY,maxZ]` 数组，`boxCoordinates=block_local`。加上目标方块的绝对坐标才是世界坐标。
- `boxCount`、`boxesMayExtendBeyondUnitBlock=true`。围栏可高于 1，薄板可小于 1；不压平为单位立方体，不合并为包围整个形状的大盒子。
- `sampledAt`、`maxAgeMs=250`。客户端另附本机 `receivedAt`、`expiresAfterMs=250`；跨机器时钟不能直接作同步保证。
- `readOnly=true`、`outcomeKnown=true`、`retryAutomatically=false`，以及三个尚未集成的 `false` 标志。

这是实际位置、邻居状态、本人姿势的短时采样，不能作为 stateId 的全局形状缓存。用于下一步物理接入时，需要限定采样坐标、维度、身份、姿势、时效及重新验证策略。

真实 `Shapes.empty()` 返回 `available=true`、`boxes=[]`，表示已确认该方块没有碰撞。无法查询返回 `available=false`、`boxes=null`，表示未知，不能解释为可穿过或改为整方块。失败保留三个未集成的 `false` 标志。换 UUID、重生、断线使挂起读请求失效；晚到回执不恢复旧采样，也不自动重发。

每包最多 16 KiB，最多 64 个 AABB。每个坐标必须有限，绝对局部范围不超过 16，三轴 min 严格小于 max。超预算明确不可用。客户端严格 UTF-8 解码；来源、身份、完整属性、位置、上下文及预算不匹配不能完成挂起请求。

## 实际 shape API 与白名单

服务端最终调用当前方块的：

```java
state.getCollisionShape(actualPlayer.level(), actualPosition,
    CollisionContext.of(actualPlayer)).toAabbs()
```

没有使用 occlusionBoxes、遮挡形状、显示网格、EmptyBlockGetter 或 `CollisionContext.empty()` 来代替碰撞。DOMUM 的贴材质组件并非碰撞定义：本轮只审计具体 panel/slab/stair 的真实 shape 派发。

为避免泛用 level.clip 在命中目标前先执行未知模组的 outline getter，本接口用原生 `BlockGetter.traverseBlocks` 走有界视线，并在每个非空气方块读取 outline/interaction 前检查实际类。访问当前位置前检查已加载的本地邻域；不主动加载 chunk。已审计的 shape getter 只读取方块 state、静态 shape 或 state 索引，不读未知远邻或 block entity。动态形状或 offset function 明确拒绝；仅凭 `hasDynamicShape=false` 不能放行未知实现。

| 精确派发类 | 本轮可查询范围 | 审计说明 |
| --- | --- | --- |
| 原版 Block、SlabBlock、StairBlock、DoorBlock、TrapDoorBlock、FenceBlock、FenceGateBlock、WallBlock | 共 8 个精确类 | 实际 collision/outline/interaction 的完整继承派发；楼梯索引、围栏连接索引也核查 |
| Domum PanelBlock、vanilla.SlabBlock、vanilla.StairBlock | 共 3 个精确类 | Panel 继承 AbstractPanelBlockTrapdoor，按 OPEN/HALF/FACING；Slab/Stair 继承原版 |
| Macaw Bridge_Stairs | 1 个精确类 | 碰撞按 FACING/CONNECTION；outline 按 FACING |
| Macaw RoofBlock、BaseRoof、Lower | 共 3 个精确类 | Roof 按 HALF/SHAPE/FACING；Lower 按 HALF；BaseRoof 沿用 Roof |
| Farmer's Delight CuttingBoardBlock | 1 个精确类 | 固定原生薄板 shape；其其他 block entity 功能不作为形状来源 |

合计 16 个精确类。还绑定模组 namespace，未知子类不能借用父类授权。其余模组具体类、流体/移动装置/动态块尚未审计，返回 `collision_class_not_audited`、`collision_dynamic_shape_unsupported` 或其他明确原因。未知方块挡住视线时也不猜测能否穿透。新增类必须先核查真实 JAR 的 collision、outline、interaction 及其辅助派发，再补测试；改变模组版本重新审计。

## 本轮离线验证

本轮独立离线测试未运行服务器、连接游戏、修改世界、安装 JAR 或清除旧 unknown/暂停标记：

```powershell
$env:MAW_COLLISION_AUDIT_ROOT='E:\QiandengJiSocietyLab'
python -X utf8 tools/test_player_collision_bridge.py
node --test world/src/neoforge-handshake/collision-client.test.cjs
```

真实 API 审计 5/5 通过，无跳过；使用当前 MC 1.21.1 / NeoForge 21.1.248 安装器选择的 CP，以 patched server 在前，临时 javac Java 21。SHA 校验当前 Domum、FD、Macaw bridges/roofs JAR。原生 `Shapes.box/.or/.empty` 与生产导出规则的 24 项断言覆盖薄块、楼梯双盒、1.5 高围栏、空 shape、整数/完整属性、实际 Macaw 枚举与原生 Property 序列化、64/65 数量、有限范围及 UTF-8 字节预算。逐类解析真实 javap，追踪 16 个精确类的 collision/outline/interaction 完整继承链，确认本次 getter 不读取远邻或 block entity。

客户端 16/16 通过：本账号 UUID、双账号隔离、完整 state CAS、各类实际几何、错误/超预算、UTF-8、超时/限流无重试、死亡重生断线、视线等待和参数冻结。两账号是客户端模拟隔离测试，不等同于两名普通玩家已在服务端通过。

## 本轮隔离服实际回执：9 个形状与 3 个拒绝

2026-10-05 在独立 fixture b 世界中，普通账号 `MawColonyFoundQB`（UUID `1642e2f5-3e03-34ec-91bf-ff690d07422b`）通过自己的连接完成以下 9 个正例。操作员事先放置测试方块；这是实际查询验收，不是 Agent 自主采集、建造或自然导航。账号当时在主世界 `(608.5,63,596.5)`，真实姿势 `standing`、宽高 `0.6/1.8`。每个正例均保存请求完整属性、实际原生类、stateId、`CollisionContext.of_actual_ServerPlayer`、capturedTick 与 block-local AABB；对应 `maw_agent:world_state` 原始 JSON 与 SDK 成功回执一致，仅 SDK 增加接收时效字段。

| 实际目标与绝对坐标 | 这次状态与真实碰撞 | 私有结果文件 |
| --- | --- | --- |
| 圆石 `(608,62,600)` | 无属性；`[[0,0,0,1,1,1]]` | `prodb-collision-platform-top-001.json` |
| 橡木下半砖 `(609,63,601)` | `type=bottom`、waterlogged=false；`[[0,0,0,1,0.5,1]]` | `prodb-collision-slab-clear-bottom.json` |
| 同坐标橡木上半砖 | `type=top`、waterlogged=false；`[[0,0.5,0,1,1,1]]`，实际 stateId 从 11165 变为 11163 | `prodb-collision-slab-clear-top.json` |
| 橡木楼梯 `(611,63,596)` | north/bottom/straight；2 个盒子，保留低半层与北侧高半层 | `prodb-collision-stairs-001.json` |
| 独立橡木围栏 `(611,63,598)` | 四个连接均 false；`[[0.375,0,0.375,0.625,1.5,0.625]]`，未将高度截为 1 | `prodb-collision-fence-001.json` |
| FD 切菜板 `(612,63,600)` | north、waterlogged=false；`[[0.0625,0,0.0625,0.9375,0.0625,0.9375]]` | `prodb-collision-fd_board-001.json` |
| Macaw 橡木桥楼梯 `(611,63,603)` | north、connection=base；6 个盒子，保留原生栏杆最高 Y=2 与 1/16 薄边 | `prodb-collision-macaw_bridge-001.json` |
| Macaw 橡木屋顶 `(608,63,603)` | 原生 BaseRoof、north/bottom/straight；2 个盒子 | `prodb-collision-macaw_roof-001.json` |
| Domum panel `(608,63,594)` | north/bottom/closed/full；`[[0,0,0,1,0.1875,1]]`，3/16 厚度来自真实 shape | `prodb-collision-domum_panel-001.json` |

这 9 个正例只覆盖 8 个精确类及表中状态，不是 16 类所有状态都已实服验证。未测试门开关、邻居连接变化、其他楼梯拐角与姿势、其他 Domum/Macaw 派发类或流体装置。物理与寻路集成仍为 false。

另外 3 个实际拒绝原样保留：

- `prodb-collision-platform-001.json` 瞄准圆石中心时，视线先碰到 `(608,62,599)`，返回 `collision_different_visible_block`；随后独立新请求瞄准目标顶面才成功，未把首次失败改成成功。
- `prodb-collision-slab-001.json` 原布置中的视线遭遇未审计类，返回 `collision_class_not_audited`；该回执没有具体阻挡类，不推断是哪种方块。移到上表无遮挡新 fixture 后，下/上半砖分别新查询通过；原失败仍保留。
- `prodb-collision-cutter-unsupported.json` 对 `domum_ornamentum:architectscutter` 返回 `collision_class_not_audited`、`available=false`、`boxes=null`。Cutter 菜单支持不代表其碰撞类已受审计，未伪造单位立方体或空 shape。

独立只读核对了全部 12 份结果：实际连接 UUID、私有频道 requestId 与关键状态一致；`dispatchedMutations=0`，背包 slots 前后相同，isolationFailures 为空，modelCalls 与 operatorPlayerConnectionCount 均为 0。每份回执中的 `physicsIntegrated`、`pathfinderIntegrated`、`globalStateCacheSafe` 均为 false。负例 SDK 的本地失败包装会增加 dispatched 字段并省略部分上下文，原始私有频道 JSON 单独保留；没有将这些包装当成逐字相同的原始包。

9 次成功查询在同机 QA worker 中，从 startedAt 到 finishedAt 的记录耗时为 6–32 ms，中位数 13 ms；这是少量串行样本，含客户端封装，不能作为网络 RTT、服务器 TPS、并发性能或持续导航保证。

私有证据目录：`E:\QiandengJiSocietyLab\research\colony-production-20261005b`。`results/prodb-collision-*.json` 保存逐次请求、before/after 与 incomingReceipts；`collision-live-summary.json`、`collision-extra-live.json` 是汇总；`collision-fixture-intent.json`、`collision-fixture-replies.json` 保存操作员夹具意图和送达回执。控制台送达本身的 resultKnown=false，方块实际状态以随后的本人读取为证据。初验属于当时隔离桥 `a7c09fea…64cc611`；后续其他功能重建桥后，需要另做最终发布读回，不能把新 SHA 倒填成这批旧实测的版本证明。旧失败世界、unknown 与暂停记录保留，未重放旧动作。

尚需普通账号在实服验证错误 UUID、换维度、并发隔离、属性改变后的旧 CAS 拒绝及其他形状状态。本轮已有上述有限 wire 验收，仍不能替代整包开放与实际导航条件；最终发布证据由负责验收的 Agent 填入 readiness 区域。

下一步导航接入必须单独设计：将短时、本人的实际位置形状映射到 physics/pathfinder 的当前位置查询；未知位置停止或改用明确有界验证，不回退为代理完整立方体；验证半砖、楼梯、薄板、门开关、围栏、高低差及实际到达位置。完成实走验收后才更改相应集成标志。
