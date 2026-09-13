# 运营班次恢复与真实回执

2026-09-13 的故障不是 Cron 开关关闭。女神旧 `running`、策划旧 `unknown` 与工程师共享账本的 `cron_reserved` 占位跨原生进程恢复留存；每次后续班次都被守卫跳过。Qwen 原生 Cron 将正常返回的 `suppressed` 也记作 `success`，因此仅看 enabled/success 不能判断运营在执行。

初次占位恢复使用现有游戏 QwenPaw `18089`，没有启动旧运营实例、宿主进程或另一套调度器，该阶段未重启 Qwen/Minecraft。恢复前验证 `/proc` 中实际 `game_service.py` 的 PID、启动 tick 与 boot ID，核对四个原生角色空闲、Cron 非 running，并取得原周期及共享账本的 Linux 锁。旧记录、原水位及判定证据先完整保存，再将旧占位明确归档为 `failed / interrupted_without_result`；结果仍未知，不重投旧模型请求，不补写世界效果。

恢复工具为 `world/ops/reconcile_operations_cycles.py`。在现有游戏容器中运行：

```powershell
docker exec qiandengji-qwenpaw-1 python /ops/reconcile_operations_cycles.py
docker exec qiandengji-qwenpaw-1 python /ops/reconcile_operations_cycles.py --apply
```

这是明确的维护入口。普通 404、超时或经过一段时间不能释放原生后台任务；带 `taskId` 的旧任务不由此工具处理。针对本进程工作区重载的取消，只能显式传入已核实的 `--cancelled-trace <UUID>`，同时匹配原生 job、user/session、执行时间及原占位。每条记录分别保留自己的证据类别；混合恢复不能把旧进程证据署成另一轮取消回执。

维护先记录暂停意图，再调用原生暂停，即使应答丢失也保留收尾对象。收尾逐项读回并用同 ID、完全相同的 spec 执行原生 PUT；不改变时间、会话或模型。原因是 QwenPaw 2.2 的 `resume_job` 只恢复仍存在于调度器内的任务：工作区在任务暂停期间重载后，单独 resume 可得到 `enabled=true`，但任务并未重新注册且 `next_run_at=null`。原样 PUT 会重新注册；每项须读到下一运行时间。单项恢复失败不会跳过其它任务；不重试状态未知的 PUT，最终审计保留失败项。

实际维护期间，23:25 的工程自然班次与原生技能重载相撞，原生 trace `8ffb0df4-09a6-40d3-a1f3-ecd6d26724c9` 与 history 明确记录 `cancelled`。此轮没有算作运营成功，按精确取消回执归档。后续角色配置操作必须先暂停相关模型 Cron，并同时检查 Cron 状态；`agent-status` 的 `running_task_count=0` 本身不能排除 Cron 正在流式执行。

本轮审计位于 `server/agents/recovery/operations-cycles/`：`operations-20260913T152157-901f519e` 为旧进程占位，`operations-20260913T152744-867afee6` 为明确取消的工程班次。每次都有不可替代的 `.before.json` 原始证据及最终 `.json`，原始文件的 SHA 写入归档记录。真实原生班次、会话工具元数据、运营队列和业务回执另存在 `runtime/operations-autonomy-20260913/`；执行报告内容仍须按业务证据验收，模型总结不等同事实。

现有 `health_mon.py` 的 `probe_world_team` 已包含 `native_cycles_unblocked`：`unknown`、超过原任务上限余量的 `running` 或共享待决占位会报红。此探针只读，不自动解除未知动作，正常执行中的班次不会误报。没有用新源码哈希覆盖历史验收记录。

源码生命周期修复将原生已结束的 timeout/cancelled 作为失败终态释放本轮执行占位，世界效果仍各自保留未知回执；其它异常继续阻断。策划的无新工作跳过只用于已 completed 周期，失败不再吞掉同一水位的下一轮检查。`cron_guard` 及严格启动标记升级为版本 2，必须实际重启加载后才能通过探针，不能把磁盘源码变化冒充当前进程已部署。

