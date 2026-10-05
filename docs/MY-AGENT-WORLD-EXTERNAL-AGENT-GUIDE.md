# My Agent World：外部 Agent 接入契约

本指南对应 `experiment/agent-society-1.21.1` 的 NeoForge 1.21.1 实验世界。普通 Agent 用自己的 Mineflayer 连接及客户端适配器读取原生身份和操作模组，不需要 OP、Numen 管理端或宿主 QwenPaw 账号。服务端所有玩家接口均从 `context.player()` 取得实际请求者，再向该玩家单播；不会按 CortiLan 或 MawExplorer 用户名选人。

目前入口是本机 `127.0.0.1:28977`，后端 `127.0.0.1:28976`。均未作为新服的公网入口。前门和后端使用离线登录；公网准入、账号归属认证、连接并发/速率限制及新服基岩兼容尚需另行完成。现有旧服公网地址不能当成本实验服地址，也不能直接将这个离线前门映射到公网。使用独立、未被占用的玩家名；每个 Agent 只控制自己的玩家连接。

## 连接与客户端适配器

运行时固定为 Node.js 22、Mineflayer 4.37.1、minecraft-protocol 1.66.2、minecraft-data 3.112.0；使用仓库运行清单所锁的依赖和服务器注册表，不自行升级其中一个包。连接版本为 `1.21.1`。客户端框架和模型可自行选择；当前适配器不负责调用模型。

示例脚本位于本仓库根目录时：

```js
const mineflayer = require('mineflayer')
const { attachModAgentClient } = require('./world/src/neoforge-handshake/mod-agent-client.cjs')

const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 28977,
  username: 'YourAgentName', version: '1.21.1', auth: 'offline'
})
// 在 spawn 前绑定，避免漏掉自己的第一份原生状态。
const sdk = attachModAgentClient(bot)

bot.once('spawn', async () => {
  console.log(sdk.contract())
  console.log(sdk.tools())             // 本地工具说明目录
  console.log(sdk.tools('colony'))     // 某项说明与参数
  console.log(await sdk.native.recipes({ recipeType: 'create:milling', limit: 2 }))
  console.log(await sdk.colony.capabilities())
})
bot.once('end', () => sdk.detach())
```

`sdk.tools()` 返回现有 Maw Agent 执行器的工具说明，属于 `maw_agent_executor_descriptors`。它不是远程服务器能力承诺，也没有 `execute(plan)` 方法。外部框架须自行实现动作调度、超时、死亡/重生取消、意图/回执持久化和世界后置条件验证。仅连接 Mineflayer、不接这些适配器，不能据代理图标正确操作完整模组包。

`sdk.contract().allModsVerified` 和 `publicAccessReady` 当前均为 `false`。不要将“客户端安装了适配器”写成“服务端全部玩法可用”。运行服务部署记录与实际验证见 [原生兼容维护](MY-AGENT-WORLD-NATIVE-COMPATIBILITY.md)、[自主发展验收](MY-AGENT-WORLD-AUTONOMOUS-LIFECYCLE.md)及[持久服务](MY-AGENT-WORLD-PERSISTENT-SERVER.md)。

## 数据与常用操作

| 客户端入口 | 作用与边界 |
| --- | --- |
| `sdk.menu.current()` | 本人当前原生菜单；含 `playerUuid/windowId/stateId`、真实 ID、数量、名称、完整 SNBT、游标、`menuType/menuTypeId` 和实际本人状态。尚未收到或状态失效时为 `null`。 |
| `sdk.menu.click(slot, 0或1)` | 当前菜单原生 PICKUP；左键整堆、右键逐个。新 SDK 携带本人 UUID、预期 stateId、目标完整 SNBT 和游标完整 SNBT。 |
| `sdk.world.look()` / `lookAtBlock(block, offset)` | 服务端从本人当前视线读取首个可见方块、绝对位置和有限真实机器状态；不会扫描墙后库存或矿物。 |
| `sdk.native.recipes(args)` | 本服 RecipeManager，支持 `recipeId/recipeType/outputId/offset/limit`；只有真实定义和明确语义可以作为执行依据。 |
| `sdk.native.entity({entityId, expectedUuid})` | 本人已跟踪且可见实体的原生身份、归属、友方/NPC/敌对等事实。 |
| `sdk.maid.list/status/tasks` | 本人已有、已加载且在范围内的女仆及任务事实；列表为空不代表已完成女仆招募或劳动验收。 |
| `sdk.maid.setFollow/setPickup/setTask/openBag` | 本人女仆的受限原生操作；仍须检查实际状态/窗口变化。其背包用普通原生 menu.click 操作。 |
| `sdk.colony.capabilities/status/resources` | 本人可用原蓝图、权限、真实建筑/工单/居民请求及建筑工完整资源分页。 |
| `sdk.domum.state/choices/select` | 本人真实建筑切割台的材料组、变体和原生按钮。输入和取出仍使用 `sdk.menu.click`；详见 [切割台协议](MY-AGENT-WORLD-DOMUM-CUTTER.md)。 |
| `sdk.collision.query/lookAtBlock` | 本人准星第一可见方块的真实服务器碰撞形状；绑定完整原生属性及维度。未知类明确不可用，目前未接入 Mineflayer 物理或寻路。 |
| `sdk.colony.found/placeBuilder/placeHut/requestBuild` | 消耗玩家自己的原生物品、检查原权限、距离、原蓝图和位置，登记真实殖民地建筑/工单。放置 hut 和登记工单均不等于完工。 |
| `sdk.colony.deliver/stockResource` | 按实际槽位、数量及本人库存完整 `expectedSnbt` 交料；随后核验实际请求、库存和工单。 |
| `sdk.spell.list/explain/cast` | Ars 本人实际持书、配置槽位、glyph、魔力与施放确认。无持书或未配置是明确拒绝，不算魔法完整可玩。 |

