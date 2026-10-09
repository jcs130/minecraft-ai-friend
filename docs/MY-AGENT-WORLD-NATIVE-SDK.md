# 旧千灯纪接入 My Agent World 原生身体 SDK

基线：`jcs130/minecraft-ai-friend` 的 `main@5cee660` 是旧 Agent 参考；新服代码继续在 `experiment/agent-society-1.21.1`。Minecraft 1.21.1 / NeoForge 21.1.248，模型、规划、记忆和技能程序仍在接入方运行。

## 身体和连接

Agent 入口：`192.168.3.163:28977`，Java 协议 1.21.1、当前家庭局域网离线账号登录。每个 Agent 使用独立且固定的用户名。SDK 控制该连接的真实玩家，`bodyId=playerUuid`，不是按名字遥控别的身体，也不是 Numen 假玩家。

Numen 核心已安装，但本 SDK **尚不支持 Numen 假玩家控制和 `numen_restore_existing`**。远端 capabilities 明确返回这两项 false。原 Numen UUID、背包、技能、经验不能仅靠新用户名自动迁移；需要同身份假玩家时，另接 Numen provider 并验证原 UUID/owner/name 恢复，不能直接套用普通玩家登录。

2026-10-09 增加独立的官方 Numen 0.1.4.1 / 主人客户端 MCP 路线和服主 Lua/恢复桥，见 [Numen 接入](MY-AGENT-WORLD-NUMEN.md)。本 SDK 的连接玩家身份及上述 false 不变；不要把新 provider 的能力误读成本 SDK 已控制假玩家。

Node 22，锁定 Mineflayer 4.37.1、minecraft-protocol 1.66.2、minecraft-data 3.112.0、mineflayer-pathfinder 2.4.5、vec3 0.2.0。完整依赖及 overrides 在 SDK 包的 package.json。首次安装用该目录运行 `npm install`；不要用任意最新版替换协议依赖。

源码入口：`world/src/native-sdk/index.cjs`。本机可分发包：`E:\QiandengJiSocietyLab\integrations\native-sdk\v1-20261009`，附 operations.json、连接 TXT、本文及原 MIT LICENSE，共29文件。第三方使用该目录的副本和自己的本地 ledgerDir，不挂载服务端世界目录。

```js
const mineflayer = require('mineflayer')
const { attachNativeBody } = require('./native-sdk/index.cjs')
const bot = mineflayer.createBot({host:'192.168.3.163',port:28977,
  username:'MyAgent01',version:'1.21.1',auth:'offline'})
// 立即挂接，在 spawn 前接收原生菜单/模组回包。
const sdk = attachNativeBody(bot, {controllerId:'my-agent-controller',
  ledgerDir:'D:/my-agent/native-ledger'})
bot.once('spawn', async () => {
  const remote = await sdk.capabilities()
  const catalog = sdk.operations()
  const state = await sdk.snapshot()
  // 按真实地形选择附近可走位置，所有坐标都是绝对坐标。
})
```

同一连接只允许一个 SDK 控制器；每账号的持久账本有排他 writer.lock。同一账号只能使用同一份受控账本，不得通过更换 ledgerDir 绕过未知结果。Minecraft 登录连接并不构成跨主机身份授权系统；不要在公网直接开放当前离线模式。

## operations、权限与状态

`await sdk.capabilities()` 查询实际远端桥，返回当前 bodyId、采集时间、桥协议、60 项原生绑定和假玩家支持标志。`sdk.operations()` 返回 **70 项**：原60项模组调用，加10项身体/控制入口；`sdk.operations('world.dig')` 返回一项完整 JSON schema、说明、权限、执行形式、调用方式和回执约定。目录存在和服务器声明绑定均不表示所有玩法已经验收，`allGameplayVerified` 保持 false。

新增入口：`sdk.capabilities`、`body.identity`、`body.snapshot`、`body.observe`、`body.move`、`inventory.equipSlot`、`inventory.use`、`action.status`、`action.cancel`、`body.stop`。动作状态、取消及停止使用专门方法；不能作为普通排队变更提交。

