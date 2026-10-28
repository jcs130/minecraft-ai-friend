# Tau 原生 Mineflayer 数据与菜单接口

这是普通 Mineflayer 登录身体的可选扩展，使用现有游戏连接，不新增公网端口、MCP 服务或推理循环。配套服务端组件 `maw_tau_native` 只安装在 NeoForge 服务端；真人客户端不需要安装它。账号仍须通过原有注册、登录和模组权限检查。Numen 常驻身体是另一种入口，本接口不会创建、代替或接管 Numen 身体。

## 接入

在账号已完成服务端认证后，给现有 `bot` 附加客户端：

```js
const { attachTauNativeClient } = require('@qiandengji/tau-native-client')
const native = attachTauNativeClient(bot)
const capabilities = await native.operations()
if (!capabilities.ok) throw new Error(capabilities.code)

const state = await native.snapshot()
// 这里是原始 ItemStack，不是网关的原版投影。
const held = state.menu.inventory[36 + state.menu.selectedHotbarSlot]
console.log(held?.id, held?.displayName, held?.componentsComplete)

const recipes = await native.recipes({ outputId: 'create:cogwheel', limit: 3 })
// status=partial 时保留 nextOffset，由当前任务决定是否续读。
// 不会自动把其余配方全部读完。
```

查询与普通 Mineflayer 能力可以同时使用；`bot.inventory`、方块注册表和原版投影不会被本模块篡改。判断模组物品请使用原生 `id`、名称、组件和指纹，不能把投影的 `stone_bricks` 当作物品真实身份。`descriptionId` 和名称组件供本地语言包或界面使用，本接口不伪造中文翻译。

`operations.json` 是说明、参数 schema、示例和服务端校验的共同定义。`operations()` 返回的是该连接实际收到的服务端能力；没有回执时返回 unavailable，不能把本地定义当作已安装能力。当前八项为：

| 操作 | 用途 |
| --- | --- |
| native.capabilities | 已安装的操作、参数和预算 |
| body.snapshot | 本人绝对位置、生命、饥饿、装备、原生背包与当前菜单 |
| inventory.inspect | 玩家物品栏菜单 0–45 的指定槽，快捷栏首格为 36 |
| native.recipes | 服务端 RecipeManager 的原始 ID、材料选择及分页 |
| menu.current | 真实菜单类型、槽位归属、原生物品、光标和可读取进度值 |
| menu.click | 带完整前置条件的一次原生左键／右键 PICKUP |
| menu.close | 关闭真实模组菜单，保留 requestId 对账和原生光标清理 |
| control.actionStatus | 只查询原 requestId，不重放动作 |

配方定义读取覆盖标准工作台／炉类、农夫乐事厨锅／砧板和已接的 Create 加工定义。没有接通语义的配方明确返回 definitionAvailable=false。查到配方不等于能自动完成整个机器生产流程。魔力、殖民地管理、女仆专用按钮、流体和复杂机器网络不在本批八项操作中；缺失状态明确为 null 或 unsupported。

部分模组的配方必须有运行上下文才能读取输出。本组件会保留其他有效配方，并用 `unreadableRecipeCount`、`filterCoverageComplete:false`、`matchedCountIsLowerBound:true` 标明查询覆盖缺口；不能把未读到的部分解释为没有配方。构建时通过上级 `recipe_catalog_patch.py` 对固定源码作有锚点校验的兼容修改，记录补丁哈希，不修改原共享仓库。

`remainingCount` 只计算已匹配集合的剩余项；覆盖不完整时不包含那些输出未知的配方，不能据此断言已经读完所有可能匹配项。

## 原生菜单动作

先通过普通 Mineflayer 的实际交互打开附近容器，再读取原生菜单。只有调用方的**同一个身体执行队列**可以提交点击；不要让脚本、旧菜单适配器、自动整理和第二个控制器同时写同一个菜单。

