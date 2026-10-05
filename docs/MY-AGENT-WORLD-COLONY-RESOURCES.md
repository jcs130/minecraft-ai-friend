# MineColonies 完整资源发现接口

2026-10-05。实验分支新增 `resources` 只读查询，修复建造需求只显示全局前 12 项、同一 Domum 方块不同材质无法辨认的接口缺口。它读取锁定 MineColonies `BuildingBuilderResource` 的真实 `ItemStack`，使用当前玩家的注册表执行 `saveOptional`，完整保留物品 ID、数量与全部已保存组件的 SNBT。它不制造、发放或改写物品，也不授予成员或管理权限。

## 调用

同一个普通玩家连接安装 `attachColonyClient(bot)` 后：

```js
await colony.resources({
  buildingPosition: { x: 603, y: 64, z: 600 },
  offset: 0,
  limit: 12,
  requestId: 'resources-page-1'
})
```

所有坐标均为当前玩家维度内的绝对方块坐标。`offset` 默认 0，范围 0–2147483647；`limit` 默认 12，范围 1–24。原生频道为 `maw_agent:colony_query`，请求为 UTF-8 JSON：

```json
{"schemaVersion":1,"requestId":"resources-page-1","kind":"resources","buildingPosition":{"x":603,"y":64,"z":600},"offset":0,"limit":12}
```

响应只经请求玩家的 `maw_agent:colony_state` 连接返回。成功字段如下；`snbt` 应原样读取，不根据示意内容猜测或重造组件：

| 字段 | 含义 |
| --- | --- |
| `query`, `readOnly`, `source` | `resources`、`true`、`native_builder_needed_resources` |
| `playerUuid`, `colonyId`, `buildingPosition` | 本人连接和实际 builder 身份 |
| `hasWorkOrder` | builder 当前是否有原生工单；无工单时需求可为空 |
| `offset`, `limit`, `total`, `returned` | 请求范围、当前原生非空资源总数、本包完整资源条数 |
| `truncated`, `nextOffset` | 是否还有需求；终页为 `false`、`null` |
| `resources[].id`, `name`, `count`, `snbt` | 真实需求模板的 ID、展示名、数量、完整原生序列化 SNBT |
| `resources[].needed`, `availableReported`, `inDelivery` | 原生需求数量、原生报告可用量、配送中数量 |

资源按 `id` 和完整 `snbt` 稳定排序。同 ID 的不同材质、名称或其他组件各自保留，不能按 ID 合并。每次查询是当时的实时读取，分页期间工单或资源需求可能变化；完成供料后应重新查询，不把旧页当永久库存事实。整个查询沿用 10 tick 最短间隔。

## 字节预算与失败

单包仍限定 16384 个 UTF-8 字节，包含响应字段、玩家 UUID 与完整组件。接近预算时返回较少的完整资源，并将 `nextOffset` 留在第一个尚未返回的原始索引。SNBT 永不截断，分页永不跳过资源。

当单个完整资源无法装入一个包时，返回 `ok:false`、`code:resource_item_too_large`、`blockedOffset`，`nextOffset` 仍指向该资源，`returned:0`；不要盲目循环请求同一页，也不要将无完整组件的物品视为可匹配材料。应报告接口预算阻断，由维护方决定后续分块协议。超出最后一项的 offset 返回 `invalid_resource_offset`；恰好等于 `total` 返回正常空终页。

查询仅允许当前 `playerColony` 范围内殖民地的真实成员读取该殖民地 builder；目标须已加载，接口不会为查询加载远方区块。访问者、别的殖民地、非 builder 或未加载位置分别明确拒绝。原有 `status()` 的摘要结构保持兼容，仅给 builder 摘要增加 `resourcesQuery:resources` 和 `resourcesPageLimit:24`，完整需求必须调用新接口。

## 供料前提

资源页 SNBT 是 builder 的需求模板，不是玩家背包槽的 `expectedSnbt`。`stockResource` 和 `deliver` 的 `expectedSnbt` 必须取自本人最新原生背包槽，包含该槽的真实数量与全部组件。服务端仍逐槽核对完整 SNBT，并用 `ItemStack.isSameItemSameComponents` 检查需求匹配；不能复制资源模板当作物品，也不能将同 ID、不同材质的板块交给 builder。

