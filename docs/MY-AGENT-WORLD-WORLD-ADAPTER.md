# My Agent World 统一身体接口

2026-10-11，`@my-agent-world/world-adapter` 0.2.1。上层 Agent 的规划、记忆、模型和调度保持原样，通过一套 JS 或 JSONL 接口选择 `mineflayer` 或 `numen` 身体。新增 19 项通用底层控制 API；参数和直接 HTTP 调用见 [控制 API 纯文本指南](MY-AGENT-WORLD-CONTROL-API.txt)。

源码：`world/src/world-adapter/`。可分发目录：`E:\QiandengJiSocietyLab\integrations\world-adapter\v3-rpg-20261012`；复制整个目录到 Agent 主机，用 Node 22 在该目录执行 `npm ci`。包附运行环境原始传递依赖锁，沿用锁定 Mineflayer / 协议依赖，不任意升级。新版包与原 Native SDK 包并存，不覆盖原 Agent 或其账本。

## 明确选择身体

| provider | 登录与身体 | 执行方式 | 恢复与账本 |
|---|---|---|---|
| mineflayer | `192.168.3.163:28977`，原账号、原 UUID；离线密码认证 | 复用现有 Native SDK、Mineflayer 物理和寻路、原生模组通道 | 同账号、同 expectedUuid、同一原 SDK ledgerDir 重新连接 |
| numen | `http://192.168.3.163:28984/numen/mcp`，本人令牌绑定已有 bodyId | 服务端 Numen 原生 Lua / 72 项同身体原生 API | 服务端原 UUID 存档与动作账本，加本机独立 shadow ledger |

每个实例固定 provider 和 bodyId。接口不会按名字寻找替身、自动创建身体、复制背包/技能、换 UUID 或回退另一种接入方式。新身体先按原 Numen 管理流程显式创建；统一层只接已登记的身体。跨 provider 切换是上层选择不同身体，**不是同一身体无损迁移**。

已有 Mineflayer 连接可 `withMineflayer(existingNativeSdk)` 包装；不再创建第二条连接或第二份 SDK。已有 Numen MCP 客户端可 `withNumen(client, binding)` 包装，它需要 `rpc(method,params)` 和 `call(tool,args)` 两个异步方法。

## 连接配置

Mineflayer 私有配置示例：

```json
{"provider":"mineflayer","host":"192.168.3.163","port":28977,"username":"MyAgent01","expectedUuid":"本人实际离线UUID","controllerId":"my-agent-controller","ledgerDir":"D:/my-agent/existing-native-ledger","loginFile":"D:/my-agent/private/game-login.json"}
```

`loginFile` 沿用已注册账号的私有 `username/playerUuid/password` 文件；自动登录只提交一次，不自动注册或覆盖密码。绑定 UUID 错误、未认证或桥不可用会结束连接，不继续动作。已有账号必须使用原受控账本目录，禁止换目录绕过 unknown。

Numen 私有配置示例：

```json
{"provider":"numen","credentialsFile":"D:/my-agent/private/numen.json","bodyId":"本人已有身体UUID","controllerId":"my-agent-controller","ledgerDir":"D:/my-agent/world-ledger"}
```

`credentialsFile` 是单独交付的 `endpoint/token/ownerUuid` JSON。文件路径和 ledgerDir 用绝对路径；token 不放进 URL、模型提示词、聊天或共享文档。HTTP 仅允许显式家庭网段/回环；远端公网须 HTTPS。不转发重定向，不自动重试超时请求。

## 同一套调用

```js
const { connect } = require('./world-adapter/index.cjs')
const config = require('D:/my-agent/private/world.json')
const world = await connect(config) // provider 明确；不调用模型、不自动控制
const catalog = world.operations()
const state = await world.snapshot()
const spec = await world.operations('body.move') // 参数、权限、available、回执约定

await world.claimControl() // Numen 明确申请租约；Mineflayer 复用现有排他 writer.lock
// target 必须来自本人实际观察；下例中的具体坐标由 Agent 选择。
const action = {action_id:'explore-001',operation:'body.move',args:{position:{x:100,y:64,z:100}}}
const accepted = await world.submit(action)
if (accepted.accepted) {
  const result = await world.wait(action.action_id,{timeoutMs:30000})
  // 检查 result.status/outcomeKnown，再核对 position；超时不重发、不自动取消。
}
await world.close()
```

