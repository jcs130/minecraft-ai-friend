# 千灯纪 Paper 分支开发说明

本目录是 `qiandengji-personal-stash` 分支的现役服务器源码入口，继承自 `qiandengji-paper-1.20.6`。仓库根目录的 1.21.1 / NeoForge 文档是历史设计参考；不要将旧版 `world/` 的 JAR、配置或存档直接部署到 Paper 1.20.6。

- 此版本后续提交和推送继续使用 `qiandengji-personal-stash`，除非用户明确改变分支策略；不要自动合入或推送 `main`。
- 运行目录是 `E:\MC\server`。这里的源码/配置快照不会自动影响运行实例；发布须按 `docs/OPERATIONS.md` 的备份、隔离验证、停服、替换、复测顺序进行。
- 不提交世界存档、玩家数据/白名单、`server.properties` 实值、RCON/代理/模型凭据、Floodgate 私钥、运行日志、备份或第三方 JAR/ZIP。版本和来源只进入清单。
- AgentFriend `0.3.52` 已在正式服运行；CortiEyeMirror `0.1.7` 对应当前生产 JAR。此前 AgentFriend `0.3.2` 保存在 `released/0.3.2/`。改动须区分构建、隔离测试和正式服验证，并在每次发布后更新此处版本号。
- 每项用户可见功能同时检查普通 Java、基岩、Mineflayer Agent 和 CortiEye 真实观战客户端能否使用；结构与玩法优先使用原版协议可表达的方块、实体、物品和菜单。
- 开发或运营新技能、公会委托、地下城时先读 `docs/AI_WORLD_OPERATIONS.md`，保留稳定内容 ID、隔离验证记录和运行数据回退方案；更新已实现能力后同步修订该手册的现状表。
- 日常维护脚本、Goddess 桥及 LAN 网关必须保留单实例与 Watchdog 覆盖；不能让离线模式 Java 端口直接对公网开放。
