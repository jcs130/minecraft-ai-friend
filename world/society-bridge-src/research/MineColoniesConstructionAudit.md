# MineColonies 1.1.1319：同一玩家的有限建造接口

本次是源码、锁定 JAR、原蓝图和回归检查，没有启动服务器、操作游戏、给玩家 OP、提供材料或进行长期自主验收。历史文档中的 `MawColonyFoundQB` 建城是 OP 账号；历史已完工建筑工小屋的材料来自 QA。两者都不能作为普通生存玩家自主采集、合成、建城和扩张的证明。

## 原始证据

- 锁定文件：`minecolonies-1.1.1319-1.21.1.jar`，SHA-256 `ab97c0eec45c3f2539ec31428e3c836bb30ba1c537af0c86f5ab4e38754f6a4d`。
- `com.minecolonies.core.network.messages.server.colony.building.BuildRequestMessage` 调用 `IBuilding.requestUpgrade(player, builderPosition)`；它经 `AbstractColonyServerMessage` 的原生 `MANAGE_HUTS` 权限检查。
- `AbstractBuilding.requestUpgrade` 返回 `void`，会因研究、最高等级、父建筑等级等原生条件正常返回而不建工单。`requestWorkOrder` 还会因建筑工等级、高度等条件拒绝。真正通过时先同步调用 `IWorkManager.addWorkOrder`，再加载蓝图；指定建筑工时会设置真实 `claimedBy`。
- `IRegisteredStructureManager.canPlaceAt` 调用相应原生 hut 的 `canPlaceAt`；桥接同时保留 `PLACE_HUTS`、同维度殖民地、本人 8 格、已加载位置、边界/高度/支撑/可替换方块、实体占位及实际背包完整 SNBT 检查。
- `HireFireMessage` 通过 `IAssignsJob.assignCitizen/removeCitizen` 工作；`WorkerBuildingModule` 还有容量、工作分配与自动雇佣逻辑。本轮只公开实际模块状态，未移植完整雇佣 UI 前置条件，不开放雇佣动作。
- `TransferItemsRequestMessage` 的原生小屋库存路径是既有 `deliver`/`stock_resource` 的依据。桥接存入实际物品并扣本人背包，尝试 `overruleNextOpenRequestWithStack`；存入不代表居民已经领取或任务已完成。

## 现有与新增能力

| 接口 | 可确认范围 | 不能据此声称 |
| --- | --- | --- |
| `status()` | 当前附近或本人拥有的殖民地、身份/成员权限、最多 24 居民/建筑/工单、开放请求；成员可读饱食度/工作/AI 状态、库存摘要、全局最多 12 建造材料 | 全世界扫描、完整组件库存、所有请求都可交付、长期自治 |
| `found(...)` | 本人真实市政厅物品、原始市政厅蓝图、原生 `createColony` 与建筑登记；已有殖民地间距和世界出生距离配置检查 | 已建成市政厅、居民已到齐、已自然取得 hut |
| `placeBuilder(...)` | 原建筑工小屋接口继续保留 | 小屋放置就已完工 |
| `placeHut(...)` / wire `place_hut` | 本轮新增下面 7 个固定原始 hut；原生权限与本人真实物品；实际蓝图主锚点必须是该 hut | 任意建筑、任意 style/path、旋转/镜像、研究解锁、工人设置 |
| `requestBuild(...)` | 原生下一等级请求。只有实际新增、匹配目标建筑及指定建筑工的 `WorkOrderBuilding` 才确认 `ok:true` | 请求一经提交必然成功、已完成建造、可绕过研究/等级 |
| `deliver(...)` | 指定建筑仍持有的开放 `IDeliverable` token，原生请求 `matches` 校验，本人物品与数量 | 可给任何居民直接喂食、所有请求类型均支持、已完成需求链 |
| `stockResource(...)` | 正在工作的建筑工小屋中仍需的精确组件材料，数量不超过需求减同组件小屋库存 | 计算了工人背包/所有在途材料、物料制造和运输自动完成 |

