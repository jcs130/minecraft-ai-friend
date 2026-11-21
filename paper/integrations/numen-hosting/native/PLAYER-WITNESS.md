# 普通玩家身体交接的独立查证

已有的签名回环接口 `/v1/hosted-role` 可以为明确登记的角色核对原普通客户端和 Numen 之间的交接。需要部署带玩家连接查证的托管版 Paper API 和游戏侧 `qiandengji_hosted_bridge` 0.1.6。两件能力都就绪后，才可在私有 `hosted-bootstrap.json` 中配置 `playerWitnessRoles`。默认列表为空。

每个登记项包含逻辑角色的 `characterId`、原普通玩家 UUID `roleUuid`、该 Numen 身体已登记的 `ownerUuid` 和游戏账号的技术名 `name`。只为明确授权切换的角色登记。普通 Java 与 Floodgate 玩家继续使用原来的登录流程。

1. 主管调用 `armPlayer(role, {characterId, requestId, generation, expect})`。`saved` 需要原普通连接在线。`client` 需要原身体已离线。主管通过原 SDK 连接向返回的插件频道发送 64 字节 ASCII 随机串。数据仅供此次进程间交接使用。
2. 主管用相同参数调用 `playerState`。退出前应看到 `witnessed:true` 和 `kind:mineflayer`。当目标是正常退出时，原玩家的退出事件写入本次请求专属的摘要。只有原 UUID 离线且服务器重读其最新玩家存档并确认摘要，才能得到 `saved:true`。未提交见证的连接会显示 `ordinary`。
3. 主管要接回普通身体时，先排空并释放 Numen。新普通客户端正常登录后通过同一方式证明持有这条新连接。只接受原请求和控制代次一致、`online:true`、`kind:mineflayer` 的回执。

每位登记玩家最多保留一个内存探针，有效期两分钟。游戏服务重启会清空探针。超过时限或缺少原存档回读时，保留原请求的待核实状态。在场且归属匹配的托管 Numen 会挡住企图抢占其 UUID 的普通登录，原生入场也会在真正放入玩家列表前复查原普通连接是否已离开。回退前先排空这批角色，保留原玩家存档和动作账本。
