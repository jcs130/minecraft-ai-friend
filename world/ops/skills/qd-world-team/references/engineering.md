# 世界工程师的独立源码与测试

本页适用于 `operations:mc-god`。先读取真实工单和 `engineering_status()` 的轻量概览：确认独立 repo、分支、baseCommit、HEAD 与 `testPlans`。默认只查看已提交的 base→HEAD 差异：`committedChanges` 最多列前 50 项，`committedChangeCount` 为总数，`committedChangesTruncated` 表示未全列出。默认不扫描工作树，`dirty/changed/workingChanges/sourceSha256=null`、`snapshotCaptured=false`；不能把 null 当成没有修改，也不能作为验收哈希。不要猜路径、计划 ID 或以本技能推定工具已经启用。源码工作区通常位于本角色的 `engineering/repo/`，实际以工具返回与原生文件权限为准。

每班先接续 `progress`：`recentTests` 来自受管请求与真实回执，`recentCommits` 来自提交日志；不包含整份测试输出，也不额外扫描候选源码。`passedFixedPlan` 只表示该历史快照通过当前固定计划；未全量捕获时 `currentSourceMatches=null`，绝不意味着当前工作树已通过。这份精简回执已核对请求/计划/镜像，已有 passed 可直接用于下一次提交的字节校验，不必再次展开全部通过日志；失败需要具体错误时才读 `engineering_test_status`。已完成本地提交且 `isCurrentHead=true` 的事项应交接部署审查，不因旧工单仍写 blocked 就重做。只有该事项出现新证据或新改动才继续验证。

用 Qwen 原生 `read_file/write_file/append_file/edit_file` 读取和修改该独立工作区中的真实代码。先读相关工程说明与已有实现，选择最小可复现问题，保留用户补充和无关改动。不要改 `.git`、受管工程配置、测试基线、工具权限或生产文件来让验收通过。查看本事项工作树时传 1–32 个相对文件或目录，例如 `engineering_status(paths=["world/ops/world_team.py"])` 和 `engineering_diff(paths=["world/ops/world_team.py"], max_chars=24000)`，返回的工作树状态或差异只覆盖 `inspectionPaths`，不能外推为全仓无改动。`engineering_diff()` 没有传 paths 时返回 `requiresPaths=true/text=null`，含义是需要限定范围，不是没有差异；未跟踪新文件仍须原生读回确认。

准备验证时按需调用 `engineering_status(capture_source=true)`，不要同时传 paths；等待完整的新鲜字节快照，确认 `snapshotCaptured=true` 并使用本次 `sourceSha256`，再调用：

`engineering_test(plan_id, expected_source_sha256, request_id)`

计划必须来自 `engineering_status().testPlans`，覆盖实际改动；参数中没有任意 shell 或自选镜像。返回 `queued/jobId` 是交给受管测试执行器，未代表测试已经跑过。用 `engineering_test_status(job_id)` 收取同一个 job 的真实回执；在途时记录编号，留待后续班次，不用模型循环等候或换 request 重投。失败时修正具体原因，源码变更后重新取哈希并测试，不能沿用旧通过记录。

固定验证通过且源码仍与测试快照相同时，才调用：

`engineering_commit(message, expected_source_sha256, test_job_id, request_id)`

已有通过回执时，直接传它的 `sourceSha256` 给 `engineering_commit` 即可：提交工具内部仍会全量读取当前字节并拒绝变化，不需要先 `status(capture_source=true)` 再重复扫描一遍。只有明确 `engineering_source_changed` 才检查本事项差异、完成修改、重新捕获与提测。新的测试仍必须先取得新鲜哈希，`engineering_test` 会独立核对；不能用文件时间或上次哈希跳过这道检查。

一次班次优先完成一个步骤：收测试并提交、修改后排队测试、或把已提交候选交给负责人。原生记忆末段保存短交接：工单、相关路径、job/sourceSha256/commit、已证实结果和下一步。不要反复读取整天记忆、所有旧案或测试全集；测试在途留原编号给下一班，超时恢复先看 `progress`。这些是帮助自己衔接的证据，不代替你的判断或伪造任务完成。

这只生成独立分支的本地 Git 提交；返回 `pushed=false`。把 commit、baseCommit、源哈希、测试 job、通过范围和仍需实服验证的行为写回工单为 `needs_review`。源码可编程不代表拥有部署权，不能宣称已推送 GitHub、覆盖正在运行的代码、重启服务或替玩家修复存档。缺少适用验收计划或部署步骤时把具体缺口交给女神/司灯，而非自行启动外部 Agent 或解锁系统 shell。
