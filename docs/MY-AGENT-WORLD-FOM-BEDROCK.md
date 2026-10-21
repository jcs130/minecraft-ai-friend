# FOM 的基岩和 Mineflayer 接入

2026-10-16 发布，2026-10-21 接入更新；现役 FOM 2.42 / Minecraft Java 1.21.1 / NeoForge 21.1.250。

## 连接

| 客户端 | 地址 | 登录与用途 |
| --- | --- | --- |
| 基岩国际版 | 公网 `micro.kangqiang.site:28988`，家中 `192.168.3.163:28988`，UDP | 在游戏中登录 Xbox；进入时接受服务器资源包。当前是部分模组兼容入口 |
| Mineflayer | 公网 `micro.kangqiang.site:28977`，家中 `192.168.3.163:28977`，TCP | `version: '1.21.1'`、`auth: 'offline'`、用户名以 `ag_` 开头；网关已显式启用公网来源准入 |
| 完整模组 Java | 公网 `micro.kangqiang.site:28976`，家中 `192.168.3.163:28976` | 安装统一 FOM 客户端包，供完整模型、专用菜单和复杂机器/载具使用 |

这三个入口进入同一个 FOM 世界。旧 Paper 千灯纪独立运行；已退役的旧 35 模组服和它的基岩桥继续暂停，没有恢复旧控制器。

2026-10-21 方块与动画适配已上线：新增 2,762 种方块的 54,113 个原模型状态、1,268 种原模型三维方块物品，另含 8 种方块的 9 套源纹理动画。新增资源包约 6.3 MiB；重新进服并接受下载即可。机械转动、灶台食物层和其他专用渲染还未全部接通，部分机器当前只有静态底座；不能把这些计数当作所有模组全适配。见 [完整覆盖清单与维护方法](FOM-BEDROCK-VISUAL-COVERAGE.md) 和 [本批发布记录](evidence/fom-bedrock-blocks-20261021.json)。

同日较早的图标／女仆修复已上线：服主已确认手机能够登录。随后补齐魂符初始、空白和收纳女仆三个状态的原始图标与中文名称，并加载原 TLM 模型包及 Geyser 模型扩展，该批资源约 13 MiB。手机在修复后的实际画面仍待玩家确认；不能以协议验收代替屏幕像素验收。见 [前批修复记录](evidence/fom-bedrock-visual-fix-20261021.json)。

2026-10-21：主服与独立基岩桥已按原守护启动，主服12项、基岩桥8项健康检查通过，UDP 28988取得实际Pong。来自本机非家庭网段接口的 Mineflayer 实际登录及 `/fom status` 通过；这验证网关准入，不能代替手机蜂窝网络的外网验证。本轮未更改路由器或 Windows 防火墙。见 [公网准入发布记录](evidence/fom-public-access-20261021.json)。

同日后续：服主完成路由器映射后，通过 Windows UAC 授权新增三条持久入站规则，放行本机 192.168.3.163 的 TCP 28976、TCP 28977、UDP 28988，来源 Any、配置文件 Any；管理端口未纳入。ActiveStore 读回三条规则均生效，防火墙配置文件保持启用。外部 Java/Agent 状态查询成功，基岩由另一状态服务取得 26.52 / FOM 的在线应答；第一家基岩探测超时记录保留。仍未代替手机 Xbox 实际登录或全部模组验收。规则名、回滚和外部检查见 [防火墙发布记录](evidence/fom-firewall-20261021.json)。

基岩入口使用 Geyser 2.11.3-b1249 / ViaProxy 3.4.14 / 独立原生注册表转换网关。生产配置启用 Xbox 验证，不能用无签名离线 Bedrock 客户端进入。当前公网状态回报 Bedrock 26.52、协议 2193；实际 UDP QA 客户端使用同协议的 1.26.51 数据。

基岩名字在 FOM 内使用独立前缀：短 ASCII 名字为 `b_名字`，其他名字使用 `bh` 加摘要。`/fom status` 可查看本人的实际服务器名字和 UUID。这是名字隔离，不是 XUID 账号绑定；改 Xbox 名字不会自动迁移原角色。FOM 原有访客/设密策略仍适用，首次访客进入无需编造密码，设置过密码后按 `/login` 提示操作。

## 目前的兼容范围

转换依据是现役 103 个服务端 JAR 和实际导出的注册表，发布时逐 SHA 校验。资源包包含 1,082 种原始物品图标；完整物品投影目录保留 4,575 种模组物品的真实名称和身份。包含机械动力、农夫乐事、Iron、女仆、精妙背包和铁路等条目；数量表示转换目录，不代表这些模组的全部玩法已验收。

魂符的初始／收纳状态原本使用 Java 动画贴图，旧构建器将它们排除，导致回落为原版方块图标。现在取原动画规定的首帧作为明确的静态图标，保留源像素和原生物品身份，不宣称已经移植 Java 图标动画。空白状态使用原 PNG；三者均按原模组 `ItemSmartSlab#getDescriptionId()` 使用“魂符”名称。资源包版本升至 1.0.4，避免继续使用旧缓存。

