# Mineflayer 移动脚本与调研（2026-10-21）

本轮将多路点行走、短程游泳、分段飞行封装成内置 `mc_script` 脚本，复用已有身体队列和物理实现。宿主一次下达目标，脚本在本地推进、核验和停止；逐段回执保留，不逐段唤醒模型。危险提醒仍即时发送。没有新增模型循环、服务端模组、控制器或后台进程。

## 三种脚本

先 `{"routine":{"op":"list"}}` 查目录，再 `{"routine":{"op":"read","id":"swim_to"}}` 读取实时参数 Schema、适用条件和源码；不要只凭本文猜参数。

以下各行为一次 `mc_script` 工具参数。坐标是绝对脚底格，必须指定当前维度；它们不是传送命令。

```json
{"routine":{"op":"run","id":"navigate_route"},"params":{"dimension":"overworld","waypoints":[[10,64,20],[15,65,20],[15,65,25]]}}
{"routine":{"op":"run","id":"swim_to"},"params":{"dimension":"overworld","at":[12,62,20],"within":0.8,"maxPulses":12,"pulseMs":500,"minOxygen":8}}
{"routine":{"op":"run","id":"flight_route"},"params":{"dimension":"overworld","waypoints":[[10,70,20],[20,64,20]],"budgetMs":15000}}
```

| 脚本 | 行为与核验 | 边界 |
|---|---|---|
| `navigate_route` | 依次精确抵达最多8个三维落脚格，保存每段实际起点/终点和任务编号 | 默认 `walkOnly:true`，只沿既有通路；显式 false 才允许原寻路器按权限拆搭。重复路点可组成有限巡逻，受阻不自动循环 |
| `swim_to` | 根据每次读到的位置和原生 yaw 转向；划水、上浮或松跳键自然下沉；以三维距离确认目标 | 必须已入水且未乘载具，目标须是已观察到的水格；不是水下 A*，不会自动绕水下洞穴。默认12次500ms，最多12次1000ms；三次无进展停止 |
| `flight_route` | 先用原有 `mc.flightPlan` 检查已加载空间、支撑、期限和预算，自动拆为12格以内航段，再逐段执行核验 | 必须已有服务端飞行许可；最多8路点、16航段。末段默认安全落地，`land:false` 才悬停；不提供鞘翅、喷气背包或魔法坐骑控制 |

水面横渡、阶梯和连续梯子优先使用原 `goto`/`navigate_route`。水下高度目标不能仅通过给 `goto` 填一个 Y 来实现。游泳脚本目前是短程闭环输入，遇墙会停止并返回未到达，而不是挖开墙。

`flight`/`land` 现在恢复重力后还会等待实际碰撞物理确认连续站稳；之前“坐标到平台就报告已落地”的时序缺口已修复。确认超时返回未确认，不把许可、动画或输入结束当落地证据。

## 回执与恢复

沿用 `agent-mc.work/v1`：`goalCompleted`、`outcome`、`reason`、`remaining`、逐段 `records`、`position`、`sampledAt`、`connectionGeneration`。移动脚本的 `inventoryDelta:null` 表示未采集库存差值。已经完成的路段不会回滚；部分完成后宿主应先观察现场，再显式选择剩余目标，不自动重放整条路线。

`mc.state().movement` 补充本体局部状态：

```json
{"feetWet":true,"headWet":true,"bodyWet":true,"oxygen":14,"yaw":-1.57,"pitch":0,"onGround":false,"vehicleAttached":false}
```

水格未知、氧气未收到时为 `null`，不会默认成20；yaw/pitch 是原生弧度。采样时间在外层 `sampledAt`。旱地氧气可能是旧元数据，只在确认头部浸水后用于换气判断。`snapshot.oxygen` 是原有摘要字段，游泳决策应使用这个新原始读数。

常见原因：`dimension_mismatch`、`operation_blocked`、`arrival_unconfirmed`、`water_state_unknown`、`oxygen_unknown`、`low_oxygen`、`no_progress`、`pulse_budget_exhausted`、`flight_not_allowed`、`flight_budget_insufficient`、`flight_permission_lost`。完整执行器回执仍保留在记录里。氧气不足先 `surface` 换气并尝试登岸；它只有找到干燥落脚点并站稳才算完整成功。飞行中断不等于已落地，应读取当前 `flight`/`movement` 再选择 `land` 或其他恢复动作。

