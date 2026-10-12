# Agent CLI：短引导、当前状态与按需详情

2026-10-12：**AgentFriend 0.4.29 / LoginGuard 0.1.1 已完成隔离验证，尚未部署。**正式服仍为 AgentFriend 0.4.28 / LoginGuard 0.1.0。本轮没有修改正式账号、物品或世界，没有排队重启。

后续发布准备：CLI候选已合入半透明气泡0.4.30。服主已批准更新；真实回环Velocity→LibreLogin→Paper组合新增15项联机检查通过，包括首次设置密码、已注册账号登录、真实认证心跳、重连会话、大背包与Eye随本体上下线。维护助手追加仅允许移除旧LoginGuard精确文件名，5项通过，覆盖错误摘要、第三方JAR、Paper/代理未停时拒绝。正式真人仍在线时不排队停服；发布状态见SERVER_UPDATES，不能把候选证明当成已上线。私有回执位于E/F `repairs/cli-bubbles-release-20261012`。

既有入门、规则、能力目录、分项进度和可靠大背包客户端适配已经随 0.4.27 上线，并保留于 0.4.28；这次统一查询语义、减少迎新上下文并补齐观测时效。前一轮见 [Agent 交互](AGENT_INTERACTION.md)。

## 参考 CLI-Anything 的方法

