# Agent 挖掘与放置前的保护查询

从 AgentFriend 0.3.33 起，玩家可用本人账号执行：

```text
/mycli protect break -551 68 -432
/mycli protect place -554 67 -440
```

坐标是目标方块的绝对整数坐标，世界取发命令的玩家当前所在维度。一次只查一个目标，范围是玩家眼睛周围 16 格；只查已加载区块，不会加载新区块。服务端按这名玩家的 WorldGuard 身份和当前建筑保护规则计算。每个结果只返回给发命令的连接：聊天有一行 `MC_PROTECT ` 开头的 JSON；注册了 `mcagent:protection` 的客户端还会收到内容相同的 UTF-8 JSON 原始 plugin message。基岩、原版 Java 和不注册频道的 Mineflayer 都可读聊天回执。查询不会把完整保护地图或隐藏方块材质发给客户端。

```json
{"schemaVersion":1,"action":"break","world":"minecraft:overworld","x":-551,"y":68,"z":-432,"status":"deny","allowed":false,"reason":"village_structure"}
```

`status=deny` 是当前已知规则拒绝，Agent 应换目标；`status=unknown` 时 `allowed=null`，例如距离太远、区块未加载或查询被限流，Agent 不应据此开挖；`status=allow_likely` 时 `allowed=true`，表示当前已知的 WorldGuard、原有村屋、公会大厅、公共道路、试炼场和地下城规则未拒绝。最终仍以实际 BlockBreak/BlockPlace 事件为准，其他插件、方块状态变化或权限变化可能在查询后拒绝。结果不宜长期缓存，动手前重新查询；收到实际拒绝后停止该目标，不要循环重试。

Mineflayer 最简接入方式是在发 `/mycli protect ...` 后监听 `messagestr`，只解析 `MC_PROTECT ` 前缀。用 `action/world/x/y/z` 对上本次请求，再要求 `status === 'allow_likely'` 才尝试操作。若需要与普通聊天分离，可在登录后注册 `mcagent:protection`，监听 `custom_payload` 并解析 UTF-8 JSON。两个回执内容相同，只消费其中一种即可。每名玩家自己的查询只回到自己的连接；Agent 不能指定别的账号或远处坐标来扫描世界。

以后若要把“当前站在安全区”作为环境提示，可另加低频区域摘要；不要把建筑快照直接当作长期客户端缓存。建筑保护以单块原始材质为条件，道路还保护走廊净空，WorldGuard 权限依玩家而异，发送一张静态区块地图会产生错误判断。
