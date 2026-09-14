# 天神工程任务无总时限

2026-09-14 用户要求不再以短时限中断天神的编程推理。仅 `qd-team-engineer` 这一原生定时任务取消总执行截止；仍是游戏 Docker 内的 `qd-engineer`，保留原会话、GLM-5.3、十分钟触发节奏和单并发。没有新增常驻进程。

QwenPaw 2.2.0 的 `JobRuntimeSpec.timeout_seconds` 只接受大于零的整数，`null` 和 `0` 都会被原生 API 拒绝。项目没有修改全局 schema，也没有填写一个很大的假期限。原任务新增 `meta.engineeringExecution={version:1,totalTimeout:"none",scope:"qd-team-engineer"}`；严格核对角色、任务及原生执行器源码后，guard 仅给当次原生执行器传递一份内存副本，将该副本的 timeout 设为 `None`。原生 `asyncio.wait_for(..., None)` 不建立截止计时器。

磁盘/API 的 `runtime.timeout_seconds:360` 只是满足旧原生 schema 的兼容字段，**不是该工程任务的生效时限**。项目健康报告将两者分开列出：`effectiveTimeoutSeconds:null`、`nativeSchemaTimeoutIsEffective:false`；只看 Qwen 原生设置面板中的 360 无法判断实际工程时限。以后同步受管配置，会保留当前开关、节奏和会话，更新受管提示及明确的执行策略。

原生 APScheduler 的 `max_instances=1`、任务 semaphore、项目非阻塞文件锁与持久执行占位均保留。上轮跨过下一个十分钟信号时不会并行执行第二个工程任务。取消仍按原生流程收尾并保留会话/trace；未知结果仍须核对，不能因取消总时限而清除、重放原操作。

流式等待是不同问题。此改动保留原生首内容/流空闲看门狗，不更改所有角色的模型配置。工程任务若收到内层 `TimeoutError`，项目周期证据明确标记 `totalDeadlineApplied:false`、`nativeInnerTimeout:true` 及错误类型。Qwen 2.2.0 的原生 trace 仍可能笼统显示 `timed out after Nones`，不能把这一字符串解释成新的总时限；需要结合原异常及项目周期证据判断。单工具执行时间、测试容器时限也未在本改动中取消。

## 部署与验收

1. 保存原原生任务完整 JSON；停用后续触发，等待当前工程任务自然结束，核对任务和工具回执。不要清除未知占位或覆盖候选代码。
2. 用 `tools/configure_world_team.py` 的 `upgraded_engineering_job(old, 'operations:mc-god')` 生成原任务更新，再通过该角色的原生 Cron PUT 保存；仅更新本任务的受管提示与 `meta.engineeringExecution`，不替换角色资料。这个函数也是日后 `--mode files` 的同步路径。
3. 游戏 Qwen 的 `/ops` 是 bind mount。源码完成后须在维护窗口重启该 Qwen 容器，加载 `cron_guard.VERSION=4` 和 `engineeringCronRuntimeVersion=1`；不改宿主 8088。
4. 容器内运行 `python /ops/engineering_cron_runtime.py`。探针只读校验新 guard 的当前进程身份、原任务、策略及生效时限。恢复原任务开关，观察下次原生班次及原会话回执。
5. 静态/离线验证不能代替自然长轮验收。部署者应另留新证据，确认真实任务跨过旧 360 秒时仍在原会话执行，后续定时信号不叠加；不能改写历史超时报告。

隔离 Docker 回归使用固定 QwenPaw 2.2.0，不挂载生产状态、不开网络、不调用模型。覆盖原生 schema 拒绝 null/0、SDK 执行器真实 `None` 时限、取消终态、会话/磁盘配置不变、单实例和单许可、正在运行时拒绝重复执行、未知不重放，以及配置同步保留开关/节奏/会话。

2026-09-14 已部署到游戏 Qwen `2.2.0-autonomy11`。12:15 原班次 `world-3b7a24c04ef64a72a409bfedf2e8eb8c` 于 12:22:33 正常完成，实际 453.62 秒，原生 trace 与 Cron history 均为 success；在第 430 秒的只读采样也确认原任务仍运行且归属证据完整。12:25 新班次在旧轮完成约 146 秒后开始，无重叠。这次实机没有跨过下一次定时信号，该分支由隔离测试验证。

健康探针识别当前进程持有的 FLOCK 或 Docker Desktop bind 上实际的 POSIX 文件锁；POSIX 必须同时匹配 `/proc/locks` 和该进程 fdinfo 的设备、inode、写锁与完整范围，不能凭打开文件认领执行权。只有原任务、原周期和原持久占位全部一致时，才将超过旧健康阈值的工程任务解释为正常长轮。

该班次交接了报告，但提交与测试分别被源码变化、计划未覆盖改动拒绝，未部署候选。原始运行窗口、终态、原生 trace 与工具审计保存在 `runtime/survival-priority-20260914/engineering-1215-terminal-audit.json` 等新文件中；没有改写此前超时或失败证据。