`status` 优先当前位置的殖民地，再选择 128 格内最近殖民地，最后选择本人拥有的殖民地；调用者必须核对返回 `colony.id` 和权限。查询间隔至少 10 tick。响应仍受 16 KiB 上限；超限会显式返回 `colony_state_too_large`。展示物品列表不等于完整原生请求谓词，执行仍由服务端匹配。库存 `stock` 仍按物品 ID 汇总，无法代替完整组件库存核对。

动作回执缓存仍只属于当前在线 UUID 的最近 32 个 ID。新增 `ColonyActionReplay` 把每个 ID 绑定到完整已解析请求的 SHA-256 指纹：递归排序对象键，保留数组顺序、JSON 类型和完整字符串（包括 SNBT 的组件及空格），规范化等值数字，仅忽略根级 `requestId`。相同内容可回放；同 ID 不同动作/位置/数量/槽位/组件等返回 `action=本次动作,ok:false,code=request_id_conflict,accepted:0,knownNotApplied:true,retryAutomatically:false`，本次没有执行，并保留原缓存。未完成的原请求结果未知时也不重施；深度/节点/规范化字节预算超限在执行前拒绝。缓存不跨断线持久化，超时或断线仍需重查原生状态，不能盲目自动重发。

## 精确放置范围

固定 pack 是锁定资源里的 `Minecolonies Original`。表中的路径来自 JAR 的 `blueprints/minecolonies/original/`；8 个蓝图（包括市政厅）均在测试中解码原 NBT，核验 `optional_data.structurize.primary_offset` 处的实际方块及原生 tile。运行时还需已加载的真实 pack、存在的蓝图，并通过 `StructurePacks.getBlueprint` 核验主锚点实际方块。没有缺失资源替代。

| `hutType` | 本人所需原生物品 ID | 固定 level 1 蓝图 |
| --- | --- | --- |
| `builder` | `minecolonies:blockhutbuilder` | `fundamentals/builder1.blueprint` |
| `home` | `minecolonies:blockhutcitizen` | `fundamentals/residence1.blueprint` |
| `farmer` | `minecolonies:blockhutfarmer` | `agriculture/horticulture/farmer1.blueprint` |
| `warehouse` | `minecolonies:blockhutwarehouse` | `craftsmanship/storage/warehouse1.blueprint` |
| `blacksmith` | `minecolonies:blockhutblacksmith` | `craftsmanship/metallurgy/blacksmith1.blueprint` |
| `cook` | `minecolonies:blockhutcook` | `fundamentals/cook1.blueprint` |
| `deliveryman` | `minecolonies:blockhutdeliveryman` | `craftsmanship/storage/deliveryman1.blueprint` |

尤其不要从 Java 字段 `blockHutHome` 猜出 `blockhuthome`；真实注册名是 `blockhutcitizen`。

新增客户端 operation 为 `placeHut`，wire `kind` 为 `place_hut`。参数为 `{hutType,position:{x,y,z},inventorySlot:0..35,expectedSnbt,requestId?}`。`structurePack`、`blueprintPath`、`style`、`rotation`、`mirror` 输入会被拒绝，不会被悄悄忽略；未知 `hutType` 也拒绝。成功回执 `code=hut_placed`，返回 `colonyId,position,itemId,inventoryRemaining,hutType,structurePack,blueprintPath,level,built`。它仅放 hut 并消耗一件本人物品，`level/built` 是当时实际状态。

`status` 新增 `constructionOptions`，即使 `ok:false,code=no_nearby_or_owned_colony` 也返回：

- `allowedHuts[]:{hutType,itemId,blueprintPath,initialTargetLevel:1,blueprintAvailable}`、`structurePack`、`scope`。
- `founding:{itemId,blueprintPath,blueprintAvailable,minDistanceFromWorldSpawn,maxDistanceFromWorldSpawn,worldSpawn,playerDistanceFromWorldSpawn,ownsColonyInDimension,siteChecksRequired:true}`。
- 有殖民地时额外给当前玩家原生 `placeHutsPermission/manageHutsPermission`。
- 明确 `hireAvailable:false,workerConfigurationAvailable:false`；食物供给能力是 `open_native_deliverable_requests_only`。

