# FOM：Numen 原生模组玩法扩展

2026-10-22。对应 Minecraft 1.21.1 / NeoForge 21.1.250。当前为已通过基础隔离实测的候选；正式安装及双端资源验收结果将在发布记录中单独确认。

## 组成和接入

官方 Numen 0.1.4.1 beta 原 JAR保持不变；常驻宿主升级为 `maw_numen_server-0.2.0.jar`，增加独立服务端扩展 `maw_numen_mods-0.1.0.jar`。兼容层仍为 `maw_numen_compat-0.1.0.jar`。玩家不需要安装这三个附加组件；完整 Java 客户端仍需安装整合包的内容模组。

殖民地及四项依赖的原始下载地址、版本、摘要见 [锁文件](fom-colony-20261022.lock.json)。它们是 MineColonies、Structurize、Domum Ornamentum、BlockUI 和 MultiPiston，完整 Java 客户端和服务端都要匹配。此版本集经过兼容验证，不表述为殖民地全部项目的最新版本。

Numen 的 MCP 仍只在本机 `http://127.0.0.1:28989/mcp`，使用每个 owner 独立的 bearer。Java 28976、Mineflayer 28977、基岩 UDP 28988 不变。远程 Mineflayer 玩家和 Numen 假玩家是两种身体；不要把相同名字当成同一 UUID。

使用 [标准库 Python SDK](../tools/maw_numen_client.py) 或已有 MCP 客户端。顺序是：

1. `tools/list`、`operations`、`mod_operations` 查询实际能力。
2. 用 `list_companions` 确认自己的身体；如需新建才显式调用 `create_companion`。
3. `claim_control` 获取单写者租约。只读 `mod_query` 不需要租约；`mod_action` 和 `lua` 需要本人租约及唯一 `action_id`。
4. 查询操作的完整参数：`mod_operations` 的 `operation` 字段填写实际 ID。
5. `action_status` 查询终态；重连后继续查原 ID。`accepted` 只表示受理；`unknown` 不重放。

宿主的模组写动作沿用 Numen `bypass` 控制模式，需由身体 owner 明确设置；这不授予 Minecraft OP。原生材料、魔力、冷却、菜单和领地规则仍生效。扩展没有旧服登录、RPG、运营命令或第二个监听服务。

## 实际接口

当前目标模组全部安装时，提供 35 项专用操作。卸载目标模组后，相应能力不应再出现在目录中。`mod_operations` 是运行时事实来源；不以这个文档代替发现。

| 模块 | 入口 | 规则 |
| --- | --- | --- |
| 目录 | `mods.list`、`mods.explain` | 实际加载模组，分页最多 24 项；区分内容模组、专用扩展与依赖库，明确未安装或未验收玩法。 |
| 殖民地 | `colony.capabilities/status/management/resources` 及目录中的建城、工单、供料、研究和居民管理操作 | 原生拥有者/成员权限、真实工单、真实库存；不是瞬间造房。 |
| 建筑切割 | `domum.state/choices/select` | 同一身体打开的原生切割台，选择前校验窗口、完整材料组件、游标和结果；产物通过正常槽位取出。 |
| 机械动力 | `create.settings/fluids/setValue/setFilter` | 本人近处可见机器、真实手持物和原生可编辑条件；数值/过滤器带前置状态校验。 |
| 饰品 | `curios.state/open/page` | 读取实际饰品槽、打开原生菜单；装备还需通过正常槽位移动。 |
| 铁魔法 | `iron.list/status/cast/cancel` | 从本人实际装备的书、装备或手持卷轴选择法术，沿用原生法力、冷却、施法时间和消耗。开始施法不等于命中目标。 |
| 原生菜单 | `menu.snapshot/button/nativeClick/close` | 实际窗口类型、槽位、原生进度、完整 ItemStack SNBT、游标、本人装备与魔力；写入可带 `expectedControlHash` 校验完整组件。 |

官方 Lua 入口继续存在，新增 `maw.mods.list` 和 `maw.mods.explain`。当前合计 70 项注册函数，其中 63 项可纯服务端调用；需要客户端的原有 7 项不被伪装成可用。可先执行：

```lua
local page = maw.mods.list({offset=0, limit=12})
for _, mod in ipairs(page.mods) do print(mod.id, mod.support) end
print(maw.mods.explain("minecolonies"))
```