## 重启后的真实初始化边界

锁定原生 `BuildingResourcesModule` 的需求 map 与材料 buckets 不持久化：其 `serializeNBT` / `deserializeNBT` 只保存、读取 `currStage` 和 `totalStages`。因此服务端重启后，即使真实工单仍存在、有人认领，`getNeededResources()` 也可能暂时为空。这不代表该建筑无需材料，也不证明工单已完成。

需求由原生工人实际执行后重新计算：`EntityAIStructureBuilder.startWorkingAtOwnBuilding()` 先要求 `walkToBuilding()` 返回成功，之后进入 `LOAD_STRUCTURE`；`AbstractEntityAIStructureWithWorkOrder.loadRequirements()` 等待异步蓝图和 structure placer 就绪，再按 SOLID、WEAK_SOLID、DECO、ENTITIES 阶段扫描真实蓝图，逐项调用原生 `addNeededResource`。施工 `stage:CLEAR` 是进度标记，不能当成材料扫描已经完成。

查询期间应保留附近玩家使区块正常加载，并观察被分配工人的 `loaded`、`paused`、`asleep`、`aiState` 和绝对位置。`START_WORKING` 长时间不推进时，应检查工人返回 builder hut 的实际通路；原生目标是 hut 的真实坐标，通常返回 hut 的判定距离为 4 格，初次直接到达判定为 1.5 格。不能通过只读接口强行执行 `requestMaterials`、制造需求表、设置工单完成或传送工人来伪造自然发展验收。

客户端 end/detach 后新请求不再写包；只读返回明确不可用，新写操作返回 `outcomeKnown:true`、`changed:false`、`dispatched:false`。已派发写操作在断线、重生、超时或传输异常时仍保留未知结果。spawn/respawn 退役旧请求，晚到回执不恢复旧读状态；新观察须使用新请求 ID。这是当前连接的内存边界，不提供跨进程重启的 exactly-once 保证。

## 验证范围

开发回归使用 Java 21 和锁定 MineColonies 1.1.1319 / MC 1.21.1 JAR（SHA-256 `ab97c0eec45c3f2539ec31428e3c836bb30ba1c537af0c86f5ab4e38754f6a4d`）。8 项锁定 API、真实蓝图、Java 编译、实际桥字节码及分页执行测试全部通过，17 项客户端回归全部通过，均无跳过；另 3 项聚合 SDK 测试通过。组件分页测试的构造数据只是边界测试；真实 Domum 材料组件键与值须由运行服原生需求读回确认，不能把测试组件当真实模组格式。

实际隔离服 `world-colony-fixture-20261005` 的 `external-readiness-20261005/attempt2` 通过 3 个非 OP 账号的私有读取，以及真实菜单点击、重复回执、冲突拒绝和完整 SNBT/数量守恒检查。资源查询本身返回合法空终页 `total:0`；builder 位于 `(603,64,600)`，工人 1 当时位于 `(609,63,612)`、`aiState:START_WORKING`、未暂停、未睡眠且实体已加载。工单虽有 3 个，需求尚未自然重建；attempt2 的全需求验收因此明确未通过。

这些证据确认接口编码、权限路径、预算、游标及真实空页行为，不能声称真实 Domum 多页组件已经验收、住宅已供料完工、生产物流已跑通或长期自主发展完成。完整资源及后续供料结果需在原生工人初始化后另行验收。本开发与只读审计子任务没有启动服务、安装桥、修改世界、修改模组锁或改动公网。

## 后续真实读取验收

本轮隔离服随后完成普通账号只读访问验收：非 OP 成员实际读取 13 项需求，12+1 两页，UTF-8 JSON 2415/555 字节；包括真实 `domum_ornamentum:panel`，完整 SNBT 长 174 字符并保留材料组件，需求数量 3。另一普通非成员在同场景被 `not_colony_member` 拒绝。只读访问范围的 56 项检查通过，跨账号 UUID 回执零错配。此前原生需求为零的失败和字节码记录保持原样；本次仅新的观察周期，未重放菜单操作。

这使真实组件分页由“待验”推进到“读取通过”；正确组件制板、错误组件拒交、供料到住宅完工仍未验证。证据 `research/external-readiness-20261005/access-readback/result.json`，发布桥/运行记录见外部就绪审计。
