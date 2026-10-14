# 保护查询：批量、聚合和按需详情

2026-10-14，AgentFriend **0.4.40 候选，未部署**。正式服仍为0.4.37。遵循 [统一 CLI 约定](CLI_CONTRACT.md)，沿用 `/mycli protect`，无需新的入口或客户端插件。

## 用法

```text
/mycli protect --help
/mycli protect batch --help

# 多个离散目标；重复坐标只查一次
/mycli protect batch break 2002,100,2002 2003,100,2002 --json

# 两端都包含，共8×1×8=64个方块
/mycli protect batch break --box 2000 100 2000 2007 100 2007 --json

# 旧单点写法保持；默认简短，详细规则按需读取
/mycli protect break 2002 100 2002 --json
/mycli protect break 2002 100 2002 --verbose --json
```

动作仍是 `break/place/container/use`。整数绝对坐标，当前维度、眼睛16格内、已加载区块；范围端点可以反向。每批最多64个输入目标，范围按体积校验，超大或溢出参数在读取世界前拒绝。不加载新区块，不发方块材质，不替玩家拆放、取物或修改权限。

Agent默认只收一份聊天 JSON，真人默认中文，`--json`仅切换格式，`--verbose`展开规则。实际附身Eye收到简短中文；私有结果不会发给旁人。

## 聚合格式

批量一次返回 **`MC_PROTECTION_BATCH {…}`**，同一对象也通过本人连接的 `mcagent:protection` 下发，`kind=protection_batch`。消费者按消息类型区分旧单点与新批量；同时监听聊天和原生负载时，使用相同 `sessionId/sequence` 去重，不把两个传输副本都加入上下文。

- `requested/total`：输入数量、去重后的实际目标数。
- `targets.encoding=points`：`points`是按首次出现顺序去重的坐标数组。
- `targets.encoding=box`：`min/max`是包含两端的范围；`order=y,z,x`表示X先递增，其次Z，最后Y。
- `counts`：`allow_likely/deny/unknown`各自数量。
- `groups`：只有实际判定、原因、归属和保护规则完全一致的目标才合并；不是只按原因码合并。
- `groups[].indices`：从0开始的**闭区间**列表，如 `[[0,3],[8,9]]` 精确对应第0–3、8–9个目标；每个目标恰好出现一次。
- 顶层 `areas`：范围定义只保存一次；组内 `areas:[0,1]` 引用其下标。保留 `shape/inclusive/envelopeOnly`，建筑外包范围不等于内部所有方块都被禁止。
- 每组保留 `status/allowed/reason/nextAction`；必要时有主人、公用物资入口和详情命令。`--verbose`一次展开该组的原始完整规则。
- `observedAt/sessionId/sequence`关联本次观察。每次查询重新判定，不缓存“允许”结果。

`deny`停止该目标；`unknown`且`allowed=null`表示未确认，不能当允许。`allow_likely`只是当前已知规则可尝试，最终以真实事件为准。不得用整批的允许数量推断某个坐标的权限。

大批次只计一次查询预算，批次内部不会被逐点限流；后续查询等待至少 `max(100, 目标数×15)` 毫秒。过快请求只返回一份 `unknown_rate_limited`、`complete=false`及`retryAfterMs`，不生成64条错误，不读取新目标。

异常复杂的重叠规则超过12000字符时，返回统计摘要、`complete=false/detailsPaged=true`和通用 `/mycli page <快照ID> 1`。完整对象通过既有无损JSON分片读取；未读完整前不能按摘要操作。快照仅属于当前连接，有效5分钟，最多保留两份；过期后重新查询。超过通用快照总上限时明确报错并要求缩小批次，不截断JSON。

## 自动提示与旧客户端

旧单点命令和 `MC_PROTECTION/MC_GUILD_ACCESS/MC_LAND_ACCESS`前缀保持。默认聊天移除重复的整段边界、操作教程和命令列表，保留状态、原因、坐标、归属、简短下一步和`detailCommand`。完整单点原生负载保持；只依赖聊天完整`areas/nextCommands`的集成应在需要时加`--verbose`。`--json`不会自动请求冗长详情。

自动拒绝按玩家、动作、维度及完整规则合并5秒内的重复通知；相邻方块相同规则也合并。规则、归属或边界变更立即显示，换连接清空记录；每名玩家最多记16组。下一次到期通知附`suppressedNotices`，没有后台定时刷屏。只减少本插件通知，其他插件自己的提示不在此承诺内。

**保护检查和实际取消每次照常执行。** 通知去重不能作为动作成功或获得授权的证据，显式查询不被通知去重吞掉。

## 验证与发布

```powershell
./paper/plugins/AgentFriend/build.ps1
./paper/plugins/AgentFriend/test-protection-query.ps1
./paper/plugins/AgentFriend/test-cli-contract.ps1
./paper/plugins/AgentFriend/test-life-challenges.ps1
node paper/probe/protection-batch-stage.mjs
node paper/probe/protection-batch-bedrock.mjs
```

联机探针仅接受回环25678/25679和指定隔离MOTD；`ProtectionBatchQA`只允许控制台建立临时真实WorldGuard区域，拒绝在生产端口启用。基岩通过回环Geyser19182；不代表手机/Xbox实际画面验收。证据放私有E/F `repairs/protection-batch-20261014`，结果及同版本JAR摘要见[候选清单](../manifests/protection-batch-candidate-20261014.json)。

最终同一JAR通过224项：保护语法/聚合/限频/分页62、通用CLI49、原挑战64、真实Java/Agent/实际Eye39、基岩协议10。原生单点实收439字符，详细683字符；64个相同规则的纯测试样例46208→741字符（不同保护场景大小不同）。原生64目标混合查询共261毫秒，包含探针主动等待170毫秒，不作为服务器处理耗时或16个自主Agent性能结论。

联机同时验证每个目标与单点结果一致、权限即时变更、范围体积拒绝、查询限流、实际连续挖掘被取消、未改库存、旁人隔离，以及64个不同区域触发私有分页。第一次通知测试中止了尚未完成的生存挖石动作，未触发最终拒绝；改用隔离创造模式的真实立即挖掘后确认合并。另一次Mineflayer预测方块状态先变为空气，改用服务端真实方块快照确认四个方块全保留，未为通过测试放宽保护。失败记录与对应旧摘要保留；最终224项只计最终JAR的结果。

生产需另行确认，按[维护规范](OPERATIONS.md)预告、检查真人和活动、双盘完整冷备份及正常停启后替换JAR。没有新增持久玩家数据或权限配置，回退旧JAR即可撤下本改造，无需回滚世界或物品；隔离夹具不得进入生产。
