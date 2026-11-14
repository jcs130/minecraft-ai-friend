# Java 与基岩共用服务器角色

LoginGuard 给已验证的微软 Java 账号签发短时凭证。游戏服核对凭证后使用原 Floodgate 角色的名字和 UUID 读取存档。基岩版仍由现有 Floodgate 验证。两端轮流登陆同一角色，共用背包、经验、权限和基于角色名或 UUID 的领地记录。

## 配置

先核对原 Java 正版档案、LibreLogin 角色记录和 Floodgate 角色。两端使用同一份 `link.properties`，字段如下。示例为隔离测试身份。

```properties
java.name=OfficialQA
java.premium-uuid=18842fbf-b1db-4bf3-8d71-4fc8dfd7f122
bedrock.name=.ConsoleQA
bedrock.uuid=00000000-0000-0000-0009-0000009b3652
```

在游戏服的 `plugins/PlatformIdentity` 放置 `link.properties` 和 `handoff.key`。后者是新生成的 32 随机字节，以 64 个十六进制字符保存。登录代理配置中的 `identity.link` 与 `identity.key-file` 指向同一对配置的私有副本。游戏后端必须仅监听回环地址，生产 Geyser 必须验证 Xbox 登录。保留当前 Velocity 转发模式及 Geyser 路由。

用现有 LibreLogin 库核对 Java UUID 与正版 UUID。经隔离验收后，运维可将管理员权限只授给 canonical Floodgate UUID，并在 LuckPerms 上检查同一 UUID 的领地管理权限。LoginGuard 只对配置中名字与 UUID 均匹配的基岩管理员采用 Floodgate 验证，其他管理员继续通过现有规则检查。游戏服与代理停启前保留本次组件和权限的备份。旧 Java 单独存档留作备查，已有物品与进度不合并。

## 验收和回退

启动时需要游戏服的 `Verified Java and Floodgate identity handoff ready` 和代理的认证就绪。用本人微软 Java 和 Xbox 客户端各连一次，核对同一 UUID、原背包、私有箱、领地与 OP。两次连接之间先退出正在使用的设备。另测普通离线账号首次设密和同名冒充拒绝。

若需回退，先撤销本批增加的 canonical OP 与 LuckPerms 权限，再停启恢复原 JAR 和代理配置。保留两端的现有角色存档以及最新世界与授权记录。代理锁住时先检查管理员名单、配对文件和认证库的匹配。
