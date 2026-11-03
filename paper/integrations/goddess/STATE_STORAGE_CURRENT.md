# 存储状态与副本恢复

AF.52 的状态保存统一经过单一写入器。`config.yml` 是可读取的快照；当 Windows 暂时拒绝替换它时，完整状态与提交凭据先落在同目录 `.state-pending`，后台只重试发布快照，不重新执行游戏操作。

- `projection_delayed`：游戏进度已经保存，网站应读取最新已提交状态。不要重复挑战、领奖或开场。
- `published`：已提交状态与快照一致；这不代替其他玩法的验收。
- `commit_unknown`：保存结果无法确认。保留原始文件，查询原场次与奖励记录，请运营核对，不盲目重试。
- 没有 `stateStore`：旧版未提供，不推断为正常。

现有 `mycli admin dungeons audit` 包含 `MC_AGENT_STATE_STORAGE`；女神快照会把它传为 `stateStore`。没有新增玩家命令。

仅确认过的存储故障会在原队伍回到遗迹后自动核对并恢复原检查点。未知异常、损坏记录或不确定提交继续保留现场，不自动解锁或补奖。玩家原有 `/mycli dungeon resume` 保留，不加 `cast` 或副本编号；巡检不代执行。

备份整个 AgentFriend 数据目录，包括 `.state-pending` 中的 `.state`、提交 JSON 和锁文件。不要将它当临时目录删除；不要从旧 `config.yml` 回灌覆盖新进度。待发布时不要手改快照；应先核对权威状态并完成发布，再按原配置维护流程操作。完整校验及发布边界见仓库 `paper/docs/STATE_STORAGE_20261103.md`。