共同方法：`identity`、`operations(id?)`、`capabilities`、`snapshot`、`read`、`submit`、`actionStatus`、`wait`、`cancel`、`stop`、`claimControl`、`releaseControl`、`restore`、`health`、`viewer`。返回值统一用 `await`。Numen 先列目录，再用 `await operations(id)` 按需获取一项实际参数并缓存；list 中 `parametersAvailable=false` 表示尚未查询签名。提交动作前也会核对真实 schema，避免每次重连批量查询耗尽限流。Numen 另有 `luaOperations(group?)` 查询原生 71 函数的分组/签名，以及 `numen.lua` 动作执行代码。

公共操作有 `body.identity`、`body.snapshot`、`body.move`。移动使用整数绝对方块坐标，目标最多距当前身体 16 格，禁止自动挖路/搭桥；Numen 生成固定原生路线代码，Mineflayer 使用原寻路器，按真实终点核验。`wait` 的期限只是等待期限，不承诺停止原动作。

模组 API 共用服务端处理器，但两条路线的完整目录和部分参数不同，**须以当前 provider 的 operations 为准**。例如 `curios.open` 两边都接受空参数；Numen 用 `menu.snapshot`/`menu.pickup` 和完整窗口/组件 CAS，Mineflayer 原入口为 `menu.current`/`menu.click`；Numen `menu.close` 必须传实时 windowId/expectedStateId，Mineflayer `menu.close` 使用空参数。不要只凭操作名猜等价性。

本版 Mineflayer 目录 94 项；Numen 目录 77 项（72 原生 + 3 公共 + Lua + 1 明确不可用占位），可用 76 项。新增 19 项共同底层控制，包含有界按键、角度、左右键、战斗、物品、完整菜单操作和本人权限的游戏命令；Numen 使用当前官方 Controls/Physics，持续操作逐 tick 执行，成功或取消后释放，不阻塞 HTTP。Numen 的公共 `body.observe` 尚未映射，返回 unavailable；其周边扫描/采集/合成等通过发现后的原生 Lua 能力使用。没有把 Mineflayer 寻路器直接装进 Numen 身体，也不声明全模组、长期自主生活已经验收。

## 真实状态与动作对账

`snapshot` 始终带 provider、bodyKind、bodyId、ownerUuid、controllerId、采集时间、存活状态、绝对 position、dimension、血量、饥饿、原生魔力（无法读取为 null）、装备、菜单及库存。当前 Numen 宿主在同一服务器 tick 读取身体、原生菜单和魔力，标为 `sampling=same_server_tick` 并附 `capturedTick`；一次 HTTP 请求即可获取。终态回执保留实际完成时的同类快照，SDK 从中核对库存变化。连接旧宿主时才回退到分别读取，明确标为 `separate_body_menu_and_mana_reads`。

共同库存是 `inventory.slotNamespace=player_menu_46`，与现有 Native SDK 一致，排除 0 号合成预览；物品保留完整 snbt，快捷栏是 36–44。Numen 原生 Java Inventory 的 0–40 索引不会被混成这套槽位。殖民地供料等接口自己的 `inventorySlot` 仍按该接口 schema 解释。菜单槽号和玩家背包槽号不可混用。

公共 `action_id` 限 1–64 个英文字母、数字、点、下划线、连字符。终态为 succeeded/failed/cancelled/unknown。相同 ID、相同参数只查询原结果；改参数拒绝。Numen 本机意图先 fsync，再提交服务器持久去重接口；网络超时保留 unresolved，重连只查询原 ID，拿到可信终态才能解除该项阻塞。没有结果不等于没执行；不要丢掉账本、换 UUID 或另造 ID重做。

Numen `claimControl` 不调整权限：独立行动须由本人/服主在原界面显式启用，仍不授 OP。服务端租约约 90 秒；需要更长控制时本人显式再次 claim，adapter 不启动无限心跳。未结算动作会阻止 release；同一身体每次只有一个控制器。`close` 对 Numen 只关闭本机适配器，不杀身体、不取消已接受动作、不删除账本；下一次重连使用同目录查询。Mineflayer close 则正常结束自己拥有的登录连接。

`restore()` 仅 Numen 支持，必须持有效租约、无未知动作，恢复原 bodyId；Mineflayer 返回明确不可用。网页入口通过 `viewer()` 取得，只读，不拿控制租约。Numen 自动给出 `/numen/view/` 的本人令牌入口；Mineflayer 只返回调用方显式配置的已有 `viewerUrl`，不会把其他账号画面当本账号。

## Python / 其它 Agent 框架

```text
node world-adapter/stdio.cjs D:/my-agent/private/world.json
```

stdin/stdout 为私有 UTF-8 JSONL；先等 `world_adapter_ready`。请求示例：

