# Agent 观战账号

2026-10-06 服主明确确认 `feiyu_bot` 是 bot，已加入维护脚本的已核实服务账号例外。该身份确认只适用于这个精确账号。其可信来源 IP 尚未核实，本轮新增配对已撤销，恢复发布前接入规则；Agent/Eye 配对须同时完成可信来源登记。09:09 正常重启更新 AgentFriend 0.3.84 后，CortiLan/Goddess/CortiEye 已恢复，`cortieye` 读回 camera=online、attached=true；feiyu_bot 原客户端也已回连，重启前四个账号均恢复。

Goddess 平时是独立观察者，不参加Agent/Eye配对巡检。0.4.10已上线的[女神相机](SERVER_PHOTOGRAPHY.md)可为本人请求串行临时附身拍照，完成即恢复观察位置；已有人工附身会话不被抢占。`ops/agent-eye-pairs.json` 登记 Agent/Eye 对；`ops/agent-eye-watcher.mjs` 每 20 秒通过本机 RCON 检查一次，把已登记的 Eye 维持为原版观战模式，并在两端在线时执行原版 `minecraft:spectate <Agent> <Eye>`。Agent 离线时 Eye 仍保持观战模式。未登记的 `eye` 名字没有镜头权限，公网 Java 网关在登录前拒绝这种名字。

每个配对写一个 Agent 名；省略 `eye` 时自动使用 `<agent>_eye`，例如 `fulumu → fulumu_eye`。命名不同的配对明确写 `eye`，目前为 `CortiLan → CortiEye`。配置在下一次巡检时生效；撤销配对会停止附身。每次巡检也检查镜头与 Agent 的位置，发现脱离就重新附身；即使位置接近，最多两分钟也会重新附身。

`ops/manage-server.ps1` 的现有 Watchdog 保证巡检进程单实例运行并在其退出后恢复。修改配对文件不需要重启 Paper。正式服 CortiEyeMirror 0.1.9 只向**已登记、正在附身对应 Agent 且处于同一世界的 Eye**转发目标的私聊、动作栏、标题、BossBar、状态效果、粒子与音效；跨组不转发私有消息，全服广播去重。登记表约每 5 秒重新读取，撤销后停止转发；附身巡检约每 20 秒重新读取。隔离服已通过两组配对、跨组隔离、未登记 Eye 隔离、广播去重、状态效果和热撤销测试。Mineflayer Eye 没有 SpectatorPlus 客户端模组，玩家背包画面未能完成同等验收。

AgentFriend 0.3.80 的探敌术还把附近怪物的 Java 发光轮廓只发给施法者和登记表中当前确实附身的 Eye；撤销配对或脱离附身后即停止。普通旁观者和其他 Agent/Eye 看不到这项私有轮廓。轮廓 8 秒后恢复实体原状，不修改世界里的怪物发光状态。

## CortiEyeMirror 0.1.9：正式服已生效

2026-10-05 02:17:34 经现有 `Afu-MC-DailyBackup` 正常停服，E/F 双盘 `20261005-021734` 快照均有 `.complete`、任务结果为 0。正式 JVM PID 32992 于 02:17:37 启动，02:18:14 完成加载；唯一启用 AgentFriend 0.3.83（SHA256 `F37340C8663C39BEE519B4CF22515723814D0BF77584DE113253B517B64F38C5`）与 CortiEyeMirror 0.1.9（SHA256 `C278F809D7885A469199256311CD70E54E044C73C7870C89039D678782EA2A3C`）。普通玩家/Agent 的视距与模拟距离仍为 8/8，最大人数为 40，`entity-activation-range.ignore-spectators=true`，堆上限仍为 4 GiB。Goddess 桥和 Agent Eye Watcher 于 02:18:25 恢复。02:22 只读检查时 CortiLan/Goddess 在线，远端原生 CortiEye 尚未回连；插件已生效与实际直播镜头恢复分别记录，未将离线账号记作正式画面验收成功。

发布过程保留两轮实际状态：第一轮 02:14:26 的正常备份完成后，加载的是 AgentFriend 0.3.82 与最终 CortiEyeMirror 0.1.9，容量配置尚未应用；发布计划写入出错后，第二轮按上述正常备份流程部署了 0.3.83 与配置。第一轮不记作最终 0.3.83 发布成功，未使用旧快照覆盖玩家进度。

恢复检查截至 02:22:31：Watcher PID 34340 存活，错误日志为空，配对与可信接入登记仍有效；服务器没有收到 CortiEye 本次登录。Watcher 只维护在线账号的观战绑定，不启动远端原生客户端。本机现有计划任务及运维脚本没有该客户端的重连入口，因此需在其原运行机恢复原有 CortiEye 客户端连接，随后读回 `cortieye` 的 `camera=online attached=true`；不能以新建同名机器人代替原生直播客户端验收。

