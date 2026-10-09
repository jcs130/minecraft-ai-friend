# My Agent World：局域网部署与接入

用户 2026-10-06 授权将现有 My Agent World 先开放局域网。现已完成防火墙、冷备、配置切换与健康启动，下表为当前 LAN 入口。使用原 `world-life`、原锁定模组和现有守护器，不重生成世界。旧 Paper 千灯纪、其公网映射、宿主 QwenPaw 和其他角色保持。验收范围见文末，不把本机内网 IP 测试写成另一台实体设备实测。

2026-10-09 增量：独立基岩桥已常驻运行，家庭网段 UDP 放行已读回，5 项健康/冒烟通过；真实手机登录和模组界面待验。路线、运维及实际验收边界见 [基岩桥接](MY-AGENT-WORLD-BEDROCK.md)。本次不重启原世界或改变原三个 LAN 入口。

## 局域网地址

| 用途 | 地址 |
| --- | --- |
| Agent / Mineflayer | `192.168.3.163:28977`，MC 1.21.1、普通离线玩家、自己的原生 SDK |
| 基岩版 | `192.168.3.163`，UDP `28988`；桥与防火墙已配置，真实客户端及模组界面另验 |
| 匹配模组包的 Java 客户端 | `192.168.3.163:28976`，NeoForge 21.1.248 与锁定模组；客户端体验另行验证 |
| 常驻 Agent 网页 | `http://192.168.3.163:28984/` |
| 第三人称 / 地下城视角 | 网页路径 `/third/`、`/dungeon/` |
| 诊断 / 网页健康 | 网页路径 `/diagnostics`、`/healthz` |
| 管理健康、控制邮箱 | `127.0.0.1:28985/healthz` 和本机私有目录，保持仅本机 |

准入范围为家里 IPv4 `192.168.3.0/24`。基岩使用独立 Geyser-ViaProxy 服务，没有新增公网端口。旧服域名不能作为本服入口。离线用户名是家庭调试身份方式，不是外部账号认证；每个 Agent 使用独立名字，避免顶掉其他玩家。当前 `max-players=4` 是配置上限，未声称更大并发容量。

Agent 按 [接入指南](MY-AGENT-WORLD-EXTERNAL-AGENT-GUIDE.md)安装原生适配器和锁定依赖；连接示例的 host 改为 `192.168.3.163`、port 保持 `28977`，版本为 `1.21.1`、`auth: offline`。2026-10-09 SDK 已有 60 项操作（25 只读、35 变更）及 19 个原生频道；通过 `sdk.operations()/operations(id)/call(id,args)` 自查实际能力与必填字段，完整清单见 [原生调用 API](MY-AGENT-WORLD-NATIVE-CALL-API.md)。网页仍观察常驻 MawExplorer 的同连接数据，不能把它当成新 Agent 的画面；新的账号需另接自己的原生观察链。可直接转发的短版见 [局域网连接方法](MY-AGENT-WORLD-LAN-CONNECT.txt)。

## 持久配置

`services/service.json` 使用明确的：

```json
"networkExposure": { "mode": "lan", "address": "192.168.3.163" }
```

Java 的 `server-ip=0.0.0.0` 与 `-Djava.net.preferIPv4Stack=true` 对应此模式；网关 `GATE_LISTEN_HOST=0.0.0.0`、`GATE_LAN_SUBNET=192.168.3.0/24`；worker 的 `MAW_VIEWER_LAN_ADDRESS=192.168.3.163` 显式启用网页 LAN。健康探测继续走本机回环，监督健康和所有写管理操作不对 LAN 开放。

未设置 `networkExposure` 时，守护器继续要求原回环模式。LAN 只允许指定主服务端和私有 IPv4 `/24`，研究服不能开启。监听进程须属于该守护器，并符合对应 IPv4 地址；IPv6 公共监听拒绝。网关还在连接进入协议前核对实际来源网段；网页核对来源、精确 Host 和 Origin，不能只换 Host 就冒充 LAN 用户。

防火墙脚本 `tools/maw_lan_firewall.ps1` 支持 `Plan/Apply/Status/Rollback`。它只管理两个带固定归属信息的规则：允许家里网段访问当前 LAN 地址的 TCP 28976/28977/28984，以及阻止这三个端口的其他 IPv4 源（本机回环除外）。显式阻止避免其他宽泛 Java/Node 规则扩大本次范围；IPv6 不监听。规则先建阻止边界再放行，每次读回实际地址/端口。Windows 写防火墙需要管理员令牌，脚本不代替 UAC 授权。

