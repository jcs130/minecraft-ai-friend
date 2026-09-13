# D 盘游戏服务与 Docker 管理

本次整理保留 `D:\Projects\QiandengJi` 为游戏唯一项目根目录。服务器常驻服务由同一个 `qiandengji` Compose 项目启动、停止和守护；本机客户端与操作入口可以在 Windows 运行，不再启动宿主游戏 Python/Node 守护进程。宿主 QwenPaw 8088 及其非游戏工作保持原用途。

## 数据归属

| D 盘位置 | 保存内容 |
|---|---|
| `server/mc` | NeoForge、模组、原 `shadow` 世界、玩家数据与游戏日志 |
| `server/world-data`、`server/mcdata` | 玩法状态、事件、CLI 队列与原动作回执 |
| `server/agents` | 游戏 QwenPaw 的 10 个现有角色、技能、会话和记忆 |
| `server/survival-agent-state` | 桐人身体调度、持久任务状态、执行租约 |
| `server/team-state`、`server/engineering` | 团队身份路由、工程候选与回执 |
| `server/operations-agent-state` | 已归档运营实例的历史资料，仍供现有角色读取 |
| `server/kokoro-state`、`server/asr-model` | Kokoro 模型和本地语音识别模型 |
| `server/tts-state` | 原配音参考文件和 IndexTTS 回滚资产 |
| `server/panel-state`、`server/inventory-state` | 后台公开状态与容器采集器状态 |
| `server/runtime-images` | 本次真实重建镜像与源码来源记录 |
| `runtime/backups` | 整理前的原存档与角色资料备份 |

Docker Desktop 的程序安装位置与镜像数据位置分开管理。其 WSL 数据目录已迁移到 `D:\docker-data\DockerDesktopWSL`，实际镜像磁盘为 `disk\docker_data.vhdx`。迁移使用本机 Docker Desktop 设置服务执行，与官方界面 Settings → Resources → Advanced 的路径变更相同；未手工移动正在使用的 VHDX。2026-09-13 13:23:06 UTC 读回新路径并验证原镜像 ID、标签、容器身份与挂载全部保留，回执为 `runtime/docker-migration-20260913T132146Z-124856b6/receipt.json`。

## 活动服务

默认启动 13 个服务：`mc`、`world`、`gate`、`npc`、`resources`、`qwenpaw`、`survivor`、`voice`、`asr`、`tts`、`panel`、`control`、`inventory`。状态采集器也由 Docker 守护，每 120 秒读取一次状态，不调用模型、不启停服务；原 Windows 状态采集任务保持禁用。

`qwenpaw-ops` 定义保留在 `legacy-operations` profile，日常启动排除它。司灯、天神等迁移由现有 `server/team-state/runtime-hosts.json` 确定，当前 10 个启用角色都在游戏 QwenPaw；不重新运行旧迁移/初始化脚本，也不把旧实例拉起成重复团队。

| 用途 | 本机入口 |
|---|---|
| 游戏客户端直连 | `127.0.0.1:25567` |
| Agent 协议入口 | `127.0.0.1:25701` |
| 日常管理首页 | `http://127.0.0.1:19091` |
| 游戏 QwenPaw | `http://127.0.0.1:18089` |
| 天神之眼渲染 | `http://127.0.0.1:19092` |
| 资源包分发 | `http://127.0.0.1:19090/packs/` |
| Kokoro TTS | `http://127.0.0.1:8100` |

管理、RCON、游戏端口继续仅发布在本机回环地址。旧运营 18090 不作为日常入口。Docker 网络重建后须核对管理台实际来源，当前 `qiandengji_default` 网关为 `172.18.0.1`；不能继续使用旧 `172.20.0.1` 而导致免密码会话被拒绝。

## 使用与重建

```powershell
# 检查镜像与 D 盘挂载，不输出环境变量或凭据。
.\run-python.bat tools/runtime_layout.py

# 默认包含自主身体服务和状态采集器，等待真实健康状态。
.\run-python.bat tools/project.py start
.\run-python.bat tools/project.py status
.\run-python.bat tools/project.py stop
```

