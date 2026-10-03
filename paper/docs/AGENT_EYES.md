# Agent 观战账号

Goddess 是独立观察者，不附身于任何玩家。在线用户名包含 `eye`（不区分大小写）的账号是观战镜头；`ops/agent-eye-watcher.mjs` 每 20 秒通过本机 RCON 检查一次，将其维持为原版观战模式。只有镜头和对应 Agent 都在线时才执行原版 `minecraft:spectate <Agent> <Eye>`；Agent 离线时镜头仍保持观战模式。

镜头名去掉一处 `eye` 和首尾下划线后，如果恰好等于在线 Agent 的登录名，就自动配对。例如 `fulumu_eye → fulumu`。不符合命名规则的配对写在 `ops/agent-eye-pairs.json`，目前为 `CortiEye → CortiLan`。配置在下一次巡检时生效。无法找到对应 Agent 的 Eye 保持观战，等待 Agent 上线或补充明确映射。每次巡检也会检查镜头与 Agent 的位置，发现脱离就重新附身；即使位置接近，最多两分钟也会再次确认附身。

`ops/manage-server.ps1` 的现有 Watchdog 保证巡检进程单实例运行并在其退出后恢复。部署或修改这几个 ops 文件不需要重启 Paper。现有 CortiEyeMirror 仍负责 CortiEye 的原生重连与镜头效果。

这套规则根据账号名推断**观战镜头和配对关系**。服务器暂时不能仅靠连接来源或客户端品牌可靠判断任意普通账号是否为 Agent：当前 Mineflayer 发送的品牌与普通客户端相同，接入网关又统一转发到 Paper 本机。`[Agent]` 头顶标志仍按 AgentFriend 配置里的 UUID 名单显示，插件启动时载入；公会日常委托按玩家 UUID 和上海日期刷新，与该标志无关。Watchdog 的“真人在线时不自动重启”保护只把已核实的服务账号列入例外，不会因为某人名字里有 `eye` 就把陌生主账号排除在保护之外。
