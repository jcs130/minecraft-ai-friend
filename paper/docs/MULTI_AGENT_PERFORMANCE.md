# 多 Agent 服务器容量与性能验收

记录日期：2026-10-05，北京时间。本文记录 Paper 1.20.6 的多 Agent 优化及隔离容量测试，与 [单次内存故障诊断](PERFORMANCE.md) 配套。当前状态：正式服于 02:18 加载 AgentFriend 0.3.83 / CortiEyeMirror 0.1.9，启动补丁与展示包预热通过；02:22 完整一分钟为 20 TPS、平均 tick 5.6 ms。CortiEye 原机客户端尚未回连；自然地形冷探索保留未通过，不承诺全负载自主玩法容量。

## 容量目标与运行设置

目标是允许 **40 个连接**，其中主要负载为 **16 个 Agent + 各自的 16 个 Eye**，共 32 个连接，其余 8 个槽位留给真人或其他服务账号。现有登记表支持最多 16 对 Agent/Eye；40 个连接上限不等于支持 40 个独立 Agent。

Eye 是附身于对应 Agent 的观察者。它仍消耗网络、实体跟踪、HUD 和私有消息转发资源，应与 Agent 一起计入测试连接数。Goddess 等独立观察者也占连接槽位。提高 `max-players` 只放宽接入上限，不会加快 tick。

此次设置已在隔离服验证，并于 02:18 正式重启后核对：

| 设置 | 本次决定 | 理由或边界 |
| --- | --- | --- |
| `max-players` | 正式值 40（原值 8） | 开放接入槽位；不是性能提升指标 |
| `view-distance` / `simulation-distance` | 保持 8 / 8 | 保留当前视野与实体模拟范围 |
| Java 堆 | 保持 `-Xms1G -Xmx4G` | 先验证修复后的真实负载，不以扩堆掩盖缓存增长 |
| Paper 区块线程 | 保持当前 1 IO / 6 worker / 6 gen | 本次不调整线程数 |
| `world-settings.default.entity-activation-range.ignore-spectators` | 正式值 `true` | 观察者不应单独扩大附近实体的激活范围；保留实体激活距离数值 |
| `spectatorsGenerateChunks` | 保持 `true` | 保留当前 Paper 1.20.6 附身与跨世界 Eye 兼容性 |

