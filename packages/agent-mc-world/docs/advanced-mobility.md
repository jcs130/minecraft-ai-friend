# 水下绕障、载具与普通鞘翅（2026-10-21）

在基础移动脚本之上，新增 `swim_route`、`ride_route`、`portal_route`，目录现在共10项。这些是 `agent-mc-world` 核心的共享能力，通过 SDK/MCP 提供给各类宿主和角色。所有执行仍归原 MethodRunner/Executor 身体队列；没有新模型循环、后台控制器或端口，也未替换锁定的 Mineflayer/物理库。

本页的路线执行与原生载具接口当前由 Mineflayer 后端提供。先用 `await mc.capabilities()` 检查本连接的 `botMethods` 和 `mcMethods`；完整 Java 客户端等后端只声明已实现的能力，不能把共享接口名称当作所有身体已具备相同实现。水位和眼高沿用主干的 `breathingReadout`；原生水中输入不会被旧版固定氧气阈值拦截，内置 `swim_route` 自己核验所选氧气保留量。

## Agent 调用

先查 `mc_script {"routine":{"op":"list"}}`，再按需 `routine:{op:"read",id}` 读取实时 Schema 和条件。例子是 `mc_script` 的参数，坐标必须取自当前世界，不能照抄示例执行。

```json
{"routine":{"op":"run","id":"swim_route"},"params":{"dimension":"overworld","at":[30,60,10],"reserveOxygen":6,"maxDurationMs":45000}}
{"routine":{"op":"run","id":"ride_route"},"params":{"dimension":"overworld","target":"boat","entityId":123,"waypoints":[[10,63,20],[20,63,20]],"dismountAtEnd":true}}
{"routine":{"op":"run","id":"portal_route"},"params":{"dimension":"overworld","portals":[{"at":[10,64,20],"fromDimension":"overworld","toDimension":"the_nether"}]}}
```

`swim_route` 通过一次 `mc.do` 执行整段水下三维路线，转向和短输入在本地继续，不逐格唤醒模型。原来的 `swim_to` 仍保留作短程直接控制。新的 `swim` 技能也可直接用于 `mc_do` 或 `await mc.do([{skill:'swim',at:[x,y,z],dimension:'overworld'}])`；`dryRun:true` 只试算。

只读的结构化试算接口是：

```js
return await mc.swimPlan({at:[30,60,10],reserveOxygen:6});
```

返回 `agent-mc.swim-plan/v1`：`complete`、`reason`、`waypoints:[{at,breathe}]`、`expanded`、`planningMs`、`estimatedMs`、`waterBreathingMs` 等。试算不证明到达。执行后的 `mc.state().lastSwim` 是带 `taskId` 和采样时间的**上一次动作报告**，不是持续更新的当前位置；当前身体位置仍读 `snapshot.position`。

## 水路边界与恢复

- 只搜索当前已加载、32格内的水域，最多4096展开节点，搜索按小批次让出事件循环，并有500ms规划预算。未知格不当空气；只使用碰撞/液体几何，不输出隐藏矿物身份。
- 使用六向相邻格，检查完整站立身位；不会斜穿两个墙角，也不会隔着中间实心层跳到更深的水格。尚未支持趴泳钻一格高缝隙。
- 氧气按当前真实读数与保留量计算，未知不会补成20。路径中的换气点是规划假设，实际必须确认头部出水并回满氧气后，才按满氧气继续下潜。
- 连续水面路段不等待氧气满值；只有下一段要进入水下时才核验补氧。等待期间用有界上浮输入保持换气，取消或控制权变化仍会释放按键。能力索引分别报告身体接触水和头部浸水，露头换气时仍提供水路选项。
- 实际存在的 WaterBreathing/ConduitPower 效果按剩余时长参与预算；不能凭道具名或“会魔法”推断有此效果。效果结束后恢复氧气核验。
- 执行保留真实游戏物理；每次输入后核对位置、氧气和进展，卡住最多重算两次。截止时间、低氧、载具变化、取消或维度变化均停止并保留失败报告，不自动重放。
- `lastSwim` 记录 `controlPulses`、`replans`、`breathStops`、`elapsedMs` 和实际坐标。`swim_route` 的 `agent-mc.work/v1` 回执附完整 `route`；宿主可比较完成率、SDK调用、耗时与恢复次数，不能把线程完成等同目标成功。

失败后读取 `reason` 和实际位置。低氧优先 `surface` 换气/登岸；它只有实际站上干燥落脚点才算完整完成。水路失败不清空宿主记忆或重启连接。

## 指定载具与连续穿门

`ride` 新增 `entityId`，须与 `target` 一起给。ID只属于当前连接所见实体；失效、遮挡、类型不符或挂载到别的载具时停止，不改骑最近同类。仍需按真实库存准备鞍和控制物品。

`ride_route` 默认不下车，只有 `dismountAtEnd:true` 才显式下车。驾驶继承现有原版船、猪和炽足兽能力；马科仍仅支持骑乘/下车。坐骑身份变更时不继续写旧位置，也不擅自卸下新坐骑；到达还会等待短暂纠偏窗口。驾驶到达按水平距离核验，Y并不是已验收的楼层。

