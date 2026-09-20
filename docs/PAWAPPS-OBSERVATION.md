# PawApp 接线与桐人运行观测

日期：2026-09-20。两项 PawApp 已在游戏专用 QwenPaw 2.2.1 按官方接口重装并通过真实浏览器验收。看板显示当前代行为、拒绝与未知、小时趋势和现役团队；天神之眼已实际渲染村庄画面。维护已结束，15:02:21 恢复原有自主运行与调度，不要重跑本轮维护脚本。

本轮沿用现有 PawApp、动作回执、记忆代标记、工单账本与生存控制器。没有新建评价系统、事件账本或常驻服务；打开看板不触发模型、身体动作、工程任务或学习任务。具身架构和 L1/L2/L3 边界见 [EMBODIED-AGENT.md](EMBODIED-AGENT.md)。

## 1. 已确认的页面与数据问题

| 问题 | 已核实原因 | 候选修复 |
| --- | --- | --- |
| App Center 声明入口与实际页面不一致 | manifest 指向 `/apps/<id>`，旧前端只注册 `/plugin/<id>` | 使用官方 `paw.forApp(id).ui.registerPage` 注册规范入口；旧书签保留兼容路由 |
| 增加有 backend 的应用后，纯前端应用可能从发现列表消失 | QwenPaw 2.2.1 优先使用 backend 插件注册表；纯前端 gods-eye 不在该表 | gods-eye 导出官方 `PawApp` 对象，仅登记应用，不添加路由、工具或服务 |
| 页面时间更新不等于内容实时 | 旧页面依赖预生成的看板文件，文件生成与页面刷新是两个过程 | evolution-board 通过应用作用域的只读 backend GET 读取当前投影，响应 `Cache-Control: no-store` |
| 团队、学习、技能数量可能不对应现役实体 | 扫描遗留 workspace、逻辑角色目录或所有技能文件会混入旧角色和索引、锁、修订文件 | 现役角色来自原生配置注册表，学习 marker 使用该角色的原生 workspace，技能数来自现有 `world-skills/index.json.skills` |
| 动作统计看起来改善，但分母与证据变了 | 旧统计混用派发日志、多个记忆代与宽泛成功码；重复与间隔也易被误读为停滞 | 复用 schema 2 的持久化动作回执分类，加上当前代、覆盖率、行为类别与时间分桶；保留未知和拒绝 |

相关实现：[pawapp_bridge.py](../world/ops/pawapp_bridge.py)、[evolution_policy.py](../world/ops/evolution_policy.py)、[evolution-board.html](../world/ops/pawapp_assets/evolution-board.html)。官方 API 行为已对照本机安装的 QwenPaw 2.2.1 `qwenpaw.pawapp.app` 及 console SDK bundle 核验，不依赖旧接线的命名推测。

## 2. 官方 SDK 路由与实时投影

实际调用关系如下：

```text
App Center manifest.entry_page = /apps/evolution-board
  → QwenPaw.paw.forApp('evolution-board').ui.registerPage(...)
  → 同源 iframe /api/pawapps/evolution-board/static/index.html
  → parent.QwenPaw.paw.forApp('evolution-board').api.get('/board')
  → /api/evolution-board/board
  → 官方 PawApp 的 GET /board
  → evolution_policy.build_live_board()
  → 原生现役角色注册表 + 原有团队 SQLite + 生存指标文件
```

应用自己的 router 注册 `/board`，官方 `PawApp` 聚合时添加应用 ID 前缀；宿主 SDK 添加 API 基路径。页面通过宿主作用域 API 使用既有认证，不复制 bearer 凭据。侧栏使用官方页面 route ID `pawapp:evolution-board:/apps/evolution-board`。gods-eye 同样注册 `/apps/gods-eye`；`/plugin/<id>` 只承担旧书签兼容。

backend 从固定可信路径 `/ops/evolution_policy.py` 加载投影，只提供 GET，不开启聊天、存储等标准能力，不注册 Agent 工具或生命周期任务。团队 SQLite 使用只读连接及 `query_only`；GET 不创建数据库、不刷新基线、不写学习 marker 或看板文件。原有定时生成文件的路径与 GET 分开。

