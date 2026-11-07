# Geyser 新版基岩局域网发现

状态：2026-11-07 16:51正式部署完成；真实手机发现/登录仍待验。部署结果另见 [运维记录](../../docs/BEDROCK_LAN_20261107.md)。

Bedrock 26.60 起使用 NetherNet。正式服已有 HTTP 信令与 WebRTC，旧 RakNet Pong 仍成功，但官方 Geyser 尚未启动 UDP 7551 的 LAN discovery。只开旧 UDP 19132 不能让新版手机在局域网世界列表中发现它。上游问题见 [Geyser #6853](https://github.com/GeyserMC/Geyser/issues/6853)，协议见 [Mojang NetherNet guide](https://mojang.github.io/bedrock-protocol-docs/guides/nether-net-onboarding-guide/)。

本候选固定官方 Geyser 2.12.1 build1295 / `1955f5151e2af01a7b51db1679e4324345690e70`，继续保留现役 Youer lambda lookup 修复，增加可选的 Cloudburst 原生 LAN transport。不能将此补丁直接应用到未知上游版本。

## 配置与端口

`plugins/Geyser-Spigot/lan-discovery.properties`：

```properties
enabled=true
cidr=192.168.3.0/24
discovery-port=7551
ice-port=19134
```

无文件或 `enabled=false` 时不启动。本机 UDP 7551 用于同网段广播发现，UDP 19134 用于该 LAN 连接的数据传输；防火墙只放家庭网段及固定 Java 程序，不做公网映射。公网仍使用原域名端口19140的 HTTP 别名、原19133 WebRTC；旧版 RakNet19132 保持。不能把 LAN ICE19134 与既有 HTTP ICE19133 重复绑定。

`validate-bedrock-login=true` 为硬条件；Waterdog 身份转发不可混用。公网 HTTP/NXS、RakNet、已有签名的 SDP 身份绑定保持上游验证。部分 LAN 客户端的 SDP 不附身份，此时仅限 `SIGNALING_LAN` 来源，并在上游已验证 Mojang 身份链和客户端 JWT 后，校验该 IP 最近的广播 nonce。nonce 每30秒轮换、90秒有效，已验证载荷摘要不可重放，最多256地址与4096摘要。不是匿名/免 Xbox 登录，也不是把公网缺失身份绑定视为成功；此路径并不声称具有 SDP 指纹绑定，限制为显式家庭网段。

## 构建与验收

使用 Java21 与现役 Youer libraries；构建目录必须为新建的非生产目录：

```text
python build.py --upstream <官方Geyser-Spigot-1295.jar> --server <隔离Youer目录> --jdk <JDK21> --output <新输出目录>
```

完整官方 JAR SHA256、三个原始类摘要与调用位置均固定；除这三个原条目和四个新增 helper 类外，20913条目保持。内置25项 admission、4项 lookup检查，重复构建产物相同。上游升级必须重新审查，不得修改摘要白名单以跳过验证。

真实协议验收包括 LAN ServerData v6/v7、子网广播、WebRTC/DTLS/SCTP、协议2225的 RequestNetworkSettings→NetworkSettings、正常停启恢复。`LanTransportProbe` 只到网络设置，**不等于手机已完成 Xbox 登录**。`bedrock-resources.integration.mjs` 只允许显式隔离标记、loopback、LAN关闭的测试实例；使用合成身份验证完整资源字节、世界区块、背包与普通命令，不可在正式服关闭验证运行它。

`paper/ops/bedrock-network-health.mjs` 并行检查 HTTP 元数据与实际 UDP7551 回包。旧 RakNet 和新协议检查共同接入原 Watchdog，原连续失败阈值和一次恢复限制保持。健康成功不代表完整游戏登录、手机像素、Xbox 或 Switch 验收。

## 回退

正常通知、停服、E/F当前游戏与认证冷备后再替换 Geyser、配套外观扩展及运维脚本；保留现有 `nethernet/identity.pem`、Floodgate key与账号数据库。回退仅换回原代码、禁用/移除本次 LAN配置，并按精确规则名移除本次创建的两条LAN规则；不能回灌旧角色数据或重用已消费维护入口。保留旧版资源包与模型，不重置玩家身份。