```json
{"request_id":"q1","method":"operations","operation":"body.move"}
{"request_id":"q2","method":"snapshot"}
{"request_id":"q3","method":"claim"}
{"request_id":"q4","method":"submit","action_id":"explore-001","operation":"body.move","args":{"position":{"x":100,"y":64,"z":100}}}
{"request_id":"q5","method":"result","action_id":"explore-001"}
{"request_id":"q6","method":"viewer"}
{"request_id":"q7","method":"close"}
```

还支持 identity/capabilities/read/wait/cancel/stop/release/restore/luaOperations/health。外层 ok 表示 IPC 方法成功，游戏结果看 result 内字段。父 Agent 监督自己的子进程，不加新服务器守护、不接 QwenPaw、不启动模型调用。

## 部署、验收与维护

2026-10-11 完整控制增量已部署：Native SDK 0.3.1 和统一层 0.2.0 各 35 个受管文件，均附锁文件、91 个依赖及纯文本控制指南。498 项 Node 测试、25 项 Python 测试（包含锁定 JAR 的 39 项原生参数断言）、完整 30 模组隔离服 143 项检查通过；实际验证两种身体的角度、组合按键、释放、取消、跳跃、原生挖掘、Shift/数字键菜单操作、主副手交换和拉弓只消耗一支箭，以及真正重启后的原 ID 去重。正式 LAN 分发包 17 项只读检查通过。没有付费模型调用。

本次正常停服、三维存档后冷备 1144 文件、288471587 字节，全部 CRC/SHA 校验通过；仅替换自有 bridge/Numen 宿主两个 JAR，原 28 个其它 JAR、存档、认证凭据、基岩模型、旧 SDK 和 MawExplorer 人工暂停保留。主服务由原守护恢复，基岩守护没有重启。备份 `backups/full-control-api-20261011`；私有证据 `research/full-control-api-20261011`，失败 QA 也保留。维护已结束，不能重放部署/固定验收动作。

SDK 9 项、统一层 8 项、Numen 宿主 15 项健康检查通过，基岩/观战/认证冒烟通过。主服务的 Java、网关、worker 与本人原生流均正常；综合 `--society` 中 `autonomy-active=false` 是原人工暂停，仍按原样报告，不能为消除红项唤醒 Agent 或重投旧 unknown。

2026-10-11 首版已安装：33 个受管文件及原锁 91 个依赖包；不依赖全局 NODE_PATH 即可读取正式服。36 项 Node 单测、完整 30 模组隔离服 115 项检查通过，两条路线均实际步行、开关 Curios 菜单、重启后查原 action_id 且不重复执行。正式服分发包 11 项只读验收、8 项接入健康检查通过，未申请正式 Numen 身体控制或唤醒休眠身体，付费模型调用 0。

正式主服务和基岩服务保持原 runId，30 个 JAR、保护配置、凭据、模型资源、原 SDK 及 MawExplorer 人工暂停保持；其动作账本原前缀完整。20:45–20:46 巡检发现原暂停角色被僵尸击杀 4 次并由原循环重生，新增仅 death/spawn 记录，未派发新动作或重放旧 unknown；该既有游玩风险保留在私有运行证据中，未以改账本掩盖。

安装：`python tools/install_maw_world_adapter.py --destination E:/QiandengJiSocietyLab/integrations/world-adapter/v3-rpg-20261012`，只允许新的受管目录，或安装记录所属且全部 SHA 校验通过的原目录；拒绝覆盖外部改动，保留旧 SDK。健康：`python world/ops/health/health_mon.py --society-world-adapter-smoke`，验证包/源码 SHA、已同步文档、两个入口和现有 supervisor；不会登录、申请控制、唤醒身体或调用模型。

实机工具 `tools/smoke_maw_world_adapter.cjs` 只对专用 QA 账号：查询 → 原生库存 → 短步行 → 实际位置 → Curios 开关 → 同 ID去重 → 正常关闭 → JSONL 原生读取/关闭。`smoke_numen_server.py --full-pack --mixauth-jar <官方已校验JAR> --world-adapter ...` 在独立存档和端口测试两条路线，并重启后再次对账。不得对正在被其他控制器使用的生产账号重跑；付费模型调用为 0。

原千灯纪 world_adapter.py / numen_gateway.py 的规划、记忆与技能可以在 Agent 侧逐项映射到此接口；本版未改旧 Agent 的身份、记忆存档和自主循环。

2026-10-12 新增公会/委托/市场：society.state、society.join、society.accept、society.submit、society.open。先读本人真实状态，再用唯一 action_id 执行；完整玩法与维护见 MY-AGENT-WORLD-RPG-CONTENT.txt。
