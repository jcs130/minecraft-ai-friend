# My Agent World：Domum 原生制板接入

2026-10-09 已在常驻新服以普通非 OP 的 mc-agent-neko 身体实测：普通放置/交互打开 Cutter，选 `domum_ornamentum:fpanel` 的 full 款式，真实两次各放入 1 圆石、每次取出 4 面板，最终 8 件真实库存且光标为空，重连后保留。产物实际包含 `domum_ornamentum:texture_data`（`minecraft:block/oak_planks` → `minecraft:cobblestone`）和 `minecraft:block_state`（`type:full`）。站位/机器物品和材料是披露的管理员测试夹具，不是自主采集证明。

首次打开尚未选组时，原 `currentGroup` 可以为 null；服务端现返回真实空选择和零当前变体，不再触发异常，也不会替玩家自动选组。快照增加原模组分组及款式的第一页各最多 10 个实际模板/材质预览；每项保留原索引和完整 SNBT，菜单/windowId/stateId/本人 UUID 继续校验。预览不是可取物品或库存槽。取物、材料消耗仍必须走真实 `menu.click`，实际产物按菜单回执确认。

网页已接原 Cutter PNG、原按钮 UV、第一页选择状态和真实圆石面板的动态材质图标。滚动位置与后续页面、其他动态 Domum 物品仍明确未支持；不能把部分预览当作完整 Java GUI。原生只读查询有 tick 限流，观察器已提供新鲜缓存时可读取 `domum.current`；拒绝不能伪装成成功或自动重投变更。当前接口包仍不超过 16 KiB。

这条接口让普通 Agent 玩家使用本人已经打开的 Architect's Cutter 原生菜单，发现材质组件、原生组和变体，并选择原生输出。输入材料与取出成品仍走 `menu.click`，原生配方负责材质、数量、消耗和输出。没有额外的 `craft`、成品发放、物品构造或殖民地需求改写功能。

适配对象锁定为 NeoForge 1.21.1、Domum Ornamentum `1.0.231`、MineColonies `1.1.1319`。其他版本必须重新核对 API 和原生菜单行为。

## 普通 Agent 的操作流程

1. 通过原生世界交互靠近并打开 Cutter。接口不能打开远处机器；本人必须距离真实机器中心不超过 8 格、方块已加载、菜单有效且有实际世界交互权限。
2. `domum.state()` 读取本账号的真实菜单。根据 `state.groups` 发现组 ID；根据 `state.inputs`、`outputSlot` 与另一路 `menu.current()` 确认真实槽位。
3. `domum.choices({groupId, offset:0, limit:12})` 分页发现组内变体。沿返回的 `nextOffset` 继续，直到 `null`。JSON 单包不超过 16 KiB、每页最多 24 项；超预算不会截断 SNBT 或跳过物品。
4. 选择符合需求的变体。`choice.variant.snbt` 是原生菜单变体模板，包含其默认材质；`choice.components` 给出输入槽、材质键和允许材质的原生 tag。该模板不能当作本人物品库存指纹，也不代表已经产出的成品。
5. `domum.select({selection:'group', groupId})` 先选原生组。
6. `domum.select({selection:'variant', groupId, variantIndex:choice.variantIndex, choiceSnbt:choice.variant.snbt})` 选择原生变体。尚未放入材料时输出可以为空，这是原生选择成功，尚未制作。原生 `selectGroup` 不清掉旧 `currentVariant`，而输入槽允许材质依据选中变体判断；换组时先选新变体，再投材料，避免旧变体限制输入。
7. 用普通 `menu.click` 把本人实际材料放入对应输入槽。每次移动材料、改变游标或取出输出后，都重新 `domum.state()`；Domum 的快照不会随独立 `menu.click` 自动刷新。确认选中变体后，`state.output` 是原生菜单生成的真实输出预览，完整 SNBT 应含实际输入材质及 `minecraft:block_state`；必要时使用新快照再次选中该变体以核对原生预览。
8. 核对真实输出与殖民地需求的物品类型和全部组件一致，再用 `menu.click(state.outputSlot,0)` 取出原生输出，将游标物品放回本人的空槽。原生输出槽的 `onTake` 消耗输入，不能只把预览当成库存。
9. 重新读取本人菜单/库存。根据真实原生 recipe 的产出数量统计消费与产出。做足需求数量后，使用殖民地供料接口及本人物品完整 SNBT 送入原生建筑库存，再观察原生工人和需求变化。