入门发现接口 `capabilities()` 对应真实服务端 query `kind=capabilities`，返回 `ok:true,query:capabilities,readOnly:true,constructionOptions,colony`；无殖民地时 `colony:null`，访客状态保留真实 `member:false`，无需事先拥有殖民地。它共用本人 10 tick 查询节奏、单播 UUID 和 16 KiB 响应上限，返回后不枚举居民、建筑库存、请求或工单。原 `status()` 无殖民地的 `no_nearby_or_owned_colony` 行为保持。初版客户端已开放该 operation 而服务端只接受 status，真实 QA 曾返回 `unsupported_query`；失败证据保留，本次修复不把该旧执行改写成成功。

本次只读主实验服 config 的出生距离为 0–30000；应从候选实际状态读取，不把“600 格”作为保证。选址还要通过原生殖民地间距、地形及可达性检查。

`requestBuild({buildingPosition,builderPosition,requestId?})` 参数不变，只申请原生下一等级，不接受自选等级。成功新增 `workOrder:{id,type,name,position,claimed,claimedBy,currentLevel,targetLevel,structurePack,blueprintPath,stage?}`。已有工单拒绝 `construction_already_pending`；原生正常返回而未创建合格新工单时拒绝 `native_build_request_not_accepted`；异常/多候选结果为 `construction_outcome_unknown_check_world`。原生 `BlockPos.ZERO` 是自动选建筑工的哨兵，显式选择该坐标会拒绝 `builder_origin_not_selectable`。

建筑查询新增真实 `maxLevel,structurePack,blueprintPath`。成员还能看到最多 4 个 `workerModules`，含实际 `moduleId,capacity,full,hiringMode,assignedCitizenIds,assignedCitizenCount,assignedCitizensTruncated`；全局限制仍在，超出模块显式 `workerModulesTruncated`。

## 调用与验证

沿既有同一已认证连接 `attachColonyClient(bot)`，先 `await colony.status()`，从 `constructionOptions` 发现真实类型/物品与蓝图是否加载；用本人最新原生菜单快照拿槽位和完整 SNBT。客户端接入新 operation 后调用：

```js
await colony.placeHut({ hutType: 'home', position, inventorySlot, expectedSnbt })
await colony.requestBuild({ buildingPosition: position, builderPosition })
const observed = await colony.status()
```

Java 无新增依赖，既有桥接 builder classpath 已包含锁定 MineColonies/Structurize/BlockUI/Domum。没有修改 builder、版本锁或运行配置。

只读可运行测试：

```powershell
$env:MAW_COLONY_AUDIT_ROOT='E:\QiandengJiSocietyLab'
& 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools/test_player_colony_bridge.py -v
```

6 项通过：原 JAR SHA 与 8 个锚点资源、原生拒绝/同步工单行为、生产确认规则正负例、Java 21 实际锁 API 编译与调用检查、生产指纹/回执缓存的真实 JVM 回归，以及 capabilities 原生响应和实际 handler 分支。测试拒绝原 API 无结果、旧工单、错误位置/类型/等级/建筑工、未认领、多工单、未知/路径注入 hut 输入；接受匹配的真实 build/upgrade 证据。缓存回归重现 found 成功后同 ID 换 place_hut warehouse 被拒，核验字段顺序与等值数字正常回放、SNBT/组件/数量/位置变化拒绝且旧回执不被覆盖、JSON 类型/数组顺序、独立玩家 ledger、32 条上限及深度预算；运行时 SHA-256 与独立 Python 规范化参考一致。capabilities JVM 回归调用实际生产响应函数，核验无城、访客权限和原 options；实际编译 handler 字节码核验分支可达、沿原单播预算 send 且在状态枚举前返回，未知 query 仍拒绝。回归禁止桥接直接加居民、伪造工单、改等级或管理员命令。

候选上线后的普通玩家验收仍需实际完成：自然获取/合成 hut → 原生放置 → 已观测居民上岗 → 工单与材料 → 自己采集/制造并供给 → 观察目标 `built=true`、目标 level 达标及对应工单消失。工单消失也可能取消，不能单独当完工。住宅入住、农田字段/工作配置、仓库/快递物流、铁匠教学/研究、直接居民交互及任务链仍有独立能力缺口；本轮不宣称这些已验收。
