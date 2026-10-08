# My Agent World：Agent 原生功能调用接口

2026-10-05 起按用户要求，以“各项功能能够被 Agent 发现、读取并调用”为当前验收标准。自主采集、长期经营和模型独立建城是后续可选测试，不再作为接口交付的前置条件。2026-10-08 已扩展服务端原生操作与统一客户端入口，新增殖民地岗位/研究、符文学习/编书、机械设置/过滤/流体读取与饰品栏；具体流程和实测范围见 [模组操作指南](MY-AGENT-WORLD-MOD-OPERATIONS.md)。尚缺的专用操作见 [能力清单](MY-AGENT-WORLD-EXTERNAL-READINESS.md)。

## 挂接与发现

在普通玩家自己的 Mineflayer 连接上、`spawn` 前挂接 `attachModAgentClient(bot)`，连接与锁定依赖见 [接入指南](MY-AGENT-WORLD-EXTERNAL-AGENT-GUIDE.md)。不创建管理员连接，也不选择其他玩家作为执行者。

```js
const { attachModAgentClient } = require('./world/src/neoforge-handshake/mod-agent-client.cjs')
const sdk = attachModAgentClient(bot)

const catalog = sdk.operations()                   // list：本地已绑定操作目录
const explain = sdk.operations('colony.resources') // explain：说明、读写属性、JSON Schema
console.log(catalog.operations, explain)

bot.once('spawn', async () => {
  const result = await sdk.call('native.recipes', {
    recipeType: 'minecraft:crafting', outputId: 'minecraft:crafting_table', limit: 2
  })
  console.log(result) // 保留原生结果；失败仍是失败
})
```

`operations()` 是实际适配器的 **48 项调用绑定**，`remoteSupportVerified=false`；目录存在不表示当前服务器、机器或角色满足条件。`operations(id)` 的未知 ID 返回 `mod_operation_not_found`。`call(id,args)` 严格核对目录参数；未知操作、额外玩家参数、非法坐标或槽位在发送前拒绝。

| 命名空间 | 项数 | 范围 |
| --- | --- | --- |
| `menu` | 2 | 本人窗口缓存、真实左右键 PICKUP |
| `world` | 2 | 本人原生视线、可见方块的原生主手交互 |
| `native` | 2 | 真实配方分页、已跟踪可见实体身份 |
| `colony` | 15 | 权限/蓝图/需求、建镇/小屋/供料、岗位/招聘/暂停和研究 |
| `maid` | 7 | 本人女仆状态、任务、跟随、拾取和真实背包菜单 |
| `spell` | 8 | 本人法术状态/说明、符文目录/学习、编书/选槽和原生施法 |
| `domum` | 4 | 本人切割台缓存、状态、完整变体和原生选择 |
| `collision` | 1 | 本人可见方块的有限真实碰撞查询 |
| `create` | 4 | 原生数值/过滤面板、流体罐读取与修改设置 |
| `curios` | 3 | 本人真实饰品槽、原生菜单打开与翻页 |

合计 23 项只读、25 项变更。其中 `menu.current/spell.current/domum.current` 是本地缓存读取，未收到或失效时返回 `null`，不能当作远端成功。完整参数以运行时 `operations(id).operation.parameters` 为准，避免手工维护第二套参数定义。

`sdk.tools()` 仍是 Maw 身体执行器的 27 项计划描述，和上述可直接调用目录分别记录。它没有 `execute(plan)`。移动、采集、攻击、普通右键及合成/放置仍使用已有身体执行器或接入方自己的 Mineflayer 调度；`lookAtBlock` 等接收 Block/Vec3 的直接 API 不混入 JSON 调用目录。FD 料理、Create 磨粉等以真实方块交互和 `menu.click` 为底座，新增 `mod` 身体工具复用这 48 项绑定，支持 list/explain/call；`look` 控制真实朝向。并未增加所有机器的专用管理接口。

## 调用与实际结果

每次调用只使用该连接所属角色。返回底层适配器的原生回执或状态副本，不套一个合成的 `ok:true`，不把 JSON 写进聊天。服务端的距离、所有权、原生权限、完整组件与槽位 CAS 检查继续生效。

