# HarnessRouter 接入、角色持久化与维护

日期：2026-10-22。第二阶段已完成：自研 `agent-mc-autonomy 0.1.27`
可显式选用 HarnessRouter 的 23 种已测运行时或原有直连规划器，在同一控制器中切换。
角色人设、私有经历与原任务/动作账本按各自职责保存。FOM 未重启、未换世界，
现役人物未迁移、未恢复旧的自动循环；普通测试账号已退出。
完整运行时列表、线上模型、六种运行时的游戏验收及记忆检索修复见
[运行时矩阵](HARNESS-RUNTIME-MATRIX-20261022.md)。下文末段保留第一阶段历史验收。
现役 Paper 千灯纪的 **1.21.1** 独立接入、私有技能状态和操作入口另见
[千灯纪接入手册](QIANDENGJI-HARNESSROUTER.md)。两服复用原规划服务，各角色的数据和身体分别绑定。

## 已部署的可选服务

| 项目 | 当前值 |
| --- | --- |
| 管理界面 | `http://127.0.0.1:29150`，仅本机发布 |
| API | `http://127.0.0.1:29150/api/harness`，Bearer API key |
| 运行位置 | 已有 WSL `Ubuntu-24.04` 内的独立 Docker 容器 `maw-harnessrouter` |
| 版本 | CE `0.35.13`、UHP `2026-09-28`、DSH `0.1.2rc1` |
| 持久数据 | 命名卷 `maw-harnessrouter-data` → `/data` |
| 资源 | 2 CPU、3 GiB 内存、1024 PID；`unless-stopped` |
| 控制台登录资料 | 本机私有 `E:\MC\private\harnessrouter\console-login.json` |
| 宿主 API key | 本机私有 `E:\MC\private\harnessrouter\api-key.json` 的 `key` 字段 |
| 容器环境文件 | `E:\MC\private\harnessrouter\service.env`，含持久加密/内部认证密钥 |
| 线上联调模型 | Qwen Token Plan 的 `qwen3.7-plus`，没有自动跨模型回退 |

完整镜像 digest、来源 commit 与启动参数见
[版本锁](../manifests/harnessrouter-20261022.lock.json)。不把凭据值写进文档或 Git。
供应商配置通过 HarnessRouter 原生加密 integration 保存；原宿主配置未改。
26 个内置运行时均已安装并运行版本检查，23 个线上决策通过且已启用。
Gemini、System One、Qoder 缺专属服务凭据，未启用。没有新增路由器/防火墙放行。

`unless-stopped` 在 Docker daemon 启动后恢复容器；本轮没有新增 Windows 开机任务，
不能据此承诺 WSL 在所有主机重启场景下自行启动。

## 怎么使用与切换

完整步骤和模板在
[框架接入指南](../packages/agent-mc-autonomy/docs/harness-router.md)。
显式填写服务器、账号、独立数据目录、人设/稳定 ID、模型与网关 API key 环境变量。
沿用已验证的游戏后端和 Web 适配；服务不会自行猜测世界或登录账号。

可用 wheel、独立 Python 环境、示例配置和依赖清单已放在
`E:\MC\integrations\agent-mc-autonomy-0.1.27-harnessrouter`。
使用其中 `.venv\Scripts\python.exe -m agent_mc_autonomy.cli` 执行指南命令。
wheel SHA-256 为 `14313f41cfc49e25a71696a8faf65ad6c310e14512d4f784ca61a5cfd862c15f`。
此安装不会自动启动游戏角色。

角色的 `owner_id + agent.id` 与模型/harness 无关。`[planner]` 可在安全决策边界热读；
正在运行的游戏动作由原队列继续执行，旧推理若在配置更换后才回来，会在派发前被拒绝。
目标、未知动作、原始 UUID 和回执不会因切换被清空。人设、账号、身体与世界绑定的
改变是另一项操作；不应通过改数据目录或复制存档伪装成切换规划器。

当前是 **规划后端接入**：DSH 输出结构化下一步，由自研核心校验和派发游戏工具。
上游当前忽略 UHP 请求的 `tools` 字段，因此工具 schema 作为输入资料传递，
不是给 DSH 另开 Minecraft 连接或直接装入另一条游戏控制循环。
每个规划决策是新 UHP 任务，宿主负责事实、近期上下文和可检索的角色历史。

普通 Mineflayer、服务端 Numen 身体、真实客户端桥继续复用原显式后端。
本轮真实游戏验收是 Mineflayer 身体；没有声称替所有 Numen/客户端模组完成了新验收。
Cortico 和 Numen 自带循环尚未成为 HarnessRouter 的内置驱动；原宿主注入/
ReviewPort 路线仍保留。用户选择界面、多用户注册鉴权、导入与云同步仍是后续项。

## 维护与备份

只读查看、重启和明确停用只针对这个容器：

