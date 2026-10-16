# My Agent World FOM 运维

2026-10-14 用户要求用《命运齿轮》替换未完成的 NeoForge 服务器。生产服为 `E:\MC\servers\fom-2.42`，不是 `E:\QiandengJiSocietyLab\server`；旧 Paper 千灯纪保持独立。

## 发布版本和入口

| 项目 | 固定值 |
| --- | --- |
| 整合包 | FOM 2.42，Modrinth 项目 `fom4Ovsz`、版本 `wWYmnFIR` |
| 游戏 / 加载器 / Java | 1.21.1 / NeoForge 21.1.248 / Temurin 21 |
| 公网 / LAN | micro.kangqiang.site:28976 / 192.168.3.163:28976 |
| 游戏监听 | 0.0.0.0:28976 TCP |
| 只读健康 | 127.0.0.1:28985/healthz |
| 物理同步 | Sable 官方 TCP 回退，共用游戏连接 |
| JAR | 原包服务端 94 + MixAuth 1.3.3 + FOM Server Support 0.2.0 + 内容扩展 6，共 102 |
| 客户端 | 原包 121 + 本机 Agent 可选 3 + 内容扩展 6，共 130；作者 10 个禁用文件保持 |
| 内存 / 距离 | Java 最大 6144 MiB，视距 6、模拟距离 4、最多 8 人 |

不开放 MCP、RPC 或 RCON。复用原有 Java WAN 转发及 Windows 规则，未修改路由器、未开放新端口。2026-10-15 在原 28977 端口启用 **FOM 基础 Mineflayer 兼容网关**，仅允许本机及家庭局域网的 `ag_` 账号，由同一服务守护管理；这是更新后的 FOM 映射，详见 [接入说明](MY-AGENT-WORLD-FOM-MINEFLAYER.md)。2026-10-16 新的独立 FOM 基岩桥使用原 UDP 28988，见下文；旧 35 模组服、旧 Agent 控制器、旧基岩桥和语音 28989 仍停用。

## 文件布局和日常操作

- `server/`：原生游戏目录、mods、world、配置、MixAuth 认证库。
- `ops/service.json`：唯一生产服务配置。
- `ops/mods.lock.json`：102 个服务端 JAR 的 SHA256。
- `ops/content-release.json`：2026-10-15 内容发布、增量包与双盘冷备记录。
- `ops/service-tools/`：固定发布的六个管理脚本及源码哈希清单。
- `ops/fom-service/`：私有信箱、回执、锁、心跳、维护标记和轮转日志，DACL 限本用户、SYSTEM 与管理员。
- `E:\MC\runtime\python-3.12.14/`：从既有可信运行时逐文件校验后独立复制的标准库运行时及许可证，不依赖 Codex 缓存或研究 venv。

根目录三个批处理调用 `ops/service-tools/fom_control.ps1`：

```powershell
# 明确启动/解除维护暂停；已有健康进程则读回，不重复启动
.\ops\service-tools\fom_control.ps1 -Action Start
# 正常存档并退出管理进程，保留维护暂停
.\ops\service-tools\fom_control.ps1 -Action Stop
.\ops\service-tools\fom_control.ps1 -Action Status
.\ops\service-tools\fom_control.ps1 -Action Health
```

命令通过本机文件信箱进入拥有该 Java 子进程的管理进程，不按进程名猜 PID，不接管其他 Java。耗时操作保留 requestId 回执；pending 时查原 ID，不换 ID 重复执行。

控制台示例：

```powershell
E:\MC\runtime\python-3.12.14\python.exe .\ops\service-tools\fom_service.py console --config .\ops\service.json --command "list"
```

Java 通过标准输入 `stop` 正常停机。Java 意外退出由原有 owned-child Supervisor 重启，指数退避，每小时最多启动六次。模组、身份配置或关键网络策略改变时暂停，避免无限重试。人工停止后的 `paused.json` 是维护意图，不靠删除文件恢复；使用明确 Start/resume。

HKCU 登录启动项 `MyAgentWorld.FOM.Service.28976` 指向固定管理脚本和独立 Python。在当前用户登录 Windows 后运行，尚未部署登录前系统服务或管理进程自身自动复活。管理进程异常退出时 Windows Job 仅结束自己拥有的子进程，可能需要检查未正常存档；不等同于优雅停服。

## 账号与权限

MixAuth 是密码和正版会话的权威，FOM Support 复用现有 `PlayerAuthBridge.java`，不另写密码数据库。旧 MixAuth 数据在旧 Java 正常退出后冷复制到新服，原库和备份保留。没有迁移旧 OP 名单，新服 `ops.json` 为空。

首次离线访客允许游玩并提醒 `/password 新密码 再输一次`，以后用 `/login 密码`。同 IP 信任时间零、bcrypt cost 12、最短 8 字符。`/register` 是兼容别名；MixAuth 初始注册提示后会跟随本服访客说明。正版客户端沿用正版会话校验；本轮实际验收覆盖离线账号，未重新验证微软正版外网登录。

`/fom status` 私下查询本人认证状态与绝对坐标；`/fom auth <在线玩家>` 仅 OP4/控制台。控制台可用 `execute run fom auth FomPublicQA`，输出 `MC_FOM_AUTH` JSON，无口令、哈希或 nonce，不向其他玩家广播。

## 备份和升级

