# 官方 Mineflayer 接入 Fabric 26.3

适配放在服务器一侧。外部 Agent 使用官方 npm `mineflayer@4.39.0`，不需要自研 SDK、Mineflayer 插件、自定义 client、注册表注入或修改 node_modules。官方包的 188 个发布文件已逐字校验；客户端没有换成同名定制包。

当前安装：**127.0.0.1:39786** → ViaProxy → 服务端数据转换 → 原 26.3 实验世界 **127.0.0.1:39781**。39785 是内部载体入口，39782 是原游戏管理入口。现役 SAO／千灯纪 28976／28977 及公网、账号和防火墙未改变。这里仍仅本机可用。

```javascript
const mineflayer = require('mineflayer')
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 39786,
  username: 'YourAgent', auth: 'offline'
  // 版本可省略，自动识别会选中受支持的 1.21.1。
})
bot.on('error', console.error)
bot.on('messagestr', text => {
  if (text.startsWith('MC_NATIVE ')) console.log(JSON.parse(text.slice(10)))
})
bot.once('spawn', () => bot.chat('/agent read-1 status'))
```

`offline` 仅用于回环实验环境。网关拒绝公网绑定；正式远程接入仍需正式账号认证，不能直接开放离线入口。模型、规划、人设、记忆和游戏循环仍归 Agent 所有者管理；网关没有额外控制同一身体的 Mineflayer 或模型循环。

## 标准操作与真实身份

移动、转向、攻击、方块交互、物品栏点击及容器操作使用普通 Mineflayer API，由原服验证实际动作。没有使用管理员命令替 Agent 发物品、传送或完成任务。

`item.name` / `block.name` 是客户端认识的原版载体。模组物品的真实身份保留在标准 `custom_data.maw_native.id` 组件，也可通过私有查询取得。两个模组物品即使共用纸载体，也有不同的原生组件，不能只据 `item.type` 认定为同种物品。

普通箱子可继续用容器 API；模组机器使用公开的 `bot.openBlock(block)` 或 `activateBlock` 并等 `windowOpen`。`openContainer` 自带原版箱子名称白名单，不能用它否定已确认的模组机器。先读真实 ID，再按准确槽位 `clickWindow`；不要只按纸的类型批量取物。

机器依据实际服务端布局呈现为标准 9×N 容器，填充格不可写。客户端预测组件不反向猜成原生物品；点击交给原服执行，以原服库存同步校正。不替换世界中的原生方块／ItemStack，不关闭 Fabric、距离、权限、碰撞或保护检查。

不同协议的数字 ID 不相通。原生 ID 属于 26.3 服务端；载体数字明确标为中间 26.3 协议，可能再次被 ViaProxy 转换，不能当作当前 `bot.registry` ID。菜单同时给 `nativeSlot` 和 `clientSlot`，点击使用后者；原生专属饰品格的 `clientSlot` 为 null，不得猜测客户端格子。

## 私有查询

```text
/agent help
/agent r1 status
/agent r2 inventory 0 12
/agent r3 menu 0 12 farmersdelight:rice
/agent r4 items 0 8 farmersdelight:
/agent r5 recipes 0 8 minecraft:crafting_table
/agent r6 recipe_book 0 8 farmersdelight:cooking
/agent r7 views 0 12
/agent r8 view 0 1 village-quest:reputation_view_v2
/agent r9 block 55 69 -344
```

格式 `/agent <requestId> <section> [offset] [limit] [filter]`。requestId 是 1～64 个 ASCII 字母、数字、下划线、连字符、点或冒号；offset 默认 0，limit 默认 8、最多 12，filter 是一个最多 160 字符的文本片段。`block` 要求三个绝对整数坐标。另有 `blocks`、`spells`、`attributes`；法术分类是服务器配置目录，不代表本人已学会或当前能释放。

只向请求连接发送标准系统消息：`MC_NATIVE ` 后跟 JSON，不广播、不写动作栏、不周期刷屏。单条最多 12 KiB；超页或超预算返回 partial、覆盖计数及续读参数，不自动读完目录。未知结果为 unknown；参数错误含字段与最小示例。每连接 4 次/秒、突发 8 次，限流给 retryAfterMs。

