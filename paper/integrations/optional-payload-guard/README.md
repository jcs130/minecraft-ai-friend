# OptionalPayloadGuard

正式已加载0.1.2：识别原版NeoForge通道声明，并衔接Fabric在登录场景完成的原始版本确认。正式相机与live游戏端已握手，相机目录40项、无人机实际加载；完整远端画面仍单独验收。原版YSM、LoginGuard、角色选择和权限不变。

只认可PLAY的客户端方向或双向通道，保留原有Minecraft/Common注册、连接隔离、断线清除、大小及数量限制。70项回归及原版NeoForge真实声明、模型传输通过。生产JAR排除所有测试夹具。

0.1.2只保留客户端实际发送的原版2.6.0版本确认，并在同一玩家的游戏后台连接建立后转交。它不会生成确认、设置原版就绪字段或重发换装/动作。512连接上限、物理身份隔离、断线清除、任务合并及两次发送上限均有独立回归，实际Velocity事件还验证来源/目标/旧连接和转发结果。

使用 `build.py --help` 在新的仓库外目录构建；固定现役Velocity、PacketEvents和JDK21作为输入，输出记录源码及依赖摘要。纯策略回归可独立编译 `OptionalPayloadPolicy.java` 和 `OptionalPayloadPolicyTest.java`，不会启动或连接服务器。

具体证据、未采用的方案及发布边界见 [原生YSM通道修复](../../docs/YSM_NATIVE_CAPABILITIES_20261102.md)。
