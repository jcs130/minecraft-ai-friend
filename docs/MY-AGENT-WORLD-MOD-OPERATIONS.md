# My Agent World：Agent 模组操作指南

2026-10-08。当前目标是让普通 Agent 通过自己的 Mineflayer 连接发现、读取和调用原生模组功能。实际安装版本以锁文件为准：Minecraft 1.21.1、NeoForge 21.1.248。本轮提供 **48 项直接调用、27 项身体工具**，包含新增的殖民地岗位/研究、Ars 学习编书、Create 设置/过滤/流体读取和 Curios 饰品栏。

接入地址仍为 `192.168.3.163:28977`，匹配模组的 Java 后端为 `:28976`，MawExplorer 同连接网页为 `http://192.168.3.163:28984/`。仅家庭 LAN；新服基岩和公网接入尚未完成。既有 Paper 千灯纪继续运行。

## 先发现，再操作

使用 [外部 Agent 指南](MY-AGENT-WORLD-EXTERNAL-AGENT-GUIDE.md) 的锁定依赖，在 `spawn` 前给自己的连接挂接 `attachModAgentClient(bot)`：

```js
const sdk = attachModAgentClient(bot)
const list = sdk.operations()
const explanation = sdk.operations('colony.assignCitizen')
// explanation.operation.parameters 为真实 JSON Schema。
const receipt = await sdk.call('colony.management', {
  buildingPosition: { x: 603, y: 64, z: 600 } // 示例；换成本人建筑的真实位置
})
```

每项操作的参数、只读属性和说明都从 `operations(id)` 读取。接口保留原生结果，缓存读取可能为 `null`，没有把所有返回包装成成功。位置是绝对坐标；`aimOffset` 是目标方块内部的 0–1 偏移，仅用于瞄准薄方块或表面。

Maw 身体执行器已接入同一目录：

```json
{"type":"mod","operation":"list"}
{"type":"mod","operation":"explain","id":"spell.configure"}
{"type":"mod","operation":"call","id":"spell.glyphs","args":{"limit":12}}
```

外部 SDK 不提供 `execute(plan)`；接入方仍负责自己的移动、朝向、物品选择、操作账本和生命周期取消。Maw 的 `look` 身体动作可转向 16 格内绝对目标点，支持小数坐标；外部 Mineflayer 可使用自身 `bot.lookAt`，随后用原生 `world.look` 核对视线。

## 殖民地：分配职业、管理工作和研究

| 操作 | 用途 |
| --- | --- |
| `colony.management` | 小屋旁读取实际岗位/住房模块、居民、已分配列表及招聘模式 |
| `colony.assignCitizen` | 原生雇用/解除岗位，或分配/解除住房 |
| `colony.setHiringMode` | 设置原生 `default/auto/manual/locked` 模式 |
| `colony.pauseCitizen` | 按旧暂停状态核对后暂停或恢复工作 |
| `colony.research` | 大学旁分页读取研究、前置、成本、资源是否足够及进度 |
| `colony.startResearch` | 按原生规则开始研究并真实扣除材料 |

本人须是城镇成员，变更还须具备原生 `MANAGE_HUTS` 权限；保持在建筑 8 格内。访客不能读取或修改成员私有管理数据。

岗位变更先读取 `management`，原样带回 `moduleId`、`expectedModuleKey` 和完整 `expectedAssignedCitizenIds`。**moduleId 是模组运行时编号，不是数组下标**；升级模组后必须重新发现。跨建筑调岗先解除旧岗位，接口不会偷偷抢走已有员工。满员、过期列表、过期招聘/暂停状态会明确拒绝。

```js
const before = await sdk.call('colony.management', { buildingPosition })
const module = before.state.modules.find(m => m.role === 'job')
const result = await sdk.call('colony.assignCitizen', {
  buildingPosition,
  moduleId: module.moduleId,
  expectedModuleKey: module.moduleKey,
  citizenId, // 取自同一份真实居民列表，确认其没有其他岗位
  assign: true,
  expectedAssignedCitizenIds: module.assignedCitizenIds
})
```

研究分页上限 12；先检查 `canResearch/requirementsMet/hasResources` 和成本，再调用 `startResearch`。资源来自本人/大学的原生库存规则，不能用账户外物资替代。已开始的研究不能重复扣费开始；研究需要原生员工、条件和时间，接口不直接完成科技。

`placeHut` 新增大学 `university`，仍消耗真实 `minecolonies:blockhutuniversity`，采用已锁定 Original 的 `education/university1.blueprint`。当前有限小屋共 8 种，另有市政厅建镇入口。放置、工单、材料交付和建筑完工分别核验。

## Ars：学符文、编书、选槽和施法

1. `spell.glyphs({offset,limit})` 分页列出本服符文，包含原生 ID、描述正文、等级、启用/已学/是否在书中展示。每页最多 24。
2. 真正持有符文，调用 `spell.list` 读取当前主手 SNBT 和快捷栏，再 `spell.learnGlyph`。原生学习会消耗一件真实符文，已学拒绝；不会凭空解锁。
3. 选中真实法术书，重新 `spell.list`，用 `spell.configure` 写一个槽位。保留已学、启用、书等级、长度及原生组合验证。
4. `spell.select` 选择已配置槽位；`spell.explain` 读取组成和基础费用，`spell.cast` 调用原生施法。

```js
const state = (await sdk.call('spell.list')).state
await sdk.call('spell.configure', {
  slot: 0, name: '弹跳',
  glyphs: ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_bounce'],
  expectedHeldSnbt: state.heldSnbt,
  expectedHotbarSlot: state.selectedHotbarSlot
})
```

示例须先实际学习相应符文，持书组件必须来自本人当前状态。槽位范围还受真实书的最大槽数限制，不能照着协议上限假称任意槽可用。