取消、战斗接管、死亡、断线和超时沿用 MethodRunner/Executor。原生 `bot` 身体调用与 `mc.do` 的互斥不变；本轮脚本没有绕过队列直接写位置。底层许可飞行仍是原有客户端飞行控制，与正常鞘翅滑翔物理不同。

## 还有哪些值得脚本化

| 场景 | 当前入口或方案 | 下一步价值 |
|---|---|---|
| 长途赶路、有限巡逻、送货往返 | `goto` 已分近段寻路；新 `navigate_route` 串明确路点 | 路口、停靠点、失败位置可复用；不必让模型每走几格再下单 |
| 跟随/护送、撤离怪群 | 已有 `follow`、`goto_player`、`flee` | 以实体身份和状态跟踪，不能把旧坐标当仍在线；跟随不等于自动认定队友 |
| 游泳、换气、登岸 | 新 `swim_to`；已有 `control(mode:water)`、`surface` | 后续才是包含气泡点、氧气预算、进出水的三维水下路径搜索 |
| 飞行、悬停施工、降落 | 新 `flight_route`；已有 `flight`、`land` | 把许可期限与整段耗时放在动作之前判断，避免模型逐段思考耗尽飞行时间 |
| 梯子、藤蔓、台阶 | 现有路径器支持其可识别的攀爬地形 | 需要实测整段连续性与出口；看到一格梯子不能证明可以爬到屋顶 |
| 船、马、矿车 | 原有 `ride` 能力，按当前环境实际检查 | 载具身份、鞍/燃料/轨道/下车点需要分别验收，不能假设与地面 goto 同构 |
| 下界门、末地门等跨维度 | 已有显式 `transit` | 穿门后重采维度、位置及连接状态，再运行下一段路线 |
| 挖隧道、搭桥、脱困 | 已有 `tunnel`、`excavate`、`build`、临时支撑记录和 `cleanup` | 可以组合“明确改结构→核验→移动→清理”，避免普通赶路反复拆家 |
| 采集、农作、入仓补给 | 前一轮四种工作脚本 | 与移动路点组合成有限生产任务；不用另开 NPC 控制线程 |
| 钓鱼、烹饪、熔炼、工作台、村民交易 | 已有 `fish`、`smelt`、`craft`、`use` 等 | 适合以后补条件明确、带库存与菜单核验的配方；交易用 `use target:villager`，没有独立 trade 技能 |
| 鞘翅+烟花、激流三叉戟、Create/魔法载具 | 当前未作为通用移动脚本开放 | 必须有对应物理、装备/消耗、障碍检测和落点验收；不能拿“允许飞行”代替 |

## 开源方案取舍

以下是阅读上游文档/源码后的判断，第三方能力宣传不等于我们已集成或实测。没有替换当前锁定依赖。

