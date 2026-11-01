# Fabric 26.3 原生 Mineflayer 接入

**原版 npm Mineflayer 不装额外客户端插件，请用新的 [服务端兼容入口 39786](../stock-gateway/README.md)。** 已在官方 4.39.0 上实测自动登录、普通动作、原生物品／锅菜单及私有查询。这里仍记录原生 39781 配套连接器；原版库直连 39781 尚未支持，不与新入口混淆。历史诊断与原生 ID 对照见 [原版直连检查](STOCK_MINEFLAYER.md)。

这是直接使用 Java **26.3 / protocol 777** 的连接组件，没有协议降级网关或原版物品替身。上游仍在开发 26.3 支持，因此不能只给普通 npm Mineflayer 填 `version: "26.3"` 就当适配完成。

此目录固定 Mineflayer、协议、数据、区块与物理库的上游提交和依赖。它配合一个可选、仅服务端安装的 `maw-native263` 组件；真实 Java 客户端继续使用原整合包，不需要安装这个组件。旧千灯纪和 SAO 的入口、账号、世界及运行依赖不随这里的部署改变。

本机已验收的安装是 `E:/MC/runtime/fabric263-lab/mineflayer/runtime-r4`，MCP 在其 `sdk-validated/mcp.mjs`。`runtime-r1` 至 `r3` 和其他 SDK 文件夹属于保留的实验历史，不作为新的接入入口。实验服仍是回环地址 `127.0.0.1:39781`。

## 数据与动作

- 在登录阶段校验同一 JVM 导出的注册表、SHA-256 和服务器 epoch，再初始化 Mineflayer 插件。不是进服后才猜 ID。
- 保留并实现 Fabric 配置阶段与注册同步；原始注册同步包必须与已导入的实际表一致才确认。不关掉模组兼容、权限、碰撞或距离检查。
- 导出实际方块状态、属性顺序、物品／实体／菜单 ID、静态碰撞、食物值和标准网格配方。上下文相关碰撞明确标为 unknown，物理层保守处理；透明性与实体碰撞分别保留。
- 修正 26.3 传送确认、每刻位置包、实体插值、挖掘／停止使用物品的 action 编号。新增角色的首次位置确认前，先完成一个没有移动的客户端 tick。
- 物品栏、掉落实体、装备和窗口使用同一份真实注册表。普通 `bot.dig`、`bot.craft`、箱子 API、`bot.clickWindow` 和寻路仍是原来的玩家操作，服务端继续验证实际效果。
- Fabric 扩展菜单转为同一个真实菜单窗口，使用服务端实际槽位布局和原始物品包。农夫乐事烹饪锅保留 `farmersdelight:cooking_pot` 类型，不伪装成箱子。
- 农夫乐事 `farmersdelight:cooking` 配方展示按 3.6.30 的真实 codec 解码，包含容器、食材、结果、站点、32 位时长及经验。
- Village Quest 六类视图由供应商原始对象转成结构化数据，只发给原接收者。客户端再核对原始包哈希，才向 Agent 暴露日记、声望、任务、公告板等数据。2.6.3 的日记命令使用 `reputation_view_v2`，不能只查旧 journal 频道。
- Better Combat 配置／武器目录、Spell Engine 配置／法术容器目录会真实解析并保存，按需要查询，不全部塞入模型上下文。

完整包解码长度不符或出现未实现的物品组件时会明确失败，防止旧协议库静默丢掉库存数据后继续操作。`block_transformer`、`compostable`、`cooking_fuel`、`brewing_fuel`、`provides_pottery_pattern` 等上游尚未完成的 codec，以及未实现的模组组件，有明确的 `UNSUPPORTED_NATIVE_CODEC` 错误；本组件不会把有数据的组件当成空字段。不要据基础验收宣称所有附魔／饰品／特殊道具变体已经全覆盖。

标准网格合成使用服务器的真实配方，按实际材料选择 tag 替代项。特殊动态配方、机器配方通过相应机器菜单操作；不能交给一个近似的原版配方表。角色视野与世界探测仍走核心原有的感知约束；注册表不含任何矿石、建筑或隐藏实体的位置。

## 安装与启动

全部路径应为自己的独立目录。Node 22+；Java／Fabric 保持父目录锁定的版本。不要全局安装 npm 包。

```powershell
python prepare_runtime.py --runtime E:/MC/runtime/fabric263-lab/mineflayer/runtime-r4 --archives E:/MC/runtime/fabric263-lab/mineflayer/archives --node <node.exe> --npm-cli <npm-cli.js>
python build_native.py
```

