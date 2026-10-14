# My Agent World 真实客户端接入

客户端桥 0.1.0 支持 Minecraft 1.21.1、NeoForge 21.1.248 和 Java 21。它控制启动器中已经登录的真实玩家，通过本机 SDK 读取状态和操作游戏。接入不需要服务器安装桥接模组，也不注册游戏自定义频道。

客户端仍需满足目标服务器的版本、整合包、账号和自动化规则。服务端未同步的机器内部数据、隐藏任务或保护规则无法由客户端桥直接查询；可通过真实界面、服务器命令或后续模组适配获取。

## 安装与连接

把 `maw-client-bridge-0.1.0-neoforge-1.21.1.jar` 放进客户端整合包的 `mods`，通过正常启动器进入服务器。正版账号沿用启动器的官方认证；离线账号沿用目标服务器的登录方式。桥不会读取启动器令牌或创建另一个玩家。

客户端启动后，在游戏目录生成 `maw-client-bridge/connection.json`。文件含随机回环地址、令牌和本次客户端实例 ID，只交给本机 Agent。游戏服务器可以在远方；控制接口目前仅绑定本机 `127.0.0.1`，无需新增防火墙规则或公网端口。

SDK 配置示例，UUID、服务器地址与用户名必须对应已经登录的玩家：

```json
{
  "provider": "java-client",
  "username": "MyAgent01",
  "expectedUuid": "该玩家的真实UUID",
  "expectedServer": "目标服务器地址:端口",
  "controllerId": "my-agent-controller",
  "credentialsFile": "D:/Minecraft/MyPack/maw-client-bridge/connection.json",
  "ledgerDir": "D:/MyAgent/client-action-ledger"
}
```

`expectedServer` 必须与 `snapshot().server` 返回的连接地址相同。外部框架的模型、规划和记忆保持原样，通过统一身体接口选择 `java-client`：

```js
const { connect } = require('./world-adapter/index.cjs')
const world = await connect(require('D:/MyAgent/client-private.json'))
try {
  const state = await world.snapshot()
  const spec = world.operations('control.keys')
  const lease = await world.claimControl()
  if (!lease.ok) throw Error(lease.code)
  const action = { action_id: 'walk-001', operation: 'control.keys',
    args: { controls: { forward: true }, ticks: 6 } }
  const accepted = await world.submit(action)
  if (accepted.accepted) {
    const result = await world.wait(action.action_id, { timeoutMs: 10000 })
    // 检查终态与 actualPosition，再查询世界状态判断目标是否完成。
  }
} finally {
  await world.close()
}
```

关闭 SDK 会停止本控制器输入并释放租约，保留真实客户端、玩家和动作账本。F8 暂停 Agent 控制并释放按键，再按一次允许重新申请控制。租约为 90 秒，长任务需要显式 `claimControl()` 续租，SDK 不运行隐藏续租循环。

## 能力与回执

23 项操作可通过 `operations()` 与 `operations(id)` 查询真实参数。

| 类别 | 操作 |
|---|---|
| 感知 | body.identity、body.snapshot、body.observe、world.blockAt |
| 菜单与消息 | menu.current、screen.current、chat.recent |
| 移动与视角 | control.keys、control.look、body.move |
| 背包 | inventory.selectHotbar、menu.openInventory、menu.close、menu.click |
| 模组界面 | screen.click、screen.key、screen.type |
| 原生操作 | world.dig、world.useBlock、world.useItem、world.attack、chat.send |
| 画面 | screen.capture |

`snapshot` 包括本人 UUID、连接 ID、采集时间与客户端 tick、绝对坐标、维度、生命、饥饿、经验、装备和完整物品 SNBT。标准背包用 `player_menu_46` 槽位，快捷栏为 36–44；实际模组容器另用其真实窗口槽号，附 `owner/inventoryIndex`。未适配的模组魔力字段为 `null`。

物品 `id` 保留真实类型，`name` 是客户端实际显示名；简略 Agent 感知也保留显示名。旧 Paper 的 Minepacks 背包入口本来就是带 `custom_name/profile` 的 `minecraft:player_head`，纹理决定其背包图案，不应伪造一个新物品 ID。隔离验证已核对旧图标的 180 字节纹理值存在并显示蓝色背包图案；该外观样本没有储物功能，新 NeoForge 服尚未迁入旧大背包容量与数据。

`body.observe` 返回已加载世界的原始方块状态和实际碰撞形状，标明 `source=client_loaded_world`、`lineOfSightFiltered=false`。它包含服务器已经发给客户端的数据，不等同于严格视觉可见性；需要公平感知时，上层必须另做视线与遮挡过滤。

