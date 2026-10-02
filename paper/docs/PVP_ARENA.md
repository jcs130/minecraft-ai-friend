# 千灯纪 PvP 竞技场

AgentFriend 0.3.68 提供独立、自愿的 1v1 对战。它用原版方块、装备、标题和菜单构成，Java、基岩版手柄与 Mineflayer 都不需要客户端模组。竞技场位于主世界 `(-700,160,-550)`，观众平台约 `(-700,161,-536)`；它不连接村庄试炼塔，不改变试炼奖励。玩家可以在技能罗盘点「PvP竞技场」，或使用 `/mycli pvp menu|lobby|join|leave|status|board`。两人加入后自动倒数 5 秒开赛，180 秒内击倒对方即获胜；超时比较剩余生命，相近则平局。比赛中离线、认输或离开擂台判负。旁观玩家不能伤害参赛者。

开赛前逐人按 UUID 将原位置、背包所有槽位、生命、饥饿、游戏模式和药水效果写到 `plugins/AgentFriend/pvp-escrow.yml`，临时换成相同的铁剑、弓、箭、盾、锁链甲和食物。结束、断线重连或正常停服时还原。对局中不能丢物、拾物、移动背包物品或用其他命令施法，鼠标光标上持物时拒绝入队。快照写入失败则取消配对；恢复失败保留快照并告知服主，**不能删除未恢复的 escrow 文件**。竞技场不发物品或货币奖励，只记录胜、负、平和 Elo 积分，初始 1000、每局 K=24；积分存在 `plugins/AgentFriend/config.yml` 的 `pvp-records` 下。这个分数衡量当前账号与 Agent 策略的实战表现，AuraSkills 的被动属性仍可能影响结果，不能把它解读为模型能力的纯控制实验。

`/mycli pvp status|join|leave|lobby` 向请求者本人发 `MC_PVP` 单行 JSON：`schemaVersion=1`、`action`、`ok`、`reason`、`queued`、`participant`、`active`、`queueSize`、`rating`、`wins`、`losses`、`world` 和大厅绝对坐标。参赛时另有 `opponent` 与 `phase`。结算仅向参赛者发送 `MC_PVP_RESULT outcome=<win|loss|draw|cancelled> reason=... rating=... damage=... durationMs=...`；`board` 私下列出 `MC_PVP_RANK`。Agent 先用 `/mycli explain pvp.join`，随后查询状态并进入匹配；`participant=false` 时不要把别人的对局当成自己的。基岩玩家用罗盘里的原版物品菜单即可完成，不必打字。

## 发布与保护边界

Paper 运行配置必须是 `pvp=true`，但 WorldGuard 三个世界 `__global__` 必须设 `pvp: deny`；主世界竞技场 `qd_pvp` 区域优先级 20，范围 `(-716,158,-566)` 至 `(-684,168,-534)`，仅这里设置 `pvp: allow`，并设 `block-break: deny`、`block-place: deny`、`mob-spawning: deny`。AgentFriend 的伤害事件再做一层拦截：只有**已经进入比赛、倒数结束、双方都在擂台内**的玩家攻击才放行。不要先把 `pvp=true` 发布、后补 WorldGuard 全局拒绝。禁用或回退 AgentFriend 期间仍要保留 WorldGuard 全局拒绝；若保护区域不能确认，先恢复 `pvp=false` 再开放服务器。

服主只在无真人游玩、无活动试炼和无 PvP 对局时进行完整 E/F 备份及发布。控制台先运行 `mycli admin surveypvp`，确认 `ok=true occupied=0`，再运行一次 `mycli admin buildpvp`；`pvp-arena.building` 是施工中断保护标记，不可自行清除后重复覆盖。建造前要确认世界范围没有玩家或其他重要内容。建成后使用普通非 OP 的两个临时账号测试场外不可互伤、场内可互伤、断线物品恢复和排名；重启后检查 WorldGuard 区域、`pvp=true`、Java/Agent 网关、Geyser 与观战镜头。隔离测试脚本为 `pvp-arena-stage.mjs`、`pvp-disconnect-stage.mjs`。回退插件只恢复同一备份中的配置与 escrow，避免复制旧世界覆盖新的玩家进度；已建方块无需为回退 JAR 而拆除。后台若发现非空 `pvp-escrow.yml`，先按 UUID 核对恢复状态。

本设计没有团队战、自动队伍平衡、赛季重置或观看战报；这些可以基于真实对局与基岩手柄反馈迭代。
