# OptionalPayloadGuard

正式为0.1.0；**0.1.1是已隔离验证的候选，未部署**。新增原版 NeoForge 21.1.252 的 `neoforge:register` 解码能力声明识别，修复真实YSM客户端被错误过滤；不改变原版YSM、LoginGuard、角色选择或权限。

只认可PLAY的客户端方向或双向通道，保留原有Minecraft/Common注册、连接隔离、断线清除、大小及数量限制。70项回归及原版NeoForge真实声明、模型传输通过。生产JAR排除所有测试夹具。

使用 `build.py --help` 在新的仓库外目录构建；固定现役Velocity、PacketEvents和JDK21作为输入，输出记录源码及依赖摘要。纯策略回归可独立编译 `OptionalPayloadPolicy.java` 和 `OptionalPayloadPolicyTest.java`，不会启动或连接服务器。

具体证据、未采用的方案及发布边界见 [原生YSM通道修复](../../docs/YSM_NATIVE_CAPABILITIES_20261102.md)。
