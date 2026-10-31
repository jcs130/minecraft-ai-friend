# 地下城参战与结算修复（已纳入0.4.22）

2026-10-31：服主要求改为按地点自动参战，AF.43 新规则及验收见 [自动参战候选](DUNGEON_AUTO_TEAM_20261031.md)。尚未部署；本页下面的“每室全勤、本人返回首室”是历史规则，不能用于指导自动参战新版。

2026-10-13补充：旧版有待领奖凭据但缺结束详情时，现役0.4.33会阻止重新开场且提示不清。23:56已按服主授权用原 `claim` 命令为小鱼领取墓穴旧奖励，准确增加8个绿宝石和4个铁锭；原日期、已领场次和凭据消费核验通过。0.4.36于2026-10-14按原维护流程上线，状态和菜单已修复，见[旧奖励与再次开场](DUNGEON_PENDING_REWARDS.md)。

## 当前状态

2026-10-11晚间：正式服 AgentFriend0.4.22/CortiEyeMirror0.1.13已包含本页修复及0.4.20罗盘箭头修正；正常维护和完整E/F快照后上线。后续隔离验证记录属于准备阶段，实际发布见 LOGIN_PROTECTION.md。

旧场次 `0add516e-284b-499c-b190-ff83f751b6d4` 的旧实现未保存结束原因，不能还原最终原因，也不据此补发、扣回或改玩家物品。新记录从此次正式更新后产生；旧的整数参战数量、待领奖凭据和每日去重记录继续保留。

## 参战规则

- 旧版只在清怪结束一刻统计在房内的玩家，会遗漏此前参战后走到门口的队友。候选在本室本次出怪期间累计登记：活跃生存队员进入战斗范围、实际命中本轮敌人（含远程攻击）、对本室队友实际治疗/施加有效祝福或成功救起，都可记功。
- 已登记者本室清场时站在门口仍记功。旁观者、未加入者、一直留在其他房间者不会凭组队被动记功。治疗/救援资格由服务器回调核对，不能凭聊天自报。
- 每室只增加一次。已清房间保存参与者明细；全队离线/离开挑战区或正常重启导致未清房间重刷时，清掉该次未完成的登记，重新参战。已清进度保留。
- 完整奖励仍要求每室登记、本人返回首室、每日限额未用。先 `claim`，奖励进入个人箱；`/mycli arena rewards` 查询、`/mycli arena stash` 打开。未获得完整资格可继续练习，查询缺席房间后正常退出再组队。

## 玩家和 Agent 提示

`/mycli dungeon status [地点ID]` 的 `MC_SITE_DUNGEON_STATE` 保留原字段，并追加 `run/attendance/requiredRooms/currentRoomParticipated/missingRooms/unverifiedRooms/attempt/resets/pauseReason/lastResetReason/lastResetAt/combatBounds`。范围是服务器实际采用的房间边界，同世界检查；缺席列出房间序号和名称。

暂停、续接、出怪、清室、结束有短中文聊天与动作栏摘要。全队离场说明“五分钟内回场、未清房间重刷”；原有故障则需处理后主动 `/mycli dungeon resume`。旧房间没有明细时显示 `unverifiedRooms` 并保留旧数量，不推断缺席名单。

没有活动时，`status` 返回本人的 `lastOutcome/outcomeKnown/pendingRewards`。`claim` 无凭据时先解释本人最近结果，再保留原 `no_pending_reward` 原因码和正确做法。新错误提示还通过原版动作栏显示短摘要，不改 Agent CLI 输入或原原因码。

| 结束原因码 | 含义 |
| --- | --- |
| completed | 房间已清并完成返程结算；每个人的奖励资格单独说明 |
| party_defeated | 全队倒地，失败 |
| party_left / member_left | 最后一人/本人主动退出 |
| time_limit | 超过三十分钟 |
| return_grace_expired | 全队离场或离线超过五分钟 |
| missing_or_unloaded_enemy_retry_required | 标记敌人异常消失，不能当击杀 |