“实时”指每次 GET 重新读取已有数据源，**不是各文件的原子全局快照**。页面每 60 秒读取，既有生存控制器约每 300 秒生成行为统计；界面明确运行状态是“最近采样时”，超过 360 秒标记陈旧（含 60 秒调度宽限）。GET 响应时间不能代替源数据时间，也不能把暂停状态显示为正常运行。刷新失败保留可辨认的旧值与错误提示，不补零。实机 Windows 挂载下读取角色目录约 4.3 秒，健康探针只对此 GET 放宽到 15 秒，其余入口仍为 5 秒。

工单状态总量使用既有全库计数；改进提案列表仍是有界样本。没有从有限事件尾部推断“全库处理时长”，缺少可靠依据时 `resolutionMedianMinutes` 保持未知。安静角色没有新知识或新草稿，不因此被自动判为异常。

写出 PawApp 包文件本身不会热加载 backend。必须经原生认证插件安装/重装完成激活，再做实际 SDK 页面注册与浏览器可见性验收；HTTP 200 或文件存在都不等于完成这一步。

## 3. 当前代动作统计口径

实现入口：[coherence.py](../world/survival/coherence.py) 与 [execution_evidence.py](../world/survival/execution_evidence.py)。统计是既有原回执的只读派生视图。

### 3.1 当前代与覆盖范围

- 代界限来自 `settings.json` 的 `brainProtocol=1`、`memoryEpoch`、真实切换时间 `memoryStartedAt`，不以文件 mtime 推算记忆归属。输出中 `generation.startedAt` 为毫秒。
- 动作按原回执的 `acceptedAt` 过滤；模型事件按带时区的事件时间过滤。先前代单独计数；缺时间、未来时间、显式 epoch 冲突或代标记不可用的记录为“未归属”，不能补成当前代。
- 同一动作 ID 去重，同一已完成模型任务 ID 去重；模型完成记录只用于决策间隔，不进入动作成功分母。
- 输出读取失败、损坏、采样截断、未归属和重复 ID 数量。回执目录本来只保留有限文件，即使本次读取未截断，也不能声称覆盖全部历史。
- 有读取失败、未归属记录或代标记不可用时，已读事实仍可展示，但总体成功率置为未知，避免丢掉坏记录后产生假改善。空样本也不写成 0% 或 100%。

### 3.2 成功、拒绝与未知

```text
closedLoop.sampled = 当前代可归属、去重后的留存动作回执数量
closedLoop.outcomes = succeeded / failed / rejected / pending / unknown
closedLoop.rate = confirmed_action_successes / sampled_persisted_receipts
closedLoop.objectiveSuccessRate = null
```

只有确认终态与对应原生结果一致才算动作成功。导航还要绑定原任务及导航 epoch，或符合现有同身体、同维度的到达观测条件；进食使用绑定任务、请求、身体和参数的原生终态。`accepted` 派发响应、模型任务 `completed`、文字说明均不能单独算游戏成功。被游戏明确拒绝的回执保留为 `rejected`，不混入未知或从分母删除；未结案及无法确认的结果分别保留 `pending`、`unknown`。

行为明细按类别归组，同时输出原始 `tools` 计数，类别包括 movement、production、inventory、contracts、interaction、skills、other。因此可以看见 contracts 下的 `guild_claim` 拒绝，不只看到一个总成功率。

趋势按 `acceptedAt` 做 UTC 小时分桶，最多显示 24 桶，另报更早样本数。每桶仍是留存样本，空桶为未知，`causallyComparable=false`。跨记忆代、跨 schema、不同留存窗口的百分比不能直接比较。

重复指标要求同身体、维度、工具及参数的连续相同动作或连续重复序列，重叠序列每个动作只计一次。散落在多个回合的同类操作不自动算连续重复；重复本身也不证明无效。已完成模型决策间隔不等于当前卡住时长。

### 3.3 两份样本不能混为一次改善

候选 `collect` 的另一次只读预览，读取 200 份留存回执：116 份属于旧代，84 份属于当前代；当前代中 56 成功、2 失败、25 拒绝、1 未知，动作确认比例为 66.7%。其中 24 份 `guild_claim` 均被拒绝。该预览保存在 `runtime/rsi-engineering-upgrade/behavior-metrics-preview.json`。

