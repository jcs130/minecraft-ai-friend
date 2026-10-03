# 玩家头顶身份与公会等级

AgentFriend 0.3.67 用原版 scoreboard team prefix 在已入公会玩家的名字前显示等级：`◆青铜`、`◆黑铁`、`◆白银`、`◆黄金`、`◆白金`、`◆钻石`。等级直接读取该玩家 UUID 对应的公会声望，升阶后最多约 2 秒更新。未注册公会的普通玩家仍显示原生名字；未注册的 Agent 保留 `[Agent]`。已注册的 Agent 同时显示两种身份，例如 `◆白金 [Agent] CortiLan`。旁观模式账号（含 Goddess、CortiEye）不显示公会标记。

这只是显示前缀，不改登录名、UUID、皮肤、聊天权限或玩家当前使用的记分板，也不把公会等级当成 AuraSkills 等级。公会档位及声望门槛仍以 `GuildManager.RANKS`、`THRESHOLDS` 为准。插件在每个观众实际使用的 scoreboard 上维护 `qd_agents`、`qd_rank_0..5`、`qd_arank_0..5` 队伍；如果别的插件已为某玩家分配 gameplay team，本功能不抢占。插件关闭时注销自己的队伍。

Java 原版客户端通过原版队伍包显示头顶和玩家列表前缀；Geyser 将队伍前后缀转换给基岩客户端；Mineflayer 能读取 `teams` 包。网页画面能否画出前缀仍取决于网页渲染器。第一人称附身画面不会看见目标自己的头顶，能看见其他玩家的标记。原版队伍前缀并非额外的 Agent 状态协议，Agent 若要准确决策公会等级仍用 `/mycli guild status` 或专用机器回执。

AgentFriend 0.3.77 每约 6 秒读取 `ops/agent-eye-pairs.json` 的 Agent 名，已登记且非旁观模式的账号自动显示 `[Agent]`，移除配对会自动撤销。旧版 `nametags.agent-uuids` 固定名单仍兼容，包含 CortiLan、Kirito、Naruto 和 corti；手工改 UUID 名单或 `nametags.agent-prefix`（单行、最多 20 字符）需正常重启。公会声望是运行数据 `plugins/AgentFriend/config.yml` 中的 `guild-players`；不要把隔离服测试数据复制到正式服。

Eye 观战账号的登记及附身规则见 [Agent 观战账号](AGENT_EYES.md)。`fulumu` 已按登记表自动显示 `[Agent]`；`fulumu_eye` 与 Goddess 均不显示。登记表只表示服务账号身份，公会日常委托仍以各自 UUID 记录。

隔离验证脚本 `paper/plugins/AgentFriend/guild-rank-nametags-stage.mjs` 用三个真实 1.20.6 Mineflayer 连接检查公会前缀；`agent-registry-stage.mjs` 验证热登记、撤销、损坏配置拒绝与恢复。正式服 RCON 名单已读回 `[Agent] fulumu`。基岩真机仍需确认字体与颜色；Geyser Pong 只能证明网络可达，不能替代画面验收。回退为停服后仅启用上一版 AgentFriend JAR；公会数据无需迁移。