奖励状态区分 `ready/claimed/run_incomplete/missing_participation/daily_limit/not_returned`，附 `nextAction/nextCommands`。后台日志追加 `MC_SITE_DUNGEON_END`；只向本人提供私人结算，不向其他玩家发奖或公开其记录。

## 保存与运维

`config.yml` 原 `site-dungeons` 下增量保存：

- `runs.<site>.roomAttendance/attempt/resets/pauseReason/lastResetReason/lastResetAt`；未清房间的临时参战集合不跨重刷沿用。
- `outcomes.<玩家UUID>.<site>`：每人每处最近一次结果，含场次ID、开始/结束时间、清室/参战/缺席及奖励状态。
- `last-outcomes.<site>`：每处最近结束摘要。
- `claimed-runs.<玩家UUID>.<site>`：已领取场次证明，原 `claimed/receipts` 保持。

房间登记、移除活动与结束结果写入同一个原子快照；领取时原奖励队列、任务证明和凭据消费仍一起提交。满队列/写入失败保留凭据并回退奖励。多级配置使用真正的配置节，避免追加房间字段时丢失原场次信息。

发布仍需原维护门禁、真人退出、180/60/10秒提醒、E/F 完整停服快照与正常停服换唯一 JAR。上线前再查当前场次，勿手动清检查点或重发旧奖励；不使用 `/reload`。女神现役资料与远端 Web 只能在实际发布后同步对应状态。

## 验证范围

候选 SHA256 `408DA24C9FAD6F7A4AB7538F5DDDCF596915611786361F90DF5539EB1BECCF4F`。`paper/probe/dungeon-participation-stage.mjs` 和 console-only `fixtures/DungeonParticipationQA.java` 只允许明确命名、回环地址和端口匹配的隔离服。已完成50项真实 Mineflayer/原生包检查：离场前参战、远程箭命中、治疗回调、缺席、重刷、主动退出/超时/宽限/异常消失、满奖励队列、写盘失败回滚、精确一份奖励及拒绝重复领；实际箱子/Minepacks/村民交易、转头保留、移动/对象超距关闭及 Eye 镜像。正常冷启动11项验证包括完整参战明细、未清室重刷、原已领奖证明和未领取凭据、续打后三室全勤及只领一次。前一候选49+11项和中途失败回执另存，未覆盖最终同包结果。

测试平台、冻结怪物、强力药效、console 位移、计时加速及治疗回调为披露夹具；远程箭实际飞行碰撞，未伪称 Agent 自主战斗。Eye 验证主动声明现有 SpectatorPlus screen_sync 通道；测试存活浮空客户端仅在隔离服允许飞行。早期夹具失败、候选保存缺陷的失败记录均保留。手机/Xbox真机、16个自主LLM长期运行不在这次验证范围。

## Web 与游戏消息

共享 Web 新增仅本页、只读、最近200条分类历史、搜索及未读数；技术回执默认折叠且最多40条，单条有4096字符上限。原 `gameMessage {kind,text}` 输入不变，按聊天/私聊/任务提醒/系统分类；聊天内容不能冒充服务器任务。切换实际附身对象、脱离或断线清理历史及旧提示；自动拍照页不创建消息面板。

游戏内保留原文字气泡；地下城重要事件及操作错误增加动作栏摘要。大背包、物理容器和交易窗口的移动/超距自动关闭早已在正式0.4.18起生效，原地转头不关闭，普通E随身背包不属于这类服务器容器。

本机已独立构建1.20.6/qiandengji候选并核验源码及bundle，未覆盖现役相机。远端 Web 在另一台电脑，需拉取共享源码并按原版本/preset重建、重启Web宿主；只刷新页面或只git pull不会改变旧bundle。浏览器截图为隔离消息面板示例，不是正式服画面或玩家私聊。

共享Web源码提交 `595a3a0eb405c0c1d2d6c5aafffd375d51ac510a`，仍未部署远端或正式相机。

私有证据保存在 `E:/MC/ops/repairs/dungeon-participation-20261011` 和 `F:/MC-backups/repairs/dungeon-participation-20261011`；原JAR、日志、截图与测试存档不提交Git。