`await sdk.snapshot()` 是服务端采样：血量、饥饿、绝对位置、维度、完整原生库存 SNBT、装备、当前真实容器/菜单、已选快捷栏，附 bodyId/capturedAt/capturedTick。`currentAction` 来自本 SDK 的控制账本，不冒充服务器全局动作。明确区分 `status=alive/dead/offline/unavailable`；读取失败不是死亡或离线。原生 canonical 库存槽为46格，排除0号合成预览；容器打开时用 playerInventory，不套用箱子槽号。

`sdk.read('body.observe',{radius:8})` 只返回48条首命中射线中的可见方块和最多24个本连接已跟踪、同维度、可见实体，范围1–12格；原生类型与绝对坐标，`complete=false`。不扫描隐藏矿物，不保证覆盖整个球体。具体方块可用 `world.lookAt`/`collision.query`，实体详情用 `native.entity`。导航目前仍用 Mineflayer 物理和寻路；原生模组碰撞并未全面集成进寻路器。

查询用 `sdk.read(id,args)`；动作参数必须来自本人最近真实状态。普通玩家规则与原模组权限始终生效；女仆所有权、殖民地成员/管理权限、YSM授权均不能通过 SDK 绕过。

## 动作、取消与对账

```js
const request = {action_id:'turn-42-move-1', operation:'body.move',
  args:{position:{x:100,y:64,z:100}, timeoutMs:15000}}
const accepted = sdk.submit(request)       // 意图 fsync 后立即返回
const progress = sdk.actionStatus(request.action_id)
const terminal = await sdk.wait(request.action_id,{timeoutMs:25000})
// terminal.status: succeeded / failed / cancelled / unknown
// terminal.result: 实际回执、actualPosition、dimension、inventoryDelta
```

每个变更必须有唯一 action_id。耗时操作由 Node 异步执行，游戏服务端只处理有界原生请求，不在 tick 上等待寻路或模型。`wait` 超时只结束等待，动作仍可能在途；继续用原 ID 查询，禁止另造 ID 重试。

`sdk.cancel(action_id)` / `sdk.stop()` 停止寻路、按键、挖掘与使用物品并封住旧异步续段。尚未派发时可返回 known cancelled；已经消费、点击或挖掘后无法确定结果则为 unknown。取消不是回滚。成功的通用 `inventory.use` 仅表示使用包已发且完成观察，`effectVerified=false`，不能据此认定法术命中或加工完成。

重新用相同账号、expectedUuid 和 **同一 ledgerDir** 创建 SDK，可 `actionStatus(oldId)` 查原回执。相同 ID+相同操作/参数返回缓存 `replayed=true,dispatched=false`；相同 ID 改参数会冲突。只有 intent 或旧未知时继续返回 unknown，并阻断新变更；未找到也明确 unknown，不能推断未执行。账本去重在接入方本地，不是服务器全局 exactly-once；崩溃、丢账本、跨机双控制器不能获得不存在的保证。崩溃遗留锁需运维核验后处理，不自动删锁。操作员可以沿既有 NativeLedger 离线审计流程释放新动作，但原未知 ID 保持未知，不向 Agent 暴露清空接口。

## 首批能力与旧接口对照

| 旧接口/动作 | 新接口 | 边界 |
|---|---|---|
| snapshot / observe | body.snapshot / body.observe | 本人、采集时间、原生ID及组件 |
| goto / navigation_observation | body.move / body.observe / collision.query | 16格内已加载地形；不挖路搭桥 |
| stop / action_status | stop / cancel / actionStatus / wait | 查询原ID；未知不重投 |
| mine / place_block | world.dig / world.place | 完整方块属性、手持SNBT CAS；挖掉不等于拾取 |
| equip_item | inventory.equip / inventory.equipSlot / inventory.select | 主手/空护甲副手槽，现有装备不覆盖 |
| eat / use_item | inventory.food / inventory.consume / inventory.use | 一次进食真实核验；通用使用不伪造效果 |
| craft | native.recipes / native.craftRecipe / native.craft | 真实配方、当前2×2/工作台3×3和材料 |
| open_container / transfer_items | world.interact / menu.current / menu.click / menu.close | 真实菜单与光标，每次点击保留原生回执 |
| 魔法 | spell.list/explain/glyphs/learnGlyph/configure/select/cast | 当前 Ars Nouveau 原生书/符文；旧 /mycli 需另迁 |
| 女仆、机械、饰品、殖民地 | maid.* / create.* / curios.* / colony.* | 复用原生权限、资源消耗及回执 |
| Numen summon / restore | 未提供 | 不创建替代假玩家冒充原身体 |
| open_lease / close_lease | Agent侧调度适配 + SDK单动作所有权 | 不是旧Numen服务端租约的无损替代 |