双击 `start-server.bat` / `stop-server.bat` 使用同一入口。启动前会拒绝缺少镜像、缺失挂载、项目外路径和旧运营服务，避免 Docker 自动创建空目录后误启一个新世界。既有 RCON 凭据不再由启动脚本覆盖；不一致时报告错误并要求核对源配置。

世界/侧车/ASR 镜像构建见 [游戏运行镜像](GAME-RUNTIME-IMAGES.md)。QwenPaw 镜像由 `tools/build_qwenpaw_recovery.py` 锁版本恢复；Kokoro 见 [游戏语音](KOKORO-TTS.md)。恢复使用新镜像标签和真实构建回执，历史镜像哈希和游戏验收记录不改写为当前证明。

## 原状态与验收边界

整理前已复制并逐项验证 27,157 个文件、2,931,935,410 字节，备份位于 `runtime/backups/service-recovery-20260913T130941Z-7d8bde74`。该备份覆盖停服时的世界和角色状态，保留私有资料且不进入 Git。

桐人原 `control.json` 为暂停，原因 `cancellation_uncertain`，仍有历史 active 任务记录。本次启动身体服务不等于恢复自主行动；需要依据原任务的终态及租约另行核对，不能删除记录或重投旧动作来制造“已恢复”。游戏是否能连接、服务是否健康、Agent 是否在自主行动分别验收。

实际 QwenPaw 原生 API 已读到 10 个启用角色、94 项启用技能绑定，与每个角色原有 `skill.json` 一致。严格检查兼容 QwenPaw 2.2.0 支持的旧 `{skills,version}` 文件格式，同时保留工具、学习 MCP、团队、伙伴及定时任务断言；同轮重复 GET 只在内存复用，不跨轮缓存。完整检查实测约 40 秒，因此 Docker 健康间隔和超时都设为 120 秒，避免原 25 秒超时误报。

Minecraft 已重新加载原 `shadow` 世界，实际协议查询确认直连和 Agent 入口均返回 1.21.1、协议 767，RCON 读回 `keepInventory=true`。本机管理台免密码会话、天神之眼观察者与区块服务、GPU Kokoro 健康均已验证。只读综合验收入口为 `tools/smoke_game_recovery.py`，报告写入 `runtime/game-recovery-20260913/live-smoke.json`；这些检查不等同于真人模组客户端完整登录、WebGL 画面或游戏内听觉验收。

该综合验收的 8 项实际检查全部通过：13 个活动服务均在运行并配置 `unless-stopped`，其中 12 个 Docker 健康探针通过，`gate` 由真实 Minecraft 协议查询验证。管理清单的后续自动发布也读到 `currentServices=true`，没有因缺少归档实例而误报。

完整 `world/ops/health/health_mon.py` 也已实际执行，当前服务、采集、QwenPaw 原生运行检查通过，但总体仍为失败，报告保留在 `reports/runtime-health.json`。除历史源码证明已不匹配当前版本外，还存在以下独立于本次存储迁移的实际遗留，不能宣称整个自主世界已验收：

- 桐人仍暂停，未取得当前身体持续 tick 和伙伴游戏通信的完整证明。
- 15 条模型用途路由中有 4 条仍指向停用角色：诊断 `qd-diagnostics`、活动 `mc-priest`、操作体验 `mc-guard-kirito`、探索体验 `mc-guard-naruto`。旧运营委派适配器也还允许这些目标；须按现有职责合并方案单独收敛，不能重新启用重复角色来掩盖问题。只读审计见 `runtime/qwenpaw-recovery-20260913T130745Z-420b0502/model-route-audit.json`。
- 世界运营当前没有可验证的当日日报回执，原源码验收亦已漂移。服务健康和原生 Cron 已启用不等于日报或任务发布已完成。

本次不重写历史哈希、补造日报、重投旧动作或改动角色配置。真人模组客户端登录与实际玩法仍应按当前整合包另行验收。

参考：[Docker Desktop 官方 WSL 存储说明](https://docs.docker.com/desktop/features/wsl/)、[Minecraft Docker 的 NeoForge 配置](https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/server-types/forge/#neoforge)。
