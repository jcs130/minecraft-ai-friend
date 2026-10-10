# YSM 服务启动维护与回退

生命周期代码接入原 `manage-server.ps1`，正式生效状态见 [YSM适配](YSM_ADAPTATION.md) 和 [版本说明](SERVER_UPDATES.md)。维护、Watchdog、网关和女神共用同一配置；不新增计划任务或公网入口。

## 服务关系

原身份网关继续核验来源、保留账号及Agent/Eye名单。启用后只将已经核验的Java连接转至回环Velocity，再进入原Paper。Geyser/Floodgate继续原Paper入口。女神使用同一私有Velocity端口，以便相机收到实际模型元数据和资源。

Proxy固定512MiB堆、Worker固定768MiB堆和4个可见处理器；Paper原预算保持。Worker只运行YSM模型世界，不承载正式游戏世界，view/simulation均为2，关闭自然动物/怪物/NPC生成。普通Agent不订阅时不收原生模型缓存或网页资产块。

## 配置与控制

私有 `ops/ysm-services.json` 包含服务根目录、启动JAR摘要、端口、预算和本机控制凭据，不能提交Git。正式端口为127.0.0.1上的25581代理、25582模型Worker、25583内部控制器和25584生命周期控制；原公网地址和端口保持。`enabled=false`时网关和女神沿用原Paper路径。

生命周期控制只接收本机连接，并验证随机64位十六进制凭据。管理员在主机使用：

```text
node ops/ysm-services-control.mjs status
node ops/ysm-services-control.mjs console proxy appearance list
node ops/ysm-services-control.mjs console proxy appearance admin set <在线玩家> <模型ID> <贴图ID>
```

控制器的成功回执仅表示已提交命令；实际分配须核对Worker确认的 `mcagent:appearance`、`appearance-state.json`，以及基岩扩展的实际应用状态。控制端默认读取自身目录的配置，防止隔离测试误操作正式实例。

原始模型放入该Worker实际 `config/yes_steve_model/custom`，两次稳定扫描后更新目录。保留原始文件夹或ZIP的授权声明，公有源须 `spec:2/free:true`；加密模型需作者另给可分发源。原模型转换、资源预算及动画限制见 [集成说明](../integrations/freesia-optional/README.md)。上线服务不会自动为所有玩家选一个新模型。

## 单实例与故障恢复

生命周期先独占本机控制端口，再启动两个JVM；重复启动不额外派生JVM。每个JAR在启动前校验摘要，端口被其他进程占用时拒绝接管，不按端口杀进程。

子服务异常退出按15秒基数指数退避恢复，首次快速失败等待30秒，持续快速失败时上限300秒。Worker暂时不可用时，原游戏连接继续；模型状态过期后回到普通外观，恢复后限频重建模型连接。Proxy故障会断开经过它的连接，恢复后客户端按原重连方式返回。

Windows Job容纳监管进程及其两个JVM。正常停止依次提交Proxy的 `shutdown` 和Worker的 `stop` 并等待存档。监管进程或启动器意外崩溃时，Job清理其子JVM，避免留下孤儿占用端口；此时按崩溃恢复处理，不能声称最后一刻的模型改动已经保存。原Paper、网关和其他Java服务不在这个Job里。

## 备份与发布

原维护锁继续串行化操作。停服先关闭Eye/Goddess和网关，再正常停止YSM服务及Paper。停服快照额外包含独立的YSM私有目录、Worker存档中的模型分配、模型源与两端配置；日志与临时目录省略。所有YSM监听必须已关闭，否则拒绝复制。E/F镜像验证完成后才应用固定摘要的五文件发布计划。

启动先等待Paper，再启动私有YSM服务，确认Proxy监听PID归属后开放原网关，随后启动女神。维护前按现有流程提醒，成功核验后发更新说明。Java/基岩原入口、原UUID、模型元数据、Goddess相机连接、旧箱子/技能/领地及普通难度/死亡保留物品分别检查。

## 回退

通过原维护流程正常停服。从本次 `deployment-rollback` 还原发布前的外观扩展配置、女神桥和禁用状态的YSM配置；只移除本次新增的Backend/扩展JAR。保留YSM私有目录及模型分配，随后启动原Paper直连路径。不恢复旧游戏世界覆盖更新后的物资或玩家进度。

## 隔离验收边界

2026-10-11正式发布准备：同一0.4.13/0.1.10游戏插件下，实际基岩协议模型及自动上传链路14项，生命周期/真实Eye/冷启动/监管进程故障/16连接14项通过；三项配置与控制边界检查通过。另验证PowerShell正常停止、停服模型快照、重新启动、固定摘要Backend安装及非白名单目标拒绝。

16客户端受控查询后五秒平均tick6.4ms、峰值24.5ms；十秒和一分钟窗口包含连接加载峰值159.4ms。这是短时已加载场景测量，不代表16个LLM长期开荒性能。隔离自签名基岩客户端不是微软认证手机/Xbox真机；完整YSM动作、控制器和装备表现仍未验收。首次控制配置定位及缺失空移除数组的夹具失败保留，修正后复验通过。

Windows进程归属与Job语义依据 [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)；实际清理范围另经隔离故障注入验证。

## 正式发布回执（2026-10-11）

原计划任务结果0，Paper PID27844，E/F `20261011-030654/.complete` 在五文件替换前完整。首次中文UTF-8计划被Windows维护任务按ANSI误读而拒绝；显式UTF-8修复及PowerShell5.1实际复制验收后重发完整预告并成功。正式23项模型/资源协议和55项旧数据检查通过；新端口全回环，三原UUID恢复，更新说明已发。临时QA仅保留自身无物品身份行及自己的模型分配，白名单撤销。未赋予实际玩家新模型。

模型专用Worker关闭自然生成后已正常保存重启，原游戏连接保持；原生状态与资源链路在该最终进程上核验。发布回退不覆盖此后正式世界物资或进度。手机/Xbox真机、远端Web部署及完整动画仍待验，不能把入口Pong或资产发包当作实际画面验收。