只读查询每名玩家限流 10 tick。常规操作将只读查询间隔留到至少 600 ms；`rate_limited` 表示此次读取不可用，不能依据旧快照继续写操作。这个等待不代表任何未知写操作可以重试。

范例仅展示调用顺序，实际组 ID、变体索引、原料和槽位来自本人的原生读取：

```js
const receipt = await sdk.domum.state()
if (!receipt.ok) throw Error(receipt.code)
const group = receipt.state.groups.find(g => /* 原生目标组 */)
const page = await sdk.domum.choices({ groupId: group.groupId, limit: 12 })
const choice = page.choices.find(row => /* 与任务所需变体一致 */)
await sdk.domum.select({ selection: 'group', groupId: group.groupId })
await sdk.domum.select({ selection: 'variant', groupId: group.groupId,
  variantIndex: choice.variantIndex, choiceSnbt: choice.variant.snbt })
// 用真实 menu.click 放入材料；重新读取 Domum 快照。
const selected = await sdk.domum.state()
// 核对 selected.state.output 全部组件，再通过 menu.click 取出。
```

## 原生数据格式

三个频道均为 UTF-8 JSON 原始字节，不加长度前缀：

| 频道 | 方向 | 功能 |
| --- | --- | --- |
| `maw_agent:domum_query` | 本人连接到服务端 | `state`、`choices` 只读查询 |
| `maw_agent:domum_action` | 本人连接到服务端 | `select` 原生菜单选择 |
| `maw_agent:domum_state` | 服务端仅发本人连接 | 私有回执 |

部署时除注册 `DomumCutterBridge.register(eventBus)`，还需在隔离网关的 `GATE_EXTRA_PLAY_CHANNELS` 追加这三个可选 PLAY 频道，并按运行手册重新协商连接。服务端只在本人的连接声明 `domum_state` 时发送，不能仅安装 Java 桥就假定消息已可达。碰撞查询复用既有 world 频道，另行使用其原生只读接口。

回执：`schemaVersion:1`、`kind:'domum_receipt'`、`playerUuid`、`requestId`、`ok`、`code`、`query` 或 `action`、`retryAutomatically:false`。写回执另有 `changed`、`outcomeKnown`、`outcomeUnknown`。状态不可用时显式 `stateUnavailable:true`；客户端清除旧快照。

`state` 包含：

- `source:'same_player_native_architects_cutter'`，本人 `playerUuid`、`windowId`、`stateId`、真实机器绝对坐标 `position`、`creative`。
- `currentGroup` 是资源 ID 或 `null`；`currentVariant`、`carried`、`output` 均为 `{id,count,snbt,name?}`。空槽为 `minecraft:air`、数量 0、SNBT 空字符串。
- `inputs:[{slot,item}]` 是真实原生输入槽顺序；`outputSlot` 从真实菜单计算，不能硬编码为 2。
- `groups:[{groupId,buttonId,variantCount}]` 保持原生按钮顺序。
- `matchingRecipeIds`、`matchingRecipeCount`、`matchingRecipesTruncated` 来自真实已匹配当前输入材料与当前选中变体的原生配方，最多列 24 个 ID。没有匹配配方时为空数组，输出可能为空；不能补造配方。

`choices` 页另有 `groupId`、`offset`、`limit`、`total`、`returned`、`truncated`、`nextOffset`：