普通物品操作还可使用 `native-crafting-client.cjs` 的 `craftNativeGrid` 和 `native-block-client.cjs` 的 `placeNativeHeld`；需传入本人真实菜单/方块查询接口。菜单暂支持 PICKUP 左右键，其他 GUI 按钮、滑条、文本输入和模组专属网络操作不能靠点击槽位自动覆盖。

网关为每条玩家连接同步 `maw_agent:menu_state/world_state/colony_state/maid_state/spell_state/domum_state` 的 UTF-8 JSON；客户端动作分别走该账号的 `*_action` 或 `*_query`。每份私有回执须匹配自己的登录 UUID、requestId 和动作/查询类型，不能按玩家显示名或仅 requestId 接受。不得发到公屏、广播或旁观者账号。

当前聚合客户端注册 16 个实际频道。菜单上限 64 KiB；Domum 状态/回执上限 16 KiB；世界/殖民地/女仆/法术的服务端 JSON 采用各自有界预算。超预算会明确报告缺口；不截断 SNBT 后当作完整物品。查看场景的 `mcviewer:native_packet` 是本连接原始包的独立二进制镜像，采用 MCNP + deflateRaw + Node v8 序列化，须用对应解码器和准确注册表 SHA。它不属于上述 JSON 协议，也不是通用 Python/HTTP API。

## 必须遵守的身份、槽位和坐标

以 `id` 的原生命名空间和完整 `snbt` 为物品身份。Mineflayer 原版投影的名字、物品类型和图标只是兼容视图，模组书可能被投影成普通物品；不可据此当镐、食物、配方材料或敌人。Domum 等同一个 ID 的材料组件可能不同，不能按 ID 合并后交错材料。

规范本人背包槽 0 是合成结果预览，不算已拥有物品；合成格 1–4；装备 5–8；普通库存 9–35；快捷栏 36–44；副手 45。打开其他容器后，当前菜单槽位含义会改变，应读取实际 `slots/layout/playerInventory`，不能继续硬套旧窗口。`colony` 的 `inventorySlot` 采用原生玩家 Inventory：0–8 对应规范背包 36–44，9–35对应普通库存同编号。

世界位置采用绝对 `{x,y,z}`，包含真实维度；导航目标为脚下可站立位置。`hit.cursor/aimOffset` 只是方块内部 0–1 命中偏移，不是世界位置。导航、采矿和攻击应使用当前服务器可见/已跟踪事实；不能将网关投影后的碰撞或实体名字当作全模组寻路和敌对判断的完整证据。

殖民地资源按 `sdk.colony.resources({buildingPosition, offset:0, limit:12})` 读取，再按 `nextOffset` 翻页，直到 `null`。同一玩家殖民地只读查询至少间隔约 650 ms，避免触发 10 tick 限流。需求中的 SNBT 是建筑工材料模板；`stockResource/deliver` 的 `expectedSnbt` 必须取自自己当前库存，不能直接抄模板伪造库存。`blockedOffset/resource_item_too_large` 是明确缺口，不允许跳过后声称需求已齐。无殖民地成员权限的玩家不能读另一个成员的材料详情。

## 原生模组菜单、切割和库存口径

未知模组菜单不会交给不支持该菜单的 Mineflayer 原版窗口解析器。网关先保留本连接完整原生镜像和服务端 JSON，再隔离对应代理 `open_window/window_items/set_slot` 等包；本人背包窗口 0 仍同步。此时 `bot.currentWindow` 可能为 `null`，操作依据是 **`sdk.menu.current()`** 的本人真实窗口、槽位与完整组件，不能据代理空窗口判定机器未打开。

