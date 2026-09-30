# Agent 游玩提醒（AgentFriend 0.3.38）

提醒由服务端按玩家 UUID 维护，走原版系统聊天，只发给本人；Java、Mineflayer 可直接读，基岩无需客户端模组。它只建议命令，不会自动传送、治疗、施法或操作背包。`/mycli coach status|on|off` 可查询、启用或关闭；个人开关存在玩家数据里，重登后保留。旁观者没有提醒。Java/Mineflayer 默认开启，Floodgate 基岩账号默认关闭；两者都能用个人命令覆盖。全服可在 AgentFriend 配置 `coach.enabled` 关闭。

默认触发规则：30 分钟内累计死亡 3 次，在复活后或下次登录时提示检查状态、治疗术和安全撤退；15 分钟没有方块位移、交互、背包点击或命令时，提示发现能力和查看路线；活跃游玩 45 分钟未调用 `/mycli` 时，提示 `list` 与 `explain`。死亡、闲置、久未使用共享每人 30 分钟冷却；一次闲置过程只提示一次，恢复活动后才可开启下一次闲置计时。连续死亡与闲置相撞时，死亡提示优先。提示不会根据一个 Agent 的状态发给其他玩家。

回执示例：

```text
MC_COACH {"schemaVersion":1,"type":"reminder","reason":"deaths","deaths":3,"message":"连续死亡后先检查状态和可用技能；必要时回出生村整理装备。","commands":["/mycli status","/mycli explain cast.selfheal","/mycli goto village"]}
MC_COACH {"schemaVersion":1,"type":"status","enabled":true,"deathThreshold":3,"deathWindowSeconds":1800,"idleSeconds":900,"unusedSeconds":2700,"cooldownSeconds":1800}
```

`reason` 可为 `deaths`、`idle`、`mycli_unused`。客户端按 `MC_COACH ` 前缀截取单行 JSON；`commands` 是可供 Agent 自行判断的建议，不应盲目全执行。`MC_COACH_ERROR` 也是 JSON，带 `code` 和 `usage`。不要把私人提醒转发到公共聊天。CortiLan 的远端 Cortico 仍须确认能收集斜杠命令的系统聊天回执；本地 Mineflayer 测试不等于远端 Agent 端到端验收。

配置源在 `plugins/AgentFriend/resources/config.yml` 的 `coach` 节，正式服运行配置在 `E:\MC\server\plugins\AgentFriend\config.yml`。旧运行配置没有新增键时，插件使用上述内置默认值；不用覆盖它原有的公会、试炼和箱子数据。门槛单位是秒：`death-threshold`、`death-window-seconds`、`idle-seconds`、`unused-seconds`、`cooldown-seconds`。改正式服门槛须先备份、隔离服验证、无玩家时重启；不要为普通运营频繁缩短到几秒。死亡计数、起点、待发提醒、最后发送时间和开关保存在玩家 PDC，属于世界备份；当前会话的活动时钟只在内存，重登后重新计算闲置时间。

隔离测试 `plugins/AgentFriend/agent-coach-stage.mjs` 临时将门槛缩至数秒、累计死亡降为 2，验证个人开关、三类触发、闲置不重复、目录 `list/explain` 和错误回执；测试完恢复隔离服原配置和出生点。发布时仍须核验 Java、Bedrock Pong、Agent LAN 网关、女神桥与 CortiEye 镜头。基岩默认没有自动提醒，故 Pong 不足以证明其手动 `coach on` 聊天渲染，需真人客户端确认。
