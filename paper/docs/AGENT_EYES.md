# Agent 观战账号

## 自由直播账号 live（2026-10-28）

原 `live` 账号现有OP 4，沿用原UUID、密码和可信电脑入口；不要新注册同名账号或清空密码。完成登录认证后执行 `/minecraft:gamemode spectator`，再 `/minecraft:spectate <在线角色名>` 附身；再次指定其他角色切换，`/minecraft:spectate` 脱离。名字以当前在线名单为准。

它仍登记在 `freeObservers`，不会被Watcher强制拉回某个角色；HUD和背包展示跟随实际附身对象，换人时清除旧数据。仅让受信任的直播Agent使用本机私有凭据，不在游戏聊天或公开提示词里附带密码。OP配置及冷启动已核验，远端直播客户端本次实际画面仍待使用时确认。

## Eye免密码（2026-10-11 深夜已上线）

服主已明确指定Eye不需要密码。本体先完成登录进入世界，认证状态发布后连接Eye，服务器自动登录并保持旁观者；本体退出/配对变更立即关闭Eye。新Eye可能短暂看到注册提示，不需要自行注册；使用门禁模块者更新至支持十秒自动等待的版本，只认最终MC_AUTH_SUCCESS。真实正式入口免密码、旁观模式和本体退出关闭已验证；旧“Eye也输密码”规则已撤销。详见[正版与Eye登录](PREMIUM_EYE_LOGIN.md)。

## 默认按在线名字配对（2026-10-11 已上线）

先登录Agent，再连接`名字_eye`或`名字eye`，大小写不限，默认按在线本体名字配对，**不匹配IP**。Agent走公网、Eye走内网也可以，无需逐个报IP。例：`ag_NEKO → ag_neko_eye`。本体须先成功进入服务器且保持连接；Eye先启动失败时，等本体上线再重试，原巡检约20秒附身。

网关只认可后端已返回登录成功且连接仍有效的普通角色；状态查询、失败登录、Eye和live不能提供本体会话。Agent断开就清除该连接，重连重新确认，不保存动态IP白名单。已有的专用接入限制、显式别名和live仍按原配置优先处理；Goddess、OP及Floodgate身份保护保持。有明确限制的账号若被拒，需房管检查该专用条目。`autoOnlineAgentEyes: false` 可热关闭默认在线配对；旧 `autoSameSourceEyes: false` 兼容为同一关闭开关，`autoNameEyes: false` 关闭自动后缀命名。

接入失败发送原版登录断开原因，说明本体未上线、专用限制或别名未登记等原因及下一步，避免只显示笼统的连接中断。此次通过原Watchdog只重连网关，Paper和YSM代理未重启，原客户端无需修改。实际Eye在线/附身须查本次回执，不把规则上线称作远端镜头已连接。 6项隔离测试通过，含真实1.20.6登录/配置、跨来源成功、失败/断开不授权、热限制及实际断开原因；私有回执E/F `repairs/eye-default-pair-20261011`。当前离线用户名本身不是强身份认证。

## 0.4.18 / 0.1.12 已上线：自动命名、live 与窗口生命周期

自动后缀配对、live按实际附身对象同步、移动/超距关闭真实窗口已正式上线。当前JAR在完整YSM隔离拓扑经原版协议20项及冷重启20项验证，正式按原维护流程发布。`ag_CorMy → ag_cormy_eye`保留原来源；服主确认live也在同一台电脑，已单独登记相同可信来源。CorMy的物品、技能保持独立；CortiLan原领地已按服主另行转给ag_CorMy，见[领地规则](LANDS.md)。原机Eye上线状态以本次实际连接为准，不能拿本地同名探针代替。

新版支持 `<名字>eye` 和 `<名字>_eye`，不区分大小写，如 `ag_cormy_eye` 和 `ag_cormyeye` 都对应 `ag_CorMy`。显式别名优先，保留 `CortiLan → CortiEye`；非末尾出现eye不会变成观战者，Goddess保持独立。`autoNameEyes: false` 可停用自动命名；`freeObservers` 默认 `["live"]`，最多4个自由镜头，设为空数组可停用。自动/显式配对总计最多16组，错误或缺失登记表停止转发。

`live` 是有可信入口的自由观战账号。按原版观战界面选择玩家后，只接收实际附身对象的原生背包、快捷栏、生命/饥饿/经验、魔力/技能及私有展示；换人或脱离立即清除旧数据。Watcher不替live选人。只复制客户端展示，不更改Eye自身的服务器背包、技能或物品。交易镜像只读，不能通过镜像拿物品或代交易。

私有 `agent-gateway-access.json` 中已有来源限制继续优先。自动命名Eye没有独立条目时，先检查对应Agent的明确来源限制；Agent也没有条目时，只要求对应本体已成功在线，不匹配IP。显式别名和live仍需独立条目。默认配对规则见本页顶部；访问清单和地址不进Git。

