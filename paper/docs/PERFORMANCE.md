# Paper 服务器性能诊断与内存修复

## 2026-10-05 正式重启后的结果

以下保留 10 月 4 日在线诊断的时间窗。之后已在正常 E/F 备份 `20261005-021734` 后发布 AgentFriend 0.3.83 与 CortiEyeMirror 0.1.9、连接上限 40 和观战者实体激活设置；新 JVM 为 **32992**。原排队 0.3.82 仅在第一次维护中短暂加载，完整过程及高负载边界见 [多 Agent 性能验收](MULTI_AGENT_PERFORMANCE.md) 与 [发布记录](OPERATIONS.md)。

正式 `logs/auraskills-cache-patch.json` 于 02:18:04.312 得到 `phase=startup-verified`，`success=true`、`transformApplied=true`、`behaviorVerified=true`；GC 日志确认堆上限 4 GiB。第三方 AuraSkills JAR 没有被替换，固定 JVM 补丁正式重启后自动生效已验收。

02:18:59–02:19:03 同身份 Watchdog 的 `GC.heap_info` 与 `GC.class_histogram -all` 保存在 `E:\MC\ops\diagnostics\20261005-021859-849`：已用堆 1043215 KiB（约 **0.995 GiB**）、已提交 1112064 KiB，`LocalizedKey` **824 个 / 19776 字节**。直方图可含尚待回收对象，此计数不是精确缓存条目数；未请求 Full GC。

02:22:53 的完整最近一分钟平均/最小/最大 MSPT 为 **5.6 / 3.2 / 26.5 ms**，1/5/15 分钟 TPS 均 20。隔离服已停止，此时 CortiLan/Goddess 在线，CortiEye 原机客户端尚未回连，绑定 watcher 与登记正常。主机 02:19:57–02:21:29 的 92 秒测量有 16 记录、15 个 CPU 差值，正式 Java CPU 平均 **1.04%**、最大 1.744%（24 逻辑处理器归一化），可用内存最低 **16.487 GiB**。少量在线窗口不替代 16 Agent + 16 Eye 负载或跨天内存增长观察。

## 2026-10-04 在线修复记录

2026-10-04 的在线诊断确认：卡顿主要伴随 Java 堆接近 4 GiB 上限和较长的垃圾回收停顿。按类直方图与 AuraSkills 2.4.0 代码核查进一步定位到消息缓存键的身份比较错误，重复的同一翻译文本被长期留在缓存。单纯增加内存不能消除这一增长。

当前环境为 Paper 1.20.6、JDK 21.0.12.1、AuraSkills 2.4.0、spark 1.10.187，正式服目录 `E:\MC\server`。AuraSkills 最小补丁于 2026-10-04 23:52 在线生效，正式 JVM PID 保持 13880；持续内存/延迟效果另行记录。

## 已取得的诊断证据

初次在线采样最近一分钟平均 tick 约 34.5 ms、最大约 1.61 秒；TPS 接近 20 仍可能出现秒级短暂停顿。当时观察到约 3.90 GiB 堆使用量，运行累计老年代回收 799 次、平均约 0.9 秒。主机 CPU 平均约 46%，可用系统内存约 10 GiB，磁盘未显示同等程度的压力。这些是特定采样窗口，不能视为持续负载承诺。

23:27 的 JVM 原始证据保存于本机 `E:\MC\ops\diagnostics\20261004-232713`，不进入 Git：

| 证据 | 观察结果 |
| --- | --- |
| `heap-info.txt` | G1 堆总量 4194304 KiB，使用 4132705 KiB，约 3.94 GiB；Metaspace 使用 302735 KiB |
| `class-histogram-all.txt` | 9959331 个 AuraSkills `LocalizedKey`，239023944 字节 |
| 同一直方图 | 9958579 个 `MessageKey` 捕获 lambda，159337264 字节 |
| 同一直方图 | 19919908 个 Adventure `TextComponentImpl`，478077792 字节 |
| 同一直方图 | 9960961 个 `StyleImpl`，398438440 字节；9959333 个 `DecorationMap`，318698656 字节 |

直方图显示的是各类对象的浅大小。它与代码中无界缓存、每次新建消息键的行为吻合，不应把所有 `String`、字节数组和容器对象都精确归属到一个插件。

原插件的 `MessageProvider.componentCache` 是 `ConcurrentHashMap<LocalizedKey, Component>`。`LocalizedKey` 为 `record(MessageKey key, Locale locale)`，而 `MessageKey.of(path)` 每次创建新的捕获 lambda；同一路径的两个键默认按对象身份比较，缓存查询未命中后又加入相同文本。因此 HUD 等不断读取展示名称的调用可让缓存持续增长。