```js
await native.read('menu.current')
// 在现有执行器已拥有身体的任务中执行并 await：
const result = await native.click({ slot: 0, button: 0, requestId: taskId + ':pick:1' })
if (result.outcomeUnknown) {
  // 保存 requestId 和 serverEpoch，暂停后续写入。
  const receipt = await native.actionStatus(result.requestId, result.serverEpoch)
  // 找不到回执仍为 unknown，不能换新 ID 重试原动作。
}
// 对模组菜单使用原生窗口 ID，不依赖 bot.currentWindow 是否存在。
const menu = native.currentMenu()
const closed = await native.call('menu.close', {
  windowId: menu.windowId, expectedStateId: menu.stateId, expectedServerEpoch: menu.serverEpoch
}, { requestId: taskId + ':close:1' })
```

`click` 根据最近原生菜单生成完整 CAS：窗口、stateId、槽位原生 ID／数量／完整 SNBT、光标 SNBT 和服务器代次。菜单超过两秒未更新时会先做一次只读查询。组件不完整时禁止构造空物品或猜测组件。槽位变化、窗口关闭、死亡、原生权限拒绝等返回明确业务回执；未知结果使用 `changed:null`，不能说成没有变化。

同 ID 同参数在客户端和服务端保留期内返回原回执，不再点击；同 ID 不同参数拒绝。服务端按本人 UUID 缓存最多 128 项、五分钟，跨连接可对账，跨 JVM 重启或过期明确未知。这不是永久去重账本。运行时须持久保存未对账 requestId／serverEpoch；重启客户端不会自动恢复这份运行时数据。

点击已完成和生产目标已完成分别判断。例如 1.21.1 的工作台结果槽可能在下一次服务端更新中才出现；收到放入材料的回执后，应等待原生菜单更新或再读一次 `menu.current`，核验结果与实际材料消耗。不要因即时结果槽暂空而重复放入材料，也不要仅凭一次点击回执宣称已制作出物品。

## 协议、预算和生命周期

- JSON 原始 UTF-8：请求 `maw_agent:world_query`，回执 `maw_agent:world_state`；菜单动作 `maw_agent:menu_action`，状态／回执 `maw_agent:menu_state`。不写入聊天，也不向其他玩家广播。
- 读请求最多 4096 字节、动作 32768 字节、状态 65536 字节；单个物品 SNBT 最多 4096 UTF-8 字节。超限组件保留身份与指纹，显式标记不完整，不映射为空气。
- 配方默认六项，最多十二项，有 offset／nextOffset、matchedCount、returnedCount、remainingCount。各页有自己的 capturedAt／capturedTick。
- 所有位置是指定 dimension 中的绝对世界方块坐标；小数位置单位为格。bodyId 为当前连接的本人 UUID，serverEpoch 每 JVM 改变。
- 每玩家只读查询间隔至少 100ms（单调时钟）；客户端默认串行间隔 110ms。服务端执行仍在主线程；慢 tick 不改变契约中的毫秒预算。限流返回实际剩余 retryAfterMs，不自动重试。
- 收到已认证查询才订阅原生菜单，每十 tick 检查一次，菜单内容变化才推送。移动和时间字段不会单独触发整包菜单刷新。
- `native.onMenu(handler)` 可接界面；`currentMenu()` 是已观测快照，不是实时保证。超大菜单明示不可用并使旧槽位失效。
- 断线／死亡会结束等待并使菜单缓存失效；没有确认的写入仍需对账。连接销毁时调用 `detach()`，不关闭宿主 bot，不改变外部监听预算。

旧 `maw_agent` 频道名保留，但旧菜单客户端如果只接受 `changed:boolean`，无法正确处理未知回执，必须升级到本客户端。不要同时安装两个原生菜单写入客户端。

## 构建与验证

从本目录上级运行 `build_native_bridge.py --source <干净的固定共享源码> --server <服务端> --java <Java21> --output <全新输出目录>`。脚本只生成新产物，校验固定 NeoForge 依赖并记录自身源码、复用配方源码、编译依赖与产物哈希，不安装或重启服务器。固定共享源码为 `78ec7abb4745f0f5e4a840af03a2fbe3166265cc`；不合入旧服的整个 AgentBridge。

客户端回归：`node --test native-client.test.cjs`。纯 Java 策略回归：将 `NativePolicy.java` 和 `tests/NativePolicyTest.java` 使用 Gson 2.10.1 编译，运行主类并传入 `operations.json`。真实联机结果及部署状态见上级 `NATIVE_PLAYER_VALIDATION.md`；源码、编译或测试包不代表正式服已更新。