统一维护使用 `tools/operations_cron_maintenance.py`，不由该脚本重启服务。`pause --manifest <新文件>` 先保存四项原 spec；`status --manifest <原文件>` 要求任务已暂停、原生 Cron 已结束、若暂停时在跑则必须出现暂停之后的原生 history 终态、周期与共享账本无未决占位；`resume --manifest <原文件>` 用原样 PUT 注册并逐项核对下一运行时间。该状态仅覆盖四个模型班次，桐人等其它后台任务需另验。本次原 spec 清单为 `runtime/operations-autonomy-20260913/maintenance-native-specs.json`。

23:28:50 的司灯原生班次已真实完成，后台执行账本为 `world-8add5bd40ea6409ba5be99dc292fc39d`，原生成功 trace 为 `1ea08427-ba99-4aee-85a0-70afd3873657`，报告 `world-daily-2026-09-13` 由角色实际调用工具写出。实测还发现 MCP 不继承容器的自定义状态路径变量，导致新报告与请求写入错误的游戏工作目录；修复改为按精确原生角色宿主选择共享状态路径，报告和请求保留原字节、原 requestId、原时间，经核对从未被消费者领取后原子交接，源文件保留。

原 NPC 工作器随后首次消费 `world-guild-2026-09-14`，原生策划任务 `task-420c48f1e9e7` 为 `finished / completed`，实际验证了石磊、烛九、禾叔的三张次日货单。该时点尚未到日切，不能说这些货单已经发布或被玩家完成。司灯报告对“11名在线玩家”的概括混淆了进度记录与实时在线证据，不能照搬为验收事实。女神 23:31 的自然班次实际调用了九项检查工具，但 360 秒后明确 timeout；只算执行证据，没有冒充巡查完成，也没有留下新的未知占位。

女神 23:41 自然班次也在 360 秒处明确 timeout。该轮没有读取源码文件，而是展开了四张工单；两份大历史的原生回包共 86,376 字节，约占工具输出七成。历史返回后下一模型动作间隔约 91 秒，救援只读回执又等待约 33 秒；23:44:27 收到检查回执后，直至 23:47:00 超时也未写出本轮工单更新或最终完成回执。证据只保存工具名称、时间、字节数、用量与 trace 终态，见 `runtime/operations-autonomy-20260913/goddess-timeout-analysis.json`，不包含完整私有对话或思考。

为让模型按需取得证据，`team_case(case_id, event_limit=3, before_seq=None)` 现在默认返回最近三条完整事件和当前工单版本；`has_more`、`next_before_seq` 可逐页查阅所有旧审计，事件带原 `seq/actor/at`，不删记录、不改原文。只读生产数据库快照验证两张大工单默认回包分别从 36,002 / 105,716 字节降为 17,036 / 19,636 字节；后者先前被原生裁到约 50 KB。全部 9 / 41 条审计分别经 3 / 14 页完整读回，无重复或遗漏，实际 MCP 参数 schema 也已核对，见 `goddess-paging-verification.json`。

女神原生班次输入同步调整为先从短索引选一项、按需查其证据、及时保存真实回执和交接、简短记忆后结束，原模型、权限、会话和 10 分钟节奏保留。仅女神运行上限由 360 改为 480 秒，工程及策划仍为 360 秒；这是输入减量后的余量，不能单凭延长超时宣称成功。周期健康窗口相应为女神 480+90 秒、其他角色 360+90 秒。源码严格校验仍检查原生完整 prompt/runtime，原 manifest 不覆写；启用时另建派生清单，先在暂停状态下更新并完整读回女神 spec，再恢复。Qwen 工作区重载不会清除进程级 Python 模块缓存，因此最终要在所有实际任务安全结束后重启游戏 Qwen 加载调度源码。以上输入修复在 2026-09-14 00:03 完成隔离回归，生产 Cron 仍暂停，下一轮完成情况须另记真实证据。