玩家打开交易/容器/虚拟菜单后，累计水平移动超过0.35格或垂直超过0.5格会关闭真实服务器窗口；转头和小抖动不关。物理容器/村民离开6.5格使用范围也关闭，远程个人箱等无物理来源菜单不按距离关闭。Web同时处理服务器关闭、相机切换、断流和移动，清除残留窗口。

Web使用原页面加 `?obs=1`（兼容 `?overlay=1`），背景透明、不启动世界渲染，保留真实角色HUD和物品。共享接入说明见mc-visual-console的 `renderer-src/docs/obs-observer-overlay.md`。远端电脑必须拉取、接入 `createViewerObserverBridge` 并用原版本/预设重建；服务端上线不代表远端已更新。基岩原版物品包可接收，但手机/Xbox实际外观和OBS合成须单独验收。以下为历史记录。

0.1.10已上线：转发器尊重上游消息取消，并只向Agent本人保留 `MC_PHOTO` 机器回执；附身Eye仅显示相机开始/完成和实际错误，不重复上传链接或进度。隔离实际附身与四地图交付已验证。

2026-10-06 服主明确确认 `feiyu_bot` 是 bot，已加入维护脚本的已核实服务账号例外。该身份确认只适用于这个精确账号。其可信来源 IP 尚未核实，本轮新增配对已撤销，恢复发布前接入规则；Agent/Eye 配对须同时完成可信来源登记。09:09 正常重启更新 AgentFriend 0.3.84 后，CortiLan/Goddess/CortiEye 已恢复，`cortieye` 读回 camera=online、attached=true；feiyu_bot 原客户端也已回连，重启前四个账号均恢复。

Goddess 平时是独立观察者，不参加Agent/Eye配对巡检。0.4.10已上线的[女神相机](SERVER_PHOTOGRAPHY.md)可为本人请求串行临时附身拍照，完成即恢复观察位置；已有人工附身会话不被抢占。`ops/agent-eye-pairs.json` 登记显式Agent/Eye对，也默认支持自动后缀配对；`ops/agent-eye-watcher.mjs` 每20秒通过本机RCON检查一次，把匹配的Eye维持为原版观战模式，并在两端在线时执行 `minecraft:spectate <Agent> <Eye>`。Agent离线时已连接Eye仍保持观战模式；再次登录按本页顶部的当前接入规则处理。

每个配对写一个 Agent 名；省略 `eye` 时自动使用 `<agent>_eye`，例如 `fulumu → fulumu_eye`。命名不同的配对明确写 `eye`，目前为 `CortiLan → CortiEye`。配置在下一次巡检时生效；撤销配对会停止附身。每次巡检也检查镜头与 Agent 的位置，发现脱离就重新附身；即使位置接近，最多两分钟也会重新附身。

`ops/manage-server.ps1` 的现有 Watchdog 保证巡检进程单实例运行并在其退出后恢复。修改配对文件不需要重启 Paper。正式服 CortiEyeMirror 0.1.10 只向**已登记、正在附身对应 Agent 且处于同一世界的 Eye**转发目标的私聊、动作栏、标题、BossBar、状态效果、粒子与音效；跨组不转发私有消息，全服广播去重。登记表约每 5 秒重新读取，撤销后停止转发；附身巡检约每 20 秒重新读取。隔离服已通过两组配对、跨组隔离、未登记 Eye 隔离、广播去重、状态效果和热撤销测试。Mineflayer Eye 没有 SpectatorPlus 客户端模组，玩家背包画面未能完成同等验收。

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

新增Agent默认先登录本体，再连接名字后缀Eye，不匹配来源IP，无需写入两份清单。别名或需固定限制时，在 `ops/agent-eye-pairs.json` 和运行机私有 `E:\MC\ops\agent-gateway-access.json` 配置；访问清单不提交仓库，结构示例见 `ops/agent-gateway-access.example.json`。网关每次登录读取，清单与开关可热改。网关代码更新需沿现有 `agent-lan-gateway.reload.requested` / Watchdog流程重连，部署时同时复制 `agent-lan-gateway.mjs`、`agent-eye-names.mjs`、`agent-gateway-login.mjs`，不必重启Paper。AgentFriend约每6秒读取显式及在线自动配对；原有铭牌UUID名单仍兼容。公会日常委托按玩家UUID和上海日期刷新，与Agent标记无关。

当前仍允许未登记的普通Java名字进入，**这些名字在离线模式下不能防冒用**；用户名和离线UUID本身不是身份验证。Goddess、OP名和既无专用许可又无在线对应Agent的Eye仍在登录前拒绝。Watchdog的“真人在线时不自动重启”保护只把已核实的服务账号列入例外，自动Eye配对不扩大该例外名单。
