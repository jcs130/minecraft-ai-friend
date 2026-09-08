# 世界运营管理

> 本文记录第一阶段治理基线。用户后续要求停止旧游戏环境、保留宿主 QwenPaw，已完成精确退役与 TTS 独立迁入 D；当前 12 服务、本机免密码维护入口和天神之眼以 [服务器管理](SERVER-MANAGEMENT.md) 为准。19091、18089 和 18090 仅发布到 127.0.0.1，宿主 8088 保持原用途。下文“仍保留”的旧游戏入口是第一阶段历史状态，不能照此重新启动。

2026-09-07。当前管理页为 http://127.0.0.1:19091/#operations 。这里只展示公开状态，不保存凭据，也不通过网页执行 Docker 或宿主命令。

## 实际归属

| 环境 | 控制台 | 配置数量 | 当前用途 |
|---|---|---|---|
| D 项目容器 | 18089，仅本机 | 4 个，启用 2 个 | 天神和司礼的游戏会话，工具、MCP、周期任务均未启用 |
| 原 shadow 容器 | 18088 | 7 个，启用 6 个 | 司灯、运营、策划、桐人、鸣人及辅助 QA；原运营、巡游驱动均已退出 |
| 宿主机 | 8088 | 15 个，启用 8 个 | 天神统筹与非游戏团队混合，含两项非游戏周期任务 |

“启用”是配置允许使用，不证明角色正在值班。MCP Python 子进程由 QwenPaw 管理，其数量不能直接算作重复部署。详情见 [配置审计](QWENPAW-TEAM-AUDIT.md)、[进程审计](OPERATIONS-GOVERNANCE-AUDIT.md)。旧 ReMe 梦境任务不属于 jobs.json，任务数量为 0 也不表示没有任何后台模型任务。

组织关系按原文件保留：造物主 → 天神 → 司灯 → 运营／策划／桐人与鸣人体验官。完整团队迁入独立运营容器的方案在 [迁移准备](OPERATIONS-TEAM-MIGRATION.md)。目前没有部署该新容器、移入凭据或打开新工具权限。

## 已整理的服务

统一登记位于 `config/operations-runtime.json`。9 个 D 服务由 Compose 的 `unless-stopped` 守护；共享 `shadow-tts` 的 8100 `/health` 单独探测，失败会使完整巡检失败，不能由 voice 的队列心跳代替。

已停用 `shadow-gate`、`shadow-voice`、`shadow-asr`。停用前验证了容器不可变 ID、旧世界已退出、输入队列为空、无连接，停用后核对 D 9 个容器身份和运行状态及 TTS 健康。容器和历史文件保留，回退命令与结果见 `reports/legacy-consumer-retirement.json`；该工具按一次性审计条件执行，不是通用清理器。

仍保留 `mc-direct` 与 25599 转发，因为存在实际连接；宿主 `QwenPaw-Autostart` 每 5 分钟同时拉起转发、QwenPaw、模型等服务，不能为清理游戏转发而停掉整项任务。旧 NPC 与其他旧服务仍共享数据；旧 18088 全接口发布尚未变更。这些均为明确遗留项，不计作已完成清理。

## CLI 使用

在 D 项目目录执行，或用 `operations.bat`：

```text
python tools/project.py ops status
python tools/project.py ops doctor
python tools/project.py ops snapshot
python tools/project.py ops restart panel
python tools/project.py ops restart panel --execute qiandengji
python tools/project.py ops stop --group dialogue --execute qiandengji
```

`status`、`doctor`、`snapshot` 都采集当前状态并原子发布快照；`doctor` 对 D 服务及共享 TTS 的失败返回非零。页面每 15 秒读取快照，采集超过 300 秒则标为历史，绝不当作当前正常。

日常由 Windows 任务 `QiandengJi-Operations-Inventory` 每两分钟采集一次。它使用已有 Python 运行时、隐藏窗口，单次执行后退出；90 秒超时，禁止重叠，日志最多 256 KiB。仅在当前用户已登录时运行，不唤醒电脑。完整巡检与 CLI 共用 OS 文件锁，任务遇忙跳过当前轮；锁文件存在不等于正在占用，不要手动删除。用 `python tools/operations_inventory_task.py query` 查看登记和最近结果，详情见 [定时采集说明](OPERATIONS-INVENTORY-TASK.md)。

启停默认只列计划；执行只允许明确列出的现有 D 容器，并校验实际归属。停止 MC 前先停消费者再确认保存；启动按依赖顺序等待服务，禁止 Compose 隐式拉起、重建未选择的依赖。依赖已停止时需要明确将其加入计划；初次部署或配置重建仍使用原部署工具。关闭 dialogue 只影响 QwenPaw，不停止玩家命令所在 world。

启停持有与游戏 QA 共用的排他锁，录音验收期间拒绝操作；失败记录执行步骤、观察状态和待恢复服务，不盲目重放不确定动作。回执在 `runtime/operations-actions/`。页面命令只是文本，宿主或旧环境不接受这个 CLI 的启停请求。

公开快照不包含 API key、token、完整配置、聊天、任务正文或原始命令行；版本、角色启用与数量未知时保持未知。模型名称仅表示现有选择，不代表本次发起过推理或验证过远端权益。