- **继续使用 `mineflayer-pathfinder` 2.4.5**：MIT，可配置 A* 运动代价、目标、拆搭和动态重算。水面通行、跳跃、攀爬已有基础，适合承接当前队列；本地锁定源码的下行动作遇到当前格是液体就退出，不能据“支持 swimming”推断完整水下三维导航。上游 README 新增 `createHuman` 的拟人行走，但已发布/锁定2.4.5不能只凭同一个版本字段就假定含该API。需要单独选定提交并验证后才能使用。[上游](https://github.com/PrismarineJS/mineflayer-pathfinder/tree/d773d15ff1bb271090122b3c7106a519a68bbbd9)
- **`@miner-org/mineflayer-baritone` 4.6.2 是水下候选**：README 声称包含水面/水下和出入水、跳跃、梯子、部分路径重算，入口是 `bot.ashfinder`；它是 JS 项目，不是 Java Baritone。package 声明 ISC，并依赖额外的 physics-reworked/physics-util。要隔离比较氧气、碰撞、取消与我们现有修正，不宜与当前路径器同时争身体。[源码与说明](https://github.com/miner-org/mineflayer-baritone/tree/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2)
- **`SpectraPhysics` 1.4.0 是物理候选**：作者宣称更接近原版碰撞、传送后首 tick、游泳姿态、气泡柱、船、鞘翅烟花及激流，并带自己的路径器。这不是几个游泳函数，而是替换 physics/输入/库存等行为的组件；当前 manifest 为 GPL-3.0-only，且依赖 minecraft-data≥3.117.0，与我们的锁定3.112.0不同。应作为独立 transport/实验 backend 核验，不能直接拷进当前 MIT 核心或默默升级协议数据。[说明及许可](https://github.com/trqxyz/SpectraPhysics/tree/1ea12c8de3edbf9b3091c75569c80608ee886777)
- **Java `Baritone` 适合真实客户端桥**：Java 客户端已有完整模组身份，Baritone 的路径结果可经桥转成同一套动作/取消/终态；不能直接 `require` 到 Mineflayer。其 #elytra 文档强调下界烟花路线，不能据此宣称所有维度通用飞行已完成。当前开发主分支为1.21.4；1.21.1分支已被标记弃用，旧环境必须选匹配构建，不直接装“最新”JAR。[当前仓库](https://github.com/cabaletta/baritone/tree/62c784d8b3ac471d70fabb203ac11391b4a0a68b)、[1.21.1分支说明](https://github.com/cabaletta/baritone/blob/1.21.1/README.md)
- **`mineflayer-statemachine` 适合借鉴状态组织**：将寻找、跟随、观察等小行为连起来；移动行为仍依赖 pathfinder。我们的执行器已经承担身体调度，本轮沿用状态迁移思路，不再创建并行身体调度器。[上游](https://github.com/PrismarineJS/mineflayer-statemachine/tree/30193e6d7fec2754a3de72876abeeaf6931cd23d)
- **不采用旧 navigate/scaffold 或修改飞行物理的 elytrafly**：前两者已声明弃用；elytrafly 自述为作弊式飞行，flyTo 也不做寻路。Mineflayer 官方 `bot.elytraFly()` 只启动滑翔，不是完整飞控；`creative.flyTo()` 也只是直线移动，不能当避障算法。[navigate](https://github.com/PrismarineJS/mineflayer-navigate)、[scaffold](https://github.com/PrismarineJS/mineflayer-scaffold)、[elytrafly](https://github.com/amoraschi/mineflayer-elytrafly/tree/722e7b4f0612194e0554eb1bb5a4dfb1d680ca22)、[官方API](https://github.com/PrismarineJS/mineflayer/blob/7b4bb8d2b56be9cdb832474af873acd37e609746/docs/api.md)

进一步检查 JS Baritone 的 [swin.js](https://github.com/miner-org/mineflayer-baritone/blob/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2/src/movement/swin.js)：它确实分别生成水平游、入水、登岸、上浮和1–3格下潜的搜索邻居，比当前路径器的液体下潜缺口更贴题；不过这个邻居生成文件没有把氧气/剩余换气时间加入搜索状态，仍需检查执行器和长程路线的呼吸策略。其 [flight.js](https://github.com/miner-org/mineflayer-baritone/blob/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2/src/flight.js) 仅做航点线性插值、限高和计算朝向，该文件本身不处理碰撞或落地，不能单凭文件名就当完整飞行路径规划。下一步实验优先比较水下搜索，保留现有许可/碰撞/落地控制。

NPC 模组的服务端导航能直接访问世界、为其专属实体设置路线；这些 Java Goal 不能直接作为玩家 Mineflayer 的 JS 函数执行。可复用的是“有界搜索、分步状态、失败冷却、进展核验”的设计。Folkways 的道路 Starlark 描述建筑形状，修路与寻路也应分开。参见 [前一轮 NPC 源码调研](work-routines.md#借鉴来源)。

## 验证边界

测试和打包证据见仓库根目录 `docs/evidence/mineflayer-movement-20261021.json`。本轮不会把仓库源码或本地打包成功当成宿主已经更新、正式服务器已经在线，或所有模组载具与动画都已验证。