```json
{"variantIndex":0,"buttonId":42,
 "variant":{"id":"domum_ornamentum:panel","count":1,"snbt":"原生完整模板 SNBT"},
 "components":[{"inputSlot":0,"componentId":"minecraft:block/oak_planks",
 "validSkinsTag":"原生允许材质 tag","optional":false,
 "defaultBlockId":"minecraft:oak_planks","consumedPerCraft":1}]}
```

模板的默认材质是用于识别原生变体的信息；最终成品材质由玩家真实输入决定。`optional` 是原生组件描述，不保证该版本所有配方的 `matches` 都允许空槽；以原生匹配和输出为准。`consumedPerCraft:1` 适用于生存玩家每个实际需要且非空的输入槽；创造玩家原生不消耗材料，验收必须使用普通生存账号。

供料前查询 `colony.resources`。每项 `availableInBuildingProvider` 是按该项完整物品组件，从原生建筑组合库存的实际槽位计数；`providerSource:'native_building_combined_item_handler'` 明确包含建筑关联的已加载货架以及建筑本身，不能只数 hut 方块自己的库存。它与模组自身的 `availableReported` 分开保留。`stockBefore`、`stockAfter` 与状态摘要 `stock` 使用同一个原生 provider；供料回执另有 `stockSource`。状态摘要仍按物品 ID 聚合，不能用 panel 总数代替某种材质的准确数量；供料决策以完整组件资源项为准。资源需求总数为 0 时，重启后的工人蓝图扫描可能尚未初始化，不能直接断言不需要材料。

`groupId` 必须是小写资源 ID `namespace:path`、最长 256 字符，并存在于原生组 map。`variantIndex` 为整数 `0..4095` 且小于真实组变体数量。页 `offset` 为 `0..2147483647`，`limit` 为 `1..24`；工具计划执行器可以设更小的 offset 上限。无法装入单包的单个变体返回 `choice_item_too_large`、`blockedOffset`；`nextOffset` 留在该项，Agent 应报告明确缺口而非无限翻页。

## 写操作前置条件与恢复边界

SDK 的 `select` 必须已有本连接当前生命周期的本人 `domum.current()` 全快照，才能展开以下前置条件。可选 `state` 参数只是与最新缓存进行完整深比较的提示，不能覆盖或初始化缓存；与最新缓存内容不同会在本地返回 `DOMUM_STATE_CHANGED_NOT_SENT`，不发包。spawn/respawn、超时或断线使缓存失效后，即使 UUID、窗口 ID 与旧快照相同，也要先通过新只读查询拿到服务端快照，否则返回 `DOMUM_STATE_UNAVAILABLE`。这两种未派发拒绝均 `outcomeKnown:true`、`changed:false`。Agent 工具不接受任意状态覆盖：

```text
playerUuid / windowId / expectedStateId / expectedPosition
expectedGroup / expectedVariantSnbt
expectedInputsSnbt[] / expectedCarriedSnbt / expectedOutputSnbt
variant 选择另外要求 groupId / variantIndex / choiceSnbt
```

服务端从 `context.player()` 取得真实玩家身份，从真实 `ArchitectsCutterContainer.worldPosCallable` 只读取得机器位置。该锁定版本没有公开位置 getter，因此位置读取使用只读反射；如果无法访问，拒绝 `native_menu_location_unavailable`，不推测位置。先检查已加载、距离、原生 `stillValid` 与实际交互权限，再核对完整 CAS。

服务端先按本人账户预占完整请求指纹，才执行原生 `clickMenuButton`。同 request ID 且所有字段相同只能重放已保存的回执；换组、换变体、换材料组件、换坐标或状态会拒绝 `request_id_conflict`。SDK 不会自动重复发送同一请求 ID。服务端回执账本是每人最多 32 条的进程内账本，登出后清理，不能当成跨进程恰好一次保证；持久恢复应由上层 Agent 账本保留未知结果并先复查状态。