原包 SimpleBackups 已启用：每 120 分钟完整世界备份、最多 10 份、上限 25 GB、备份前保存。玩家离开后允许一次无人备份。本次实际生成 ZIP 已作 CRC 检查。

世界自动备份不是完整发布备份。升级前通知玩家并正常停止，备份 `world`、`config`、`defaultconfigs`、`mixauth`、属性/权限文件和 `ops`，连同模组锁及脚本保留校验。认证库在游戏停止后复制。凭据、存档、第三方 JAR、截图和运行信箱不加入公开 Git 或客户端分发。

先用研究目录、独立端口和世界副本测试。不要单独升级 Create、Sable、Aeronautics 或加载器；客户端与服务端统一更新整包。`tools/build_fom_support.py` 使用确切 NeoForge 21.1.248 patched server classpath 构建并输出源码哈希。经过验证后更新部署脚本副本和 `release.json`，运行中的脚本不随源码 checkout 自动改变。

配置写正常 UTF-8/LF。首次发布曾因 bytes 解码后写回产生重复 CR，NightConfig 重置 Sable；守护程序正常停止，失败配置和日志保留。已修复换行并通过后续启动。不能忽略加载器自动修复配置的日志。

## 健康和验收

```powershell
python world/ops/health/health_mon.py --society-fom-smoke
python tools/fom_health.py --config E:\MC\servers\fom-2.42\ops\service.json
```

探针检查发布哈希、认证策略、物理 TCP 策略、拥有者心跳、原生 protocol 767 应答、游戏绑定与认证库。HTTP 只读且绑定回环；实际监听另在发布验收中检查。健康通过不等于所有模组玩法通过。

隔离认证闭环、普通完整客户端的正式入口登录、实际移动、Create 原生界面、截图与 SDK API 已通过。GUI 测试用预设工作台/材料及管理员夹具，不计自然生存或长期自主学习。完成动作 ID 去重使用原身份原账本，旧 unknown 不重投。外部状态查询看到新 MOTD，真实外网玩家完整模组登录及大型载具延迟仍待验证。

启动日志有原包已有的可选兼容 mixin 和未安装联动掉落表错误，不能称零错误。保留原包，未靠删除玩法模组掩盖。Lithium 单碰撞方法 JIT 排除已记录，未证明上游根因或性能提升百分比。`allow-flight=true` 避免模组载具移动误判，不授予创造飞行能力。

## 旧服归档与回滚

旧主服、AgentGate、worker、Bedrock、compat_gate 均由原管理入口正常退出。两条旧 HKCU 启动值设为空串，原值在私有 `registry-before.json` 留存。旧角色原地保留，旧 Agent 自主暂停及 unknown 未解除。

冷备：`E:\QiandengJiSocietyLab\backups\fom-takeover-20261014\unfinished-my-agent-world-cold.zip`，6,900 文件、636,603,560 字节，CRC 和每文件 SHA256 全部校验。原 35 个 JAR、受保护配置及 JSONL 历史前缀保持。

回滚到旧栈前，先按基岩运维说明正常停止独立 FOM 基岩桥并停用它的启动项，确认 UDP 28988 释放；再正常停止新 FOM，确保 28976/28985 释放，停用新 FOM 登录启动项，再按记录恢复两条旧启动值，用旧管理入口启动旧主服/基岩桥。旧 shutdown 的维护暂停通过明确 resume 解除。旧 MawExplorer 自主暂停是另一个意图，不能随基础服务回滚解除；未知动作继续按原证据对账。

旧 Paper `E:\MC\server`、宿主 QwenPaw 及其他非本次服务不在替换范围。原型 `ops/server_manager.py` 的 39171 入口已退役，请用新根目录批处理。

## FOM 基岩桥（2026-10-16）

独立基岩桥已上线，公网/家中 UDP 28988，共用现役 FOM 世界。配置 `ops/fom-bedrock.json`，控制脚本 `ops/bedrock-service-tools/fom_bedrock_control.ps1`；独立 owner 和 HKCU Run 启动名 `MyAgentWorld.FOM.Bedrock.28988`，支持正常停启、持久暂停、子进程退避与健康冒烟 `--society-fom-bedrock-smoke`。只更新此桥可不重启游戏服。安装范围、资源包边界、失败证据和独立回退见 [基岩运维说明](MY-AGENT-WORLD-FOM-BEDROCK.md)。原桥继续暂停，不能用原桥启动脚本替代。

## 后续兼容边界

FOM 当前用完整 Java 客户端原生渲染交互。远程 Agent 在自己的电脑运行客户端和自研核心，经游戏 TCP 入服；桥 RPC 留在本机回环并用 bearer，服务端不需要 MCP。普通玩家不用三个 Agent 组件。

Mineflayer 基础 registry 翻译已在 FOM 发布，见 [基础接入](MY-AGENT-WORLD-FOM-MINEFLAYER.md)。烹饪、女仆和 Iron 法术内容已通过独立候选及正式服检查，2026-10-15 发布，见 [内容扩展](MY-AGENT-WORLD-FOM-CONTENT.md)。

旧网页资源、Numen、千灯纪技能/公会/试炼、殖民地和距离语音未迁入当前 FOM。基岩现有独立的部分兼容入口，旧模型/表单/语音扩展未迁入。新内容必须按实际整包注册表与协议适配，并验证真实画面和操作。
