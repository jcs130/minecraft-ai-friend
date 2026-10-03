# Agent 观战账号

Goddess 是独立观察者，不附身于任何玩家。`ops/agent-eye-pairs.json` 登记 Agent/Eye 对；`ops/agent-eye-watcher.mjs` 每 20 秒通过本机 RCON 检查一次，把已登记的 Eye 维持为原版观战模式，并在两端在线时执行原版 `minecraft:spectate <Agent> <Eye>`。Agent 离线时 Eye 仍保持观战模式。未登记的 `eye` 名字没有镜头权限，公网 Java 网关在登录前拒绝这种名字。

每个配对写一个 Agent 名；省略 `eye` 时自动使用 `<agent>_eye`，例如 `fulumu → fulumu_eye`。命名不同的配对明确写 `eye`，目前为 `CortiLan → CortiEye`。配置在下一次巡检时生效；撤销配对会停止附身。每次巡检也检查镜头与 Agent 的位置，发现脱离就重新附身；即使位置接近，最多两分钟也会重新附身。

`ops/manage-server.ps1` 的现有 Watchdog 保证巡检进程单实例运行并在其退出后恢复。修改配对文件不需要重启 Paper。正式服 CortiEyeMirror 0.1.8 只向**已登记且正在附身对应 Agent 的 Eye**转发目标的私聊、动作栏、标题、BossBar、状态效果、粒子与音效；跨组不转发私有消息，全服广播去重。登记表约每 5 秒重新读取，撤销后停止转发；附身巡检约每 20 秒重新读取。隔离服已通过两组配对、跨组隔离、未登记 Eye 隔离、广播去重、状态效果和热撤销测试。Mineflayer Eye 没有 SpectatorPlus 客户端模组，玩家背包画面未能完成同等验收。

新增 Agent 时，在 `ops/agent-eye-pairs.json` 写配对，并在运行机私有 `E:\MC\ops\agent-gateway-access.json` 分别为 Agent 与 Eye 登记可信来源 IP。访问清单含私人地址，不提交仓库，结构示例见 `ops/agent-gateway-access.example.json`。网关按每次登录读取，修改两份清单不用重启。AgentFriend 0.3.77 也约每 6 秒读取配对表：登记的非旁观 Agent 自动显示 `[Agent]`，并接收 Agent 路径的村庄紧急私聊；`fulumu` 已按这条规则识别。原有 `nametags.agent-uuids` 名单仍兼容，调整它需要正常重启。公会日常委托按玩家 UUID 和上海日期刷新，与 Agent 标记无关。

当前仍允许未登记的普通 Java 名字进入，**这些名字在离线模式下不能防冒用**；正式向更多 Java 玩家开放前，应选定正版登录或逐账号的可信接入方式。用户名和离线 UUID 本身不是身份验证。Goddess、OP 名和未登记 Eye 名字由公网网关在登录前拒绝。Watchdog 的“真人在线时不自动重启”保护只把已核实的服务账号列入例外。