旧 schema 的 48.2% 与这里的 66.7% 使用不同来源、分代与分类口径，**不能解释为能力提高或修复收益**。下节 24 份回执又是更窄的观测时间窗，不是对上述 84 份样本重新计数。

## 4. 真实 L1 观测：13:00–14:39:42

时区为 Asia/Shanghai，日期为 2026-09-20；正常完整回合终态最新到 14:25:04。观测只读取已有任务元数据、输入封装、工具回执和状态，没有发起模型或身体动作，没有导出隐藏思考、聊天内容或记忆正文。

| 观测项 | 留存证据 | 解释边界 |
| --- | --- | --- |
| 原生输入轮 | 13 轮：12 正常完成，1 轮自动暂停后结案；正常 `decision_finished` 失败数为 0 | 不能写成系统 12/12 成功，故障轮必须保留；模型完成不证明游戏目标完成 |
| 增量输入 | 13/13 有 `baseTurn`，0 次重复 bootstrap，0 次与上轮完全相同的 updates 字段 | 证明应用层增量封装，不证明供应商请求不重复历史、缓存命中或省 token |
| 工具使用 | 85 次工具调用；15 次 status 中 12 次默认 full、3 次显式 brief | brief 已真实采用，但 3 次都来自同一回合，不能外推为普遍采用 |
| brief 输出 | 14:21:44、14:23:46、14:24:19；分别 6,307、5,307、5,307 字节 | 字节数不是供应商计费 token，也不是收益 |
| 原生身体动作回执 | 24 份：14 次 goto 确认成功，10 次 guild_claim 拒绝，0 失败、未知、在途 | 14/24=58.3% 仅是此窗口留存动作确认比例；没有产出或合成成功证据 |
| 重复拒绝 | 10 次 guild_claim 的身体、维度、工具和参数签名相同；任务 `2026-09-20:1`，均为 `claim_refused`，原生 NPC 判断距离柜台太远 | 连续同动作指标为 0，但跨回合重复拒绝确实存在；没有未知动作重投证据 |
| 重复工具结果 | 同轮同输入、归一化输出相同共 6 次：look 1、scan_blocks 2、remember 3 | remember 的 3 次发生在自动暂停轮，不能算正常有效学习；观察是否冗余仍需任务语义 |
| 完成任务耗时 | 12 个正常完成任务墙钟中位 56.782 秒，范围 27.543–223.026 秒；控制器结案延迟中位 10.525 秒 | 墙钟包含工具等待和推理，没有首 token 或推理耗时分解 |
| 工具耗时 | 85 份工具回执延迟中位 2.170 秒 | 只是当前观测分布，没有配对基线 |
| 原生 usage | 12 个完成任务报告 input 合计 1,102,789、output 合计 7,089 | 聚合语义、供应商缓存及实际计费未经独立核验；不换算货币成本、不宣称 token 改善 |
| 独立练习评分 | `practice.sqlite3` 为 3 个历史 run、0 step、0 receipt、1 refinement；窗口内新增 run 为 0 | 尚无本轮独立任务评分、冻结初态 A/B 或 RSI 因果收益证据 |

这份较长窗口更新了早先 13:00–14:02 观测中的“brief 采用为 0”，没有追溯改写早先事实。动作目录上限为 200 份，本窗有 24 份留存回执；没有保留的记录不能被推定为从未发生。

## 5. 自动暂停与 ENOENT 最小修复

14:30:34.811，调用链 `controller.tick → poll_model → collect_action_receipts → turn_receipts → read_json → _read_json → path.stat` 抛出 `FileNotFoundError`，读取对象为当前回合的 `turn-actions` 索引。14:30:36.644 控制器自动暂停；原生任务随后达到终态，14:32:04 记录 `cancellation_settled`。该观测截点的 `control.enabled=false`、`pauseReason=controller_FileNotFoundError`，无 active、unknown 或 inflight 标记。