回执带本人 bodyId、服务器 epoch 和观察时间。库存／菜单来自原服发给本人的实际同步包；日记／声望来自原模组的同人原始数据并核验原始包摘要。位置、状态和目标方块由只读组件在游戏主线程读取，不使用客户端谎报的位置扩大范围。槽位权限未导出时保留 null，不猜成允许。

物品 `components` 是实际同步包中的组件增量，不是完整默认定义；`componentsArePacketOverrides=true`、`defaultComponents=null` 明确保留未导出的默认值。food 标为注册表默认来源。不能把空增量解释为武器没有默认属性；载体无法表示的自定义属性会明确列为省略，原始增量仍可私有查询。

方块查询受本人真实交互距离、区块加载情况及交互轮廓射线约束，不额外加载区块或返回隔墙目标。`interaction_outline_raycast` 表示交互射线：玻璃后方可以视觉可见，却被玻璃挡住交互；回执不会把交互受阻说成视觉不可见。

## 已验收及限制

官方 Mineflayer、无 OP 生存角色已实测：自动／显式版本登录、真实地面和生命值、普通走动与挖掘、按槽位取放原生稻米、合成工作台、打开真实农夫乐事锅并投入 4 份稻米、回存余下 4 份到箱子，以及重连库存保持。原生 Village Quest 视图、跨账号隔离、无公屏副本、超距拒绝和有界分页也已验证。冷盘读取再次确认锅 4、箱 4，玩家泥土 1、木板 4、工作台 1，没有发奖补齐或复制物品。

这不是全部模组和视觉兼容验收：417 个状态的载体碰撞标为 unknown；不等价几何使用明确的保守载体，中间准确形状也可能被前端降级改变。任意附加 GUI、饰品写入、完整法术施放、特殊配方书写入、创造物品反向映射及全部自定义组件仍需单独验收。当前不发送原生专用配方书 UI、进度界面、声音、粒子及任意方块实体渲染包；已收到的原生配方展示可按需查询。不能称为真实客户端的 1:1 画面。

普通区块仍按 Minecraft 标准同步。上述方块查询的距离／射线约束不等于已实现整个服务器的反透视过滤。

## 维护

`prepare_proxy.py` 只下载校验过的官方 ViaProxy 3.4.14；供应商 JAR 不入 Git。`build_body.py` 验证锁定 Fabric API 和提取依赖后构建仅服务端的 `maw-stock263`。它只读本人状态、近距方块，没有命令执行、发物品、改权限或控制动作能力。真实 Java 客户端不需要安装它。

先正常停止实验服、做两份冷备，再按 `body-component.lock.json` 安装；`install_body.py` 拒绝热替换及覆盖已有版本。游戏 JVM 仍由原 `manage.py` 管理。新增组件纳入 localComponents，重新准备或更新兼容组件会保留它。

```powershell
python prepare_proxy.py <新的私有代理目录>
python build_body.py --cache <原缓存> --java <java.exe> --output <新的构建目录>
python install_body.py --deployment <deployment.local.json> --jar <构建的jar>
python manage_gateway.py start <私有网关配置.json>
python manage_gateway.py status <私有网关配置.json>
python manage_gateway.py stop <私有网关配置.json>
```

配置见 `gateway.example.json`。管理器持有自己的 Node／ViaProxy 子进程、冻结源码和依赖锁摘要，不控制游戏 JVM。有人在线时拒绝停网关；停止时两个自有子进程正常退出。相同配置可重新 start，保留日志并验证冻结文件；停止请求绑定启动代次，旧标记不会再次停掉新进程。不自动重启或重放玩家动作。升级使用新运行目录；回退切回已有冻结服务目录，保留最新世界和玩家数据。

本机当前配置是 `E:/MC/runtime/fabric263-lab/stock-gateway-20261101/managed-main-r2.local.json`，冻结发布目录 `managed-main-r2/release` 的 10 个生产文件已逐个与仓库源码核对。R2 实连再次确认自动选择 1.21.1、原世界状态和实际地面。私有配置、令牌、世界、日志、vendor、node_modules 和供应商资源不入 Git。原 39781 连接器与打包核心的既有路径也已在新组件安装后重新实连通过。
