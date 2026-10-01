# Agent 挖掘与放置前的保护查询

从 AgentFriend 0.3.33 起，玩家可用本人账号执行：

```text
/mycli protect break -551 68 -432
/mycli protect place -554 67 -440
```

坐标是目标方块的绝对整数坐标，世界取发命令的玩家当前所在维度。一次只查一个目标，范围是玩家眼睛周围 16 格；只查已加载区块，不会加载新区块。服务端按这名玩家的 WorldGuard 身份和当前建筑保护规则计算。每个有效查询的结果只通过发命令玩家连接上的 `mcagent:protection` clientbound plugin message 发送，消息体是 UTF-8 JSON 原始字节，不带长度前缀；`deny`、`unknown`、`allow_likely` 都发送。没有 `MC_PROTECT` 聊天副本、广播、动作栏或标题。命令语法错误仍用普通聊天提示用法。原版 Java/基岩客户端若不处理此频道，看不到结构化查询结果；Mineflayer 应监听协议 `custom_payload`。查询不会把完整保护地图或隐藏方块材质发给客户端。

```json
{"schemaVersion":1,"action":"break","world":"minecraft:overworld","x":-551,"y":68,"z":-432,"status":"deny","allowed":false,"reason":"village_structure"}
```

`status=deny` 是当前已知规则拒绝，Agent 应换目标；`status=unknown` 时 `allowed=null`，例如距离太远、区块未加载或查询被限流，Agent 不应据此开挖；`status=allow_likely` 时 `allowed=true`，表示当前已知的 WorldGuard、原有村屋、公会大厅、公共道路、试炼场和地下城规则未拒绝。最终仍以实际 BlockBreak/BlockPlace 事件为准，其他插件、方块状态变化或权限变化可能在查询后拒绝。结果不宜长期缓存，动手前重新查询；收到实际拒绝后停止该目标，不要循环重试。

Mineflayer 在连接上监听 `custom_payload`，只处理 `packet.channel === 'mcagent:protection'`，以 `JSON.parse(Buffer.from(packet.data).toString('utf8'))` 解码。客户端可以通过 `minecraft:register` 注册频道；0.3.42 对未注册连接也会发送同一种原生 custom-payload 包，因为 Paper 的 `Player.sendPluginMessage` 会静默跳过未注册连接。用 `action/world/x/y/z` 对上本次请求，再要求 `status === 'allow_likely'` 才尝试操作。每名玩家自己的查询只回到自己的连接；Agent 不能指定别的账号或远处坐标来扫描世界。不要再等待 `messagestr` 中的 `MC_PROTECT`。

以后若要把“当前站在安全区”作为环境提示，可另加低频区域摘要；不要把建筑快照直接当作长期客户端缓存。建筑保护以单块原始材质为条件，道路还保护走廊净空，WorldGuard 权限依玩家而异，发送一张静态区块地图会产生错误判断。