CAS 失败、菜单关闭、距离过远或缺少权限等在调用原生选择前拒绝：`changed:false`、`outcomeKnown:true`。此时材料、输出、游标、选择均不改变。正常选择只改变原生选择与输出预览，不消耗输入；材料消耗发生于随后真正取出原生输出。

已经调用写操作后断线、超时、重生或发生原生后置不变量异常：`changed:null`、`outcomeKnown:false`、`outcomeUnknown:true`。不自动重试；先读取原生菜单与完整本人库存确认事实，再让计划决定是否需要新动作。未派发请求在 end/detach 后明确已知拒绝且零 write。spawn/respawn 淘汰旧请求与缓存，迟到回执不能复活旧状态。

## 锁定源码依据与验收

主要证据为本机锁定 JAR 字节码，不采用近似配方或自制结果：

- Domum `domum-ornamentum-1.0.231-main.jar` SHA-256：`04c0c902bdbcbd48e38bee5a323907ae0b7b7db4ff4a3e4da7c45334b65610a1`。
- MineColonies `minecolonies-1.1.1319-1.21.1.jar` SHA-256：`ab97c0eec45c3f2539ec31428e3c836bb30ba1c537af0c86f5ab4e38754f6a4d`。
- `ModBlocks.getOrComputeItemGroups` 提供原生组和完整变体模板；`IMateriallyTexturedBlockComponent` 提供材质键、允许 tag、默认材质和 optional。
- `ArchitectsCutterContainer.clickMenuButton` 选择原生组/变体并重算原生输出。原生 `updateRecipeResultSlot` 要求物品类型与 `BLOCK_STATE` 一致后调用原生配方。
- `ArchitectsCutterRecipe.assemble` 从真实输入 `BlockItem` 建立 `texture_data`，写入实际材质后应用原配方组件 patch；数量取原生组件数与 recipe.count 的最大值。
- 原生输出槽 `ArchitectsCutterContainer$3.onTake` 对每个需要且非空的输入槽 `remove(1)`，生存模式生效。`DomumCutterBridge` 不调用 `assemble`、不构造 ItemStack、不写库存或输出槽。

独立临时目录编译/字节码/CAS/回执指纹测试 **6/6**；SDK 私有归属、完整组件、生命周期、旧快照不能覆盖当前缓存、严格 UTF-8 解码、超预算、已知拒绝与未知不重试测试 **17/17**；殖民地锁定 API、分页和实际组合库存口径测试 **10/10**。非法 UTF-8 字节不会替换成乱码再被 JSON 接受；它只产生协议错误，不填充快照或结算等待中的请求。这些验证锁定 API 与安全执行边界，不等同于普通账号已完成真实制板或房屋建成。

复现：

```powershell
$env:MAW_DOMUM_AUDIT_ROOT='E:\QiandengJiSocietyLab'
$env:MAW_COLONY_AUDIT_ROOT='E:\QiandengJiSocietyLab'
python tools/test_domum_cutter_bridge.py -v
python tools/test_player_colony_bridge.py -v
node --test world/src/neoforge-handshake/domum-client.test.cjs
```

真实隔离 QA 至少记录以下步骤的完整 SNBT、槽位与数量：

