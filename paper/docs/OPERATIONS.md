# Paper 分支维护与发布

此文档描述源码分支与当前 Windows 家服的关系。仓库是代码及配置基线；正式存档和玩家状态只保存在 `E:\MC\server` 以及已校验备份中。完整本机维护记录仍在 `E:\MC\ops\MAINTENANCE.md`。

## 日常检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Status
node E:\MC\probe\rcon.mjs mspt
node E:\MC\probe\agent-lan-smoke.mjs
node E:\MC\bedrock-ping.mjs 192.168.3.163 19132
```

`Status` 应同时显示 Paper、Agent 网关、Geyser Pong、Goddess 桥、CortiEyeMirror、最近 E 盘快照及 F 盘镜像。Pong 和状态包不是基岩真机、Agent 具体动作或直播画面的端到端验收。

## 变更顺序

1. 对照 [安装内容锁](../manifests/installed-content.lock.json) 和当前服务端文件，确认要修改的源码、配置或第三方版本。AgentFriend 目录的 0.3.3 源码是候选，生产仍为 0.3.2。
2. 在独立服务端目录及端口构建、测试插件和跨端行为。自研 JAR 不提交 Git；第三方 JAR/数据包从原发布处取得并按哈希核验。
3. 检查没有真人玩家在线，执行 `manage-server.ps1 Backup`。备份会在只有服务账号在线时正常停服约半分钟，写 `.complete` 后重启，再复制到独立 F 盘。若 F 盘镜像失败，可在不重启游戏服的情况下单独执行 `Mirror`。
4. 停服、替换单一启用版本的插件/配置、正常启动；用 Java、基岩、Agent、CortiEye 四条路径复测。不要用 `/reload` 加载新的插件代码。
5. 保存源码修改、版本锁和测试说明到此分支，推送同一分支。运行日志、`server.properties` 实值、`ops.json`、Floodgate 私钥、玩家数据库与世界不提交。

## 当前自动恢复

`Afu-MC-Watchdog` 开机及每分钟执行：验证 Java/RCON、Agent 网关、女神单实例、观战绑定和基岩 Pong。基岩连续三次失败，且无人类玩家在线时，才尝试一次完整重启；持续故障不会每分钟或每半小时重启。自动启动暂停标志用于计划停服。`Afu-MC-DailyBackup` 每天 04:00 尝试快照；在线名单中出现真人或读取异常时跳过。

## 恢复

备份目录为 `E:\MC\backups\scheduled\<时间>` 和 `F:\MC-backups\scheduled\<时间>`。只选择带 `.complete` 的快照；F 盘镜像在校验后才写此标记。先停服，把现有服务端目录另存，再从同一快照恢复 `server/`；管理脚本损坏时，还原该快照的 `ops/`、`probe/`、`root/`。恢复世界会舍弃快照之后的进度，因此需要保留事故现场副本。异盘快照能应对 E 盘故障，不能应对整机损毁。

## 公网与身份边界

Paper 使用离线模式供本机 Mineflayer 与 Floodgate 连接，所以 Java 后端必须继续绑定回环。局域网 Agent 网关只接受可信来源，并拒绝 OP 名称；公网 Java 接入需要单独的身份验证入口。基岩由 Geyser/Floodgate 接入，服务端白名单仍开启。不要把 `rcon.port`、Floodgate 密钥或未验证身份的 Java 端口直接发布到公网。
