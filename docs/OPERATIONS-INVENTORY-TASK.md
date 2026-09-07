# 运营快照定时采集

管理台的运营组快照有效期为 300 秒。项目提供一个 Windows 计划任务，每两分钟执行一次现有 `tools/operations.py snapshot`，更新运行环境、角色和服务清单及共享 TTS 的 `/health` 结果。采集不调用模型、不启动或停止服务，也不读取聊天内容。执行完即退出，没有新增常驻 Python 进程。

## 安装与查询

在 `D:\Projects\QiandengJi` 执行：

```powershell
# 默认只看计划；不会查询或注册计划任务
.\run-python.bat tools\operations_inventory_task.py

# 缺少 --execute 时仍然只看计划
.\run-python.bat tools\operations_inventory_task.py install

# 显式注册或更新本项目已有任务
.\run-python.bat tools\operations_inventory_task.py install --execute qiandengji

# 只读查询实际注册状态，输出 JSON
.\run-python.bat tools\operations_inventory_task.py query
```

任务名固定为 `QiandengJi-Operations-Inventory`，位于任务计划程序根目录。安装前检查名称归属：同名但描述或执行动作不匹配的任务不会被覆盖。安装后再次查询核验。无需密码或管理员运行级别；任务使用安装者当前 Windows 登录令牌，因此只在该用户登录时执行。Docker Desktop 和既有服务须已可用；此任务不负责开机启动它们。

动作使用当前 Python 安装目录的绝对 `pythonw.exe` 路径，在本项目目录运行 `tools/operations_inventory_task.py run`。外壳只启动固定的 `python.exe -X utf8 -B tools/operations.py snapshot`，不能从任务参数选择其他命令。目前复用 `.qwenpaw` 虚拟环境内已有 Python；这不启动 QwenPaw Agent。外壳及其 Docker 子命令隐藏控制台窗口。任务在 Windows 管理界面保持可见，便于人工查询和停用。

## 超时、互斥与日志

- 周期为 120 秒；采集外壳最长等待 90 秒，超时只终止本次启动的子进程树。Windows 任务外层执行上限为 100 秒，重叠策略为 `IgnoreNew`。Windows 可将 `PT100S` 规范化为 `PT1M40S`，查询按等价时长核验。
- `tools/operations_inventory_lock.py` 为 CLI 和完整健康巡检共用 `runtime/operations-inventory.lock`。Windows 使用 OS 字节锁，Linux 使用 `flock`；进程退出时自动释放。锁文件本身持续存在，不能通过删文件解锁。
- CLI 采集遇到锁忙时返回 75，外壳回执为 `status: skipped`，不覆盖运营快照。下一周期重试。健康巡检最多等 10 秒；仍忙或无法使用锁时写明确失败和 `retry: true`，不保留前次成功结论。健康巡检从采集直到 HTTP 快照比对及报告写出都持锁，避免与定时刷新发生 SHA 竞态。
- `runtime/operations-inventory-task.log` 为 UTF-8 覆盖日志，最多 256 KiB，过长输出只保留尾部并标记 `outputTruncated`。`runtime/operations-inventory-task.json` 为覆盖回执，包含开始/结束时间、状态、退出码与输出字节数。启动先写 `running`，异常中断不会留下上一轮成功作为本轮结果。

`query` 的 JSON 包含固定项目/任务名、查询时间、`exists`、`managed`、`definitionMatches`、`actionMatches`、`enabled`、`state`、`lastRunAt`、`nextRunAt`、`lastTaskResult` 和实际周期/超时/重叠设置。`ok` 只表示注册定义与启用状态符合要求；它不证明最近一次采集成功、服务健康或实体语音效果。查询不到任务或配置不符返回 1。计划任务缺失与查询服务失败会分别报告，不能混为一谈。

Windows 导出 XML 时可能省略默认的运行级别、触发器启用、任务设置启用和唤醒选项；查询会补读该任务 COM 定义的实际属性核验。缺失字段而又无法获得实际属性时校验失败，不假定它仍是默认值。

采集命令退出 0 表示采集并发布完成；快照仍可能记录服务故障。共享 TTS 不可用会通过现有运营快照/健康探针报红，不会因定时任务正常退出而冒充健康。

## 验证范围

离线测试覆盖默认不安装、显式安装分派、固定动作、注册身份与超时配置误绿、日志大小和编码、锁忙跳过、超时终止及真实 OS 进程间互斥。测试不注册任务，不采集实际 Docker 状态，不调用模型。

```powershell
.\run-python.bat -X utf8 -B -m unittest tests.test_operations_inventory_task tests.test_operations_health -q
```

实际安装结果、任务查询及最近回执应单独核验；源码离线测试不代表任务已经周期运行。部署后的证据以项目实际报告及 `runtime` 中的本次回执为准。建议等待跨过两个周期，确认 `finishedAt` 推进、快照年龄低于 300 秒，并确认 Windows 未弹出控制台窗口。

实现参考：[Microsoft 重复任务](https://learn.microsoft.com/en-us/windows/win32/taskschd/repeating-a-task)、[重叠执行策略](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-multipleinstancespolicy-settingstype-element)、[Python OS 文件锁](https://docs.python.org/3/library/msvcrt.html#msvcrt.locking)。