`menu.click` 会核对窗口 ID、stateId、目标完整 SNBT 和光标 SNBT。`screen` 操作用 token 防止点击已切换的旧界面；坐标使用 GUI 缩放后的像素。标准控件可读标题、按钮与位置，自绘控件通过原始画面识别。输入框的值默认不导出，避免把配置页中的 API key 混进普通状态。

`chat.recent` 按序号增量读取该连接实际收到的聊天、系统与动作栏文字，保留最近 128 条；换游戏连接清空。`chat.send` 通过正常游戏连接使用 `/mycli` 等服务器命令，仍受原有权限约束。

每个变更有唯一 `action_id`。客户端先持久化意图，再安排到游戏线程执行，磁盘终态写入由独立 IO 线程完成。Agent 端沿用原 `NativeLedger`，同时绑定服务器和 UUID。重复 ID 与相同完整参数只返回旧结果，改变参数拒绝；断线、重启未能确认的动作保持 `unknown`，阻止新增变更，不能换 ID 重做。

回执的 `authority=client_observed` 表示客户端观察值。`client_input_delivered` 只说明输入已发送；`effectConfirmed=true` 用于实际位置、方块变化、菜单变化或截图被观测到的情形。菜单包含客户端预测，不能把客户端变化当作独立的服务端事务确认。上层任务仍需核对位置、物品数量或目标界面，不能用模型口头完成作为成功判定。

## Mineflayer 复用

`java-client/mineflayer-facade.cjs` 在同一身体上提供部分 Mineflayer 风格 API：`look/lookAt`、`blockAt/findBlock/findBlocks`、`inventory.items`、`equip`、`clickWindow`、`activateBlock/activateItem/placeBlock`、`dig/attack/chat`。放置会核对命中面、主手完整组件与实际目标方块。

`refresh()`、`refreshWorld()` 与 `refreshChat()` 显式更新数据，不自动创建第二条 Minecraft 连接。聊天提供 `messagestr/clientChat` 事件；未核实发送者名称时不拼造 Mineflayer 的 `chat(username,message)`。

```js
const { createMineflayerFacade, goals } = require('./java-client/mineflayer-facade.cjs')
const bot = await createMineflayerFacade(world)
await world.claimControl()
// 目标坐标先从本人实际观察选择。
await bot.pathfinder.goto(new goals.GoalBlock(x, y, z), { actionPrefix: 'go-pot-001' })
```

寻路复用锁定的 mineflayer-pathfinder 2.4.5 的 AStar、Move 与 goals，邻接关系由客户端真实碰撞形状生成。首版支持已加载局部区域内的步行、上下一格与危险地面避让，不自动挖路、搭桥、游泳、跑酷或操纵 Create 移动结构。路径每步通过真实客户端物理执行并核对终点。尚未验证的 Mineflayer 插件不能直接宣称兼容。

## 原始画面与维护

`screen.capture` 从原客户端 Framebuffer 采集 PNG，随后 `await world.frame(actionId)` 返回原图字节。包含原始模型、材质、粒子和模组 GUI。服务端、网页和 Agent 可以保留各自现有界面；此版本提供原帧接口，连续视频流与网页观看页面后续接入。

截图保留最近 64 张，动作记录独立保留；已淘汰图片会明确返回不可用。桥随 Minecraft 客户端运行与退出，不另启常驻服务或模型循环。健康接口检查客户端 tick 新鲜度；Host/Origin/Bearer 校验限制本机访问。

源码构建：

```text
python world/java-client-bridge-src/build.py --minecraft <官方NeoForge缓存目录> --javac <Java21的javac> --output <独立输出目录>
python tools/test_java_client_bridge.py --minecraft <同上> --java <Java21的java>
python tools/java_client_bridge_health.py --config <本人SDK配置> --manifest <安装清单>
```

`tools/launch_java_client_bridge.py` 专供离线隔离 QA，只允许独立游戏目录和回环测试服务器。正式游玩使用正常启动器。

首版验收覆盖未装服务端桥的农夫乐事测试服：真实登录、按键移动、A* 绕障碍、烹饪锅界面、12 个番茄双向存取、原帧截图、2×2 合成工作台、切铁镐、真实挖掘与放置、取消释放按键和动作去重。同世界重启客户端后保持 UUID、位置与原动作终态，重复动作不再移动。所有模组的语义接口、长期自主生活、F8 真人按键、基岩兼容和视频流各需另外验证；客户端桥不会自动完成基岩资源与界面的转换。