1. 非 OP、生存模式玩家用真实原料按原生配方制作并放置 Cutter；如果原配方接入另有缺口，单独标注“机器来自管理员夹具”，不能称全自主流程。不得夹具发放 panel 成品。
2. 打开 Cutter，输入真实橡木板，按真实菜单发现 `panel` 的 `full` 变体，选择后只生成原生预览。选择前后输入和游标必须完全守恒。
3. 使用已改变输入前的旧快照 select；应明确拒绝，确认完整状态无副作用。改变 choiceSnbt 的组件也应拒绝。重复/冲突 request ID 分别重放/拒绝，不能重复副作用。
4. 原生取出输出，核对 `domum_ornamentum:texture_data` 的 `minecraft:block/oak_planks -> minecraft:oak_planks`、`minecraft:block_state:{type:'full'}` 与真实需求一致，核对实际需要槽原料各减少 1。产出数量从原生 recipe/输出读取，不能预设每次 1。
5. 材料耗尽后只能得到空预览，不能凭模板取到成品；换不合格材质按原生 `mayPlace`/配方拒绝；关闭菜单后 select 必须拒绝。
6. 使用本人得到的真实组件 panel 供给真实建筑库存；对照 `colony.resources` 的原生需求变化。工人需实际完成 blueprint 扫描并产生需求，重启后的空资源页不能当作完成。

### 2026-10-05 实际隔离验收

证据目录为 `E:\QiandengJiSocietyLab\research\colony-production-20261005b`。`MawColonyFoundQB` 使用本人的普通生存连接，另有访客 `MawProdVisitor` 检查权限和消息归属；这是同账号另建隔离世界的脚本 QA，模型调用为 0。Cutter 和原料来自明确的管理员夹具，所需完整组件 panel 成品未被发放。原先的裸 panel 3 不具备所需组件，始终没有计入正确制板或供料。

| 证据 | 实际结果 |
| --- | --- |
| `prod-native-cutter-b-002-resources`、`011-choices` | 原生需求为 13 项；目标是 full 橡木 panel 3。`fpanel` 组的变体 2 原模板包含完整默认橡木纹理和 full 方块状态。 |
| `025-domum_state`、`026-menu_click`、`027-domum_state`、`031-read` | 桦木输入槽 1→0，实际取出原生桦木 panel 4，原料总量 4→3。完整纹理为桦木，不能替代橡木需求。 |
| `033-stock`、`034-read` | 错误材质拒绝 `item_not_needed_for_construction`、accepted=0，前后新读取的全部本人库存及游标相同。 |
| `047-domum_state`、`048-menu_click`、`049-domum_state`、`053-read` | 橡木输入槽 1→0，实际取出原生橡木 panel 4，原料总量 64→63；全部组件精确匹配需求。 |
| `055-stock`、`056-read` | 故意改变库存 SNBT 的数量，拒绝 `inventory_components_changed`、accepted=0，前后新读取的全部本人库存及游标相同。 |
| `059-stock`、`prodb-after-stock-read-001` | 原生供料接受 3，本人正确组件 panel 4→1。即时 `after` 缓存还显示 4，后续新读取才确认实际扣减，不能只看同一回执附带的缓存。 |
| 存档 rack NBT、17:21:12 服务端只读 `data get block 595 64 598` | 已加载关联货架 `(595,64,598)` 的 `inventory[1]` 持有正确 full 橡木 panel 3；另一个关联货架 `(595,64,599)` 无 panel。材料去向由真实完整 NBT 确认。 |
| `prodb-provider-status-001` | 修复后的组合库存摘要实际读到 panel 3，`stockSource=native_building_combined_item_handler`。 |
| `prodb-visitor-resources-denied-001`、`prodb-visitor-stock-denied-001` | 非成员读取、供料都拒绝 `not_colony_member`，回执属于访客自己的 UUID，供料 accepted=0。 |

其中 `059-stock` 的旧回执保留了 `stockBefore=0,stockAfter=0`：旧计数只读 hut 自身 `getAllContent()`，遗漏关联货架，驱动据此正确停在 `NATIVE_CORRECT_STOCK_NOT_CONFIRMED`，没有重试。随后以新只读库存、真实存档和实时 rack NBT 独立核实物品去向，再修复计数口径；没有修改旧回执或重新执行原请求。修复后的正向回执已由下面的独立 c 流程重新验收。

