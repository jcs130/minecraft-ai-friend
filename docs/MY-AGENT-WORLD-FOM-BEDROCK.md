# FOM 的基岩和 Mineflayer 接入

2026-10-16，现役 FOM 2.42 / Minecraft Java 1.21.1 / NeoForge 21.1.248。

## 连接

| 客户端 | 地址 | 登录与用途 |
| --- | --- | --- |
| 基岩国际版 | 公网 `micro.kangqiang.site:28988`，家中 `192.168.3.163:28988`，UDP | 在游戏中登录 Xbox；进入时接受服务器资源包。当前是部分模组兼容入口 |
| Mineflayer | `192.168.3.163:28977`，TCP | `version: '1.21.1'`、`auth: 'offline'`、用户名以 `ag_` 开头；仅本机和家庭局域网 |
| 完整模组 Java | 公网 `micro.kangqiang.site:28976`，家中 `192.168.3.163:28976` | 安装统一 FOM 客户端包，供完整模型、专用菜单和复杂机器/载具使用 |

这三个入口进入同一个 FOM 世界。旧 Paper 千灯纪独立运行；已退役的旧 35 模组服和它的基岩桥继续暂停，没有恢复旧控制器。

基岩入口使用 Geyser 2.11.3-b1249 / ViaProxy 3.4.14 / 独立原生注册表转换网关。生产配置启用 Xbox 验证，不能用无签名离线 Bedrock 客户端进入。当前公网状态回报 Bedrock 26.52、协议 2193；实际 UDP QA 客户端使用同协议的 1.26.51 数据。

基岩名字在 FOM 内使用独立前缀：短 ASCII 名字为 `b_名字`，其他名字使用 `bh` 加摘要。`/fom status` 可查看本人的实际服务器名字和 UUID。这是名字隔离，不是 XUID 账号绑定；改 Xbox 名字不会自动迁移原角色。FOM 原有访客/设密策略仍适用，首次访客进入无需编造密码，设置过密码后按 `/login` 提示操作。

## 目前的兼容范围

转换依据是现役 102 个服务端 JAR 和实际导出的注册表，发布时逐 SHA 校验。资源包包含 1,079 种可直接转换的原始静态物品图标；完整物品投影目录保留 4,573 种模组物品的真实名称和身份。包含机械动力、农夫乐事、Iron、女仆、精妙背包和铁路等条目；数量表示转换目录，不代表这些模组的全部玩法已验收。

基岩背包换槽经真实 UDP 操作验证，原生 `farmersdelight:rice` 的类型、数量和原有物品均保留。物品身份和原生组件快照由服务端网关恢复，不能把投影图标当成真实纸张等基础类型。Mineflayer 的相同原则及五项原生只读查询见 [Mineflayer 接入说明](MY-AGENT-WORLD-FOM-MINEFLAYER.md)。

本轮没有转换全部方块模型、动态纹理、专用物品渲染器、女仆动态模型、复杂载具或模组 GUI。模组方块投影可能近似；不支持的实体不会伪装成原版生物，需结合 `/fom nearby` 和 `/fom inspect` 判断现场。复杂玩法优先使用完整 Java 客户端和客户端桥。

接受基岩资源包会下载贴图，不会安装 Java 模组或把 Java 专用界面自动搬到基岩。相关机制见 [Geyser 自定义物品](https://geysermc.org/wiki/geyser/custom-items/) 和 [资源包下发](https://geysermc.org/wiki/geyser/packs/)。

## 已做的验证

- 20 项 Node 协议回归、14 项 Python 服务与资源包测试，以及 63 项现有服务守护回归通过。构建/旧模型测试使用带 Pillow 的 Python；生产标准库 Python 的实际启动与健康检查另行通过。
- 真实 loopback Bedrock UDP：13 项登录、下载校验、原生查询、三种实际模组物品、背包换槽、数量/身份保全及清理检查通过；另一次 75 秒会话存活和库存保留通过。QA 的 Xbox 验证只在明确标记的回环夹具关闭，生产始终开启。
- 正式 LAN Mineflayer 再次完成 8 项只读联机检查，实际位置与服务端一致；FOM 9 项、基岩桥 8 项健康检查通过。
- 生产无签名连接被服务端明确拒绝，新增日志为“请登录 Xbox 以加入此服务器”。测试库未解码登录前的断开包，因此以该次连接的新增服务端日志独立验收，早期失败客户端回执保留。
- 外部 mcstatus.io 读到公网 UDP 28988 的新 FOM MOTD；mcsrvstat.us 同次超时，未记录为通过。没有变更路由器或防火墙。
- 真实手机、Xbox 正向登录、手柄操作和屏幕像素效果尚待玩家验证，不能用离线 QA 冒充。原包已有告警保留；QA 曾出现一次 Geyser-ViaProxy 首连接事件 NPE，后续多次登录与物品/会话测试通过，尚未证明全部设备长期稳定。

失败证据不覆盖：初版 QA 阻塞心跳并未打开背包，导致超时/无库存回执；改用异步控制台、先打开背包及正确实体 ID 后通过。已核对并清理该专用 QA 的临时材料，原 Soul Spell 保留。QA 外层包装器达到 900 秒预算后退出，独立服务随后经显式 shutdown 确认两子进程正常退出码 0、端口释放；不将包装器错误记成正常退出。

## 日常维护

基岩桥固定部署在 `E:\MC\servers\fom-2.42\ops\bedrock-20261016`，网关在同级 `bedrock-gateway-20261016`，脚本在 `bedrock-service-tools`。配置是 `ops\fom-bedrock.json`，使用 `E:\MC\runtime\python-3.12.14`，不依赖研究目录、源码 checkout 或 Codex 缓存。生产管理员 HTTP 只监听 `127.0.0.1:28996`；内部 TCP 28994/28995 只监听回环，不需要转发。

```powershell
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Status
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Health
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Stop
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Start
python world/ops/health/health_mon.py --society-fom-bedrock-smoke
```

独立 owner 管理两个子进程，有退出重启、退避和重启频率上限。注册启动名 `MyAgentWorld.FOM.Bedrock.28988`，与主 FOM 分开；当前使用 HKCU Run，用户登录 Windows 后启动，不保证登录前启动，也不保证 owner 自身异常退出后自动复活。Stop 会持久暂停并等待正常关闭，Start 明确恢复；更新基岩资源只需停桥，不必重启游戏服。主服不可用时健康会明确失败，不假报就绪。

加入或更新模组时，重新导出本服注册表、冻结网关、生成资源包和目录，再做隔离与联机验收；不能复用旧服数字 ID。资源内容变化需更新包版本，原始专用渲染器和动画需单独适配。`tools/prepare_fom_bedrock.py` 只生成新候选目录，不会自动发布或启动服务。运行验证只需标准库，生成 PNG 时需要 Pillow。

回退本次桥：用上述 Stop 等待子进程退出，再用同目录 `maw_service_task.ps1 -Mode Unregister -FomBedrock -Python E:\MC\runtime\python-3.12.14\python.exe -Config E:\MC\servers\fom-2.42\ops\fom-bedrock.json` 移除本桥启动项。保留桥目录及证据；Java 28976、Mineflayer 28977、世界和原认证库均不需回退。不得据此恢复旧服。

公开验收摘要见 [发布记录](evidence/fom-bedrock-20261016.json)。私有原包、图标、日志、玩家数据和失败原包不上传 Git；资源通过游戏服务下发。