官方最新发行仍为 2.4.0，已核对的官方源码也保留这一实现：[LocalizedKey](https://github.com/Archy-X/AuraSkills/blob/master/common/src/main/java/dev/aurelium/auraskills/common/message/LocalizedKey.java)、[MessageKey](https://github.com/Archy-X/AuraSkills/blob/master/common/src/main/java/dev/aurelium/auraskills/common/message/MessageKey.java)、[MessageProvider](https://github.com/Archy-X/AuraSkills/blob/master/common/src/main/java/dev/aurelium/auraskills/common/message/MessageProvider.java)。

## 修复内容和隔离验收

### AuraSkills 最小 JVM 补丁

可复现源码位于 [ops/auraskills-cache-patch](../ops/auraskills-cache-patch/README.md)。补丁只将现有 `LocalizedKey.equals`、`hashCode` 改为按消息路径字符串及 `Locale` 值比较，字段、构造器、访问器、record 组件与类结构保持一致。HotSwap 形状检查为 Java 21、2 个字段、6 个方法完全相同。

在线应用时，agent 经实际 Bukkit 主线程清理组件缓存、重定义目标类、再次清理并验证键值行为。它不调用 `System.gc`，也不执行 `/skills reload`。自然垃圾回收随后释放已丢弃的重复文本；原 `ConcurrentHashMap` 的空桶数组仍会保留。

所有目标版本和字节码严格锁定：

| 对象 | SHA256 |
| --- | --- |
| AuraSkills 2.4.0 原 JAR | `de54cbd2e33d65e8b1704751ae4121ed2f5b466ba89c63a1aadf3a3e629d6a40` |
| 已确认的 Paper remapped JAR | `507c93874ce8b7a8daaf9408465f6486e7a067409394fe13bd36e1880162edce` |
| 原 `LocalizedKey.class`，两份 JAR 一致 | `dac331ba0e51e180938263c9bf7ed344b59dd538ed4ea7d948a85263fb0e00e5` |
| 修复后 `LocalizedKey.class` | `cece3f917e52a283261c70a6a899cdd0235ebeee65de44510807e77efe2ad947` |
| 最终修复工具 JAR | `68dfb98c3de4d2f6397614208b4b0dfe815d1f2e849216ea1bc91f979b33e1bd` |

构建产物位于本机 `E:\MC\ops\repairs\performance-20261004\patch-build\auraskills-cache-patch.jar`，工具和第三方字节码不进入 Git。

独立 128 MiB JVM 使用实际 AuraSkills `MessageKey`、`LocalizedKey` 与独立类加载器，通过以下检查：

- 原实现 10000 次重复键及两个路径/语言区分项产生 10002 条；修复后仅 3 条。
- 包含 4 个并发写入线程的总计 50000 次请求仍保持 3 条，已有实例也获得正确的值比较。
- 在线回退恢复原身份比较，缓存重新表现为 10002 条；再次修复通过。
- 启动 `premain` 应用、启动后在线回退通过。
- 修改目标 JAR 的整体 SHA 后，启动和在线应用均明确拒绝，目标保留原行为。

原 JAR 和实际 remapped JAR 各完整验收一次。报告分别在 `patch-build\test-20261004-234620-313\summary.json` 与 `test-20261004-234625-653\summary.json`。这些进程不是 Minecraft 服务器，测试完成后均退出。

真实隔离 Paper 服的热修也已通过：本机 `E:\MC\ops\repairs\performance-20261004\stage-apply-result.json` 为 `success=true`，`cacheEntriesBefore=838`、`cacheEntriesAfter=0`、`classRedefined=true`、`behaviorVerified=true`。这是隔离服激活证据，正式服效果仍须单独验收。

真实隔离服再次通过启动应用：`E:\MC\staging\life-buildings-20261003\logs\auraskills-cache-patch.json` 为 `success=true`、`phase=startup-verified`、`transformApplied=true`、`behaviorVerified=true`，PID 为 26320。启动后重新运行 Viewer 新/旧/双频道测试，`independentState=true`、`heartbeat=true`、`chatLeaks=0`，验证 AuraSkills 补丁与 0.3.82 候选兼容。

### AgentFriend 0.3.82 候选

`ViewerStatePublisher` 在客户端未订阅 `mcviewer:state` 或旧频道 `corti:viewer_state` 时，提前返回，避免为普通原版、基岩与仅订阅 Agent 状态的连接反复构建观战 HUD。展示名称按固定中文语言与注册项类型/ID 缓存，技能、主动能力和被动能力不混用键；关闭组件时清缓存。

候选的定向回归通过：模拟 14 名玩家、13 项技能、10000 轮 HUD 更新，1820000 次展示名称请求只解析 13 次；同时验证未订阅时不读取 AuraSkills、旧/新/双频道分发与关闭时清理。真实隔离服的 `viewer-state-stage.mjs` 新/旧/双频道、本人经验更新、魔力/技能列表和无聊天泄漏检查也已通过。候选 JAR SHA256 为 `c84bb060bf44360f3edc2f1bd3eccb38675f2825ca8e3db34d00c25a4cc52d1d`。

0.3.82 是后续正常发布的候选，目前不把它描述为正式服已加载。AuraSkills JVM 补丁解决现有缓存键错误；Viewer 修复减少重复构建和翻译请求。两项验收分别记录。

## 运维入口

运行时入口继续使用 [ops/manage-server.ps1](../ops/manage-server.ps1) 的单实例维护锁与既有 Watchdog，不新增并行守护进程。必须从拥有 Paper JVM 的计划任务安全身份执行 attach；交互令牌可能无法连接 S4U 启动的 JVM。

新增入口：

| 请求或配置 | 行为 |
| --- | --- |
| `E:\MC\ops\jvm-diagnostics.requested` | Watchdog 在确认唯一 Paper 监听 PID 后采集 `GC.heap_info` 与 `GC.class_histogram -all`，请求和结果归档到 `ops\diagnostics\时间戳` |
| `E:\MC\ops\auraskills-cache-fix.requested.json`，`mode` 为 `fix` 或 `rollback` | 经同身份 Attach CLI 应用/回退，结果保存在诊断目录；不重启服务 |
| `E:\MC\ops\instrumentation\auraskills-cache-patch.jar` 存在 | 下一次正常启动追加 `-javaagent`，无需修改第三方 AuraSkills JAR |
| 下一次启动的 GC 日志参数 | `-Xlog:gc*,safepoint:file=logs/gc-%t.log:time,uptime,level,tags:filecount=5,filesize=20M` |

`GC.class_histogram -all` 避免先请求 Full GC，但仍会遍历堆并可能短暂停顿，应按需单次采集。spark 1.10.187 的普通 `heapsummary --save-to-file` 内部没有传 `-all`，HotSpot 默认会先请求 Full GC；`--save-to-file` 只改变保存方式，不能将该命令当成低影响诊断。[OpenJDK 实现](https://github.com/openjdk/jdk21u/blob/master/src/hotspot/share/services/diagnosticCommand.cpp)

正式 spark 配置已观察到 `backgroundProfiler=false`。原 Windows Java 引擎每 10 ms 采线程栈、保留约 60 分钟聚合数据；取消后台采样可减少常驻诊断开销，按类证据已明确主要重复对象来自 AuraSkills。

补丁回执必须同时检查 `success`、`classRedefined`、`behaviorVerified` 与缓存计数。维护 CLI 超时只结束 attach 客户端，已开始的 JVM agent 操作仍可能完成；超时后先读最终回执，不能立即重复提交。排队但未开始的任务在 30 秒后会取消。工具操作细节与独立调用命令见补丁 README。

启动应用的最终证据为 `E:\MC\server\logs\auraskills-cache-patch.json` 的 `phase=startup-verified`、`success=true`、`transformApplied=true`；只有注册/pending 日志不能视为生效。版本或 SHA 不匹配时记录拒绝并保留原目标类。

## 在线修复当时的正式服验收状态（2026-10-04）

23:52:22.733 正式服通过同身份 Watchdog 在线应用，回执保存于 `E:\MC\ops\diagnostics\20261004-235221\cache-patch.result.json`：`success=true`、`mode=fix`、`cacheEntriesBefore=10133384`、`cacheEntriesAfter=0`、`classRedefined=true`、`behaviorVerified=true`。JVM 仍为原 PID 13880，未通过重启清掉内存。

23:54 的正式复测保存在 `E:\MC\ops\diagnostics\20261004-235400`。`heap-info.txt` 为已提交堆 2936832 KiB、使用 964383 KiB，约 **0.92 GiB**；原上限仍为 4 GiB。缓存清理后的内存由自然 GC 回收，未调用 `System.gc`，直方图使用 `-all`。

| 对象 | 修复前 23:27 | 修复后 23:54 |
| --- | --- | --- |
| `LocalizedKey` | 9959331 个 / 239023944 字节 | 468 个 / 11232 字节 |
| AuraSkills `MessageKey` 捕获 lambda | 9958579 个 / 159337264 字节 | 468 个 / 7488 字节 |
| `TextComponentImpl` | 19919908 个 / 478077792 字节 | 138 个 / 3312 字节 |
| `StyleImpl` | 9960961 个 / 398438440 字节 | 60 个 / 2400 字节 |
| `net.kyori.adventure.text.format.DecorationMap` | 9959333 个 / 318698656 字节 | 15 个 / 480 字节 |

修复后约 30 秒的短窗口曾观察到 5 秒平均 MSPT 7.2 ms、最大 16.4 ms，10 秒平均 7.4 ms、最大 19.8 ms。23:54 左右的完整最近一分钟窗口平均 **7.3 ms**、最小 3.9 ms、最大 **26.9 ms**，最近一分钟 TPS **20**。当时 5/15 分钟 TPS 仍为 13.01/16.57，包含此前卡顿，不能声称全部长窗口已回升。

最终 23:57:25 RCON 复查的 TPS 为最近 1/5/15 分钟 **20.0 / 20.0 / 16.61**；最近一分钟 MSPT 为平均 **6.9 ms**、最小 **4.0 ms**、最大 **23.9 ms**，5/10 秒窗口分别为 6.5/4.0/23.9 与 6.4/4.0/23.9 ms。最近 1/5 分钟已恢复正常，15 分钟窗口仍包含旧负载。

同 PID 的主机计数器采样保存在 `E:\MC\ops\repairs\performance-20261004\host-metrics.json`。CPU 按 24 个逻辑处理器归一化，样本均值不加权：

| 采样项 | 修复前 23:50:08–23:50:31 | 修复后 23:54:47–23:56:12 |
| --- | --- | --- |
| 正式 Java PID 13880 平均 CPU | 56.46% | 1.56% |
| 正式 Java 最大 CPU | 64.47% | 6.39% |
| 整机平均 CPU | 94.08% | 12.60% |

修复前整机窗口受隔离服启动影响，因此主要比较相同正式 Java PID；这些短窗口数据不能归纳为固定性能提升比例。修复后 85.12 秒窗口含 15 个样本，最后 Java 工作集为 3207.49 MiB、私有虚拟提交为 3889.65 MiB，主机可用内存约 12125–12381 MiB。Java 工作集包含堆外空间和仍驻留的已提交页面，不等同于当前堆使用量。

在线状态复核：Goddess、CortiLan、CortiEye 三个原服务账号仍在线，Java `127.0.0.1:25565` 仍由 PID 13880 监听，Geyser 本机 `19132` 的 Pong 探测通过。隔离 PID 26320 已通过 RCON 正常停止，`25567` 无监听，后续正式采样无需分担隔离服负载。

| 项目 | 状态 |
| --- | --- |
| AuraSkills 在线补丁正式应用回执 | 已通过，10133384 条缓存 → 0，键值行为已核验 |
| 清理后的实际堆使用量与自然 GC | 已通过，3.94 GiB → 约 0.92 GiB；重复键降至 468 个 |
| 相同在线服务账号下的 TPS、平均/最大 MSPT | 最终 1/5 分钟 TPS 20、最近一分钟 MSPT 平均 6.9 ms / 最大 23.9 ms；15 分钟仍含旧负载，长期及高分位仍待持续观察 |
| 正式 JVM PID 保持 | 已通过，原 PID 13880 |
| 玩家连接与服务入口保持 | 三个原服务账号保持，Java 同 PID / Geyser Pong 通过；真人实际游玩体感未在本次自动验收中观察 |
| 下一次启动的 premain 激活回执及 GC 日志 | 待验收 |
| AgentFriend 0.3.82 正常发布 | 已准备待部署计划；未现在启用，下一安全备份窗口执行 |

AgentFriend 0.3.82 已生成 pending 部署计划，源与候选 SHA 已核验。下一次 `Afu-MC-DailyBackup` 为 **2026-10-05 04:00（Asia/Shanghai）**，沿正常备份及无人、无活动守卫进入安全维护窗口后发布；若守卫拒绝则推迟。本次没有为启用候选重启正式服。原维护脚本、spark 配置与补丁工具已备份到 E/F，F 盘另保存 0.3.82 候选及部署计划。

下一次正式启动的 premain 激活回执与 GC 日志仍待验收；真实隔离启动验证已通过。热修后的短窗口改善不等于跨天内存增长已持续验收。后续记录自然运行窗口的对象计数/堆使用与 GC 停顿；其他插件或世界实体的热点需要新证据再处理。

## 回退

在线请求 `mode=rollback` 会撤销本 agent 的目标类加载变换、恢复嵌入的原 class 字节并清理组件缓存。回退会恢复原缓存身份错误，是操作故障时的暂时退路。

下一次启动停用补丁时，从固定 instrumentation 位置移走 opt-in JAR，或移除启动参数；不要覆盖原 AuraSkills JAR。保留应用/回退回执、原诊断和构建哈希。普通 AgentFriend 发布继续遵循 [OPERATIONS.md](OPERATIONS.md) 的备份、隔离验证、正常替换与正式复测流程。