施法方向由玩家朝向决定。Ars 原生逻辑在瞄准机器方块时可能优先交互，返回 `SUCCESS` 却没有施法；Self 法术可先看向空中，投射法术先瞄准实际敌人。接口不会为了成功绕过原生逻辑。

`manaCost` 是基础费用，装备折扣可能改变实际消耗。`castConfirmed/castEvidence` 表示原生施法确认；`native_expenditure_event` 也能确认实际费用为 0 的法术。`manaSpent=0` 不能独自判失败，`CONSUME/SUCCESS` 也不能独自判成功。无法确定的原生分支返回 `outcomeKnown=false`，暂停变更。`effectVerified=false` 表示目标命中、治疗、破坏或掉落还须独立观察。

## Create：设置机器、过滤和流体

`create.settings({position,aimOffset?})` 返回原生行为编号、类型、旧行/数值、面板行数/上限、过滤完整 SNBT，以及活跃、可交互、是否需要扳手。`setValue` 原样核对方块/行为/旧值/主手组件，再调用原生面板；`setFilter` 核对旧过滤及实际手持物，调用原生短交互。

普通方块过滤是原生幽灵模板，不扣该方块；真正的 `create:filter` 会按原规则消耗/返还，不能当幽灵物品复制。清除过滤用真实空手。过期配置、错误主手、不可交互和越界数值都拒绝。

薄漏斗不一定能命中中心，可显式提供如 `[0.1,0.5,0.5]` 的 `aimOffset`；仍要求服务器视线首先命中该方块，不能穿墙操作。范围遵守玩家原生方块交互距离和权限。

`create.fluids` 读取**当前可见面**实际流体能力的 ID、mB 数量及容量。装卸仍用真实容器和原生 `world.interact`：

```js
await sdk.call('world.interact', {
  position, expectedBlockId: nativeLook.block.id,
  expectedProperties: nativeLook.block.properties,
  expectedHeldSnbt, expectedHotbarSlot
})
const actualTanks = await sdk.call('create.fluids', { position })
```

`world.interact` 前必须关闭菜单、清空游标；它核对方块完整属性和实际主手，执行一次原生主手右键。接受交互不等于流体或产物已经变化。

本轮实测普通生存账号把水桶倒入排液器：流体 **0→1000 mB**、水桶变空桶。生存模式储罐直接用桶交换原生返回 `PASS`，排液器用空桶也不会抽水；抽送应按原玩法建管道/泵等系统。这些拒绝和无变化保留，不强行改成成功。完整流体生产线及任意机器未全部验收。

## Curios：真实饰品栏

`curios.state` 读取本人真实槽位与完整组件；`curios.open` 打开本人的原生饰品菜单；随后读取 `menu.current` 和 `state.menuSlots` 的当前实际槽号，用 `menu.click` 取放。

禁止把普通背包槽号硬套到饰品菜单。翻页用 `curios.page`，带当前 `containerId/stateId`，游标必须为空。原有效槽、诅咒和物品自身规则继续生效。完成后取回游标、关闭菜单。

已实测 Ars 戒指穿戴/取回，木板放戒指槽被原生拒绝且不丢物。折扣戒指还用于验证 Ars 实际不扣魔力的施法。全部饰品的特殊效果和诅咒尚未逐项测试。

## 回执与维护

新增 `maw_agent:mod_query/mod_action/mod_state`，UTF-8 JSON 原始字节、64 KiB 上限，单播实际请求玩家；殖民地和法术继续复用已有专用频道。SDK 共声明 19 个实际频道，网关可保留额外既有频道。没有周期聊天副本或替别的账号执行的参数。

写入前保存意图、requestId、本人 UUID、上下文和完整前置状态；写入串行。超时、断线、重生或未知结果后停止重放，先只读核对。服务端最近请求缓存、SDK 内存锁均不是跨重启 exactly-once；菜单点击内部 requestId 与外层 callId 分别记录。

隔离测试使用普通非 OP 生存账号，管理员仅提供明确记录的设备、材料、大学夹具和定位；没有模型调用，不算自主获取材料或长期经营验收。私有原始包、意图、结果、源/产物 SHA 和失败保留于 `research/mod-operations-20261008/`，不上传第三方 JAR、完整世界或凭据。

全部模组可操作、全效果、复杂工厂/物流/仪式/地下城机关、完整碰撞寻路、Java 画面完全一致及新服基岩仍未全量完成。继续保持 `allModsVerified/publicAccessReady=false`，详见 [能力矩阵](MY-AGENT-WORLD-EXTERNAL-READINESS.md)。常驻 MawExplorer 的历史未知导航与自主暂停按原记录保留。


## 本次发布验证

2026-10-08 已冷备、发布并恢复常驻服务。最终桥 SHA-256：`3abe0916341aaebbf9f44774c19a088233ce5599db873a2386ee48b118d9aa28`；运行 JAR、整包锁文件与 v14 资产来源一致，39767 文件完整性通过。355 项 Node 与 29 项锁定 Java API/构建测试通过，0 失败、0 跳过；93 条隔离原始回执保留。生产普通 Agent 又经实际 LAN 入口验证目录、本人三种新旧查询及原生饰品菜单开关，私有包 UUID 全部匹配本人。完整部署、冷备和维护回执见 [运维记录](MY-AGENT-WORLD-PERSISTENT-SERVER.md#原生模组操作发布2026-10-08)。

原生规则的拒绝也是结果：满员/访客/过期状态不能强制通过，未学符文和不合书等级的法术不能编辑，生存储罐直接用桶不被允许时不会绕过，排液器接受空桶交互但没有变化也不能称抽水成功。接入方应根据返回的事实安排下一步。
