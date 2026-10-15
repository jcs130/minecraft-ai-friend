# YSM 登录后断线：握手阶段修复

## 状态（2026-10-15）

Freesia **2.5.1+2.4.1-af2** 已于11:28正式上线。服主回复“现在提醒并上线”后，180/60/10秒提醒、原维护锁与真人/活动副本门禁通过，代理和Worker正常停止；E/F `repairs/ysm-play-phase-20261015/cold-before/.complete` 均在替换前完成。仅更新私有代理的 Freesia 插件，沿原Windows Job监管和Watchdog启动。Paper PID始终为6372，未重启；原生 YSM 2.4.1、Worker插件和认证配置保持。

正式联机20项通过，覆盖原生握手/目录/权限/缓存初始化及1.20.6普通Mineflayer，并在实际入口延迟configuration确认。39个原账号的UUID/正版关联/密码/名字、51份原生保存绑定、172份模型资源保留；临时QA白名单已撤回，女神与鸣人恢复认证，游戏更新说明已发出。Worker `server.properties` 启动时重写日期注释，全部属性值一致，首次字节比较失败保留。**可米实际Fabric模型界面完成同步仍待她重连复测。**

## 原因与证据

可米客户端为 Minecraft 1.21.1 / Java 21 / Fabric Loader 0.16.13 / Fabric API 0.115.4+1.21.1 / YSM 2.4.1，原生协议未修改。10月15日09:21:37，正式 Freesia 在 `auth` 登录大厅建立 Worker 会话并发送 YSM 握手；09:21:39 登录通过后切换 Paper，又销毁和重建会话。这个时间点尚未完成实际世界加入。

客户端的异常是 YSM payload 不能转换为 `net.minecraft.class_8711`；[Yarn 1.21.1 映射](https://maven.fabricmc.net/docs/yarn-1.21.1%2Bbuild.3/net/minecraft/network/packet/UnknownCustomPayload.html) 确认它是 `UnknownCustomPayload`。这说明编码时没有选到对应的 YSM codec，不能解释为密码错误或 `PacketByteBuf` / `RegistryByteBuf` 类型转换。结合异常报告的 configuration 阶段和实际时序，登录大厅的提前握手会让延迟的原生回复跨进世界切换阶段。

隔离环境复现：旧版在首次登录大厅 JOIN 后收到包51；延迟1200ms处理该消息，密码登录会使客户端此时处于 configuration。测试保留这个危险回调的记录，但不在错误阶段伪造发送、更不把协议探针当成 Fabric 崩溃复现。新版相同流程下，登录大厅不收 YSM 消息，第二次实际世界 JOIN 后才收到51、6、8、1等原生包；延迟回复处于 PLAY。

## 改动

- `ServerPreConnectEvent` 按最终目标建立新的会话代次；拒绝的连接不创建新会话。
- `auth` 永远不启动模型会话。`ServerConnectedEvent` 本身不能证明客户端已进入实际世界。
- 收到实际后端 JOIN 且客户端处于 PLAY 后，才连接 Worker、发送原生握手和启动检测。
- 在客户端 Netty 事件循环实际写出前，再核对 PLAY、接收方会话代次和来源 mapper；跨换服/下线的旧消息直接丢弃，不排队重放。
- 旧 Worker 回调在修改模型状态前也校验来源；旧会话退出不能移除新会话。可选 Worker 中断保持游戏连接，恢复后重新握手。

仍使用原生 `yes_steve_model:2_4_0` / 协议 **2.4.0**。YSM 模组版本 **2.4.1** 不表示频道应改名为2.4.1。不更改客户端模组或消息编码。

## 验证与边界

- `YsmPlayGateTest`：17项，覆盖登录大厅、实际世界、迟到 JOIN/负载、换服、同UUID重连、断线清理及玩家隔离。
- 真实同栈联机43项：原生握手重连12项、普通 Mineflayer 1.21.1与1.20.6各8项、Worker正常中断/恢复15项。均经过 LibreLogin 实际密码登录，并将第二次 configuration 确认延迟2500ms。验证真实 Paper 区块、原UUID、PLAY握手、模型目录/权限/缓存初始化、无协议错误和恢复时不重复登录。
- 旧版7项对照复现独立记录，不计入新版43项。
- 私有证据：`E:/MC/ops/repairs/ysm-play-phase-20261015`。早期测试的缺失 Eye 配置、精简服缺少后端 ViaVersion 和错误的白名单UUID夹具均原样保留；诊断认证JAR已恢复原件，最终测试使用现役原认证插件。
- 候选代理 SHA256：`22c7d5f1c3de93b0cc73850c534a168ea4875c5f132b214a9d781a897a747f4c`。

协议测试证明服务器握手时序及资源初始化恢复；**可米的原生 Fabric 界面完成同步和实际模型画面仍需上线后复测**。没有把收到目录、缓存初始化或资产包称作原生画面验收。正常游戏换服中原生模组自身已有的异步任务，不由服务器补丁取消；本次修复针对登录大厅不应触发的模型会话，并阻止服务器在错误阶段发送和重放消息。

## 构建与回退

按 [集成构建说明](../integrations/freesia-optional/README.md) 使用固定依赖和新的私有输出目录。JDK21可单独验证纯时序测试：

```powershell
javac -encoding UTF-8 --release 21 -d <私有测试目录> src/meow/kikir/freesia/velocity/network/ysm/YsmPlayGate.java tests/meow/kikir/freesia/velocity/network/ysm/YsmPlayGateTest.java
java -cp <私有测试目录> meow.kikir.freesia.velocity.network.ysm.YsmPlayGateTest
```

上线前使用原维护锁、真人/活动副本门禁和预告，正常停止代理及Worker，完成E/F双盘冷备份并核对摘要，只将代理旧af1设为禁用、安装af2。沿原Windows Job监管及Watchdog启动；Paper PID应保持。不得用 `/reload` 替换插件，不覆盖认证数据库或模型分配。

回退同样先正常停止代理及Worker；移出af2、恢复本次备份的af1并核对摘要，沿原监管启动。保留之后的认证记录、玩家进度和模型分配；无需恢复旧世界或改客户端。