农业、烹饪、背包、抽屉、仓储等优先使用原生通用接口：`numen.inv.recipes`、`numen.use.block/item/entity`、`numen.gui.view/move/quick`、`numen.build.place`、`numen.work.dig`、`numen.scan.container`。必须先读实际签名和窗口槽位，不能套用原版物品 ID 或猜测槽号。

官方车万女仆联动仍提供 `tlm.maid.list/info/task/config/open` 和祭坛配方等接口；具体前提按真实女仆所有权与原生任务规则执行。Smart NPC 模型对话需要它自己的模型配置。Waystones 专用传送按钮、移动列车/飞机驾驶和所有机器的完整生产链尚未全部验收，目录会提示这些边界。

## 殖民地最短建造流程

先 `colony.capabilities` 获取本服原生蓝图及出生距离规则；在合适地形准备真实小屋方块和材料。当前专用建造接口支持 Original 风格的 1 级城镇中心、建筑工、住宅、农场、仓库、铁匠、厨师、快递员和大学。

`colony.found` 创建实际拥有的城镇；`colony.placeBuilder` 放置并登记建筑工小屋。先让建筑工建造自己的 1 级小屋：`colony.requestBuild` 中 `buildingPosition` 和 `builderPosition` 均填写该小屋的绝对坐标。原生居民领取工作后，通过 `colony.resources` 分页读取材料需求，再用 `colony.stockResource` 从本人真实背包供料，或按实际请求 token 交付材料。材料不凭空生成。

建筑工小屋达到 1 级后，才给住宅等其他建筑下工单。若过早提交，会返回 `build_builder_hut_first`、要求等级及 `nextAction`。需要考虑完整蓝图的占地和高差，不能只给小屋方块留一格空地。实测隔离服的紧凑小屋位置只是接口夹具，不能复制为城镇布局。

`inventorySlot` 的命名空间是 `player_inventory_0_40`，其中供料只接受原生普通背包 0–35。`expectedSnbt` 必须来自最新本人库存，包含数量及完整组件。收到 `stock_outcome_unknown_check_inventory` 时停止重复供料，查原动作和实际库存；不能换新 ID 继续扣料。

## 已验证的范围

普通非 OP Numen 身体使用明确披露的隔离夹具，已完成真实建城、登记建筑工和住宅、暂停及重新分配原生居民、建筑工自建工单、原生材料需求、实际供料和同 ID 去重。重启后身体 UUID、全部 ItemStack 组件和旧动作回执保持。

另外实际打开 Curios 菜单；打开精妙背包、存取真实物品；读取并使用原生火焰弹卷轴且正常消耗；把 Create 转速控制器从 16 改为 32；在 Domum 切割台投入真实材料，选择原生变体并取出带材质组件的建筑块。前次已验证的农夫乐事烹饪锅、机械挖放和手摇曲柄继续复用官方 Lua。

这些是原生操作闭环，不是大模型自主完成整个殖民地或全部模组内容的证明。完整房屋竣工、仓库物流跨天运营、全部法术效果与复杂载具需要后续任务验收。网页和基岩资源映射也须独立验收，不能由服务端操作成功推断模型、动画及全部 GUI 已经一致。

## 构建与维护

`tools/build_numen_mods.py --root <包含 server/mods 与 server/libraries 的构建根目录>` 只构建，不部署。编译使用匹配的官方 Numen 和目标模组 JAR；产物及记录放在 `build/numen-mods`。构建记录固定官方核心/API 摘要，并记录全部新源文件和复用的共享实现摘要。没有修改官方 Numen 源码。

殖民地、Domum、机械和铁魔法处理逻辑在构建时复用既有共享源码；仅重定位到独立扩展包，不打包旧入口类。未来修改共享实现必须重建并重新验证。测试入口为 `tools/test_build_numen_mods.py`，另有锁定模组 API 的殖民地和 Domum 审计测试。

安装或升级走正常无人维护、E/F 双盘冷备、版本锁、原 owner/watchdog 启动与健康/冒烟检查。新增内容模组后必须重导原生表并更新 Mineflayer、网页和基岩资源，不能沿用旧编号。不得在 owner 运行时替换它的模组、配置或冻结网关。世界、玩家数据、凭据、JAR、原素材和完整运行日志不进 Git。
