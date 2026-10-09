# My Agent World：基岩版局域网桥接

2026-10-09：独立 ViaProxy + Geyser 桥已常驻运行，家庭网段 UDP 防火墙放行已读回。5 项健康/冒烟检查、协议转换和进世界收取区块、背包的 Java 侧测试通过；真实手机登录和模组操作未验收。不要把发现响应当作完整基岩客户端游玩成功。

## 入口与链路

| 用途 | 地址 |
| --- | --- |
| 基岩版添加服务器 | 名称 `My Agent World`，地址 `192.168.3.163`，UDP 端口 `28988` |
| 桥的 Java 转换端口 | `127.0.0.1:28995`，仅本机 |
| 基岩独立兼容网关 | `127.0.0.1:28994`，仅本机，与 Agent 原生网关分开 |
| 桥的管理健康 | `http://127.0.0.1:28996/healthz`，仅本机 |
| 原 Agent 网关 | `192.168.3.163:28977`，Mineflayer 1.21.1 / offline，保持原 SDK 接入 |
| 原 Java 模组客户端 | `192.168.3.163:28976`，匹配 NeoForge 及锁定模组包 |

链路：基岩 RakNet → Geyser-ViaProxy → ViaVersion 的 Java 版本转换 → 独立 28994 兼容网关的 NeoForge 握手与号表映射 → 原 `world-life`。该网关复用原代码和同一套锁定号表，使用自己的协商缓存，不改变 Agent 的 28977 原生通道。Mineflayer 兼容的是 Java 协议，因此基岩端仍需要 Geyser。[官方支持版本说明](https://geysermc.org/wiki/geyser/supported-versions/)与 [ViaProxy 部署说明](https://geysermc.org/wiki/geyser/setup/self/viaproxy/)提供该组合的依据。

新 UDP 监听只绑定 `192.168.3.163`，IPv6 不监听；显式防火墙规则仅允许 `192.168.3.0/24`，另阻止其他 IPv4 源。没有路由器映射或公网发布，不占用旧 Paper 的 19132/19140 或现有其他 UDP 服务。原 Java、网关和 worker 本轮均未重启。

基岩端使用已有号表的兼容方块/物品表示，尚未添加本模组包专用的基岩资源映射。网页的原始 NeoForge 贴图、模型和原生 GUI 适配不能自动变成基岩能力。模组特有界面、女仆/YSM 外观、Create 动态结构及法术效果需逐项实测；不能据入口可用宣称全部可玩。[Geyser 自定义物品文档](https://geysermc.org/wiki/geyser/custom-items/)要求另外提供相应映射和基岩资源包。Agent 仍用其本人 Mineflayer 连接和原生 SDK。

28994 独有 `GATE_BEDROCK_PROJECTION=1`：按该连接收到的真实 NeoForge FrozenRegistrySnapshot 还原标签、属性和原版实体 ID，不把原始模组号交给 ViaVersion；没有基岩定义的模组实体暂不发送，其后续 metadata 也不发送，避免错读成其他生物。这意味着部分模组 NPC/敌人暂不可见，不能宣称模组战斗可用。原网关有意跳过的模组配方流未被伪造为已支持：向转换层声明空配方目录，配方书及实际合成必须另外验收；原 Agent 原生配方 SDK 保持。普通包转换异常仅结束该连接，不使网关进程退出。

## 入服自动下载资源

已启用 `enable-integrated-pack=true`、`enable-custom-content=true` 和 `force-resource-packs=true`。这是 Geyser 基础兼容资源的自动下发配置；真实手机的下载提示/完成尚未实测。连接时若提示资源下载，应选择“下载并加入”。当前没有冒充整套模组已转换的空白自制包。

玩家在其他服务器看到的自动下载通常是基岩资源包；基岩原生附加包还可以包含行为内容。Java 的 NeoForge JAR 不能交给基岩版直接运行。后续本服专属的贴图/模型/声音包放在 `bedrock/plugins/Geyser/packs/*.mcpack`，自定义物品映射放在 `custom_mappings/*.json`（或对应 Geyser 扩展），正常重启本桥后随登录发送，不必重启主世界。[官方资源包下发说明](https://geysermc.org/wiki/geyser/packs/)明确支持本地包并要求先转换为基岩格式。资源转换、物品/方块/实体映射和原生交互是三项独立验收；下载完成不能替代玩法验收。

## 运行与维护

运行目录 `E:\QiandengJiSocietyLab\bedrock`；配置 `services\bedrock.json` 只声明固定 LAN 地址和 UDP 端口。`tools/maw_bedrock_service.py` 锁定桥接 JAR 与完整 Geyser 配置，启动时校验 SHA256，运行时发现文件变更暂停桥接。Geyser 的基岩登录校验保持开启，Java 后端沿现有家庭 LAN 的 offline 配置。

复用原 `maw_service.py` 的进程归属、Windows Job、私有控制邮箱、日志轮转、受限退避重启及维护暂停；同一桥 Supervisor 依次管理兼容网关和 ViaProxy/Geyser，停止时反序退出，主服使用独立 Supervisor。停止桥不会停主世界。新增 HKCU 用户登录项 `MyAgentWorld.Service.28995`，以隐藏的 pythonw 启动；登录前启动、Supervisor 自身崩溃后自动拉起及实际重启机器尚未验收。不能将子进程守护写成已经实现系统级高可用。

在仓库根目录用既有 Python 运行：

```powershell
$py = 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py tools/maw_bedrock_service.py status
& $py world/ops/health/health_mon.py --society-bedrock
& $py world/ops/health/health_mon.py --society-bedrock-smoke
```

健康探针核对新鲜守护状态、所属 Java/UDP 监听、RakNet Pong、锁定文件及实际防火墙规则；冒烟只检查新基岩入口，不改历史服务验收。健康不等于真实基岩登录或完整模组验收。

只读查看防火墙：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/maw_lan_firewall.ps1 -Mode Status -Bedrock
```

管理员终端中执行同脚本 `-Mode Apply -Bedrock` 可建立两条专属规则；需要 Windows 管理员令牌。本轮第一次 UAC 被取消的失败记录保留，用户明确要求重新弹窗后第二次正常 RunAs 成功，两条规则读回符合配置，原 TCP 规则保持。`Status` 也严格核对两条规则的名称归属、协议、动作、地址和端口，不以命令成功代替规则存在。

正常停止或恢复桥接使用独立 requestId：

```powershell
& $py tools/maw_bedrock_service.py stop --request-id '<新的维护ID>'
& $py tools/maw_bedrock_service.py status
& $py tools/maw_bedrock_service.py resume --request-id '<新的恢复ID>'
```

`stop` 保留暂停和 Supervisor；等其 `pid=null`、退出回执确认后再维护文件。`shutdown` 正常退出本桥 Supervisor。用户登录启动注册/启动使用 `tools/maw_service_task.ps1 -Bedrock -Mode Register|Start -StartupMethod Run -Python $py -Config 'E:\QiandengJiSocietyLab\services\bedrock.json'`。回滚先 shutdown 并确认退出，再用该 helper 的 `-Mode Unregister -Bedrock` 撤销本桥启动项，最后管理员执行防火墙脚本 `-Mode Rollback -Bedrock`；保留运行日志，不修改主服配置或覆盖存档。

## 固定来源与验收

| 组件 | 版本 | SHA256 |
| --- | --- | --- |
| [ViaProxy](https://github.com/ViaVersion/ViaProxy/releases/tag/v3.4.14) | 3.4.14，标准 Java JAR | `2894bbfb2f4342f8fde887af6c689313efd5b0e46a8006775eea0e21e2948ab5` |
| [Geyser-ViaProxy](https://download.geysermc.org/v2/projects/geyser/versions/2.11.3/builds/1249) | 2.11.3 build 1249，f66329d9 | `b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7` |

实际 Pong 为基岩协议 2193、版本 26.52，名称 My Agent World、上限 4。使用 Geyser 自带 Java codec 776（26.2）的普通非 OP 测试账号，经正式转换端口进入原世界，首轮修复后收到 login=1、chunk=9、inventory=1；最终加入正常区块批次 ACK 并停留 15 秒，收到 45 个区块和背包数据、正常退出 0，零模型调用、没有授予物资或传送。该测试覆盖 Java 转换到 1.21.1（767）的实际 PLAY 流，仍不等于 Xbox/RakNet 完整登录。

36 项守护器、协议、配置和健康边界测试及 49 项网关回归通过，零跳过。首次直接连接原 Agent 网关产生 10912 条警告和 1 条配方 ERROR，随后独立投影首轮遗漏空 bundle 导致本桥网关异常退出；两份失败和自动守护恢复记录完整保留。已根据真实 FrozenRegistrySnapshot 修复标签/属性/实体投影与空包处理，修复后桥的当前进程 ERROR=0，仅保留新版可用/配置弃用两条启动警告。初次单元测试/编译参数失败和独立 Java 探针的 Log4j `ip_redactor` 布局缺失诊断也保留。原始包、JAR、缓存、运行私有日志与验收证据位于仓库外 `research\bedrock-gateway-20261009`，不上传 Git。原 world-life、27 模组、主角色自主暂停、未知动作与历史账本保持；不恢复或重试原自主任务。
