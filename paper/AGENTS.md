# 千灯纪 Paper 分支开发说明

本目录是 `qiandengji-personal-stash` 分支的现役服务器源码入口，继承自 `qiandengji-paper-1.20.6`。仓库根目录的 1.21.1 / NeoForge 文档是历史设计参考；不要将旧版 `world/` 的 JAR、配置或存档直接部署到 Paper 1.20.6。

- 此版本后续提交和推送继续使用 `qiandengji-personal-stash`，除非用户明确改变分支策略；不要自动合入或推送 `main`。
- 运行目录是 `E:\MC\server`。这里的源码/配置快照不会自动影响运行实例；发布须按 `docs/OPERATIONS.md` 的备份、隔离验证、停服、替换、复测顺序进行。
- 不提交世界存档、玩家数据/白名单、`server.properties` 实值、RCON/代理/模型凭据、Floodgate 私钥、运行日志、备份或第三方 JAR/ZIP。版本和来源只进入清单。
- 2026-10-04 23:52 已在原 JVM PID 13880 在线修复 AuraSkills 2.4.0 翻译缓存键错误，清理 10133384 条重复组件；固定工具 `E:\MC\ops\instrumentation\auraskills-cache-patch.jar` 由同身份 Watchdog 应用，下一次正常启动自动追加 `-javaagent`。源、版本/字节码 SHA 锁定、回退及实测见 `docs/PERFORMANCE.md`，不要覆盖第三方 JAR 或将隔离验收当成正式启动验收。AgentFriend 0.3.82 的 Viewer 订阅早退与固定名称缓存已通过隔离服测试，排队到现有 2026-10-05 04:00 安全维护窗口；当前正式 AgentFriend 仍为 0.3.81，发布被真人/活动守卫推迟时不冒称生效。
- AgentFriend `0.3.81` 已在正式服生效：玩家主动的非原版传送及远程个人箱操作消耗魔力并显示技能特效，规则见 `docs/TRAVEL_MAGIC.md`；0.3.80 的心眼轮廓与探矿粒子引导随此版一并发布，见 `docs/SKILL_SYSTEM.md`。0.3.79 修复四座生活公会的堵门招牌及入口地形台阶，入口前八格与最低台阶都纳入保护；见 `docs/LIFE_GUILD_BUILDINGS.md`。0.3.78 的动态公会看板可用 `plugins/AgentFriend/dynamic-board.yml` 和 `mycli admin board reload|regenerate|replace` 热运营；规格与边界见 `docs/DYNAMIC_BOARD.md`。0.3.77 从热更新的 Agent/Eye 登记表识别 Agent；0.3.76 的法术图鉴与 Agent 查询协议见 `docs/SKILL_SYSTEM.md`、`docs/MYCLI_AGENT_CLI.md`；0.3.73 的村庄守望见 `docs/VILLAGE_SUPPORT.md`。CortiEyeMirror `0.1.8` 把已登记 Agent 的私有消息与 HUD 转发给各自 Eye；规则见 `docs/AGENT_EYES.md`。手动启动 `manage-server.ps1 Backup` 曾因当前交互令牌无法停止 Agent 网关而失败，计划任务可正常执行并完成 E/F 快照；以后优先用现有计划任务发布。改动须区分构建、隔离测试和正式服验证，并在每次发布后更新此处版本号。
- 每项用户可见功能同时检查普通 Java、基岩、Mineflayer Agent 和 CortiEye 真实观战客户端能否使用；结构与玩法优先使用原版协议可表达的方块、实体、物品和菜单。
- 开发或运营新技能、公会委托、地下城时先读 `docs/AI_WORLD_OPERATIONS.md`，保留稳定内容 ID、隔离验证记录和运行数据回退方案；更新已实现能力后同步修订该手册的现状表。
- 日常维护脚本、Goddess 桥及 LAN 网关必须保留单实例与 Watchdog 覆盖；不能让离线模式 Java 端口直接对公网开放。
