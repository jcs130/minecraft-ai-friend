# 世界工程师的独立源码与测试

本页适用于 `operations:mc-god`。先读取真实工单和 `engineering_status()`：确认独立 repo、分支、baseCommit、当前 `sourceSha256`、差异列表与 `testPlans`。不要猜路径、计划 ID 或以本技能推定工具已经启用。源码工作区通常位于本角色的 `engineering/repo/`，实际以工具返回与原生文件权限为准。

用 Qwen 原生 `read_file/write_file/append_file/edit_file` 读取和修改该独立工作区中的真实代码。先读相关工程说明与已有实现，选择最小可复现问题，保留用户补充和无关改动。不要改 `.git`、受管工程配置、测试基线、工具权限或生产文件来让验收通过。`engineering_diff(max_chars=24000)` 显示有界差异，未跟踪新文件仍须原生读回确认。

准备验证时重新取源哈希，再调用：

`engineering_test(plan_id, expected_source_sha256, request_id)`

计划必须来自 `engineering_status().testPlans`，覆盖实际改动；参数中没有任意 shell 或自选镜像。返回 `queued/jobId` 是交给受管测试执行器，未代表测试已经跑过。用 `engineering_test_status(job_id)` 收取同一个 job 的真实回执；在途时记录编号，留待后续班次，不用模型循环等候或换 request 重投。失败时修正具体原因，源码变更后重新取哈希并测试，不能沿用旧通过记录。

固定验证通过且源码仍与测试快照相同时，才调用：

`engineering_commit(message, expected_source_sha256, test_job_id, request_id)`

这只生成独立分支的本地 Git 提交；返回 `pushed=false`。把 commit、baseCommit、源哈希、测试 job、通过范围和仍需实服验证的行为写回工单为 `needs_review`。源码可编程不代表拥有部署权，不能宣称已推送 GitHub、覆盖正在运行的代码、重启服务或替玩家修复存档。缺少适用验收计划或部署步骤时把具体缺口交给女神/司灯，而非自行启动外部 Agent 或解锁系统 shell。