`upstream.lock.json` 固定上游源归档；`npm-lock.json` 固定其余依赖。下载内容验证大小与哈希，解压拒绝链接与越界路径；已有运行目录拒绝覆盖。构建只在私有目录生成 JAR，不改供应商 JAR。

服务端安装要先确认无人游玩、通过父目录 `manage.py stop` 干净停止，并运行 `backup.py` 完成两份冷备份。构建结果必须与 `native-component.lock.json` 一致，才能运行：

```powershell
python install_native.py
python ../manage.py start
python ../manage.py status
```

管理器会同时等待游戏 `Done` 和原生注册表就绪。开端口或 Java 进程存在不足以证明 Agent 可以接入。升级与恢复使用新版本目录及明确迁移，不自动覆盖旧组件，不删除旧 SDK 和请求账本。

## 直接使用 Mineflayer API

```javascript
const { createBot } = require('./create_bot.cjs')
const bot = createBot({
  runtime: 'E:/MC/runtime/fabric263-lab/mineflayer/runtime-r4',
  host: '127.0.0.1', port: 39781,
  username: 'YourAgent', auth: 'offline', version: '26.3'
})
bot.on('error', console.error)
bot.once('spawn', async () => {
  await bot.waitForChunksToLoad()
  console.log(bot.entity.position, bot.health)
  console.log(bot.registry.itemsByName['farmersdelight:rice'])
  console.log(bot.native263.views.list())
})
```

这里的 offline 仅适用于回环实验入口，不能作为公网身份方案。远程接入必须沿用目标服务端的登录鉴权；本次未改防火墙、域名、路由器或公共登录策略。

## 自研核心、SDK 与 MCP

使用经过构建验证并打包的自研 `agent-mc-world`，通过它的公共扩展接口注入本连接器。规划、模型、人设和个人记忆继续归调用者；核心保留唯一的队列、身体租约、请求账本、取消和恢复规则。没有另起模型循环，也不需要对公网开放 MCP。

```powershell
python prepare_sdk.py --runtime <已准备的运行目录> --core-archive <core.lock.json 对应的核心 tgz> --name sdk-rc131 --node <node.exe> --npm-cli <npm-cli.js>
```

`core.lock.json` 校验自研包；`sdk-npm-lock.json` 固定 SDK 依赖；源码来自同一运行目录的 vendor，避免核心又加载一套不支持 26.3 的协议表。SDK 安装到新目录，不覆盖正在工作的 Agent。复制 `client.example.json` 为 SDK 文件夹内的私有配置，修改用户名并给每个角色独立数据目录：

```powershell
node <运行目录>/sdk-rc131/mcp.mjs <运行目录>/sdk-rc131/client.local.json
```

MCP 客户端以 stdio 启动该命令，再通过 `mc_connection` 显式连接。`mc_native` 提供原生物品、方块类型、配方、法术目录、本人任务视图和当前菜单的有界查询。普通行动仍使用核心的 `mc_do`、`mc_script` 等工具。分页不会自动扫完剩余目录；查询原请求结果不等于重新派发动作。

本次 SDK 包为执行端；26.3 Web 渲染尚未验收，必须保留 `viewerPort: 0`，画面继续使用匹配的真实 Java 客户端。Numen 与基岩桥尚未安装到这个 26.3 世界；Spell Engine 的完整施法、全部饰品和特殊菜单也不能据此视为完成。

## 验证与维护

```powershell
node --test test_adapter.cjs
python -m unittest test_prepare_runtime
```

设 `MAW_NATIVE263_RUNTIME` 指向已准备的运行目录后，Node 测试还会运行真实编解码、未知组件拒绝和不同服务器 schema 隔离检查。

`smoke.cjs` 是有时限的只读联机检查。`exercise.cjs` 只面向 **39783 隔离夹具**：需要新 request ID，已存在 ID 只读原回执，不重复动作；按计划分别核对移动、挖掘、取物、合成、锅输入和本人日记。未知操作先对账，不得重跑整个流程。首次试验的失败回执保留，不能用新成功覆盖历史证据。`sdk_smoke.mjs` 通过真正的 stdio MCP 与打包核心检查连接和工具结果。

重建联机夹具时使用独立源码检出目录，以及全新的 server/client/cache 路径和 39783／39784 端口，避免覆盖当前服的 `deployment.local.json`。`fixture.example.json` 给出了首次验收的具体准备命令；只在没有玩家与进度的新 QA 世界执行一次，不用于重置已有世界。随后依序运行各计划，每次使用新的请求 ID。

不要把服务器世界、私有配置、启动器凭据、运行日志、供应商 JAR、vendor 或 node_modules 提交到 Git。源码、锁、测试和去标识的验收结论可以提交。更改模组或数据包后应重连并核对新的 catalog snapshot；不要把旧观察当成当前状态。