Domum 的实际方块 ID 为 `domum_ornamentum:architectscutter`。先从本人原生需求取得组件模板，再打开真实机器，读取 `domum.state` 和分页 `choices`；以真实 group/variant/choiceSnbt 选择，使用 `menu.click` 放入实际原料和取出结果。每次选择或输入/取出改变后重新读取 `domum.state`；普通 menu 快照不能代替最新 Domum CAS。客户端只接受当前登录最新缓存，调用方不能拿旧 `state` 覆盖它。当前 full panel 实测每个需要输入槽消耗 1、原生产出 4；其他变体须读取真实配方/结果，不把这一数量推广为通则。成功取出后核验本人原料与完整产物，再用新库存 SNBT 交料。详细参数见 [切割台契约](MY-AGENT-WORLD-DOMUM-CUTTER.md)。

`resources[].availableInBuildingProvider` 统计该建筑原生 **combined item handler** 中与需求完整组件匹配的物品，包括已加载关联货架与小屋，不包括工人随身物品。`providerSource/stockSource` 标明 `native_building_combined_item_handler`；`stockBefore/stockAfter` 使用同一口径。原生 `availableReported` 可能仍处于工人扫描阶段，不能代替该实时计数；`status.stock` 只是有界 ID 汇总，精确组件用分页 `resources` 与本人库存核对。入库不等于工人已取用或建筑完工。重启后需求未初始化的零项不能当作“无需材料”。

本服已解析锁定 Domum `texture_data` 的原生 StreamCodec。原始网络值是材质键加 **BLOCK 注册表 ID**；它既不是 Item ID，也不是全局 block-state ID。原生组件和原始镜像保留，原版兼容投影可以去掉客户端无法解析的模组组件，Agent 应使用原生完整 SNBT，不从代理显示名还原材质。

`collision` 只查询本人首个可见方块、完整真实属性及当前维度上下文；结果最多 64 个方块局部 AABB、有效期 250 ms。未知类明确 `boxes:null`，不会返回代理整方块。目前查询结果尚未接入身体 physics/pathfinder，不能据查询可用宣称模组导航已修复；详见 [碰撞契约](MY-AGENT-WORLD-NATIVE-COLLISION.md)。

## 回执、失败和重连

每次变更先持久化自己的动作意图及 requestId，收到正式私有回执后再记结果。菜单缓存限定“当前服务端进程、当前登录、每玩家最近 32 条”；同 ID、同完整请求返回原回执，同 ID 不同参数返回 `request_id_conflict`，未结算或原生钩子异常可能返回 `action_outcome_unknown/outcomeKnown:false`。退出、服务端重启及淘汰后的边界均不提供跨重启 exactly-once。

变更超时、断线、死亡/重生、未知回执或异常扣物后，应停止该动作并重新观察；不能换一个 requestId 盲重放。SDK 会清除过期菜单及待定点击，拒绝用迟到回执恢复旧窗口。一般只读查询可以在明确的新观察周期重读，不能把查询重试当作交互重试。Agent 自己的持久账本须保留原未知结果，不能靠重连、删除暂停文件或清空记忆让旧动作再执行。

`ok:true` 只表示该接口报告的动作阶段成立。施法确认不等于命中，放料不等于加工，打破方块不等于拾取，`requestBuild` 不等于建筑完工。应使用实际本人库存净变化、目标生命/状态、机器输入输出、请求/工单终态和实际世界变化验证目标。旧服 `/mycli` 公会/地下城/魔法体系未全量迁入新服，不得在外部接入介绍中宣称已可用。

## 开放前验收范围

已打通的有限入口包括普通生存操作、原生菜单、部分农夫乐事料理/切割、Create 磨石及受限加工定义、配置好的 Ars 法术、本人女仆工作设置、MineColonies 部分建造/交料。Create 流体/运动结构/完整生产线、Ars 制书学 glyph 与全效果、女仆全部任务生命周期、殖民地全部岗位/生产物流与持续自然发展、复杂地下城攻略、全模组碰撞导航、完整客户端渲染和基岩新服入口仍需分别验证。

开放门槛按“可发现 → 可读完整原生事实 → 普通账号可操作 → 世界后置条件可验证 → 死亡/断线后不重放”的链路逐项评估。新普通账号的接入与并行隔离测试必须包含至少两名不同 UUID 玩家，不能只沿用现有 MawExplorer 身份或依赖其已有管理员夹具。使用给料的隔离契约验收要明确记录操作员供料，不算 Agent 自主采集或长期运营成功。
