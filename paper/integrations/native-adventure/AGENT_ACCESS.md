# 暮色 / Lootr / 新版外观组合的 Agent 接入

这是独立 Youer 1.21.1 / NeoForge 21.1.252 测试服的候选接入。**没有安装到千灯纪主服或 SAO 公网服，也未开放新的公网端口。** 实际验收范围、原始失败和待办见 `agent-acceptance.json`。现有官方 Numen 0.1.4.1 原始字节保持；[作者发布页](https://www.curseforge.com/minecraft/mc-mods/numen-ai/files/all) 当前列出的是 0.1.4.1 Beta，不能将 Beta 称为正式稳定版。

## 两种身体

| 入口 | 身体 | 决策与记忆 | 数据与操作 |
| --- | --- | --- | --- |
| Mineflayer + 可选客户端 SDK | 真正登录的普通玩家，无 OP | 用户自己的 Agent / mc 核心 | 握手桥后同一连接的原生库存、菜单、区块与事件 |
| Numen 原生 SDK | 服务端持久假玩家，无 OP | 用户自己的 Agent；本轮未启动 hosted 模型 | Owner Token + 身体 UUID + 单控制器租约；官方 Lua 与原生菜单扩展 |

测试 Java 后端为回环 39761，Mineflayer 候选入口回环 39771，Numen Owner MCP 回环 39779。这些是本机实验端口，停机时不可连接；不应发给公网访客。主服、SAO 原有入口与账号策略保持。

## Mineflayer

普通 Mineflayer 直接连接这个模组后端仍会被 NeoForge 必需通道拒绝。握手桥使用**当前 JVM**导出的注册表、完整组件编解码和 Better Combat 配置确认，没有关闭第三方通道要求。

兼容物品、方块只是网络载体。例如同一次实际连接中，Lootr 箱的载体是 `oak_planks`，暮色楼梯的载体竟是 `glowstone`。它们不能成为 Agent 判断真实身份、碰撞或配方的依据。单独使用未适配的原始 Mineflayer 不等于完整模组客户端。

可选 `@qiandengji/native-adventure-client` 附加到宿主**已经创建的同一个 bot**，不创建身体、模型循环或第二个控制器。应在登录前附加，读取当前运行的注册表文件及可信的 SHA-256：

```js
const mineflayer = require('mineflayer')
const { attachNativeAdventure } = require('@qiandengji/native-adventure-client')
const bot = mineflayer.createBot({ host, port, username, version: '1.21.1', auth })
const access = attachNativeAdventure(bot, {
  stateFile: currentRegistryFile,
  expectedRegistrySha256: currentRegistryManifest.files['block-states.jsonl'],
  bindBlockReads: true
})
bot.once('spawn', async () => {
  const catalog = await access.native.operations()
  const body = await access.native.snapshot()
  // catalog is the actual server response; discover an operation before using it.
})
```

此示例只负责连接和查询。宿主仍须通过原本唯一的身体队列派发动作，保留 core 的视线、保护、停止、超时和未知结果门禁。`world.read` 是内部收到的区块读数，不要将未经视线过滤的缓存直接提供给模型；它没有向服务端额外扫描矿物或未加载世界。

- `native.operations()`：实际安装的能力及参数契约；不靠静态包版本推断服务器已支持。
- `native.snapshot()` / `inspect(slot)`：本人真实物品 ID、名称、完整组件和指纹、装备、位置、窗口及时间。`bot.inventory` 仍是兼容载体，涉及模组身份或组件时使用原生接口。
- `native.recipes(filters)`：当前 JVM 的配方管理器和原生序列化定义；每页最多 12 条、约 16 KiB，保留 `nextOffset`。`outputId` 只查显示产物，不能证明覆盖概率副产物；看到定义不等于机器已经成功工作。
- `native.read('menu.current')` → `native.click({slot,requestId})`：读取实际槽位，再执行一次包含窗口、stateId、完整槽位及游标组件的 CAS 点击。右键真实方块打开菜单，不允许远程打开任意箱子。真实箱支持取和放；Lootr 独立库存仍按本人 UUID。
- `native.call('menu.close', observedArgs, {requestId})`：关闭本人窗口。
- `native.actionStatus(originalRequestId, originalServerEpoch)`：只读对账。不自动重放未知写入。

开启 `bindBlockReads` 后，普通 `bot.blockAt` 读取同一连接原始区块中的真实身份、属性和静态碰撞；现有 core 的体素/可见性逻辑继续调用它。玻璃保持透明且有完整碰撞，楼梯保持半阶形状。原生缓存最多 256 个区块；卸载、换维度、序号断档、未知注册表或未知动态形状保持未知。缓存不补成空气，不把载体木板/荧石碰撞当原生碰撞。导出的静态形状使用 `EmptyBlockGetter`、无实体碰撞上下文；实体相关、邻居相关及动态模组形状仍需单独验证。这里没有承诺所有 Mineflayer 原始 `findBlocks`、采掘、物理和模组载具都已原生化。

绑定的 `getProperties()` 将原生规范字符串 `true/false` 显式转成 prismarine-block 使用的布尔值，作物年龄等数字字符串保持字符串；`nativeObservation.properties` 保留原值。这里仅规范化表示，不选择目标或修改游戏状态。

原生菜单的服务端去重账本是每玩家 128 条、5 分钟，绑定 JVM epoch。短时重连可对账；重启或过期返回 `unknown`，不能据此重新发奖、施法或移动物品。原生目录不包含世界区块、玩家背包或密钥，可单独分发；任何数字 ID 都不得从旧服或旧 JVM 沿用。

## Numen

复用既有 server-resident addon 和官方原生假玩家；客户端 Numen 仍是可选项。本轮没有把旧 Tau 的专属任务 mixin 带入新核心，也没有把用户模型 Key、记忆或账号复制过来。

额外补测发现：只把 Numen 消息频道改为 optional 还不够，`numen_tlm:tlm_model` 被加入 NeoForge 的必需同步附件注册表，原来的 Java 客户端仍会被拒绝。新版自有兼容组件 0.1.1 仅对**没有协商 Numen 客户端能力**的连接，从该连接独立的注册表副本及初始/后续附件同步中排除这一项可选外观；有 Numen 的连接保留原数据。全局注册表、存盘、女仆本体、其他附件、战斗、认证和保护不改变。实现精确固定 NeoForge 21.1.252 的 API；未知版本须重新审核，不能通过放宽版本号套用。

Owner MCP 必须使用本人 Token，先 `operations` 查看官方组，再按完整函数 ID 查参数、`returnTypes`、示例；`mod_operations` 查询确实已安装的扩展。不要将全部手册塞进每轮上下文。

1. `list_companions` 取原身体 UUID；首次才以唯一 `action_id` 调 `create_companion`。
2. `get_state` 确认真实身份、位置、健康、背包、窗口和当前动作。
3. `claim_control` 用稳定 `controller_id` 获得 90 秒租约。第二个控制器不能同时派发动作。
4. `lua` 使用唯一 `action_id`，异步提交；`action_status` 查询终态和实际前后变化。重连继续查原 ID，不创建替代身体。
5. 模组菜单可使用官方 `numen.use.block` / `numen.gui.*`；扩展 `menu.nativeClick` 仍要求完整菜单 CAS。所有范围、物品、模组及保护规则保持。

示例为已验收过的函数格式，坐标须换成本次真实观察到的位置：

```lua
local plan = numen.route.plan({to = {x=107,y=201,z=103}})
numen.move.go(plan)
local w = numen.use.block({x=105,y=201,z=105})
numen.gui.take("minecraft:bread", 3)
numen.gui.close()
local household = tlm.maid.list()
for _,m in ipairs(household.here) do print(m.id, m.task) end
```

`tlm.maid.list()` 返回含 `here / away / tombstones` 的对象，不是顶层数组。QA 曾用 `#household` 误报 0，正确字段 `#household.here` 实读 1，并确认所有者为 `you`；保留这次探针错误，没有因此放宽女仆所有权。

普通生存动作是否独立执行由该身体既有 Numen permission mode 决定。本轮只对新建 QA 身体设置 `bypass`，它表示无需离线主人逐次点许可，不授 OP，不绕过模组所有权、距离、建筑保护或服务器认证。

## 安装及认证边界

本候选原生数据组件已拆除对旧服 MixAuth JAR 的硬依赖。存在 MixAuth 时仍查询原生会话；反射或提供器故障拒绝。原生 online-mode 使用已登录连接；离线且没有认证提供器默认拒绝。QA 例外必须同时具备显式 JVM 开关、实验标记、固定回环后端和真实白名单；只凭名字或 IP 不授权。它尚未对接主服的 LoginGuard / RealmAccounts 代理会话证明，不能直接作为正式服认证方案部署。

构建器只生成新文件，不安装、不重启、不更改第三方元数据：

```text
python paper/integrations/native-adventure/build_agent_access.py --shared <固定78ec7abb源码快照> --server <隔离Youer目录> --numen <官方0.1.4.1原JAR> --java <Java21> --output <全新目录>
python paper/integrations/native-adventure/build_agent_client.py --gateway <冻结网关源gate目录> --server-addon <本次原生组件JAR> --output <全新SDK.tgz>
node --test paper/integrations/native-adventure/tests/native-world.test.cjs integrations/tau-ceti/native-bridge/native-client.test.cjs integrations/tau-ceti/gateway-overrides/channel-manifest.tau.test.cjs
```

正式部署仍需主服完整插件、现有账号/保护/技能、基岩和观战链路回归及当时的正常维护。新版 YSM Java 结果和本轮两个 Agent 的特定玩法验收，均不能代替这些检查。Better Combat 共存下的普通攻击已测实际伤害；这不等于全套连击、动画、盾反及 Boss 战均已接入。