2026-09-14 00:00:06，原 NPC 发布器已实际消费上述完成草案中的两张货单：石磊铁锭 8 换 3 绿宝石、烛九火把 20 换 2 绿宝石，分别进入当天公会看板 No.1/No.2，检查时均为 open、done=false。禾叔胡萝卜 16 仍留在原完成草案，未进入当天看板。既有发布器按每名合格发布人 0.55 概率抽选，当日上限 6；三个角色当时均有资格，未全量发布符合既有抽选路径，但随机抽值本身没有单独回执。原计划、请求、消费者回执及新合同/看板的逐项对照与 SHA 位于 `guild-20260914-publication.json`，NPC 原生生成日志另存 `guild-20260914-publication-log.json`。没有补写当天合同或宣称玩家完成。

最终由主线程在安全边界部署游戏 Qwen `autonomy3`，启动镜像 ID 为 `45dc7f061c09489b7d36d5b1499b830a3b14176835c0bc9afaa233d60df2299f`，当前原生启动标记为 guardVersion=2。派生清单 `maintenance-native-specs-goddess480.json` 保留原维护 capture 时间，只有女神的 text/request.input/timeout_seconds 改动，其余三项整行保留。先将女神新 spec 以 enabled=false 原生 PUT 并完整读回，再检查派生 readiness、恢复四项同 ID Cron；全部重新读到 nextRun，过程未手动触发模型。原始清单、派生证明及写入审计分别是 `maintenance-native-specs.json`、`maintenance-native-specs-goddess480.derivation.json`、`autonomy3-native-rearm.json`。

女神随后连续两轮自然调度真实完成。00:21:00→00:25:40 的 trace `5375f02f-e07f-4d9f-afe3-212918096c1a` 与 00:31:00→00:36:10 的 `64619e6f-52ed-4e6c-ab22-9315c46b9c42` 都有 scheduled history、success trace、completed cycle，并分别写入原工单事件 seq 56/57 和当天 memory。第一轮耗时约 280 秒，实际读取一张工单而非四张大历史，写入工单后提交原生工程求助。上述事实证明班次观察、交接与记忆闭环，不能把女神对旧工程缺口的判断当成当前源码尚未修复的证据。她提交的 `help-d3dcb15cd69ece62e2859ccb` 对应 `task-c6eceee4f393`，到 00:39:57 原生为 finished/result.failed，并非工程修复完成。

天神 00:25 自然轮 `5520b9d0-8dab-45e0-8fe6-c8fbdbcdf4bf` 在 00:31:01 明确 timeout；engineering_status 单调用耗时约 246 秒，随后的 engineering_diff 被截止中断，没有工程交付或当天记忆回执。生命周期修复已实机生效：该轮自动进入 failed，共享 reservation 自动结束，没有 unknown 或 cron_reserved 残留，也未人工解锁；00:35 新自然轮 `59c91289-eead-45d9-b1a6-c5e1c7fd447f` 已继续启动。00:39:57 检查时新轮仍在途，不能将其在途占位算成再次卡死，也不能算工程完成。工程只读查询扫描优化另行验收，test/commit 必须继续使用新鲜完整源码字节。

真实女神及工程轮还暴露了 `team_context: team_native_host_inactive`。根因是公共读取构造了无 native host 的 `OperationsTools('mc-god')`，冒用已迁移工程身份。现提取 `public_snapshot(public)` 只读投影函数，公共 context 不再构造运营身份或私有状态目录；运营工具本身仍保持原身份、路径与实际宿主验证。25 项 Linux 定向回归通过，00:39:21 又按全部 10 个真实注册 driver 的 argv/env 运行短命 MCP 子进程，实际读取生产公共状态和团队数据库，全部 context 正确且快照新鲜。证据 `team-context-actual-cards.json` 明确这是独立协议验证；实际长期 driver 的重连与新轮调用须由主线程另记，不能把子进程通过当成 driver 已部署。自然轮最小证据保存在 `autonomy3-shifts-*.json`，不复制完整私有模型对话。