- `sdk.call('colony.resources',{buildingPosition:{x,y,z},offset:0,limit:12})` 后按真实 `nextOffset` 翻页；本人殖民地只读查询相隔约 650 ms。
- 打开真实女仆背包或机器后，读取 `sdk.call('menu.current')` 的实际窗口，再调用 `sdk.call('menu.click',{slot,button:0})`；`slot` 来自当前布局，不能复用旧窗口编号。
- `sdk.call('spell.list')` 读取本人当前真实书的配置槽；用真实 `spellId` 调用 `spell.explain/cast`。未持书、未配置或缺魔力是正式拒绝。施法确认与目标命中分别核验。
- 切割台先 `domum.state/choices`，再 `domum.select`；选择变体必须同时传真实 `variantIndex/choiceSnbt`，不接受调用方覆盖缓存 `state`。取出仍走真实菜单。

位置均为绝对坐标。交料的 `expectedSnbt` 取本人实时库存；建筑需求模板和他人物品不能作为自己的库存前置条件。入库、登记施工或切换劳动任务不等于最终完工。

## 变更调度与恢复

`sdk.call` 同时只派发一个变更；有待定变更时另一变更在发送前拒绝，只读查询可以继续。`sdk.callStatus()` 返回在途操作、上下文 epoch 和未知结果阻断状态。该约束只覆盖 `sdk.call`；直接使用 `sdk.colony.*` 或身体执行器的操作由接入方统一调度，不能假定它们自动共享此锁。

超时、断线、重生、身份变化或原生结果未知会阻断后续变更。原已派发动作不自动重试；只读检查继续可用。拒绝且明确未派发/未生效的操作不产生未知阻断。迟到的旧上下文结果不能恢复旧窗口或法术书缓存；法术回执须同时匹配本人 UUID、待定 requestId 和 action。

接入方先持久保存动作意图和可用的原生 requestId，再保存实际回执。菜单点击内部生成原生 requestId，外层可另存自己的 callId。SDK 内存锁不替代持久账本；重连或重新创建 SDK 不能把原未知动作当成未执行，也没有“清空未知后继续写”的恢复接口。核验后再人工决定新的步骤，保留旧失败和未确认记录。

## 2026-10-05 历史验证

完整 Node 回归 **342 通过、0 失败、0 跳过**。单测覆盖 30 项精确调用映射、参数边界、并发变更、未知阻断、重生/断线退役、账号隔离、缓存副本和监听器清理。最初未设置 `NODE_PATH` 的依赖加载失败保留在私有报告，正确加载锁定运行依赖后通过。

普通非 OP 账号 MawApiCallQA、最终源码独立账号 MawApiCallQB 各进行 12 次真实隔离服调用，包含 2 次物品“库存→游标→库存”变更，完整槽位及游标守恒；未开切割台时正式返回 `architects_cutter_menu_not_open`，未发现私有回执串号。实际调用次数、最终源码哈希和每次意图/原始回执保存于 `research/native-call-api-20261005/`，最终源码复测单独保存于其 `final-source-live/`，不覆盖前次记录。不是 30 项全部玩法场景通过，也不是模型自主测试。两次隔离 QA 均已正常关闭，子进程退出码 0。

上述 2026-10-05 SDK 轮次无需改桥 JAR、资源包、端口或重启常驻主世界；旧 Paper 和其他服务保持。源码交付可供新外部客户端挂接，不代表常驻玩家已切换到新的统一入口，也不解除原自主暂停。

## 2026-10-08 原生操作扩展

新增18项实际绑定，当前为48项、19个SDK频道、27项身体工具。测试、原生操作与明确限制见 [模组操作指南](MY-AGENT-WORLD-MOD-OPERATIONS.md)。研究成本和学习符文真实扣料，机器/饰品使用原生逻辑；全部回执仅发本人。零费用施法凭原生实际 expenditure 事件确认，不能因 `manaSpent=0` 就判失败；原生过程不明确时 `outcomeKnown=false`，暂停变更。
