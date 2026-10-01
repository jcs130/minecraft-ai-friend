# Agent 魔力状态频道

AgentFriend 0.3.52 注册出站频道 `mcagent:state`，向每位在线玩家自己的连接发送本人的 AuraSkills 魔力状态。频道与登录名无关，也不会把一个玩家的数据发给其他连接。负载为无长度前缀的 UTF-8 JSON：

```json
{"schemaVersion":1,"mana":{"current":23.0,"max":32.0}}
```

AuraSkills 资料尚未加载时 `mana` 为 `null`，加载后发送数值。登录和重生会发初始快照；`/mycli` 与 MagicSpells 成功耗魔后下一游戏刻发送；其他变化，包括自然恢复，最多每秒检查一次，而且内容与上次相同时不发送。恢复轮询距离上一包不足一秒时会延后到下一轮。数据只走客户端自定义负载，不产生聊天、动作栏或全服公告。

支持已注册频道的客户端，也向未注册频道的 Mineflayer 连接单播原版 custom payload。客户端按 `mcagent:state` 过滤并解析 JSON；`mana:null` 表示等待数据，不能当成 0 魔力。登录、死亡重生后应以最新快照替换旧值；断线重连时清除本地缓存。`mcviewer:state` 继续提供完整技能和冷却信息，这是独立频道，客户端可以同时订阅。

`/mycli` 的 `MC_CLI_*`、`MC_DUNGEON`、`MC_ARENA_ECONOMY` 等命令回执仍是执行者本人的系统聊天。`mcagent:protection` 已是私有插件消息。试炼层公告只投递给该层玩家，试炼结束通知发给本次参赛者；原版玩家加入、退出和玩家正常聊天另按服务器现有规则显示。直播镜头 CortiEye 目前会镜像 CortiLan 收到的系统聊天，所以其个人回执会在这条观战连接中出现；这不是向全服广播。

隔离验证：`node paper/probe/agent-state-stage.mjs`，在 Paper 1.20.6 的 25566 隔离服上以两个独立 Mineflayer 玩家覆盖注册/未注册频道、初始状态、施法、自然恢复、重生、跨账号隔离、无状态聊天副本和数值未变不重发。
