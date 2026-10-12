# Folkways 与 Agent 接入（2026-10-13）

本轮为隔离环境验证，**尚未安装到正式服**。正式服仍是原有 35 个 JAR；不覆盖世界、玩家背包、原 Agent 身份或记忆。版本、下载地址与 SHA 锁定在 `manifests/society-folkways-1.21.1.lock.json`。

## 选型与职责

用户描述的自动委托、农牧生产、货物蛙港和列车通勤对应 [Folkways](https://github.com/IzakyL/folkways)，与现有 MineColonies 分别提供玩法。此次审阅源码为 `5567e84e872a674b1e5a3c764d226bcab348d63b`；下载的是上游 nightly 0.1.0，搭配 LDLib 2.2.42、现有 Create 6.0.10。nightly 是预发布，不承诺生产稳定性。

LLM 决定建哪里、种什么、生产和运输什么；既有 SDK 控制玩家身体；Folkways 原生居民执行殖民地工作。居民是 Mob，不冒充 Mineflayer 或 Numen 玩家。模型、凭据和推理调度继续位于 Agent 端。

## 本轮开放的 SDK 操作

继续使用同一条游戏连接和原 `sdk.read` / `sdk.submit` / `sdk.wait`，没有新增远程管理端口。

| 操作 | 用途与边界 |
| --- | --- |
| `folkways.catalog` | 原生委托类型、形状上限和可招募居民类型；本轮区域只支持 Volume，使用原生默认设置 |
| `folkways.state` | 手持殖民书所绑定聚落、居民 UUID/实际坐标、区域绝对边界和仓储位置 |
| `folkways.found` | 给真实未绑定殖民书创建聚落；已绑定时保留原身份 |
| `folkways.member` | 以期望 `joined` 值登记/撤销近处可见箱子、床和工作台；检查原方块、保护与归属 |
| `folkways.zone` | 原生委托区域，绝对 `min/max`，最多 4096 格、两角距本人不超过 32 格；不强制加载区块 |
| `folkways.hire` | 原生移民请求；保留床、食物、队列和时间条件，不强行召唤 |
| `folkways.orders` | 本聚落原生配送/维持订单及目的地 |
| `folkways.order` | 对已登记目的地设置 `deliver/maintain/withdraw`；居民自行取货与执行，不凭空生成物品 |
| `folkways.logistics` | 本人有原生管理权的可见 Create 包裹网络、货物、蛙港、柜台与故障 |
| `folkways.logisticsLink` | 按期望 `joined` 接管/交回网络；保留网络所有权、拓扑与运转条件 |
| `folkways.rail` | 本聚落接管的真实列车、时刻表错误、站点、列车长和座位；无列车则返回空数组 |

安装后先查 `sdk.capabilities()` 和 `sdk.operations(id)`，不要根据客户端的静态目录推断服务端已支持。未装 Folkways 时服务端不声明这些能力，直接调用返回明确不可用。客户端总目录 132 项；直接模组适配 122 项；Numen 原生同步路由表 110 项（运行时会过滤未安装的可选模组）。数字代表接口数量，不代表全部玩法已验收。

管理依据是上游**真实手持绑定殖民书**，可转移书的原生机制保持；没有新增 UUID 管理员后门，也不枚举其他聚落。动作有唯一 `action_id`、完整终态和原有持久账本；未知结果停止，不换 ID 自动重试。

```js
const state = await sdk.read('folkways.state', {})
// 手持真实殖民书，先按 catalog/state 建立床、食物、仓储等条件。
const request = {
  action_id: 'settlement-delivery-unique-001',
  operation: 'folkways.order',
  args: { position: { x: 2, y: 180, z: 3 }, expectedBlockId: 'minecraft:chest',
    mode: 'deliver', itemId: 'minecraft:oak_planks', low: 1, count: 8, rank: 0 }
}
// 示例坐标属于隔离测试世界，正式使用时必须替换为实际观测位置。
const accepted = sdk.submit(request)
if (accepted.accepted) console.log(await sdk.wait(request.action_id, { timeoutMs: 45000 }))
// 接单成功只证明订单保存；再查 orders，最终检查目的地真实库存。
```

## 真实验证与已修复问题

独立 28978/28979 端口、独立存档和普通 QA 账号，未调用付费模型：

- 注册绑定殖民书、箱子、床、工作台和 4 格农田区域；重连后聚落身份保留，同 ID 不重派动作。
- 原生移民条件满足后产生真实居民；下达配送 8 块橡木木板订单，居民完成后订单消失，普通箱子实际出现 8 块木板。
- 第二普通账号无书时查不到该聚落。
- 普通 Agent 实际走近农田，拒收未成熟小麦，收获成熟小麦，使用已有真实种子补种，服务端确认小麦 `age=0` 与种子消耗。
- 修复 Folkways 在普通箱子旁附加 LDLib UI、向无此频道连接发送 `ldlib2:modular_ui_sync` 导致异常的问题。仅对无该频道连接移除 Folkways 的附加界面，保留原箱子真实槽位；不谎报支持频道。具备 LDLib 的 Java 客户端保留原 UI 分支，尚未做真人画面验收。
- 修复前置身体快照与后续准星查询共用两 tick 读取预算的问题；最多重读 3 次明确被限速的只读查询，消耗动作不重放，重生/跨维度时作废旧观察。

失败尝试与未知回执原样留在本机私有 research，不以之后成功覆盖旧证据。

## 尚未通过的部分与发布要求

Create 包裹网络、列车的读写入口已接原生 API，但**完整蛙港实物配送和居民坐车通勤尚未验收**；空列车列表不能算铁路已建成。NPC 全季种植、畜牧、钓鱼、建造样式和自定义农田设置也未覆盖。

Folkways 专用 Web GUI、居民渲染、基岩模型/表单和资源包尚未适配，不能称三端全部可玩。新增优化模组也会重排大量原生网络编号：当前性能候选组合有 3404 个物品、2899 个方块的编号/状态记录与正式号表不同。不得把候选 JAR 直接放入正式 mods 后沿用旧号表。

发布前必须以**最终相同模组集合**用现有桥内 `/maw_registry dumpids` 导出完整号表，生成并校验网关映射、原生 Web 资源和基岩桥，再完成真实登录与菜单验收。额外诊断模组本身也可能改变编号，不能用于最终号表。导出命令限 OP 4，会短暂占用 tick，只在无人维护时执行。

随后按既有原 owner 流程正常停服、校验冷备 CRC/逐文件 SHA、安装、恢复原守护；保持 `MawExplorer` 自主暂停和原未知动作，不重放历史维护脚本。暂未执行这些正式发布步骤。

源代码复用研究与玩家种田工具见 [FOLKWAYS-AGENT-REUSE.md](FOLKWAYS-AGENT-REUSE.md)。
