# LoginGuard 0.1.0

2026-10-12 同名双登录与首次自设密码候选见 `../../docs/SELF_SERVICE_LOGIN.md`，
尚未部署。新增本人设密码/已验证正版找回入口，现有密码和管理员保护保持。
须与 `../librelogin-dual/` 一起发布；不能单独替换 Guard。

Velocity 上的 LibreLogin 补充保护：认证失败关闭入口、已认证账号心跳、官方正版会话校验、离线管理员强制密码、在线本体的Eye自动观战、跨重连错密锁定，以及 Mineflayer 在 NanoLimbo → Paper 1.20.6 配置切换期间的两个已复现协议兼容问题。

详细接入、密码交付、验证边界与回滚见 `../../docs/LOGIN_PROTECTION.md`。

构建使用 `build.py --proxy <隔离代理目录> --jdk <JDK目录> --output <新的构建目录>`，从实际测试过的官方 JAR/缓存读取依赖；输出目录必须不存在，且置于仓库之外。构建清单记录源文件及依赖 SHA256。

本实现锁定现役 Velocity JAR（SHA256 `fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef`）、LibreLogin 0.24.0 与 PacketEvents 2.8.0/2.14.0已核验摘要。CONFIG 兼容处理访问了 Velocity 内部 API，升级代理或协议后必须重新构建并做真实跨服务登录验证，不能直接沿用旧 JAR。

配置 `plugins/login-guard/config.properties` 指定私有 `heartbeat`、`attempts` 与实际 `ops` 与 `eyes`（原agent-eye-pairs.json）文件路径。认证心跳失效五秒即拒绝新 Java 登录；原代理监督器在每次启动前清除旧心跳，避免插件未加载时误用旧的正常状态。

`HashAccounts.java` 只供离线建立**全新**数据库使用，从标准输入接收临时凭据并输出 BCrypt 哈希给父进程。`bootstrap-login-accounts.py` 拒绝非空认证库，校验原离线 UUID；不能用于重置现有玩家密码。凭据、数据库、构建物和日志均不得进入 Git。

2026-10-11深夜服主策略变更、21项profile/配对回归与正式验证见 `../../docs/PREMIUM_EYE_LOGIN.md`。Java测试为 `PremiumEyePolicyTest`、`RefreshConcurrencyTest`；Node门禁七项。只有官方会话且原始profile与绑定UUID一致才能免密码，不使用名字或IP会话证明正版。