阅读了 [HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything) 和 [HARNESS 方法](https://github.com/HKUDS/CLI-Anything/blob/main/cli-anything-plugin/HARNESS.md)。采用以下适合 Minecraft 聊天协议的做法，没有导入其运行时代码：

- 复用已有分组和 `list / info / status`，帮助可以在执行前发现参数、权限、副作用和结果查询方式。
- 增加 `--help` / `-h` 和明确范围的 `--json`；错误格式不会落入消耗性动作。
- 观察、报名、学习、执行、提交分别描述；普通查询保持只读，旧兼容入口如有证明或刷新行为则明确说明。
- 使用真实 Paper、Geyser、Mineflayer 和 Minepacks 验证最终状态，不把命令已发出算作完成。

没有增加 `/mycli agent` 分组，也没有把进程退出码、操作系统文件路径或交互壳加入游戏命令。

## 最短入门路径

```text
/mycli status
/mycli rules
/mycli capabilities
/mycli progress all 1
/mycli skills status
/mycli skills status night
/mycli skills learn night --help
```

普通已登录玩家可以查询。未认证客户端仍受代理原有拦截。`ag_` 或已登记 Agent 的核心自动迎新改为一条 `MC_GUIDE` 稳定中文说明和一条 `MC_STATUS` 当前观察；其他插件的安全提示、真实发物品回执仍可能出现。Eye 不参加新手实练。手动 `coach guide` 保留完整说明。

`MC_GUIDE` 提供规则、能力、任务、认证和大背包入口。54 格 Minepacks 大背包与任务袋、奖励储物分开；存取仍使用原生窗口及槽位协议。自动提醒发单条 `MC_GUIDE_NEXT`，包含真实当前阶段和一条下一步命令。

## 查询与兼容入口

| 命令 | 输出和语义 |
| --- | --- |
| `/mycli status` | 新 `MC_STATUS`，只读本人状态。Agent 默认只收机器消息；其他玩家另有两行中文摘要 |
| `/mycli status --json` | 只发 `MC_STATUS` |
| `/mycli status full` | **旧详细输出兼容入口**；保留原实练证明及各子系统原有行为，不标成只读 |
| `/mycli progress [all\|main\|training\|guild]` | 保留旧 `MC_PROGRESS` 多条流；增加当前连接信息；过大行返回完整详情入口 |
| `/mycli progress all 1` | 按需 `MC_PAGE`，一条命令返回一页。主线、专项、公会分别说明阶段、缺少条件和下一步 |
| `/mycli skills status [mine\|all\|技能ID] [页码]` | 只读本人学习资格、消耗和实际冷却。默认 `mine`，未知学习数据保留为未知 |
| `/mycli skills mine/info/points` | 原流程保持；目录明确这些旧入口会同步已赚点数/指标，不冒称只读 |
| `/mycli page <快照ID> [页码]` | 只续读本连接缓存，不刷新游戏状态 |
| `/mycli coach practice status` | 已报名者显式完成状态实练；未报名返回 `NOT_ENROLLED` 和报名命令 |
| `/mycli <命令及参数> --help` 或 `-h` | 查最贴近的命令说明，不执行学习、施法、接单等动作 |
| `/authstatus` | LoginGuard 0.1.1 代理查询本人认证观察；不授予登录资格 |

**兼容变化：**`status` 的默认输出形状和副作用变了。依赖旧详细输出或用它记录实练的调用端应改用 `status full`；只想查当前状态的调用端读取新 `MC_STATUS`。未带页码的 `progress` 保留旧协议，显式页码或 `--json` 使用 `MC_PAGE`。

`--json` 仅支持 `status`、`progress`、`skills status`、`page`、`capabilities`。其他命令带该标志返回 `UNSUPPORTED_FORMAT`，本次不执行动作。尚未支持的旧入口继续沿用各自回执，不能假定所有服务器命令已经支持这个标志。

## 如何判断信息是否是当前的

新观察有 `schemaVersion`、`kind`、`scope`、`playerUuid`、`sessionId`、`sequence`、`observedAt` 和 `readOnly`：

- `sessionId`：每次加入 Paper 生成新 UUID；重连或重启后变化。
- `sequence`：本连接的观察递增编号。接收端不能拿旧连接的较大序号覆盖新连接。
- `observedAt`：服务端观察毫秒时间戳，不能拿聊天到达顺序当作状态版本。
- `playerUuid`：Eye 镜像仍标实际本体；普通陌生玩家收不到别人的私有状态。
- 分页另有 `snapshotObservedAt`，所有页属于同一次冻结观察。续读时响应时间更新，**快照内容不会变新**。

`status` 包括生命、最大生命、饱食、模式、冒险者等级、职业、魔力及是否加载、倒地/参战标志、主线毕业标志和下一步命令。专项完成与主线毕业独立，只有 `mainlineGraduated` / 主线 `graduated=true` 才表示毕业。

## 无损分页

每连接最多保存两份只读快照，保留五分钟，退出即清理。单次源数据总计最多 131072 个 UTF-16 字符，超限明确报 `RESPONSE_TOO_LARGE` 并建议缩小查询，不静默裁掉文本。

`MC_PAGE` 包含 `snapshotId`、`snapshotObservedAt`、`page`、`pages`、`total`、`firstItem`、`lastItem`、`expiresAt`、`refreshCommand`、`items`，有后页时给完整 `nextCommand`：

- 页码从 1 开始；源条目索引从 0 开始；`total` 是原条目总数，不是消息数。
- 普通页最多四条，并受消息预算约束。过大条目先发 `encoding:"summary"` 的阶段摘要，再给完整的 `json_fragment` 分片。
- 分片按相同 `snapshotId` / `itemIndex` 的 `part=1..parts` 拼接 `data`，最后 `JSON.parse` 得到原条目。摘要不是另一个任务，不计入 `total`。
- 不拆开 emoji 的 UTF-16 代理对，中文、奖励说明和转义字符均可完整取回。
- 过期、被新查询替换或来自旧连接/他人连接的缓存给 `SNAPSHOT_EXPIRED`；按 `nextCommand` 重查。客户端应及时续读，避免在中间发多组新列表把缓存挤掉。

## 技能状态的确定性

`supported`、`unlocked`、`learned`、`level` 分别表示服务端支持、学习资格、已学和等级。查询不会学技能或刷新技能点。

`manaCost` 来自当前基础技能固定成本或当前配置等级，`cooldownRemainingMs` 读取实际冷却所有者，包括 MagicSpells 的个人/全服冷却。缺数据返回 `null`，不会伪造零。`give` 未选具体配方时冷却未知。

`preflightReady` 仅表示已检查的通用前置条件。目标、路径、落点、保护、特定场景仍可能需要执行时检查；因此多数技能 `canUseNow=null` 并说明 `target_or_context_not_checked`。已有明确阻碍时为 `false`；仅条件完备的自身烟花/星光类可以为 `true`。施放时仍走原有权限、资源和目标校验。

## 认证观察：复用本机可信来源

LoginGuard 0.1.1 向现有原子心跳追加 `sessionStates`，保留 `ready`、`at`、`authorizedNames`。每行有本人 UUID、每连接 `authSessionId`、`observedAt`、真实 `status` / `authorized`、认证方式和 `passwordSet`，不含密码或哈希。代理连接切换时另发 `MC_AUTH_STATE`；原 `[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。` 原文保留，既有客户端登录门禁无需改认这个标志。

Paper 的 `plugins/AgentFriend/agent-guide.yml` 增加可选设置，**候选默认空路径，未改正式配置**：

```yaml
auth-observation-file: 'E:/MC/ops/auth-heartbeat.json'
```

仅同机、运营者指定的私有文件作为来源，无新端口、无客户端可写通道。Paper 每秒最多读一次，限制文件大小 1 MiB。它只用于提示，不作为权限授予依据。跨主机部署不能直接套用此本机文件方案。

按 UUID 匹配，要求代理行来自 `login_guard`、当前 Paper 加入之后的新观测、15 秒内有效、时间不异常、状态与布尔值一致。缺失、旧会话、过期或文件错误均返回 `status:"unknown", authorized:null`；代理不可用返回 `unavailable/null`。`unknown` 不代表密码错误，也不证明登录成功。刚切入 Paper 的第一秒可能尚未产生新心跳，稍后可重查或用 `/authstatus`。

## 操作与错误

新查询错误提供稳定 `errorCode`、中文原因、`retryable`、`retryPolicy` 和可复制 `nextCommand`。共享 `ActionFeedback` 对已有动作建议补错误码和重试说明；尚未覆盖每个第三方插件的纯文字报错。

`retryable=true` 不表示自动重放。存取、学习、接单、领奖等超时后先查询。现有 [可靠背包适配器](AGENT_INTERACTION.md) 串行核对容器、本人库存及光标，窗口 ID 复用以代次区分；未知操作和断线不自动再执行。本轮复用该适配器，服务端没有新增第二套库存账本。

## 实际验证

最终 AgentFriend JAR SHA256：`D4C605B969740EA6F03494944667EC41999AC657294466C3850BAED4CB43352F`。

最终 LoginGuard JAR SHA256：`127F4A789BDF51B48C0CB3FD4FC9562AF8908986084009693D833B3BFF1A70BD`。

| 验证 | 结果 |
| --- | --- |
| 纯 Java 分页/认证数据验证 | 124 个断言通过，含中文、emoji、转义、容量及失效 |
| LoginGuard | 11 个观察边界、8 个首次密码、21 个正版/Eye 检查通过；两种启动并发/失败关闭场景通过 |
| 既有客户端模块 | 37 项通过：背包延迟/重复/ID复用/未知/断线、配方私聊兼容及登录门禁 |
| 正常重启后的最终候选 Mineflayer 4.39 | 35 项通过，含真实冷却、只读账本/PDC、本人 Eye 私有镜像与背包完整存取 |
| 最终候选 Geyser/Floodgate 原生基岩协议 | 8 项通过，含无损分页、帮助、技能资格和恢复命令 |
| 正常停止/启动后的旧测试玩家回读 | 9 项通过：UUID、已学技能、报名/实练、未毕业与 8 张纸保留，原背包无重复存入 |

私有证据：`E:/MC/ops/repairs/agent-cli-20261012/`，29份文件已逐份SHA256核验镜像到 `F:/MC-backups/repairs/agent-cli-20261012/`，两盘均有候选验证 `.complete`，不是生产备份或发布标记。测试计划、可重复命令与范围见 [测试记录](../ops/tests/agent-cli-observations.TEST.md)。

认证文件的 Paper 联机部分使用明确的隔离夹具；LoginGuard 查询、事件/命令权限及序列化使用真实依赖 API 回归。**未宣称完成真实正版启动器、手机/Xbox 画面、16 个 LLM 长期自主或整套代理跨服发布验收。**现有身份规则保持；后续代理上线前还须做原有认证链路联机检查。

## 发布与回退

生产部署另行获得本次确认，按 [OPERATIONS](OPERATIONS.md) 提前通知、检查真人/活动副本、双盘完整备份后正常维护。Paper 和 LoginGuard 候选分别替换，不覆盖现役 LibreLogin 双监听器补丁；认证文件路径应指向实际心跳，不能用测试夹具。原有正版、离线密码、管理员和 Eye 规则保持。

回退到已验证的 AgentFriend 0.4.28 / LoginGuard 0.1.0 及发布前配置即可；本轮观察只存内存，未做新玩家数据迁移。保留维护期间玩家正常产生的物品/任务进度，不整体回滚世界或账本。回退后新 `MC_STATUS` / `MC_PAGE` / `/authstatus` 不存在，客户端按版本使用旧入口。
