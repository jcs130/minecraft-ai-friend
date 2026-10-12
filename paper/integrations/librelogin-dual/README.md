# LibreLogin 0.24.0 同名双登录补丁

状态：2026-10-12 候选，尚未上线。配合本仓库 LoginGuard 使用。

上游 [LibreLogin 0.24.0](https://github.com/kyngs/LibreLogin/releases/tag/0.24.0)
的 `/premium` 会把账号永久改为只允许正版连接。本服服主要求同名共用
原存档：本次连接通过官方验证则免密码，离线连接使用该账号的密码。

`src/` 保留上游两份监听器及 MPL-2.0 声明，只改变 Velocity 的同名登录
选择、经过验证后的正版关联及后端选择。上游其他平台入口仍沿用原重载。
构建脚本只替换两份监听器及它们生成的内部类，其余上游文件逐字保留。
代码来源为上游 0.24.0 标签的 `Plugin/src/main/java/`，修改源码公开在这里。

登录开始包的 UUID **只决定尝试哪种验证**。声称正版 UUID 的客户端必须
继续通过 Velocity 的 Mojang 加密/会话验证；不能凭名字、IP、UUID 声明免密。
无法查询正版服务时走密码流程，不会擦掉旧密码或把声明视为认证。
正版关联仅在 `GameProfileRequestEvent.isOnlineMode()` 为真时保存，之后仍
重写为该名字原有的存档 UUID。遇到已经关联其他存档的正版 UUID 则拒绝。
没有登录 UUID 的旧版客户端走密码流程，不保证旧版自动识别正版。

新账号首次进世界后自行设密码由 LoginGuard 完成，详见
[登录候选说明](../../docs/SELF_SERVICE_LOGIN.md)。保留管理员、旧密码和
TOTP 不通过首次进入规则绕过；经过验证的正版本人可重新设置服务器密码。

构建：`build.py --proxy <含官方原版 JAR 的目录> --jdk <JDK21> --output <新目录>`。
锁定官方 JAR SHA256 与现役 Velocity 摘要，拒绝覆盖已有构建目录。
构建物、认证库、凭据均不进 Git。`tests/VerifiedProfileTest.java` 直接调用
修改后的 profile 处理器；隔离真实连接记录另存私有运维目录。

回退需同时恢复原 LibreLogin、旧 Guard、配置与客户端门禁。先备份当前
认证库；保留上线后玩家自设的新密码，不恢复旧库覆盖玩家进度。
