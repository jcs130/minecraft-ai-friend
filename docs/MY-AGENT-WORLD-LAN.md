# My Agent World：局域网部署与接入

用户 2026-10-06 授权将现有 My Agent World 先开放局域网。使用原 `world-life`、原锁定模组和现有守护器，不重生成世界。旧 Paper 千灯纪、其公网映射、宿主 QwenPaw 和其他角色保持。这里是局域网配置说明；地址只有在文末发布验收完成后生效，不能用计划替代实际开放。

## 局域网地址

| 用途 | 地址 |
| --- | --- |
| Agent / Mineflayer | `192.168.3.163:28977`，MC 1.21.1、普通离线玩家、自己的原生 SDK |
| 匹配模组包的 Java 客户端 | `192.168.3.163:28976`，NeoForge 21.1.248 与锁定模组；客户端体验另行验证 |
| 常驻 Agent 网页 | `http://192.168.3.163:28984/` |
| 第三人称 / 地下城视角 | 网页路径 `/third/`、`/dungeon/` |
| 诊断 / 网页健康 | 网页路径 `/diagnostics`、`/healthz` |
| 管理健康、控制邮箱 | `127.0.0.1:28985/healthz` 和本机私有目录，保持仅本机 |

准入范围为家里 IPv4 `192.168.3.0/24`。没有新增基岩服务或公网端口。旧服域名不能作为本服入口。离线用户名是家庭调试身份方式，不是外部账号认证；每个 Agent 使用独立名字，避免顶掉其他玩家。当前 `max-players=4` 是配置上限，未声称更大并发容量。

Agent 按 [接入指南](MY-AGENT-WORLD-EXTERNAL-AGENT-GUIDE.md)安装原生适配器和锁定依赖；连接示例的 host 改为 `192.168.3.163`、port 保持 `28977`，版本为 `1.21.1`。`sdk.operations()/operations(id)/call(id,args)` 的 30 项绑定和参数不变。网页仍观察常驻 MawExplorer 的同连接数据，不能把它当成新 Agent 的画面；新的账号需另接自己的原生观察链。

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

当前阶段：策略代码与测试通过，但本次 Windows UAC 启动返回“操作已被用户取消”。读回两个所属防火墙规则均不存在；原服务继续回环运行，LAN 尚未开放。没有开始停服、更改正式配置或解除 Agent 自主暂停。

管家机上以管理员身份打开 PowerShell，执行以下已准备好的防火墙步骤即可解除这一发布阻碍；它只设置本页列出的三个端口，不修改路由器或旧服：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'E:\minecraft-ai-friend-society-lab\tools\maw_lan_firewall.ps1' -Mode Apply -ReceiptPath 'E:\QiandengJiSocietyLab\research\lan-release-20261006\firewall-applied.json'
```

完成后维护者必须核对回执和实际规则，继续上述冷备、配置切换及新进程验收；执行防火墙脚本本身不等于 LAN 已开放。预备配置 `research/lan-release-20261006/service-lan.json` 和 `server-lan.properties` 不用于当前运行进程，不能在守护器仍运行时直接覆盖正式配置。

回归：29 项守护器、344 项 Agent/网关、34 项网页网络/宿主测试通过，零失败、零跳过。私有计划、原配置、暂停/model-task/账本基线及原始结果保存于 `research/lan-release-20261006/`；不提交密钥、存档、完整私有库存或旧未知回执到 Git。