私有消息与 HUD 的“正在附身”判定同时要求登记授权、对应 UUID、观战相机目标及同一世界。已登记且原本正在附身的 Eye 在 Agent 跨世界后，下一 tick 通过 `SPECTATE` 原因真实传送到新世界，重新设置相机，并刷新实体、效果和背包快照，避免只有坐标变更、Eye 仍停留在旧维度。Goddess 不参加此配对流程。

这次修复不会因 Agent 跨世界而强制重新附身一个已手动脱离的 Eye。现有 Watcher 仍按前文的巡检与最多两分钟策略重新附身；手动脱离并非永久退出配对，永久停止需撤销登记。

回归脚本为 [eye-dimension-stage.mjs](../plugins/CortiEyeMirror/eye-dimension-stage.mjs)，两条路径都在无外部 Watcher 的隔离服运行，世界跳转期间没有补发修复用的 `/spectate`：

| 路径 | 上海时间 | 结果 |
| --- | --- | --- |
| 原配置 `CortiLan → CortiEye` | 2026-10-05 01:18:35–01:19:18 | PASS |
| 新登记 Agent/Eye | 2026-10-05 01:19:57–01:20:40 | PASS |
| 最终预热版原配置 `CortiLan → CortiEye` | 2026-10-05 02:09:22–02:10:07 | PASS |
| 最终预热版新登记 Agent/Eye | 2026-10-05 02:11:49–02:12:32 | PASS |

两条路径均验证主世界 → 地狱 → 末地 → 主世界的实际维度与相机实体 ID，每次真正跨世界都收到一次 Eye `respawn` 包；私有 `MC_WAYPOINT`、消息、动作栏和映射到 Eye 实体的速度效果 HUD 均正确转发且不重复。另验证手动脱离后跨世界不被强制附身、显式重新附身恢复转发，以及热撤销登记后停止私有 CLI、消息、动作栏和效果转发。

每个隔离账号预置恰好一个主世界私人家。在四个阶段和重新附身后查询 `/mycli waypoint`，Agent 位置变化均为 0，世界与 `respawn` 计数不变，魔力未减少；这也覆盖 AgentFriend 0.3.83 移除查询中 `homes` 调用的修复，防止 Essentials 将单家查询执行为回家。结束时恢复登记表与两账号 Essentials 数据原始字节，清理临时实体及测试增加的强制加载区块，确认在线人数为 0。

0.1.9 在 `onEnable` 主线程预热既有 14 种展示包的构造与浅复制缓存，临时包立即丢弃，不发送包，逐包转发路径保持原有语义。最终 SHA256 `C278F809…` 的隔离冷启动首次预热 14/14 用时 581.7 ms，同 JVM 重复预热 0.8 ms，无预热警告；正式冷启动首次为 748.8 ms，重复 0.9 ms，同样 14/14 且无预热警告。首次最慢项均为 `ENTITY_SOUND`。它把协议库首次 ByteBuddy 初始化移到启动期；不据此声称消除了原版区块生成或存盘停顿。

报告保存在运行机私有修复目录 `E:\MC\ops\repairs\performance-scale-20261005\`，不提交运行数据。前两条回归的文件为 `eye-dimension-primary-after.json` 与 `eye-dimension-after.json`，对应未加预热的 `D4D2C851…` 候选；最终预热版的完整重新回归为 `eye-dimension-primary-prewarm.json` 与 `eye-dimension-prewarm.json`，对应正式发布的 `C278F809…`，两份均无失败、登记表与玩家数据恢复、在线人数归零。此前多 Agent 负载窗口仍对应 `D4D2C851…`，不修改旧报告的哈希。旧主配对测试的单家查询副作用及错误断言以历史失败摘要保留。此次为 Java 协议验收，基岩视觉画面与 SpectatorPlus 背包画面仍需实测。

新增 Agent 时，在 `ops/agent-eye-pairs.json` 写配对，并在运行机私有 `E:\MC\ops\agent-gateway-access.json` 分别为 Agent 与 Eye 登记可信来源 IP。访问清单含私人地址，不提交仓库，结构示例见 `ops/agent-gateway-access.example.json`。网关按每次登录读取，修改两份清单不用重启。AgentFriend 0.3.77 也约每 6 秒读取配对表：登记的非旁观 Agent 自动显示 `[Agent]`，并接收 Agent 路径的村庄紧急私聊；`fulumu` 已按这条规则识别。原有 `nametags.agent-uuids` 名单仍兼容，调整它需要正常重启。公会日常委托按玩家 UUID 和上海日期刷新，与 Agent 标记无关。

当前仍允许未登记的普通 Java 名字进入，**这些名字在离线模式下不能防冒用**；正式向更多 Java 玩家开放前，应选定正版登录或逐账号的可信接入方式。用户名和离线 UUID 本身不是身份验证。Goddess、OP 名和未登记 Eye 名字由公网网关在登录前拒绝。Watchdog 的“真人在线时不自动重启”保护只把已核实的服务账号列入例外。