该回合已存在 14:30:21 的 goto，14:30:34.762 又产生 guild_claim；索引最终包含两个动作 ID，mtime 为 14:30:34.786。写入使用同路径 `os.replace`，已检查的源码没有删除该索引的流程。因此这不是“本轮没有动作”的正常空索引。异常与并发原子替换时间重合，支持 Docker Desktop Windows 绑定目录短暂不可见的假设；**底层文件系统可见性机制尚未独立复现，不能把假设写成已证明的内核根因**。

[numen_gateway.py](../world/survival/numen_gateway.py) 的最小修复只在 `_read_json` 遇到 `FileNotFoundError` 时延迟 50/100/200 毫秒重读，最多 4 次读取，总等待上限 0.35 秒。持续缺失仍抛出异常；无效 JSON、错误结构、大小限制、符号链接及权限错误保持原失败语义。它不把缺失改成空成功，不改变未知结果，不重新派发动作，也不自动恢复暂停。

## 6. 验证与实际部署

| 范围 | 已留存结果 |
| --- | --- |
| 动作分类、当前代、覆盖、趋势、重复和界面语义 | `tests/test_execution_evidence.py`：33 项通过，含真实前端渲染回归 |
| 实时只读投影与原生角色来源 | `tests/test_evolution_board.py`：6 项通过 |
| 官方 SDK、页面入口、发现列表与 backend 只读接线 | `tests/test_pawapp_bridge.py`：7 项通过 |
| ENOENT 最小读取修复 | `tests/test_survival_state_read.py`：Windows 7 项通过；两个新增竞态回归在旧基线失败 |
| 固定 Linux 镜像组合回归 | 105 项中 103 通过、2 error；两项 error 已在旧基线重现，不宣称整套全绿 |
| PawApp 健康检查 | `tests/test_pawapps_health.py`：11 项通过；包含页面注册不能由 HTTP 成功替代、浏览器证据不能由原生 ready 替代、暂停与未知不能伪装为正常 |

Linux 组合验证使用固定镜像、禁网、只读源码挂载和 UID/GID 65534。未通过的旧基线测试是 `ContinuousActionTests.test_async_move_requires_same_native_task_and_epoch_before_next_action` 与 `ContinuousActionTests.test_new_native_epoch_does_not_clear_a_previous_move_barrier`，详见现有基线复现日志。

生产 `D:/Projects/QiandengJi` 的 15 个明确文件已按预映像 hash 精确同步。旧文件逐字节备份，部署时确认生产版本对应已有 Git 历史；两应用目录整体备份并在独立 staging 目录叠加新包后安装，既有 `board.json`、`policy.json` 等数据保留。安装返回 `loaded=true` 后，原游戏 QwenPaw 与 survivor 各正常重启一次，以加载新 backend、原定时生成器及读取修复。主服、NPC、宿主 QwenPaw 未重启；沿用现有 `unless-stopped` 容器守护，没有新增常驻进程。

| 验收项 | 状态 | 实际证据 |
| --- | --- | --- |
| 原生插件安装与发现 | 通过 | 官方 `POST /api/plugins/install` 两次分别成功；App Center 显示两个 v1.1.0 应用 |
| 浏览器实际页面 | 通过 | 在官方应用列表分别点击“打开应用”，规范入口均有实际内容；世界观察器自己的连接提示和 canvas 村庄画面均可见 |
| 动态刷新与数据语义 | 通过 | 按钮使读取时间从 15:01:42 更新到 15:02:16，分钟轮询也生效；84 条当前代样本、25 拒绝、1 未知、116 历史代排除和空桶破折号均可见；目标达成显示未独立评估 |
| 浏览器错误 | 无 error | 既有 Qwen lazy-module 警告和 THREE 阴影 API 弃用警告仍保留，不冒称零 warning |
| 生产代码隔离冒烟 | 通过 | 具身 20/20、实践 34/34；固定镜像、断网、源码只读、非 root；报告分别绑定生产 12/15 份真实源码 hash，旧报告先备份 |
| PawApp 健康与 panel 接线 | 通过 | 原生发现、SDK 页面、当前代、新鲜度、运行状态、10 角色、未知保留和 7 项真实 UI 证明通过；现有 `probe_panel_smoke` 中 PawApp、具身、实践均通过 |
| 原配置恢复 | 通过 | 15:02:21 恢复 NPC 准入与原自主控制；15:02:59 核对 10 角色全 profile 和 16 Cron 全 spec 与维护前完全相同，原关闭的工程 Cron 未开启 |