```powershell
wsl -d Ubuntu-24.04 -- docker ps --filter name=maw-harnessrouter
wsl -d Ubuntu-24.04 -- docker logs --tail 60 maw-harnessrouter
wsl -d Ubuntu-24.04 -- docker restart maw-harnessrouter
wsl -d Ubuntu-24.04 -- docker stop maw-harnessrouter
```

日志可能包含私人模型任务内容，仅在本机查看。不要 `docker system prune` 或删除
命名卷来“重置角色”。维护前先停止该服务的新规划提交，检查原响应 ID 的终态；
它不负责取消已经交给 Minecraft 的动作。只读的 `harness-check` 检查发现能力，
不消耗一次模型推理，也不验证每种模型的实时可用性。

一致性备份分三份，不能互相替代：

1. HarnessRouter 无任务运行后停容器，冷备整个命名卷，并保存同一版本的私有
   `service.env`、API key/登录资料、镜像锁。原加密密钥必须随备份保留，恢复时不重新生成。
2. 自研框架用 `agent-export` 导出有哈希的人设修订和经历；保存原数据根目录内的
   `sessions`、目标邮箱、动作回执与身体数据。SQLite 热拷贝不能只拷主文件而漏 WAL。
3. Minecraft/模组进度沿用原有停服或协调保存的世界备份。角色导出不含世界存档。

新实例恢复先使用相同锁定镜像、原卷和环境文件，仅发布回环端口；读回 API 能力、
角色档案和原动作状态后再启用规划。已发生的世界变化不能通过恢复旧推理历史重放。
云端全文同步、断网增量恢复、冲突处理与旧宿主个人记忆转换本轮没有实现。

本轮已完成第一次命名卷冷备：私有 `backups/state-20261022T041417Z.tgz`，
178,121,333 字节，23,502 个成员逐项读过；原加密环境和登录资料在同一私有备份目录。
仅此 HarnessRouter 容器停启后恢复原卷，FOM 与基岩桥未重启。

## 第一阶段真实验收（保留历史）

独立普通账号 `ag_HarnQA22` 使用冻结的 `agent-mc-world 0.4.0` 与模组适配资产连接
FOM 的 `28977`。没有 OP、赠物、传送、挖掘或放置。初轮从 `(-9,82,0)` 走到
`(-8,82,0)`；修复格式适配后复测从 `(-8,82,0)` 走到 `(-7,82,0)`。

最终复测：

| 阶段 | 实际结果 |
| --- | --- |
| DSH | 保存带随机口令的便笺，读取当前事实 |
| 切直连 | 清空短期规划历史，从角色库找回便笺；经 `mc_help` 纠正参数后实际步行一次 |
| 切回 DSH | 再次从库找回原口令，读到新位置；三个阶段的游戏事件 run 一致 |
| 断线重连 | 同账号、人设修订和记录保留；位置仍为 `(-7,82,0)`、队列空，没有再提交移动 |
| 导出 | 1 版人设、12 条历史记录，独立一致性读取与 SHA-256 校验 |

三个阶段合计 **8 次规划调用、1 次真实移动、1 次无副作用的错误参数拒绝后纠正**。
“终态完成”来自原生任务 `cbf9bccb-effc-4d6f-b970-5012676147ae:1`，
不是模型报告。这里只证明小任务的接线和接续，不能推导长期自主生存成功率。
DSH 包装和上下文开销明显高于直连，保留逐次 latency/token 供后续比较。

早期失败证据保留：`qwen3.7-plus`、`qwen3.6-plus`、`glm-5` 被同账户接口返回 429；
经用户授权后改测 `qwen3.5-plus`，直连和 DSH 均成功。这不等于整个账户额度耗尽。
第一次 DSH 把工具参数输出为对象，适配器原先只收字符串而拒绝；已支持两种表示，
参数值仍交原 schema 校验。临时模型夹具只用于传输联调，不计作真实模型成功。

原始任务/包/私人经历留在本机 `E:\MC\research\harness-acceptance-20261022`，
脱敏汇总见 [验收记录](evidence/harnessrouter-20261022.json)。临时模型服务、测试网络和
integration 已移除，所有已知 UHP 任务均终结，测试账号已退出。

框架 332 项 pytest 与安装包独立消费者检查通过；后者禁止联网、启动进程和导入
宿主 SDK/源码副本，同时验证原队列、角色导出及 UHP 封包。可复跑：

```powershell
E:/MC/integrations/agent-mc-autonomy-0.1.27-harnessrouter/.venv/Scripts/python.exe -I packages/agent-mc-autonomy/tests/standalone_probe.py --installed --config packages/agent-mc-autonomy/standalone.example.toml
```

正式服只读 20 项、基岩桥只读 14 项均通过，仍是本轮开始前的两个原 run ID。
