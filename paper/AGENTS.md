# 千灯纪 Paper 分支开发说明

本目录是 `qiandengji-personal-stash` 分支的现役服务器源码入口，继承自 `qiandengji-paper-1.20.6`。仓库根目录的 1.21.1 / NeoForge 文档是历史设计参考；不要将旧版 `world/` 的 JAR、配置或存档直接部署到 Paper 1.20.6。

2026-10-06 接入复核：仅确认机器人身份不等于确认其来源 IP。新增 feiyu_bot 配对时发现私有访问清单缺少该账号的可信来源，已撤销本轮新增配对并恢复发布前清单，避免网关把其原有重连拦截；已核实的维护服务账号例外保留。后续建立 Agent/Eye 配对须同时登记各自可信来源。

- 此版本后续提交和推送继续使用 `qiandengji-personal-stash`，除非用户明确改变分支策略；不要自动合入或推送 `main`。
- 运行目录是 `E:\MC\server`。这里的源码/配置快照不会自动影响运行实例；发布须按 `docs/OPERATIONS.md` 的备份、隔离验证、停服、替换、复测顺序进行。
- 不提交世界存档、玩家数据/白名单、`server.properties` 实值、RCON/代理/模型凭据、Floodgate 私钥、运行日志、备份或第三方 JAR/ZIP。版本和来源只进入清单。
- 2026-10-06 09:09 正常备份发布后，正式 AgentFriend 为 **0.3.84**（SHA256 `984AE0773B3EB9345DB024FFB2F66769B686B9929EE27B06D864EB936668D69F`），Java PID 34740，E/F `20261006-090906` 均有 `.complete`，任务结果 0。女神桥及配套七文件已同步，唯一新桥 PID 29836，目录 12 项 ready=true；MCP 八工具已实际重新发现，游戏桥仍只允许 server_status。隔离服铁砧、药水、满背包及重启去重通过；正式祈愿答复实测通过且未发物品。服主明确确认 `feiyu_bot` 为 bot，已加入维护脚本的已核实服务账号例外；不要据此泛化匹配所有 bot 名字。CortiLan/Goddess/CortiEye 已恢复，`cortieye` 读回 camera=online、attached=true；feiyu_bot 原客户端也已回连，重启前四个账号均恢复。哈希、测试、目录热更新及回退见 docs/GODDESS_GIFTS.md。
- 2026-10-05 02:17 正常备份发布后，正式 AgentFriend 为 `0.3.83`、CortiEyeMirror 为 `0.1.9`，Java PID 32992；E/F 双盘快照 `20261005-021734` 均有 `.complete`，任务结果 0。连接上限 40、观战者不额外激活实体，view/sim 保持 8/8、堆上限 4 GiB。AuraSkills 固定补丁正式 startup-verified 回执已通过 transform/behavior，不覆盖第三方 JAR。16 Agent + 16 Eye 受控移动测试通过，自然冷探索保留 FAIL，不能当作 16 个 LLM 长期自主验收。CortiLan/Goddess 已恢复，CortiEye 原机客户端仍未回连；登记与 watcher 正常，不能声称镜头已恢复。完整哈希、0.3.82 过渡发布与边界见 docs/MULTI_AGENT_PERFORMANCE.md、docs/PERFORMANCE.md。
- AgentFriend `0.3.84` 保留已上线技能：玩家主动的非原版传送及远程个人箱操作消耗魔力并显示技能特效，规则见 `docs/TRAVEL_MAGIC.md`；0.3.80 的心眼轮廓与探矿粒子引导随此版一并发布，见 `docs/SKILL_SYSTEM.md`。0.3.79 修复四座生活公会的堵门招牌及入口地形台阶，入口前八格与最低台阶都纳入保护；见 `docs/LIFE_GUILD_BUILDINGS.md`。0.3.78 的动态公会看板可用 `plugins/AgentFriend/dynamic-board.yml` 和 `mycli admin board reload|regenerate|replace` 热运营；规格与边界见 `docs/DYNAMIC_BOARD.md`。0.3.77 从热更新的 Agent/Eye 登记表识别 Agent；0.3.76 的法术图鉴与 Agent 查询协议见 `docs/SKILL_SYSTEM.md`、`docs/MYCLI_AGENT_CLI.md`；0.3.73 的村庄守望见 `docs/VILLAGE_SUPPORT.md`。CortiEyeMirror `0.1.9` 把已登记 Agent 的私有消息与 HUD 转发给各自 Eye；规则见 `docs/AGENT_EYES.md`。手动启动 `manage-server.ps1 Backup` 曾因当前交互令牌无法停止 Agent 网关而失败，计划任务可正常执行并完成 E/F 快照；以后优先用现有计划任务发布。改动须区分构建、隔离测试和正式服验证，并在每次发布后更新此处版本号。
- 每项用户可见功能同时检查普通 Java、基岩、Mineflayer Agent 和 CortiEye 真实观战客户端能否使用；结构与玩法优先使用原版协议可表达的方块、实体、物品和菜单。
- 开发或运营新技能、公会委托、地下城时先读 `docs/AI_WORLD_OPERATIONS.md`，保留稳定内容 ID、隔离验证记录和运行数据回退方案；更新已实现能力后同步修订该手册的现状表。
- 日常维护脚本、Goddess 桥及 LAN 网关必须保留单实例与 Watchdog 覆盖；不能让离线模式 Java 端口直接对公网开放。