实体激活范围会影响实体更新和玩法；配置含义参见 [Spigot 配置说明](https://www.spigotmc.org/wiki/spigot-configuration/)，`ignore-spectators` 字段见 [Paper 对应配置源码](https://github.com/PaperMC/Paper/blob/main/paper-server/src/main/java/org/spigotmc/SpigotWorldConfig.java)。视距与模拟距离的含义参见 [Paper server.properties](https://docs.papermc.io/paper/reference/server-properties/)。这些在线文档可能面向较新版本，本次以实际 1.20.6 隔离实例的配置和行为验证为准。

官方在 [24w33a 修复清单](https://www.minecraft.net/en-us/article/minecraft-snapshot-24w33a) 中列出 MC-273672：关闭 `spectatorsGenerateChunks` 后，玩家可能无法正常停止观战实体。它是保留当前兼容设置的依据之一，不能把较新版本修复视为已回移到本服 1.20.6。

## 堆缓存修复与 4 GiB 决策

AuraSkills 2.4.0 的消息缓存键错误已于 2026-10-04 23:52 在原正式 JVM 中修复，清理 **10133384** 条重复组件；随后自然 GC 将堆使用量从约 3.94 GiB 降至约 **0.92 GiB**，没有调用 `System.gc`。最近一分钟 MSPT 在 23:57 的采样为平均 6.9 ms、最大 23.9 ms。修复原理、版本锁定、回退和完整前后证据见 [PERFORMANCE.md](PERFORMANCE.md)。

固定补丁路径为 `E:\MC\ops\instrumentation\auraskills-cache-patch.jar`，工具 SHA256 为 `68dfb98c3de4d2f6397614208b4b0dfe815d1f2e849216ea1bc91f979b33e1bd`。正式新 JVM PID 32992 于 02:18:04.312 写入 `startup-verified` 回执，`success` / `transformApplied` / `behaviorVerified` 均为 `true`，已完成正式启动验收。

0.92 GiB 是修复后当时的正式服读数，不能当作 32 或 40 个连接的峰值。此次暂留 4 GiB 上限；后续扩堆应依据负载期间堆峰值、自然 GC 停顿与系统余量。Java 堆使用量、进程工作集和 private bytes 是不同指标，不混用。

## 已完成的源码优化

正式 AgentFriend 0.3.83 包含此前 0.3.82 的 Viewer 优化，以及本轮保守改进。以下均保留现有魔力消耗、技能特效、消息隔离和更新频率；正式发布证据见后文。

| 路径 | 改动 | 保留的行为 |
| --- | --- | --- |
| [ViewerStatePublisher](../plugins/AgentFriend/src/org/afuhome/agentfriend/ViewerStatePublisher.java) | 未订阅新旧 Viewer 通道时提前返回；固定中文名称按类型和 ID 缓存 | 5 tick 轮询、5 秒心跳、实时魔力/冷却/技能经验、双通道路由 |
| [ProspectingSpell](../plugins/AgentFriend/src/org/afuhome/agentfriend/ProspectingSpell.java) | 按立方壳表面枚举，省去每层内部坐标的重复循环 | 相同矿物类别、候选访问顺序、同距选择、世界高度限制和不加载未加载区块；施法仍同步完成 |
| [AgentStatePublisher](../plugins/AgentFriend/src/org/afuhome/agentfriend/AgentStatePublisher.java) | 最终 JSON 编码一次，同时复用字符串和 UTF-8 字节 | 输出逐字节一致、16 KiB 上限及原裁剪顺序、每秒轮询和施法后即时更新 |
| [PlayerNameTags](../plugins/AgentFriend/src/org/afuhome/agentfriend/PlayerNameTags.java) | 每轮跨记分板共用身份结果，固定前缀组件缓存；按登记名称直接查对应 Eye | 40 tick 核对、名称大小写不敏感、旁观者无铭牌、其他插件队伍不被覆盖，以及 UUID/世界/附身目标守卫 |
| [VillageWatchManager](../plugins/AgentFriend/src/org/afuhome/agentfriend/VillageWatchManager.java) | 全世界实体扫描改为村庄固定范围的已加载区块扫描；同 tick 死亡事件合并下一 tick 扫描 | 40 tick 周期、原 `nearVillage` 圆角边界、全高度 Raider 集合、Raid 优先、死亡奖励立即保存、公开状态调用立即读取最新世界 |
| [AgentFriendPlugin 的 waypoint 查询](../plugins/AgentFriend/src/org/afuhome/agentfriend/AgentFriendPlugin.java) | 移除查询路径中的 `performCommand("homes")`，继续直接枚举 `user.getHomes()` | 列表查询不移动角色、不切世界、不减少魔力；主动传送仍按既有技能规则执行 |
| [CortiEyeMirror 启动预热](../plugins/CortiEyeMirror/src/org/afuhome/cortieye/CortiEyeMirrorPlugin.java) | 启动阶段创建并浅复制既有 14 种展示包后丢弃，记录初次与重复耗时 | 不发送测试包，逐包转发路径、HUD/私聊路由及更新频率保持 |

隔离跨世界测试发现 Essentials 在只有一个 home 时，执行 `homes` 会直接传送；旧列表查询因此可能意外移动角色并加载远处区块。此问题已在最终 0.3.83 候选修复，之前的候选 JAR 已废弃，不用于正式发布。

### 可复现的工作量变化

探矿缺矿场景的枚举上界与实际方块查询：

| 范围 | 原循环枚举上界 | 优化后枚举上界 | 实际矿块查询（前后一致） |
| --- | ---: | ---: | ---: |
| 24 | 780625 | 117649 | 57777 |
| 48 | 11527201 | 912673 | 462781 |

这个优化减少无效循环，没有减少同一范围内必需的矿块查询。代理夹具记录了运行时间，但不作不稳定的耗时断言，也不将它当作真实服务器 MSPT。大量角色同时以最大范围施法仍需单独压测，当前没有改变同步施法或加延迟预算。

村庄守望每轮最多检查 **17 × 17 = 289 个区块**，只读取已经加载的区块及其实体；不会扫描远处分散 Agent 加载的无关世界实体。回归夹具中，原扫描访问 50311 个全世界实体，新扫描检查 289 个区块、访问 217 个本地实体，取得相同的 178 个合法 Raider。实际本地实体数量仍可能增长，289 是区块检查上界，不是实体数量上界。

### 定向回归与边界

完整当前 AgentFriend 源码已用 Java 21 编译，以下独立回归通过：

- `ViewerStatePublisherRegression`：订阅守卫、固定名称缓存、类型区分、新旧通道、清理行为；1820000 次标签请求只解析 13 个固定技能名称。
- `ProspectingScanRegression`：276 个场景对比原算法，检查所有矿物类别、同距最近矿顺序、负坐标、世界高度、未加载区块，以及范围 24/48 的真实方块查询次数和查询顺序。
- `AgentStateEncodingRegression`：普通、空、中文、精确 16 KiB 边界、超大基础状态；新旧最终字节一致，缓存 JSON 与最终字节一致。
- `PlayerNameTagsRegression`：多记分板身份复用、前缀复用、公会等级变化、fulu 等登记 Agent、旁观者和外部队伍；Eye 大小写、世界、UUID 和实际附身目标过滤。
- `VillageWatchRegression`：新旧合法 Raider 集合一致，空/未加载区块、圆角及小数边界、极高/极低 Y、不同维度、自然 Raid 进入；同 tick 两次死亡只安排一次扫描，奖励仍立即保存，公开状态和下一 tick 状态保持最新。

这些是使用实际插件类与 Bukkit 代理对象的独立回归，不是 Minecraft 客户端或真实战斗验收。此前真实隔离 Paper 的 Viewer 新旧双通道测试也通过：独立状态与心跳正常、私聊泄漏 0；它仍不能替代基岩客户端技能粒子与轮廓的视觉检查。

## 隔离服基线：0.3.82 与已修复的 AuraSkills

原始结果位于本机 `E:\MC\ops\repairs\performance-scale-20261005\baseline.json`，不提交 Git。测试服务器为 `E:\MC\staging\life-buildings-20261003`，Java 端口 **25567**，不是正式服 25565。基线已经包含 AuraSkills 缓存修复，因此下表不用于衡量该缓存修复的收益。

测试逐级连接 8 对、16 对 Agent/Eye，峰值 **32 个连接**。每阶段先预热 15 秒，再测量约 75 秒，取完整最近一分钟 MSPT。行走使用真实原版移动，在磁盘已生成区块的高空临时平台上进行；16 个分散锚点均核验周围区块已生成。测试未执行 LLM 推理、挖矿施法、战斗、农场生产、委托运营或新地形生成。

| 连接与模式 | 北京时间测量窗口（2026-10-05） | 1 分钟 MSPT 平均 / 最大 | 1 分钟 TPS | 每 Agent 实际行走最少格数 |
| --- | --- | ---: | ---: | ---: |
| 8 Agent + 8 Eye，同区域静止 | 00:28:46.824–00:30:01.838 | 3.1 / 10.7 ms | 20 | 0 |
| 8 Agent + 8 Eye，分散行走 | 00:30:16.953–00:31:31.965 | 14.1 / 30.9 ms | 20 | 315.85 |
| 16 Agent + 16 Eye，同区域静止 | 00:32:17.652–00:33:32.654 | 4.1 / 16.7 ms | 20 | 0 |
| 16 Agent + 16 Eye，分散行走 | 00:33:54.003–00:35:09.032 | 27.9 / 65.6 ms | 20 | 314.93 |

16 对分散行走的最大 tick 超过 50 ms，说明短时尖峰仍存在；平均 TPS 为 20 不表示每个 tick 都准时。32 连接阶段登录后的最近 5 秒平均 MSPT 为 23.1 ms、最大 50.7 ms，登录窗口与稳定窗口分开解读。

协议观测中，Eye 的 `mcviewer:state` 约 0.187–0.2 包/秒，单包最大 2629 字节，与 5 秒心跳相符。Agent 无状态变化时，测量期内 `mcagent:state` 可以为 0 包；它采用变化后发送，不能凭 0 包断言状态通道断开。客户端事件循环 p99 为 34.93–37.65 ms，最大 40.89 ms，是客户端侧指标。

基线脚本最终报告 `PASS`、错误列表为空；所有测试客户端断开，登记表恢复，自有强加载票剩余 0，临时平台只保留在隔离世界。退出后的堆读数不能作为 32 连接负载峰值。

## 优化后隔离复测

复测使用下列候选版本与候选设置，保持 16 Agent + 16 Eye。`after-final-summary.json` 是原始报告索引，汇总静止有效窗和 `after-followup.json` 的严格行走/地面窗口。后两窗为生存模式，保留正常怪物 AI，以抗性 V 测试保护避免受击死亡打断移动；每个 Agent 均实际行走且没有死亡。地面场景与高空平台不同，保护条件也须计入比较，不能直接作同条件提升百分比。

| 项目 | 结果 |
| --- | --- |
| 本次负载测试对应的版本与 SHA256 | AgentFriend 0.3.83：`f37340c8663c39bee519b4cf22515723814d0bf77584de113253b517b64f38c5`；CortiEyeMirror 0.1.9：`d4d2c85122424ab07c153542cc22ecc2a032afa51f95100e239c16575636178b`。正式预热版本 `c278…` 的启动与回归证据单独列于下文 |
| 负载期隔离设置及原始结果路径 | 负载期隔离 JVM PID 9492，仅加载上述两个自制插件版本；`max-players=40`、`ignore-spectators=true` 已在隔离部署。结果目录 `E:\MC\ops\repairs\performance-scale-20261005` |
| 隔离 AuraSkills 启动补丁 | 01:14:13.815，`logs/auraskills-cache-patch.json`：`startup-verified`，`success` / `transformApplied` / `behaviorVerified` 均为 `true` |
| Viewer 定向验收的时间边界 | 01:01:50 的 `viewer-83.txt`：`PASS`，新旧双通道状态独立、心跳正常、私聊泄漏 0。它对应修正 waypoint 前的候选与 PID 34588；相关 HUD 类未变，但不将其称为最终 JAR 全套验收 |
| 16 + 16 同区域静止：时间、MSPT、TPS | 01:22:48.053–01:24:03.066，1 分钟平均 5.5 ms / 最大 55.4 ms，TPS 20 |
| 16 + 16 严格分散行走 | 01:33:40.584–01:34:55.597，1 分钟平均 26.7 ms / 最大 75.7 ms，TPS 20，每 Agent 至少行走 315.62 格；`PASS` |
| 16 + 16 严格地面行走 | 01:35:11.912–01:36:26.915，1 分钟平均 28.4 ms / 最大 292.7 ms，TPS 20，每 Agent 至少行走 304.68 格；`PASS`，但短暂停顿仍待定位 |
| 8 Agent 并发探矿 | 01:36:26.952 起，真实 `/mycli cast prospect ancient`，范围 24，均返回无矿；最慢响应 37 ms，观测最近 5 秒最大 tick 47.9 ms，`PASS` |
| 负载期间堆与 GC 观测 | 上述静止窗完成 Young GC 10 次，平均 4.874 / 最大 6.432 ms，回收后堆 704–747 MiB；首次混合行走窗完成 Young GC 16 次，平均 5.484 / 最大 7.594 ms，回收后堆 1162–1235 MiB；两窗 Full GC 均为 0 |
| 预热改动前的 Eye 附身、跨世界和消息隔离 | Primary 路径 01:18:35–01:19:18、Additional 路径 01:19:57–01:20:40 均 `PASS`；原始报告分别为 `eye-dimension-primary-after.json`、`eye-dimension-after.json` |
| 单 home 的只读查询及清理 | 两条 Eye 测试各阶段的 `MC_WAYPOINT` 查询位置变化 0，查询不触发世界重生，不减少魔力；登记表及 Essentials 用户数据恢复原字节，临时标记/强加载票清理，测试结束在线 0 |

GC 按 `after.json` 的精确开始/结束窗口，只数完成的 `Pause Young` 摘要。隔离 spark 的 100 Hz `ThreadDump` 是采样 safepoint，不是 GC；静止与首次行走各约 7501 次。行走窗有 17 次 `G1CollectForAllocation` safepoint，但只有 16 次完成 Young：01:25:06.253 有一次 0.0245 ms 的分配请求操作，随后才执行 GCLocker 发起的 GC(142)。不能以 allocation safepoint 数量替代完成 GC 次数。

这里的 GC 数字只对应前述 01:22/01:24 的早期窗口，不能当作 01:33/01:35 严格复测或冷探索的 GC 结果。并发探矿只是 8 个范围 24 的缺矿扫描，失败按既有规则不扣魔力、不进入冷却，立即重试仍受 5 秒尝试间隔约束；没有临时修改魔力、等级或冷却。它尚未证明 16 个范围 48 的同时施法容量。

首次地面准备因夹具所选区块未加载而失败，原失败报告保留为 `after-tool-failure-ground-prep.json`。首次分散行走 01:24:25.297–01:25:40.305 平均 28.3 ms / 最大 43.5 ms，其中 A1 被蜘蛛击杀并重生，属于混合负载，未用于严格行走比较。修正夹具后的 `after-followup.json` 错误列表为空，所有客户端断开、登记表恢复、自有强加载票剩余 0；临时平台仅在隔离世界保留。

### 主机采样范围

`host-phases-summary.json` 按实际负载窗口汇总 `after-host-followup.json`。下表的可用内存是整机余量，不是 Java 堆；磁盘延迟及队列是间隔采样值，不能排除两个样本之间的短时停顿。

| 窗口 | 记录数 | 隔离 Java 平均 CPU | 整机可用内存最少 | 采样磁盘延迟最大 / 队列最大 |
| --- | ---: | ---: | ---: | ---: |
| 严格高空行走 01:33:40.584–01:34:55.597 | 14 | 2.99% | 7.253 GiB | 1.905 ms / 1 |
| 严格地面行走 01:35:11.912–01:36:26.915 | 14 | 3.21% | 7.329 GiB | 1.162 ms / 0 |

进程 CPU 以“CPU 时间差 / 墙钟时间差 / **24 个逻辑处理器**”归一化。因此一个线程持续占满一个逻辑处理器约为 **4.17%**；2.99% 或 3.21% 不能解读为主线程只有约 3% 负载，也不能据此称服务器 CPU 全部空闲。

冷探索的 `coldwalk-host.json` 从 01:52:39.707 才开始，实际行走于 01:52:57.263 结束。重叠部分只有 3 条记录（01:52:41.305、46.818、52.307），第一条 CPU/磁盘延迟为 `null`，仅两个 CPU 差值样本平均 5.528%；整机可用内存最少 9.36 GiB、采样磁盘延迟最大 0.653 ms、队列 0。这仅描述行走尾段，不能用于解释完整 75.509 秒或之前的定位/flush 停顿。

### 自然地形冷探索：未通过

`coldwalk.json` / `coldwalk-walking-failure-003.json` 保存完整实际行走窗口，索引见 `after-final-summary.json`。16 个 Agent 进入原先未生成的自然地形，01:51:41.754–01:52:57.263 行走约 75.509 秒：

| 指标 | 实际结果与解释 |
| --- | --- |
| 场景结论 | **FAIL**：只有 12 个 Agent 达到要求的 80 格，4 条自然寻路路径不足；客户端出现重复 SlotComponent `PartialReadError` 解码警告 |
| 行走量 | 最少 35.1 格、最多 192.07 格，总计 1847.67 格；没有死亡，不将路径不足视为完成探索 |
| 区块变化 | 行走期间磁盘 region 索引增加 3113 项；它表示新保存的生成区块项，不能保证每项都是完整可游玩状态的区块 |
| 延迟与 TPS | 行走期间各 5 秒平均 MSPT 为 35.8–50.6 ms，最大 126.1 ms；结束时最近一分钟平均 39.5 ms / 最大 110.6 ms，TPS 20 |
| 行走前准备 | 约 80.758 秒定位/加载及 `save-all flush`，行走前新增 1759 项；8758.3 ms 最大 tick 与日志 01:51:32–01:51:41 的 flush 区间有强时间对应，但没有覆盖该区间的 JFR，不能作精确堆栈归因。01:51:26 另有 flush 前 3495 ms 落后记录，仍保留为冷定位/加载阶段的卡顿证据 |
| 清理 | 客户端全部断开，登记表恢复，没有新增强加载票，结束在线 0 |

解码警告在这次历史运行没有精确计数；工具后续加入显式审计，不能把它们当作零错误。两个先前的 setup 失败报告也保留，未覆盖为通过。这里不承诺 16 个自主 LLM Agent 的长期冷探索、地形生成或寻路完成能力。

只读核查见本机 `coldwalk-readonly-audit.json`。`coldwalk-natural.jfr` 从 01:52:38.944 才开始，在实际行走窗口内只覆盖最后 **18.319 秒**，不是全部 75.509 秒。该尾段取得 1043 个主线程样本，其中 144 个含 `ServerFunctionManager.tick`，约 13.8%；另有实体选择器、Mob、区块模拟和刷怪样本。它们是可重叠的包含计数，不是毫秒，也不能相加为 CPU 百分比或外推全程。

启用的 Ships 3.0.3 数据包每 tick 使用三个无 `type` 限制的 tag 实体清理选择器；源码中对应生成对象分别为 area effect cloud 或 marker，可以作为后续独立验证类型过滤的候选。JFR 堆栈没有函数资源 ID 或完整选择器文本，不能把所有 tick 函数/实体扫描样本都归属给 Ships。当前没有修改或发布该第三方数据包，尚无实测收益；Attract Villagers 的跟随与关联扫描也仅列为后续观察项。

### 短时尖峰与启动预热

严格地面窗口中的 292.7 ms 仍是实际短暂停顿。01:35 附近的采样发现 ProtocolLib `shallowClone` 首次调用触发 StructureCache/ByteBuddy 冷初始化，相关累计样本约 240–270 ms；分钟级聚合尚不能单独证明某个 tick 的根因。准备窗口的 8758.3 ms 也不能直接归因于行走，需结合 JFR 与保存/加载时序核查。

最终 CortiEyeMirror 0.1.9 SHA256 为 `c278f809d7885a469199256311cd70e54e044c73c7870c89039d678782ea2a3c`：在 `onEnable` 取得 ProtocolManager 后，对既有 14 种展示包执行 `createPacket(type, false).shallowClone()` 并立即丢弃，不发送包，不改变逐包转发路径。此改动将相同创建器/浅复制缓存的冷初始化移到启动阶段。早期 `6f913…` 预热候选由该最终构建替代。

最终隔离 JVM PID 34400 于 02:07:24 启动、02:07:53 ready，初次预热 14/14，合计 581.7 ms，重复 0.8 ms；Primary 02:09:22.994–02:10:07.851 与 Additional 02:11:49.379–02:12:32.050 的跨世界回归均 `PASS`、错误 0，测试数据恢复。隔离服于 02:13:36 正常停止。

正式新 JVM 初次预热也完成 14/14，合计 748.8 ms，最慢 `ENTITY_SOUND` 625.1 ms；重复预热 0.9 ms。它证明创建/浅复制冷初始化已在启动阶段执行，不证明所有游戏尖峰均消除。前述受控负载窗口仍对应 **`d4d2…` 的旧候选**，不能把报告 SHA 替换为新 `c278…` 或当作新 JAR 的全负载性能验收。

## 正式重启与部署验收

本轮部署按 [OPERATIONS.md](OPERATIONS.md) 备份、正常停服、替换与复测，实际发生两次维护，失败及短暂版本状态保留：

1. 第一次安装 helper 的 `.NET File.Replace` 调用因 `null` 参数绑定失败；调用 shell 仍触发了维护任务。02:14:26 完成编号 `20261005-021426` 的 E/F 备份，AgentFriend 0.3.82 短暂上线、CortiEyeMirror 为最终 0.1.9。此时没有把 0.3.83 宣称已部署。
2. 修正安装后再次正常停服，02:17:34 的 E/F 快照编号为 `20261005-021734`，两份 `complete`，维护任务结果 0。新 Java PID 32992 于 02:17:37 启动，02:18:14 输出 `Done (26.604s)`；RCON 查询实际版本为 AgentFriend **0.3.83** / CortiEyeMirror **0.1.9**。

| 项目 | 结果 |
| --- | --- |
| 正式重启时间、备份位置与新 Java PID | E/F 快照 `20261005-021734` 均 complete；02:17:37 启动 PID 32992，02:18:14 ready |
| 实际加载的 AgentFriend / CortiEyeMirror 版本、JAR SHA256 | 0.3.83 / 0.1.9；AgentFriend 480037 字节，SHA256 `f37340c8663c39bee519b4cf22515723814d0bf77584de113253b517b64f38c5`；CortiEyeMirror 32326 字节，SHA256 `c278f809d7885a469199256311cd70e54e044c73c7870c89039d678782ea2a3c` |
| `max-players=40` 与 `ignore-spectators=true` 实际生效 | 正式配置及版本查询已核对 |
| view/sim 8/8、4 GiB 堆、原区块线程保持 | 保持；新 GC 日志已写入并确认 max heap 4 GiB；已检查样本未见 `Pause Full`，精确 GC 日志范围另行审计 |
| 正式 AuraSkills `premain` 回执与版本锁定验证 | 02:18:04.312，PID 32992，`startup-verified`，success/transform/behavior 均 true |
| 原账号恢复 | 观测窗内 Goddess、CortiLan 在线；CortiEye 原机客户端未回连。Watcher PID 34340 alive、stderr 0、登记有效，需在原机器重新连接；不将 Watcher 存活称为 camera 已恢复 |
| Java / LAN / 基岩网关 | Java 后端 127.0.0.1，PID 32992；LAN 网关 192.168.3.163，PID 27816。实际 Mineflayer `AfuGateProbe` 通过 LAN 短暂入服并正常退出；Geyser 本机与 LAN 19132 Pong 正常、显示 40 槽位，仅证明网络连通，不替代基岩视觉验收 |
| 正式完整 1 分钟 TPS/MSPT | 02:22:53.993 查询，TPS 1/5/15 分钟均 20；02:21:53–02:22:53 的 1 分钟 MSPT 平均 5.6 / 最少 3.2 / 最大 26.5 ms；5 秒 5.9/3.4/25.0，10 秒 5.6/3.3/25.0 ms |
| 正式堆观察 | 02:18:59–02:19:03：堆使用 1043215 KiB，约 0.995 GiB；当时已提交总量 1112064 KiB；Metaspace 使用 268227 KiB。`LocalizedKey` 824 个、浅大小 19776 字节 |
| 世界/玩家数据保存、服务与 Watchdog | 正常停服及 E/F complete 快照已确认；02:22:18 Watchdog 结果 0。维护暂停/待发布标记清除动作已完成，最终标记核对由运维收尾；CortiEye 客户端重连仍单独待验 |

堆证据位于本机 `E:\MC\ops\diagnostics\20261005-021859-849`。直方图使用 `-all`，可能含尚未自然回收的对象；824 个 `LocalizedKey` 不是精确缓存条目数，也不等于全部存活的保留键。堆提交总量约 1.06 GiB 与 4 GiB 最大上限不同，不能用提交量判断启动参数已缩小。

正式主机数据见 `E:\MC\ops\repairs\performance-scale-20261005\production-final-host-summary.json`：**02:19:57.141–02:21:29.328**，约 92 秒，16 条记录、15 个 CPU 差值样本；隔离服已停止，正式服只有 CortiLan、Goddess 两个账号。

| 指标 | 该窗口结果 |
| --- | ---: |
| 正式 Java 平均 / 最大 CPU，按 24 逻辑处理器归一化 | 1.0429% / 1.744% |
| Java 工作集尾值 | 1686.8 MiB |
| 整机平均 CPU | 9.5747% |
| 整机可用内存最少 | 16.487 GiB |
| 采样磁盘延迟最大 / 队列最大 | 4.467 ms / 1 |

该窗口与之前三个账号在线、或正式服和隔离服同时运行的主机窗口负载不同，不作比例提升比较。它证明此次正常重启后的低连接负载窗口运行稳定，不能外推为 16 个 Agent / 16 个 Eye 全玩法容量；采样间隔仍可能遗漏更短的尖峰。

正式 GC 滚动日志 `gc-2026-10-05_02-17-37.log` 截至 02:29:23 的完成摘要：Young 85 次、最长 17.712 ms，Full GC 0。前述 02:21:53–02:22:54 一分钟窗完成 Young 4 次、平均 5.670 ms、最长 8.688 ms；与启动期及冷探索的 GC 分开记录。原始审核为本机 `production-final-gc-summary.json`。最终复核确认维护暂停、插件/设置 pending 与诊断请求标记均已消耗，Watchdog 正常。

## 后续负载验证

当前证据支持比较受控连接和移动负载，尚未证明 16 个 LLM Agent 持续战斗、最大范围探矿、同步生成新地形或长期公会生产均能稳定运行。后续按真实负载采样定位，再决定是否扩大修改范围；采样方法参见 [Paper 性能分析文档](https://docs.papermc.io/paper/profiling/)，现服 spark 版本与安全诊断方式见 [PERFORMANCE.md](PERFORMANCE.md)。

优先观察同秒多次最大范围探矿、心眼/守护重叠、分散区块生成、追踪目标列表、每玩家 Aura 状态构建、村民交易周期扫描，以及大量公会事件下的配置保存。保留技能特效、魔力规则、消息实时性和奖励持久化；没有测到明确热点前，不通过降低刷新频率或延迟奖励保存来换取表面指标。

原始日志、测试 JSON、诊断直方图、运行 JAR、世界和备份均保留在 `E:\MC\ops` / `E:\MC\staging` 等本机运行目录，不进入 Git。仓库仅保存源码、可复现测试、版本/哈希清单与本验收摘要。