`portal_route` 要求每段给出入口坐标和实际的起始/目标维度。跨入意外维度就停止后续步骤，回执保留实际位置及剩余门段；不能把两端坐标按8倍缩放后直接当已发现的出口。同维度只接受原 `transit` 证实的大于64格末地折跃。传送门定位和未知维度地图发现仍由宿主规划。

原有跟随、逃跑和攀爬继续使用同一执行器。跟随可以被战斗挂起后继续，也能取消；它不会让模型每100ms醒一次。连续梯子与出口平台交给原路径器，缺失梯段或出口受阻应报告具体失败，不反复提交同一个目标。

## 普通鞘翅与模组载具原生输入

通过 `mc_script api:<name>` 按需查签名，所有 `bot` 方法逐个 `await`。首次身体调用取得现有队列的独占租约；之后不能再在同一程序中调用 `mc.do`。

| 方法 | 实际含义 |
|---|---|
| `bot.elytraFly()` | 身在空中、已装备鞘翅、正常物理时，发送原生展开动作，等待服务端确认实际滑翔。不给创造飞行权限，不写位置或速度 |
| `bot.look(yaw,pitch)` | 原生弧度朝向，供实际鞘翅物理转向；烟花须真实持有再 `activateItem`，另核验库存消耗 |
| `bot.read('entity')` | 本体位置、速度、朝向、onGround及nullable `elytraFlying`；输入结束不代表已落地 |
| `bot.read('vehicle')` | 当前附着实体的ID、名称、绝对位置或null；只代表当前客户端连接观察 |
| `bot.mount(entityId)` | 交互距离内挂载当前确实观察到的指定实体，并等待精确身份确认 |
| `bot.dismount()` | 等待附着清除；不保证下车点干燥、安全或适合继续步行 |
| `bot.moveVehicle(left,forward,ticks)` | 原生左右/前后输入，各轴-1..1，1–100刻。正常结束或取消会发零输入，旧程序不会清掉新控制者的输入 |

真实客户端/服务端自行处理输入的模组载具可以从这组原生入口继续适配；**发送输入不等于模组支持它，更不等于抵达**。Mineflayer缺少的载具物理/自定义频道仍需要对应桥接，不能宣称所有Create、飞机、船或魔法坐骑已自动支持。

普通鞘翅取消后会继续按游戏物理滑翔，无法像创造飞行那样原地悬停；不要通过关物理或修改速度伪造“安全停止”。本轮开放和核验的是展开、转向与读数接口，尚未提供任意地形长途鞘翅自动驾驶或自动选择起降点。

深坠自保现在识别实际 `elytraFlying` 状态，不累计正常滑翔的落差；仅装备鞘翅或请求展开不构成豁免。实际滑翔结束后重新按自由落体判定；已经产生的坠落冻结仍须稳定安全落脚才能解除，不能在半空打开鞘翅就丢掉冻结令牌。

## 为什么没有直接换成 JS Baritone

研究锁定 [miner-org/mineflayer-baritone 5bbb91e](https://github.com/miner-org/mineflayer-baritone/tree/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2)。它的 [loader](https://github.com/miner-org/mineflayer-baritone/blob/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2/src/loader.js) 会安装 ashDig，另可替换物理；与既有补丁和身体写者不能无条件叠加。[swin.js](https://github.com/miner-org/mineflayer-baritone/blob/5bbb91eeb2ace18b4c83a56d00fcd494f0f976f2/src/movement/swin.js) 有值得借鉴的分立水路动作，但对未改动邻居生成器的两项隔离夹具观察到：

1. 中间y=65为实心层时，仍发出从66到63的下潜邻居。
2. 两个正交邻格为实心时，仍发出夹角后的斜向水路邻居。

这说明该阶段可生成有问题的候选路线，**不是其完整执行器已经穿墙的证据**；没有据此给整个项目下结论。完整插件未装入核心或生产进程。我们独立实现当前有界搜索，保留原有物理、保护与单写者，相关地形反例进入核心回归测试。

正常鞘翅基于已锁定 Mineflayer 与 prismarine-physics 的原生能力，参考 [官方 elytraFly](https://github.com/PrismarineJS/mineflayer/blob/7b4bb8d2b56be9cdb832474af873acd37e609746/lib/plugins/physics.js)，未升级依赖或引入作弊式elytrafly。

主干集成验证见仓库根目录 `docs/evidence/core-shared-mobility-20261021.json`；实验分支的隔离服实测记录见 [原始验收摘要](https://github.com/jcs130/minecraft-ai-friend/blob/4b1ce4d5ca57b3d350c0b6e7c489c1e0a3d31d3b/docs/evidence/advanced-mobility-20261021.json)。主干适配会重新测试、构建和验收独立消费者，不把旧包的联机结果称为新包实测。源码更新不代表现有 Agent 宿主已经更新，也不代表正式服已经重启。