基岩背包换槽经真实 UDP 操作验证，原生 `farmersdelight:rice` 的类型、数量和原有物品均保留。物品身份和原生组件快照由服务端网关恢复，不能把投影图标当成真实纸张等基础类型。Mineflayer 的相同原则及五项原生只读查询见 [Mineflayer 接入说明](MY-AGENT-WORLD-FOM-MINEFLAYER.md)。

车万女仆已增加 241 个原模型／贴图绑定，使用原几何、UV、PNG，资源包也包含原模组预录语音；本次未实测手机播放。模型握手完成后保留原实体 ID、UUID、位置和服务端 AI，仅由基岩桥替换显示；不会重新生成玩家的女仆。当前 FOM 没装 YSM，不下发不存在的 YSM 模型。13 个源模型因重复骨骼或几何／贴图规格未通过当前转换器，仍明确列为不支持；并非所有模型、动画控制器、装备层和对话气泡都已移植。

本批世界方块共有 54,113 个状态使用原几何、UV、贴图、朝向及碰撞；其中 23,880 个不带方块实体，其余 30,233 个暂只提供静态底座。未覆盖状态、专用物品渲染器、复杂载具和模组 GUI 仍需继续适配，不按普通 JSON 模型猜测其形状。基岩本身支持动画和动画控制器，动态玩法需分别把真实游戏状态接入；当前缺口在转换和同步链路。不支持的实体不会伪装成其他生物，需结合 `/fom nearby` 和 `/fom inspect` 判断现场。复杂玩法优先使用完整 Java 客户端和客户端桥。

