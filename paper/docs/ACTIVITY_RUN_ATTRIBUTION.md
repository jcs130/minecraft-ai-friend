# 试炼塔与地下城场次回执

供客户端区分同一账号在不同活动中的记录。本批在已有回执上加字段，不改变 `/mycli` 的命令、权限或原字段。服务端在回执中确认游戏角色与场次；客户端仍应核对自己的服务器、账号与 Agent。

| 回执 | 场次归属 |
| --- | --- |
| `MC_TRIAL_STATE`（`/mycli arena status --json`） | `recipient` 是请求角色。仅在本人参赛且当前检查点已保存时才有顶层 `run`、`revision`。`active` 是全服试炼占用状态；`participant` 与 `lifecycle` 表示本人是否在该场。暂离等待重连时本人仍是成员。 |
| `MC_DUNGEON_START`、`MC_DUNGEON_JOIN`、`MC_DUNGEON_LOOT` | 保留原键值格式，附上 `recipient`、`run`、`revision`。这是试炼塔开场、加入、楼层奖励或限领回执；清一层不代表整塔通关。个人箱汇总 `MC_REWARD` 可能合并多个来源，不归入某个场次。 |
| `MC_TRIAL_RESULT`、`MC_TRIAL_STATE.lastOutcome` | 保存给结算时属于该队伍的角色，仅返回其最近一个本人结算。两处的 `run`、`revision` 一致；不能用历史记录作为本人当前场次。旧版未按角色保存的历史保持未知。 |
| `MC_SITE_DUNGEON_RESULT` | `start`、`join`、`resume`、`leave` 成功时的 `run` 取自实际操作的场次。`claim` 取自被消费的个人奖励，即使同地点已有新队伍。失败时不附会场次；旧奖励缺 ID 时不补猜。 |
| `MC_SITE_DUNGEON_STATE` | 字段保持兼容。只有 `participant === true`、`lifecycle === "active"` 且 `participantRun === run` 时，顶层 `run` 才代表本人当前场次。 `lastOutcome.run` 和 `pendingRewardDetails[].run` 各自是历史。 |

试炼塔的业务 `revision` 按场次计数。新场为 1；楼层、成员、暂停或恢复、清层和终局等已保存的状态变化会推进版本。等待秒数、剩余怪物和读操作不推进版本。重启继续使用同一场次的已保存版本，必要时记录一次暂停或恢复。旧版有效活动检查点从版本 1 开始，沿用已存在的场次 ID。地下城动作的 `run` 只确认归属；本批不为它构造业务版本。不要用 `schemaVersion` 或时间戳代替版本。

隔离验证使用 Youer 1.21.1、JDK 21、两个普通 Mineflayer 角色和一个旁观角色。只用专用回环端口 `25976/25977`，不用生产角色、账号或凭据。测试通过真正的 `/mycli` 和服务器回执读取数据；夹具仅构造初始场地、终止已生成的怪物和注入测试暂停，不构造回执。

1. 在新的可丢弃实例设置 `server-ip=127.0.0.1`、`server-port=25976`、`rcon.port=25977`、`online-mode=false` 及专用 RCON 凭据。创建 `.activity-run-qa`，内容为 `activity-run-attribution-loopback`。
2. 使用候选 AgentFriend。编译 [ActivityRunFixture.java](../probe/communication-contract/ActivityRunFixture.java) 为单独的 QA 插件，`main: org.qdqa.ActivityRunFixture`，依赖 AgentFriend，注册 `qd_attr_fixture`。在 `dungeons.yml` 加入 `qa_attribution`，入口和唯一房间为主世界 `(4200,81,4200)`，半径 5，1 只僵尸和合法奖励。
3. 运行 `node paper/probe/communication-contract/activity-run-attribution.mjs <隔离服目录> <java> <Mineflayer package.json>`。脚本自行启动、停止并重启隔离服，成功后写出 `activity-attribution-report.json`。

基于 `a7bc299a` 完整编译 AgentFriend，候选在 Youer 上通过 22 项联机检查，并正常停机。以下是测试回执的相关字段（仅 QA 角色）：

```text
MC_TRIAL_STATE {"recipient":"ag_AttrAlice","participant":true,"lifecycle":"active","run":"ae7507c0-d851-4b6f-8d6e-14d956e124c0","revision":1}
MC_TRIAL_RESULT {"recipient":"ag_AttrAlice","run":"ae7507c0-d851-4b6f-8d6e-14d956e124c0","revision":3,"status":"cancelled","reason":"timeout"}
MC_SITE_DUNGEON_STATE {"recipient":"ag_AttrAlice","run":"a4c0879f-112f-4965-91cd-c226e12353c9","participant":false,"participantRun":"","lastOutcome":{"run":"56b5371d-aff6-445b-a4fa-fde3039190f6"}}
MC_SITE_DUNGEON_RESULT {"action":"claim","id":"qa_attribution","success":true,"recipient":"ag_AttrAlice","run":"56b5371d-aff6-445b-a4fa-fde3039190f6"}
```

Alice 的楼层奖励在版本 2，重复查询保持版本 1。Bob 的新场从版本 1 开始，冷重启后的首次查询仍返回同一个 `6703159a-aa32-4eaa-b329-3d6db69becbe`，已保存的版本为 2。Alice 的历史仍为原场次版本 3。

这些字段仍需客户端按归属规则消费。该候选未部署。
