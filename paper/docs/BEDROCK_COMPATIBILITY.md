# 基岩版接入与版本维护

## 2026-10-08：1249 构建已验证，等待维护切换

正式服目前仍为 **Geyser 2.11.3-b1247**，支持基岩 26.30～26.34、26.40～26.45、26.50、26.51。**2.11.3-b1249 已下载并在独立目录与端口验证，尚未部署正式服**；新增 26.52 支持。真人 LittleFish0510 在线，已请求选择维护时机，没有把这个账号加入服务账号名单或直接断开。

候选来自 [Geyser 官方下载 API](https://download.geysermc.org/v2/projects/geyser/versions/2.11.3/builds/1249)，Spigot JAR 为 47,170,037 字节，SHA256 `39d8a45eca9f2413080b9597c67d1b2bf3bc9b62e8577f46eb83c9c8abfc4499`。官方构建提交 `f66329d9d21b3c836edc014fbb9d8312fbe34285` 登记以下基岩客户端版本：

| 协议族 | 客户端版本 |
| --- | --- |
| 1001 | 26.30、26.31、26.32、26.33、26.34 |
| 2168 | 26.40、26.41、26.42、26.43、26.44 |
| 2169 | 26.45 |
| 2193 | 26.50、26.51、26.52 |

这不是所有历史基岩版本的兼容层。官方目前支持范围与旧 Java 服务端接入方式见 [版本说明](https://geysermc.org/wiki/geyser/supported-versions/)。手机、Windows 基岩版与主机使用基岩协议；Xbox、PS、Switch 添加第三方服务器仍需连接器等入口，见 [主机接入说明](https://geysermc.org/wiki/geyser/using-geyser-with-consoles/)。

## 验证与发布

隔离服使用同一个 Paper 1.20.6、现役 Floodgate 2.2.5-b141、ViaVersion/ViaBackwards 5.12.1-SNAPSHOT，在回环 TCP 25568/25588、UDP 19134 上验证。7 项通过：实际载入 1249、运行时报告支持到 26.52、现役 Floodgate 与 ViaVersion 正常载入、基岩 UDP 返回有效 MCPE Pong、原版 Java 1.20.6 客户端出生并在后端在线名单出现。已正常停服。

维护脚本新增只替换 `Geyser-Spigot.jar` 的待发布计划，在 E 盘完整快照与 F 盘哈希校验镜像完成后执行；新旧 JAR 哈希均校验，旧文件改名保留，失败归档计划，成功保存应用回执。离线文件夹夹具 6 项通过，包括错误哈希拒绝、正确安装、旧 JAR 保留、计划消费和无关配置保持。既有真人门禁和游戏代码发布的活动试炼门禁保持；仅替换 Geyser 的普通重启使用原有 AgentFriend 检查点恢复，不取消挑战。源码同时补记此前服主已确认的精确 `ag_NEKO` 服务账号例外。

维护时先确认真人已离线；若服主明确选择立即维护，须先保存、告知并断开对应真人，再由原 `Afu-MC-DailyBackup` 正常停服、备份、替换和启动。不要修改服务名单来把真人伪装成 Agent，不用 `/reload`。待发布计划为运行机私有 `ops/geyser-deploy.pending.json`，本次尚未写入。上线后须重新查询 `geyser version`，核对 Java/LAN/基岩入口、原 Agent 与 Eye、普通难度、三维度 keepInventory 和 NEKO 签名皮肤。未完成这些步骤前不标记已部署。

配置、Floodgate 密钥、白名单、世界、职业与委托账本及 Agent 客户端不随此次接入插件升级替换。基岩 Pong 与服务端版本报告不代替真实手机/Xbox 的登录、画面或手柄验收。

公开候选记录见 [1249 清单](../manifests/geyser-2.11.3-b1249.json)。官方 JAR、新旧原件、阶段回执和失败预检保存在 E/F 私有 `repairs/geyser-update-20261008`，不提交第三方 JAR、运行配置或日志。代码回退仍需正常停服备份，只恢复旧 Geyser JAR，不以旧世界或旧插件数据库覆盖新的玩家进度。
