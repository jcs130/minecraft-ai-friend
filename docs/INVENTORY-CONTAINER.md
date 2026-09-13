# 游戏管理清单由 Docker 采集

2026-09-13 起，管理台公开库存由 `inventory` Compose 服务每 120 秒更新，旧 Windows 定时任务保持 Disabled。运行时共有 13 个活动服务；旧 `qwenpaw-ops` 仍在注册表中，标记 `active:false`，不计入当前服务健康、普通服务卡片或 `--group all` 的启停列表。

入口是 `python3 -u /project/tools/inventory_service.py`，复用现有 `qiandengji-sidecar:20260913-qd1` 镜像。源码通过只读挂载进入容器，不增加宿主常驻进程。仅游戏配置、原生角色技能与任务的元数据用于公开清单，宿主 Home、旧 shadow 和旧运营会话目录不挂入。状态只写 D 盘 `server/panel-state`，锁文件统一位于 `server/inventory-state/operations-inventory.lock`，该独立状态目录在容器中挂到 `/project/server/inventory-state`，宿主与容器使用同一个物理文件。

采集器通过 Unix socket 发送固定 `GET /containers/<登记名称>/json`，不提供 Docker CLI、exec、启动、停止或模型调用路径。每轮只在内存保留容器状态、归属、守护策略和镜像 ID；原始环境变量、命令和挂载不会被写入报告。Docker socket 本身仍是宿主 Docker 的管理接口，`:ro` 挂载不等于 HTTP 权限隔离；当前约束由固定采集代码实现。

TTS 探针继续对外报告 `127.0.0.1:8100/health`，容器内仅此固定入口转换为 `http://tts:8100/health`。健康命令 `python3 /project/tools/inventory_service.py --health` 检查最近一次发布是否完成，允许被监控的 MC 或 Agent 服务不健康，避免采集器健康与整个服务器健康互相等待。实际服务失败仍保留在 `operations.json` 的 `checks.currentServices`、issues 和 `health.json` 中。

本机实测 Windows `msvcrt` 与 Docker Linux `flock` 即使作用于同一物理文件也不能互斥，因此公开状态采用唯一写入入口：`operations.py status/doctor` 只读当前快照，`snapshot` 和完整健康审计的刷新由宿主验证采集容器归属后，通过其实际容器 ID 执行固定 `inventory_service.py --once`。自动循环与手动刷新都在 Linux 内竞争同一 `flock`。宿主直接 `write_snapshot` 被拒；刷新失败不回退到宿主写入，完整健康报告只写 `reports/runtime-health.json`，不覆盖采集器的公开文件。真实验证已确认第二个 Linux 发布者被阻止、宿主写入被拒、旧快照保持不变，释放后容器刷新成功；见 `runtime/game-service-recovery-20260913/inventory/single-writer-lock.json`。

明确不存在的旧容器记为 `absent`，不冒充 Docker 故障，也不因旧 shadow 已不在新引擎而报退役漂移；无法连接 Docker 则保持 `unavailable`。已归档实例意外运行仍会告警。原六角色报告和来源 SHA 保留历史事实，最新司灯迁移为 active 时，由游戏 QwenPaw 的原生角色/技能回执及世界团队探针验证当前运营；不将旧报告改写成新十角色验收。

离线测试覆盖 socket 方法和对象范围、私密字段排除、404 与 Docker 故障区分、固定 TTS 路由、适配器恢复、被监控服务失败时持续发布，以及归档服务不会自动启动。

2026-09-13 实际自动发布已验证两轮：13:25:55.869 和 13:27:54.801 UTC。容器 `healthy`、重启 0 次、`unless-stopped`；管理台公开投影仅当前游戏 runtime 的 10 个启用角色，`available=true`、`stale=false`，没有归档运营或旧 shadow 缺失误告警。第二轮仍准确报告 QwenPaw 启动未就绪，其余 12 项活动服务已就绪；这是该时刻的状态，不将采集成功等同于全部游戏功能验收。证据在 `runtime/game-service-recovery-20260913/inventory/`，没有手动运行 `--once` 冒充定时循环。