后续主线程已在各角色空闲边界完成 10 个 `qd_world_team` driver 的原值重连，证据在 `runtime/autonomy-mcp-reloads/`，保留原卡、权限与角色身份。天神 00:35 班次于 00:41 明确超时，00:34:25 提交的第二原生求助直到 00:44:25 才结束；为维护只暂停其下一项 Cron，原 spec 保存为 `engineering-driver-maintenance.json`，没有取消当前任务。工程只读优化随后通过 22 项测试，实际同一 Windows bind 工程仓默认 status 1.481 秒、指定 `world/ops/world_team.py` 的 status 1.095 秒、diff 1.004 秒，工程 Git index SHA 保持不变。默认 status 仅给绑定与已提交差异摘要，不再扫描工作树或声称具备源码哈希；paths 查询仅覆盖指定范围，diff 未指定 paths 明确要求选择范围。准备测试才显式捕获全仓新鲜字节，test/commit 仍独立重新捕获完整字节进行校验，未用缓存旧哈希代替验收。主线程已重连工程 driver，工程参考页与原 Cron 收尾由其统一同步和恢复；轻量读取变快不等于模型已交付工程修复。

引用同步仍使用现有原生完整流程。Qwen 的普通 workspace ETag PUT 只原子写文件，不调用技能扫描或工作区重载；其技能扫描缓存又只看技能目录及直属文件的 mtime，单改 references 子目录未必使缓存失效。`tools/sync_team_skills.py` 已补齐：已有技能只修改引用时，引用写完后用原 ETag 原样保存 `SKILL.md`，核对内容完全相同且 ETag 已变化，然后才调用原生 enable。没有直接清缓存、修改权限或改写用户内容；并发冲突保留新用户文件，未知写不重试。12 项回归包含锁版 Qwen 的真实文件写入与缓存签名测试，验证引用写入本身不改签名、原值保存 `SKILL.md` 会改签名且内容哈希不变。

最终女神第三轮 00:41→00:44:42 也已自然完成，trace `07590877-adcd-4bd7-b03b-ed6b7c5a8521` 为 success，写入原工单事件 seq 58；该轮实际 `team_context` 成功，耗时 0.236 秒，补足了长期 driver 重连之后的自然调用证据。全部 10 个角色已通过修复后的引用同步，审计 `runtime/team-skill-sync/20260913T164954999102Z` 只涉及工程参考页及原内容 `SKILL.md` 保存，保留角色配置。主线程原样恢复女神、策划和司灯 Cron 后，天神也在 00:54:05 通过 idle/原生非 running、driver 与源码、原生参考页完整读回等核对，用原 `originalSpec` 同 ID 唯一 PUT 恢复，下一次为原节奏 00:55。恢复证据为 `engineering-optimized-rearm.json`，没有手动触发或停服务。

天神优化后首个自然轮 `f02d96fe-4df1-4baf-bea3-ce67d5c19538` 于 00:55 启动，01:01:01 明确 timeout。实际长期 driver 的默认 status 仅 1.364 秒、限定两文件的 diff 1.758 秒、team_context 0.194 秒；默认查询返回 snapshotCaptured=false、sourceSha256=null，证明快速读取生效且没有冒充完整字节验收。本轮在独立 `engineering/repo` 内修改 `world/ops/world_team_mcp.py` 与 `tests/test_world_team.py`，00:59:38 才发起 capture_source=true，完整新鲜快照耗时 76.091 秒，01:00:54 成功返回 SHA `432e7ac6309517907fee9b1c781e655d3b385648cd076ce3dfe3df48a113ce4e`。之后未调用 engineering_test/commit，也没有工单更新或当天记忆，故只能认定有未验收的工作区修改，不能算工程交付。周期自动 failed、共享 reservation 自动结束、pendingReservations=[]，未留下 unknown。最小工具时间及终态证据见 `engineering-optimized-20260913T170202.json`。

01:05 的下一自然工程轮 `4efc1af1-1837-48a0-8386-adea73d6f5b7` 随原节奏启动，没有人工重投或重新解锁，证明超时后调度继续；01:05:29 仍在执行，不能将它算作已完成。此时 API 的 next_run_at 仍显示 00:55：锁版 Qwen 的 `_scheduled_callback` 在执行返回后才刷新该缓存字段，异常会跳过刷新，因此用实际新 trace/cycle 证明调度接续，未把旧时间当成未来预约。证据 `engineering-optimized-20260913T170529.json`。
