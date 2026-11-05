# 摄影账号在线人数统计：PR #68 后续修复候选

PR #68 已于 2026-11-05 02:53:41 UTC 合并。本次在包含 PR #68、#70 的
`cbf2c6d3` 上隔离验证并修复官网统计；没有连接、修改或部署正式服务器。

## 复现与边界

使用临时游戏投影文件、回环 TCP Minecraft 状态响应、真实门户 HTTP、独立 SQLite
和进程对象重建，串联 `GameData → buildSnapshot → CloudSource.accept/read → CloudGame`。
测试先于实现运行。原代码在样本缺失且摄影账号在线的夹具中返回含摄影账号的原始人数；
公开 roster 已删除摄影账号，云端无法再修正。另复现两条组合路径：

- 未过滤旧 roster 带同一摄影 UUID 的两个别名时，云端把 4 扣成 2，应该只扣成 3。
- 旧 producer 给出 2 人及在线摄影行，`buildSnapshot` 先丢弃摄影行却保留 2，云端仍为 2。

同时发现 Ping 中换名的摄影 UUID 在尚未写入 usercache、也未匹配授权名称时，
可重新进入本地公开 roster；现在依据 Ping 中的固定 UUID 一并过滤该名称。

这些是隔离复现，不是正式环境错误统计的证据，也不是实际拍照或观战画面验收。

## 人数的证据规则

只依据同一份新鲜 Ping 的总人数和身份样本判断是否包含摄影连接。
样本中的固定姓名（不区分大小写）或固定 UUID 是正证据，最多扣一次。
样本缺失不等于离线；不按 roster 长度、认证人数或所有 observer 数量替代总人数。

LoginGuard 的 `authorizedNames` 来自代理上的 `authorized(player)`，不要求 `inPaper(player)`。
因此认证成功也可能尚未进入被 Ping 的后端，不能仅凭这份心跳扣减。
现有数据无法证明时返回 `playersOnline: null` 和 `playersOnlineUnavailableReason`，
界面显示“在线人数待确认”，服务器运行状态仍独立显示。未知容量进度条不伪装成零。

| 隔离输入 | 原始人数 | 本地、快照与云端结果 |
| --- | ---: | --- |
| 摄影在线，sample 缺失、为空或不完整且不含摄影账号 | 4 | 待确认 |
| 摄影离线，sample 为空或不完整 | 3 | 待确认；不减 1 |
| 不完整 sample 明确包含摄影账号 | 4 | 3 |
| 完整 sample 包含摄影账号 | 4 | 3 |
| 完整 sample 只有普通玩家、其他 Agent、Eye | 3 | 3 |
| 摄影是唯一连接，且 sample 证明其在线 | 1 | 0 |
| 总人数为零且无样本矛盾 | 0 | 0 |
| 重复姓名、重复 UUID、匿名零 UUID 无法覆盖全部连接 | 非零 | 待确认 |
| 状态来源过期、时间异常、人数非法或零人数与非空样本矛盾 | 任意 | 待确认 |

“完整”要求样本长度等于总人数，每行名称合法、UUID 合法且非零，名称和 UUID 分别唯一。
新鲜度与现有 Ping 缓存相同：最多 5 秒，最多允许未来 1 秒的时钟误差。
若未来需要在空样本时也显示精确人数，应增加与总人数同源的后端在线身份投影；
本次不新增认证协议或正式服务依赖。

## 快照与历史兼容

- 新 summary 添加 `playerCountPolicy: "photo-observer-excluded-v1"`，表示三个计数
  `playersOnline / rosterCount / agentCount` 已执行摄影过滤。未知人数也携带口径。
- `buildSnapshot` 在丢弃摄影行前规范旧 producer 的计数；云端只对没有口径的旧数据兼容转换。
  已带口径的数值不再扣减，即使旧适配器仍带内部摄影行。
- 旧快照只有在同一次后端 Ping 的样本证实相机在线时才扣减一次，名册和 Agent 计数按移除的行数调整。
  如果缺少相机行、只有代理认证或观测时间不一致，非零人数显示待确认。
- 转换仅作用于读取结果，不更新旧 payload、body hash、序号或身份数据。
  原字节重放、重复提交、重启恢复仍遵守原协议；不把新字段补写到旧存储中。
- 新口径的非法人数、缺失未知原因和不支持的口径在 HTTP 接收时拒绝，不能替换已有快照。
- 快照整体过期时继续显示未知，不能沿用上一份已确认的人数。

摄影的公开角色、成长数据与私有状态仍被过滤；原内部 Eye 配对保留。
本次不修改摄影执行器、Eye 配对配置、Java 插件或玩家/Agent 的原始连接数。

## 隔离验证

在 `paper/integrations/agent-portal` 执行：

```sh
node --test tests/photo-observer-count.test.mjs
node --test tests/photo-observer-count.test.mjs tests/cloud.test.mjs tests/portal.test.mjs tests/native-presence.test.mjs tests/agent-access.test.mjs
node --test --test-name-pattern='unknown online count|verified zero count' tests/ui.test.mjs
npm run check
```

- 新统计回归 27 项通过，覆盖 TCP 样本缺失/为空/截断、摄像机在线/离线、固定身份、
  去重、旧快照、实际 HTTP 接收、原哈希重放、重启和连续状态切换。
- 新增两项 DOM 界面回归 2/2 通过。
- 最终门户完整 `npm test`：447 项中 445 项通过、2 项未通过，均为 Chromium 在当前宿主启动时
  `socket() failed: Operation not permitted`，尚未执行浏览器断言。
  分别是 `music-browser.test.mjs` 和 `site-shell-browser.test.mjs`；未更改或跳过其断言。
- 134 个 JavaScript 模块语法检查通过，公开源码路径检查通过，`git diff --check` 通过。

已有门户 HTTP 回归同时验证历史摄影隐藏、直播目标/直接观战拒绝、成长过滤、事件分页、
照片相关路径与 Eye 内部身份边界。真实游戏拍照、Eye 连线及正式网站发布不属于本次验收。