## 发布与回滚

先完成代码/策略回归与防火墙，再通过拥有对应子进程的 Supervisor 正常停服；确认原玩家退出、Java 存档及所有子进程退出，再做冷备。随后修改持久配置、校验 `plan`，隐藏启动守护器，以独立 requestId 恢复其维护暂停。不要直接结束未知进程，不能将停服受理回执当成存档退出。

主 Agent 的 `autonomy.paused`、旧未知导航与 model-task 原始记录保持。开放服务器不代表其自主决策已恢复；新连接客户端可以独立调用已支持接口。Supervisor 启动仍沿现有 HKCU 用户登录项，登录前开机启动和守护器自身异常退出后的独立重试未验。

回滚使用该次备份的 `service.json/server.properties`；正常停服后恢复原回环配置，重启并读回健康，再由管理员对本脚本的归属规则执行 `Rollback`。不覆盖当前存档来回滚网络设置，也不重放原 Agent 未确认动作。任何不明确的系统授权、停服或启动结果先读回，不能反复提交变更。

## 本轮发布记录

当前阶段：LAN 配置已发布，Java/网关/worker 全部健康，分别为 TCP 28976/28977/28984，IPv4 `0.0.0.0` 监听；管理 TCP 28985 仍为 `127.0.0.1`。新 runId `7e217d1165a3496480d8fd5be764ea76`，Supervisor PID 21656，Java 17072、Gate 14460、worker 27608；PID 是此刻核验值，今后不得据此接管进程。

第一轮 UAC 返回取消的原始失败保留。用户追问权限后重新使用正规 RunAs 提权成功，管理员 helper 的 Apply 回执为 `ok=true`，两条规则的地址、端口、Profile/Action 以及三个已启用防火墙配置均已读回。原 supervisor 正常 shutdown，三个子进程退出 0，服务端记录三维世界全部存档。冷备为 `E:\QiandengJiSocietyLab\backups\lan-release-20261006-1221`，1031 文件、391608625 字节；世界冷备逐文件校验，27 个 JAR 未改变。完成网络配置 plan 后启动新 supervisor，并通过本次独立 requestId 恢复服务器维护暂停。组合启动命令首次被自动审批拒绝，改为分别核验并执行正常启动和专用维护恢复成功；未触碰主 Agent 自主暂停。

防火墙维护示例（此次已完成，不是要求重新执行发布）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'E:\minecraft-ai-friend-society-lab\tools\maw_lan_firewall.ps1' -Mode Status
```

同宿主通过 `192.168.3.163` 实测 Java/网关 MC 协议 767 应答，普通非 OP `MawLanQA1006` 独立登录网关，`menu.current/native.recipes/colony.capabilities` 三项真实调用通过，回执均为本人 UUID，零串号，正常退出。没有 give/TP/OP 或模型调用。探针集成产生一条已有有限 spawn listener 阈值警告，原始输出保留；不将它写成服务端错误或隐去为零日志异常。

同宿主 LAN IP 的网页首页、第三人称、地下城视角、诊断、健康、样式和脚本均 HTTP 200，SSE 身份为原 MawExplorer UUID；错误 Host/Origin 实际返回 403。主 Agent 配置、autonomy.paused/model-task 原字节与账本原前缀保持，旧 25565 两实例及宿主 8088 监听归属不变。尚未用另一台实体电脑/手机实测 Wi-Fi 登录，也未用匹配 Java 模组客户端重新验收完整画面或游戏内容；公网、基岩入口与完整模组玩法就绪不因本次网络发布而变为已完成。

回归：29 项守护器、344 项 Agent/网关、34 项网页网络/宿主测试通过，零失败、零跳过。私有初次计划、原配置和失败保存在 `research/lan-release-20261006/`；成功提权、停启、冷备、LAN Agent/网页原始结果与 `acceptance.json` 在其 `admin-retry-1221/`。此轮 shutdown/resume 维护已结束，旧 requestId 不得重放。不提交密钥、存档、完整私有库存或旧未知回执到 Git。
