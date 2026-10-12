# My Agent World 魔法小镇接入与维护

Wandscape 为玩家和 Agent 提供原生法师居民、建筑施工、城镇经验和材料仓库。本次已接入服务端桥、Mineflayer SDK、Numen 身体及基岩城镇菜单，并在独立存档完成联机验证。**当前为待发布候选；正式服尚未安装 Wandscape。** 网页实际 WebGL 画面验收完成后，才能更新正式服的模组、注册表、资源包和 SDK。

## 版本与依赖

目标环境为 Minecraft 1.21.1、NeoForge 21.1.248、Java 21。使用 [Wandscape 2.1.3-1211 正式发布文件](https://www.curseforge.com/minecraft/mc-mods/wandscape/files/8963734)，来源代码为 [a93cca08452f16b1100a0328cdc0962aa708c05b](https://github.com/CheesePaste/Wandscape/tree/a93cca08452f16b1100a0328cdc0962aa708c05b)，许可证 MIT。完整下载地址、大小和 SHA-256 在 [版本锁](../manifests/wandscape-1.21.1.lock.json)；不使用上游尚未发布的开发版本。

桥接依赖是可选的：没有安装该版本时，远端不声明对应可用操作；调用会明确失败，不阻止其他玩法。原生 NeoForge Java 客户端需要配套模组。Mineflayer 和基岩客户端使用已有兼容网关，不安装 Java 模组；基岩会下载服务端适配资源包。

## 玩家入口

执行 `/mycli town`，或在命格书／`/mycli rpg` 菜单点击“魔法小镇”。菜单使用原版箱子窗口，可以用基岩手柄操作。

1. 在允许建设的主世界区域选好市政厅锚点，查看蓝图占地与旋转后确认。系统不清空整个场地，法师通过模组原有任务逐块施工。
2. 在“小镇建筑”查看实际完工状态；再选择蓝图扩建，或到已完工酒馆附近招募法师。初始三位法师、建筑首建优惠、解锁和元素费用遵循原模组。
3. 在自己已完工的市政厅锚点 8 格内打开仓库，存取主背包物资；在法师菜单选择均衡、进攻、支援或防御策略。策略不凭空教授新魔法。

仓库菜单中的物品是操作按钮。存入会再次核对本人的真实物品和完整组件，取出进入主背包；绑定道具不能存走，背包满时不丢到地上。原生操作拒绝时显示失败，不提示“施工成功”。

## Agent 原生操作

先查询实际远端 capabilities；本地目录中存在操作不代表运行服已经安装。沿用 [原生 SDK](MY-AGENT-WORLD-NATIVE-SDK.md) 的本人连接、控制器、持久账本、异步回执和重连防重规则。

| 操作 | 参数 | 行为 |
| --- | --- | --- |
| `wandscape.state` | 无 | 本人小镇、等级经验、法师、建筑进度、元素与物品仓储 |
| `wandscape.catalog` | 可选 `offset`、`limit`，每页最多 24 项 | 实际蓝图、中文名称、解锁、占地偏移及策略预设 |
| `wandscape.found` | `position`、`name`、`rotationSteps` | 创建本人小镇；已有小镇返回原身份 |
| `wandscape.build` | `position`、`typeId`、`rotationSteps` | 按原生蓝图、解锁和材料规则排入施工任务 |
| `wandscape.recruit` | `position`，本人酒馆锚点 | 在已完工酒馆 8 格内按原生费用招募 |
| `wandscape.strategy` | `npcUuid`、`preset` | 修改本人法师的四种原生策略之一 |
| `wandscape.deposit` | `position`、`inventorySlot`、`expectedSnbt`、`quantity` | 将本人主背包中核对过的物品存入原生仓库 |
| `wandscape.withdraw` | `position`、`itemSnbt`、`expectedAvailable`、`quantity` | 按最新仓库记录取出真实物品 |

`position` 是主世界绝对坐标；`rotationSteps` 为 0–3，分别旋转 0、90、180、270 度。只有 catalog 的 `footprint.minOffset/maxOffset` 是明确标注的蓝图局部偏移，不是行走目标。建造锚点距本人最多 48 格，完整占地体积最多 32768 格，必须已加载并通过建设和破坏保护查询。

`inventorySlot` 为原生主背包槽 0–35；不要套用客户端窗口槽号。`expectedSnbt` 来自最新本人 `menu.snapshot` 的原生库存；`itemSnbt` 和 `expectedAvailable` 来自最新 `wandscape.state.warehouse`，每次转移 1–64 件。保留完整组件，不自行拼造 SNBT。

```js
const town = await sdk.read('wandscape.state')
const catalog = await sdk.read('wandscape.catalog', {offset: 0, limit: 24})
// 建筑 ID、锚点及前置条件须来自 catalog、本人状态和实际地形。
const action = {
  action_id: 'my-controller-build-001',
  operation: 'wandscape.build',
  args: {typeId: chosenBlueprint.id, position: surveyedAnchor, rotationSteps: 0}
}
const accepted = sdk.submit(action)
const receipt = await sdk.wait(action.action_id, {timeoutMs: 25000})
// 只有 outcomeKnown 且 ok 时才检查 receipt.result?.state?.applied；unknown 不自动重发。
// phase=queued / constructionComplete=false 只表示施工任务已入队。
// 后续读取 wandscape.state.buildings 核对 intact、queuedTasks、currentTaskId。
```

Numen 使用现有私有 provider 的 `mod_query`／`mod_action`，填写所拥有身体的 `companion`，写操作携带当前 `lease_id` 和唯一 `action_id`。operation 和 arguments 与上表一致。真人菜单也可经 `rpg.open {menu:"town",page:1}`、`menu.snapshot`、带槽位与组件核对的 `menu.pickup` 操作。同一身体只允许一个控制器，观战不领取控制权。

状态附 `bodyId`、`sampledAt` 和维度。建筑、法师、仓库每类最多返回 32 项；超限标记相应 `*Truncated`，过大的物品组件返回 `itemSnbt=null` 和 `componentDataOmitted=true`，不得据此推断仓库为空或伪造存取参数。

## 显示与已验证范围

网页适配使用原版 Humanoid 与上游 WizardHatModel 的几何、UV、22 张原始 PNG 和实际实体元数据，包含 21 款法师皮肤、染色帽子和已实现的施法姿态。共享源码和素材位于 `mc-visual-console/packages/modern-viewer`，原始资源和 MIT 许可随源码提交。基岩资源包同样保留原始纹理与三层几何，原有女仆和 YSM 资源继续保留。

基岩显示载体只改变翻译侧实体表示，保留原 UUID、实体 ID、移动与服务器 AI。Wandscape 使用不会占用帽色字段的铁傀儡协议载体，避免 ViaVersion 的盔甲架头部姿态覆盖 RGB；不会在服务器生成一个替代铁傀儡。

隔离服已实测普通玩家建镇、三位原生法师施工完工、酒馆招募、仓库存取和库存变化、本人权限、重复动作防重、中文菜单，以及 Numen 原 UUID 和历史动作在重启后的恢复。真实基岩 UDP 连接验证六个资源包完整下载、法师换肤染色、元数据更新后帽色保持、移动及原生箱子菜单。网页 HTTP 层验证本人 Numen 身体、真实原生包、区块和原始 PNG 的同连接下发。

**尚未验收：实际浏览器 WebGL 场景、与配套 Java 客户端的像素对照，以及手机上的最终显示。** 完整动画时钟、特殊装备渲染和全部模组玩法没有宣称完成，`completeRendererParityVerified` 保持 false。上游当前 `MagicApi.cast` 与道路 API 部分入口是未实现桩，本桥未将它们伪装成可用能力。

## 发布与回退

`python tools/maw_wandscape.py plan` 查看锁定版本与八项接口；发布完成后运行 `python tools/maw_wandscape.py health --root <运行目录>`，核对已安装字节、编译桥、注册表、资源包和守护健康。health 是只读检查，不建镇、不调用模型。

发布须在独立世界完成验收后，确认无人游玩并正常停服，制作含存档、playerdata、配置、Numen 身份与动作账本、模组和注册表的冷备份。不要重建现有世界。

安装锁定 JAR 和对应编译桥后，从实际完整模组集合重新导出注册表、idmap、components、粒子和实体序列化表；更新两个网关各自的旧知识缓存。主网关需声明 `maw_agent:scene_state,maw_agent:scene_subscribe`，已有模组与语音频道全部保留。重新导出网页资产，构建模型、图标及场景资源包，再更新 SDK 分发包与资产路径；不能只复制一个 JAR。

基岩生成顺序为 `maw_bedrock_resources.py` → `maw_bedrock_visuals.py`，部署最终 visuals 目录里的图标包与合同，以保留 Ars 法术书等专用物品模型；另用 `maw_bedrock_modpacks.py` 构建女仆、YSM 和 Wandscape 模型包。资源包版本须递增，使旧客户端重新下载。

回退需同时恢复模组、桥、注册表、网关缓存、资源和本次备份的世界状态；已经开始游玩的新城镇不能靠删除模组直接安全撤销。正式服原有 Agent 的暂停状态及未确认动作必须保留。