旧 world_adapter.py / numen_gateway.py / motor_loop.py 的迁移由 Agent 端完成；本 SDK 不改其规划、记忆和技能内核。原 Numen39工具中的 drop、sleep、trade、攻击、远距导航、旧公会与旧 /mycli 等不能因为模组目录存在就假定有等价动作；先查具体 operation，缺项按新 provider/API 继续补。

## Python 等语言接入

`node native-sdk/stdio.cjs <private-config.json>` 提供一个由 Agent 父进程拥有的玩家连接。配置为 host、port、username、controllerId、绝对 ledgerDir，可选 expectedUuid。stdin/stdout 每行原始 UTF-8 JSON；输出只为父进程，不进入游戏聊天。

```json
{"request_id":"rpc-1","method":"operations","operation":"body.move"}
{"request_id":"rpc-2","method":"snapshot"}
{"request_id":"rpc-3","method":"submit","action_id":"turn-42-move-1","operation":"body.move","args":{"position":{"x":100,"y":64,"z":100}}}
{"request_id":"rpc-4","method":"result","action_id":"turn-42-move-1"}
```

响应为 `{request_id,ok,result}` 或 `{request_id,ok:false,error}`，连接事件另有 event 字段。RPC ok 只表示方法调用成功，游戏成败看 result。还支持 identity、capabilities、read、wait、cancel、stop、health、close。调用方按 request_id 收取响应，按 action_id 对账；父进程需正常关 stdin/发送close并监督此子进程。断线不会自动重登或重放，Agent按同身份账本显式接回。

## 维护与验收

`tools/install_maw_native_sdk.py` 从精确相对依赖生成可分发目录与SHA清单，不带世界、账户密钥、模型配置或第三方素材。`tools/smoke_maw_native_sdk.cjs` 使用独立普通账号，零模型、零OP、零管理员命令：实际远端 operations → 状态/附近观察 → 单次短步行 → 原生位置核对 → 正常离线重连 → 同ID缓存且账本无追加。隔离副本与正式入口结果分别记录，不混用。完整玩法、长期自主生存、Numen假玩家与旧技能记忆迁移需要后续独立验收。

2026-10-09 已发布桥 `b32a15cc6dafe8fb1b3eac12fce711331e2376cfced20f618109e466d904a477`，其余26个JAR、资源、世界进度和原Agent暂停/未知账本保留。87文件冷备CRC及逐SHA通过。隔离副本和正式LAN入口各8项闭环验收通过；正式普通QA身体UUID `d603b98d-15d8-3309-9d93-85217cf70fbb` 从(-421.5,63,403.5)步行到(-420.685,63,403.5)，重连后位置和原动作回执保持，同ID重提无账本追加。这个UUID仅为验收账号，不应配置给正式Agent。

Python经分发包JSONL入口实际登录、查询60项远端绑定/70项目录、本人原生库存和unknown回执，正常退出0；未调用模型或派发游戏变更。471项Node回归、11项Python/实际Java编译与审计通过，0失败0跳过。首次spawn前用户名缺失的SDK初始化失败及其QA连接强制清理、初次旧测试数量断言/环境加载失败均保留在本机证据，不能算作成功验收。有限生命周期监听预算已验证清理并恢复，正式复测无监听器警告。

服务端仍由原Windows supervisor守护，没有新增常驻模型/Agent服务。安装与面板冒烟：`python world/ops/health/health_mon.py --society-native-sdk-smoke`，范围为SDK文件SHA、70项契约、实际桥类和入口守护；不声称全模组玩法或自主Agent健康。私有完整回包和账本在 `E:\QiandengJiSocietyLab\research\native-sdk-integration-20261009`，不公开上传；隔离owner已正常shutdown，测试前的QA属性/mods已恢复。main维护stop/resume已完成，勿重放旧请求。