全项目 panel 仍为 false，历史各组件总布尔结果与上一轮一致，本轮仅新增通过的 PawApp 项；这不证明旧失败的每一个细项都不变。`guild_npc_identity_not_ready` 等既有问题仍存在，不能宣称全项目健康或游戏目标成功。新恢复回合的终态与效果在下节独立记录。

官方依据：[页面 SDK](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/console/src/plugins/pawapp-sdk/ui.tsx)、[页面加载器](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/console/src/plugins/usePluginLoader.ts)、[插件安装接口](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/app/routers/plugins.py)、[插件后端加载](https://github.com/agentscope-ai/QwenPaw/blob/v2.2.1/src/qwenpaw/plugins/loader.py)。

## 7. 恢复后的自然回合

原生活 session 中的新任务 `task-aee503afbcba` 于 15:02:30 提交、15:06:24 原生 completed，15:06:29.447 由控制器记录 `decision_finished`，`completed=true/nativeTaskCompleted=true`，随后进入 observing。没有人工补发模型任务或游戏动作。

这一轮实际 11 次工具调用：team_context 3 次、move 2 次、status 2 次（均为 full，本轮 brief 为 0）、guild_claim 2 次、interact_at 1 次、remember 1 次。4 份持久动作回执为 2 次 goto 确认完成、2 次 guild_claim 明确拒绝；interact_at 另在工具层被 `protected_area` 拒绝，没有计入上述 4 份回执。不能把模型 completed 说成公会或交互目标完成。

截至 15:07:03，恢复后的日志未再次出现该 ENOENT 暂停，控制器无暂停原因、无当前 unknown 标记。这个有限窗口证明修复已加载并能继续真实循环，不证明该竞态永久消失。看板自然读到了 15:05:44 的新采样，运行提示已由暂停变为自主运行，样本从 84 增至 87（58 成功、2 失败、26 拒绝、1 历史未定结果）；采样早于回合结案，不能与该回合最终 4 份回执混用。

增量输入在此轮仍有效，然而 repeated guild_claim 拒绝依然发生。后续应优先让感知、错误反馈与目标调整消除这种无效循环，并用独立任务验证收益，不能只增加技能或提高看板分数。

## 8. 证据位置与仍未证明的结论

本地证据目录为 `runtime/pawapp-observation-20260920/`，属于忽略目录，不随本文提交原任务内容：

- `l1-observation.json`：观测截点、结构化聚合、任务/动作来源及源文件 hash。
- `findings.md`：只读现场观测和暂停定位。
- `repair-manifest.json`：候选修复文件 hash、镜像约束、回归结果与诊断限制。
- `state-read-regressions.log`、`state-read-baseline-repro.log`、`unrelated-baseline-repro.log`：新回归与既有失败的区分。
- `pawapps-health-regressions.log`：健康检查回归结果。
- `ready.json`：维护前某一截点的角色 idle、身体结案等状态；它不是部署完成或浏览器验收凭据。
- `deploy-plan.json`、`source-applied.json`、`apps-before/`、`source-before/`：精确部署清单与原字节备份。
- `installed-*.json`、`browser-ui-evidence.json`、`live-board-after.json`、`pawapps-health.json`、`panel-smoke.json`：原生安装、真实浏览器和健康结果；生产 UI 证明为 `reports/pawapps-smoke.json`。
- `resumed.json`、`postdeploy-native-verification.json`：本次维护已结束及配置恢复核验。
- `production-smoke-20260920T070047Z/`：生产源字节的 20/34 测试日志、新报告和旧报告备份。
- `postresume-observation.json`、`postresume-observation.md`：恢复后自然回合的原生终态、实际工具、动作回执及观测边界。

现有证据证明了部分接线、只读投影、统计口径和容错行为，也揭示了重复拒绝及一次自动暂停。**尚未证明 RSI 提高游戏目标成功率，也未证明单位成本收益改善。** 这些结论需要独立目标完成证据、可比初态与任务、冻结版本和可靠成本口径；本文不以模型完成数、工具调用数、记忆写入数或 token 消耗替代收益。