重启后 `prodb-combined-provider-resources-001` 返回合法空页：`total=0,hasWorkOrder=true`。此时虽然组合库存可读到 panel 3，原生工人的需求扫描仍未初始化，不能称无需材料或住宅完工。私有离线审计保存在 `production-b-audit.json` 和 `provider-storage-saved-world-audit.json`。

`E:\QiandengJiSocietyLab\research\colony-production-20261005c` 使用另外一个隔离世界和全新的 `prod-native-cutter-c` 请求 ID；原生需求先自然初始化到 13 项、橡木 panel 需求 3、实际 provider 库存 0 后才开始。该脚本 **62 步正式结束、exit 0**，保存状态为 `scripted_cutter_and_stock_verified`。独立只读审计逐条核对本人 UUID、epoch、完整原生槽位和回执；全程模型调用 0，无断线未知结果或私有连接归属异常。机器与原料仍是管理员夹具。

| c 流程证据 | 实际结果 |
| --- | --- |
| `prod-native-cutter-c-026-menu_click`、`048-menu_click`，各自随后原生 state/read | 再次实际取出桦木 panel 4 和橡木 panel 4，各消耗原料 1；完整纹理和 full 状态保留。 |
| `033-stock`、`034-read`；`055-stock`、`056-read` | 错误材质、错误库存 SNBT 分别已知拒绝，accepted=0，随后完整本人库存及游标未变。 |
| `059-stock`、`060-read` | 新回执 accepted=3、`stockBefore=0,stockAfter=3`、`resolutionError=false`，本人正确组件 panel 4→1，其余完整库存槽未变。 |
| `061-resources`、`062-status` | 需求完整 SNBT 不变，`availableInBuildingProvider=3`；组合库存状态摘要同样读到 panel 3，来源字段一致。 |
| `prodc-oversupply-reject-001`，前后独立 read | 已供满需求后再交正确 panel 1，明确拒绝 `quantity_exceeds_remaining_need`、accepted=0；全部 46 格本人库存及游标相同。 |
| `prodc-visitor-resources-denied-001` | 非成员资源查询拒绝 `not_colony_member`，只读零写操作，回执属于访客自己的 UUID。 |
| `prodc-visitor-stock-denied-001`；`prodc-visitor-near-stock-denied-001`，各自前后独立 read | 首次在远处拒绝 `building_not_reachable`；仅将访客位置夹具移至可达范围后，用新请求验证 `not_colony_member`。两次 accepted=0，各自全部库存及游标未变；远处结果单独保留，不冒充权限验证。 |

这是新世界、新请求的完整制板与供料验收，并非重放旧 b 的 `059-stock`。私有审计 `production-c-audit.json` 保存 62 条正式结果的哈希、实际原料消费、完整产物组件、拒绝前后库存和正确供料前后数量。

补充的 10 条正式记录也经过独立只读审计，哈希、完整库存比较与本人回执归属追加在同一审计文件，操作方概要为 `supplemental-private-audit.json`。访客的位置夹具没有改变成员或 OP 权限；全程 epoch=1，没有私有消息归属异常或未知写结果。最初只读封装取错字段的异常另行保留，零写操作，没有重发。

更早的 `E:\QiandengJiSocietyLab\research\colony-production-20261005` 保留两次失败：未知 mod 菜单引起断线的 `prod-open-cutter-002`，以及投桦木过程中断线的 `prod-native-cutter-a-022-menu_click`。后者最后已知状态是游标桦木 4、输入和输出空；重连后库存无桦木。NeoForge 原生菜单断线移除会把游标/输入经可取消的 `ItemTossEvent` 掉落，初始拾取延迟 40 tick；实际去向仍不能只凭库存缺少推断。这两个旧操作保持 `outcomeUnknown`，原意图/包/回执与暂停证据保留，独立 b/c 成功不覆盖它们。

以上只证明原生发现、选择、生存制板、完整组件和本次供料，未证明自主获取机器原料、模型长期自主经营、住宅完工或全部模组已可玩。