接受基岩资源包会下载贴图，不会安装 Java 模组或把 Java 专用界面自动搬到基岩。相关机制见 [Geyser 自定义物品](https://geysermc.org/wiki/geyser/custom-items/) 和 [资源包下发](https://geysermc.org/wiki/geyser/packs/)。

## 已做的验证

本批 51 项 Python、29 项相关 Node、18 项固定 Geyser JVM 断言通过；较早更广的 41 项 Node 组合也通过。真实 UDP 世界方块 13 项、三维物品／女仆及 75 秒会话 21 项、同身份库存重连 10 项、最终原生放置及清理 23 项通过。安山机壳实际放置生成原 `create:andesite_casing` 并只扣一个；临时方块与物品分别独立查询确认清理。E/F 双盘控制备份校验后仅正常重启桥，原主服 Java 30356／runId 34b2c082…及全部 103 JAR 保持，主服 12／桥 13 健康与两项 panel-smoke 通过。隔离服务已正常退出并释放端口。

首次启动登记因继承了不兼容的 PowerShell 模块搜索路径而被权限校验拒绝；只为维护子进程恢复 Windows PowerShell 自带模块路径后完成真实 DACL 校验和同名登记。首次 Geyser 启动遇到微软发现接口 TLS 失败，原守护正常停止该子进程后重试成功，始终保留 Xbox 验证。两次失败的原始记录均保留，没有当成一次成功发布。

2026-10-21 修复验收：30 项 Node、44 项 Python 回归通过；实际 Bedrock UDP 的 19 项检查包含初始／空白魂符与农夫乐事物品的真实运行时 ID 对应原图标、原生库存换槽保全、蓬莱人形原模型生成与同实体位置更新，以及 75 秒会话与库存保留；同一 QA 账号重连另有 9 项检查通过。协议测试客户端不生成真人持续输入，测试期间每 10 秒做一次本人私有只读查询；不是无输入挂机或长时间负载验收。早期测试中的旧槽位缓存、错误 NBT 字段以及无输入超时与失败回执保留；临时物品经实际库存对账清理，临时女仆仅按随机专用标签清理。补齐基岩点击的原生组件恢复，并修正冷却消息 `itemID`、方块破坏特效的编号转换。正式仅重启基岩桥，游戏进程和 103 个模组／认证静态输入保持。

以下保留 2026-10-16 首版验收记录，数量和限制以本页上方的新版本说明为准。

- 20 项 Node 协议回归、14 项 Python 服务与资源包测试，以及 63 项现有服务守护回归通过。构建/旧模型测试使用带 Pillow 的 Python；生产标准库 Python 的实际启动与健康检查另行通过。
- 真实 loopback Bedrock UDP：13 项登录、下载校验、原生查询、三种实际模组物品、背包换槽、数量/身份保全及清理检查通过；另一次 75 秒会话存活和库存保留通过。QA 的 Xbox 验证只在明确标记的回环夹具关闭，生产始终开启。
- 正式 LAN Mineflayer 再次完成 8 项只读联机检查，实际位置与服务端一致；FOM 9 项、基岩桥 8 项健康检查通过。
- 生产无签名连接被服务端明确拒绝，新增日志为“请登录 Xbox 以加入此服务器”。测试库未解码登录前的断开包，因此以该次连接的新增服务端日志独立验收，早期失败客户端回执保留。
- 外部 mcstatus.io 读到公网 UDP 28988 的新 FOM MOTD；mcsrvstat.us 同次超时，未记录为通过。没有变更路由器或防火墙。
- 真实手机、Xbox 正向登录、手柄操作和屏幕像素效果尚待玩家验证，不能用离线 QA 冒充。原包已有告警保留；QA 曾出现一次 Geyser-ViaProxy 首连接事件 NPE，后续多次登录与物品/会话测试通过，尚未证明全部设备长期稳定。

失败证据不覆盖：初版 QA 阻塞心跳并未打开背包，导致超时/无库存回执；改用异步控制台、先打开背包及正确实体 ID 后通过。已核对并清理该专用 QA 的临时材料，原 Soul Spell 保留。QA 外层包装器达到 900 秒预算后退出，独立服务随后经显式 shutdown 确认两子进程正常退出码 0、端口释放；不将包装器错误记成正常退出。

## 日常维护

基岩桥固定部署在 `E:\MC\servers\fom-2.42\ops\bedrock-20261021-v2`，网关在同级 `bedrock-gateway-blocks-20261021-v2`，脚本在 `bedrock-service-tools`。配置是 `ops\fom-bedrock.json`，使用 `E:\MC\runtime\python-3.12.14`，不依赖研究目录、源码 checkout 或 Codex 缓存。生产管理员 HTTP 只监听 `127.0.0.1:28996`；内部 TCP 28994/28995 只监听回环，不需要转发。

```powershell
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Status
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Health
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Stop
& E:\MC\servers\fom-2.42\ops\bedrock-service-tools\fom_bedrock_control.ps1 -Action Start
python world/ops/health/health_mon.py --society-fom-bedrock-smoke
```

独立 owner 管理两个子进程，有退出重启、退避和重启频率上限。注册启动名 `MyAgentWorld.FOM.Bedrock.28988`，与主 FOM 分开；当前使用 HKCU Run，用户登录 Windows 后启动，不保证登录前启动，也不保证 owner 自身异常退出后自动复活。Stop 会持久暂停并等待正常关闭，Start 明确恢复；更新基岩资源只需停桥，不必重启游戏服。主服不可用时健康会明确失败，不假报就绪。

加入或更新模组时，重新导出本服注册表、冻结网关、生成资源包和目录，再做隔离与联机验收；不能复用旧服数字 ID。资源内容变化需更新包版本，原始专用渲染器和动画需单独适配。`tools/prepare_fom_bedrock.py` 只生成新候选目录，不会自动发布或启动服务。运行验证只需标准库，生成 PNG 时需要 Pillow。

构建女仆模型复用 `tools/maw_bedrock_modpacks.py`，输入必须含实际安装的 TLM JAR 哈希及原资源完整性清单；FOM 无 YSM 时允许只转换 TLM。编译扩展使用固定 Geyser JAR 和 Java 21。发布将模型契约、目录、扩展和模型包放入候选 `plugins/Geyser`；服务会校验它们与真实模组、Geyser 的 SHA，并周期检查文件漂移、实际模型注册与下载栈。标准库运行还需部署 `maw_bedrock_modpacks.py`、`maw_bedrock_animations.py`、`maw_bedrock_voices.py`，不能漏掉验证依赖。

换桥目录后，先用同一配置路径执行 `maw_service_task.ps1 -Mode Register -StartupMethod Run -FomBedrock`，补齐新运行目录的真实 `startup.json`，再执行 Start；不得伪造注册回执或裸起常驻进程。旧桥、网关保留；本批控制脚本／配置冷备在 E、F 两盘的 `fom-bedrock-blocks-20261021/previous-controls.zip`，上一批备份也保留。若回滚，先正常 Stop，按备份恢复控制脚本与配置，再重新登记同名启动项并 Start。新增验证模块 `fom_bedrock_block_contract.py` 必须随固定工具部署；带方块包的桥堆上限是 2 GiB，游戏服仍为 6 GiB。游戏世界不需要回滚。

回退本次桥：用上述 Stop 等待子进程退出，再用同目录 `maw_service_task.ps1 -Mode Unregister -FomBedrock -Python E:\MC\runtime\python-3.12.14\python.exe -Config E:\MC\servers\fom-2.42\ops\fom-bedrock.json` 移除本桥启动项。保留桥目录及证据；Java 28976、Mineflayer 28977、世界和原认证库均不需回退。不得据此恢复旧服。

公开验收摘要见 [发布记录](evidence/fom-bedrock-20261016.json)。私有原包、图标、日志、玩家数据和失败原包不上传 Git；资源通过游戏服务下发。
