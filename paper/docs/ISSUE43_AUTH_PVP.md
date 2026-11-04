# Issue #43：官网密码和 PvP 物品托管修复候选

基线是 main @ 80d9b99c。此候选不修改数据库结构、账号或角色归属，不改竞技装备或计分规则。回归使用独立网站数据库和可丢弃游戏世界。上线与验收记录见下文。

## 官网

密码哈希含随机盐，现有哈希本身可作凭据版本。密码校验、生成新哈希仍在 SQLite 写事务之外；登录在 BEGIN IMMEDIATE 内重读并核对该版本，同一事务签发会话并写审计，提交后才发送 Cookie。主动改密在同一写事务内复核凭据版本和原会话，更新哈希，撤销会话及个人令牌，再为本次请求签发替换会话。邮件重置在写锁内复核挑战及凭据版本、消费验证码、改密和撤销。普通账号恢复和原角色归属不变。

运行：在 paper/integrations/agent-portal 安装已锁定依赖，再执行：

    node --test tests/password-session-race.test.mjs tests/email-auth.test.mjs tests/portal.test.mjs tests/login-throttle.test.mjs

新 HTTP 测试用测试接线暂停真实 scrypt 校验的结果，不靠延时猜测顺序。对基线复现时，仅把同一个 verifyPassword 测试接线和测试文件放到独立基线工作树，保持原登录及改密逻辑不变。

## 竞技场

- **held**：两份原背包、位置及状态先作为一个写入原子落盘；再发竞技装备。
- **restoring**：在应用背包前先锁定玩家并持久保存阶段。应用使用逐槽替换；失败或进程中断后，只允许从同一事务快照恢复，不能把玩家当前包叠加进去。
- **完成**：仅当本次唯一保存标记确实出现在该 UUID 的完整 gzip 玩家文件，且同步写入成功，才移除对应托管行并解除锁。单独调用 void 的 saveData() 不算证明。记录更新使用同步后的临时文件和同卷原子替换；不支持原子替换的文件系统上保留托管并失败关闭。进程退出测试不等同于存储设备断电测试。

游戏测试入口：paper/plugins/AgentFriend/tests/pvp-escrow-stage.mjs。准备一份 **可丢弃** 的 1.21.1 测试服务端，使用测试角色、测试世界、独立日志目录。服务器只能绑定 127.0.0.1:25966，RCON 25967，level-name=world；根目录 .pvp-escrow-qa 内容必须为 disposable local PvP test only。用服务端 1.21.1 Bukkit API 及其依赖编译同目录 PvpEscrowFixture.java，打成测试插件（plugin.yml 主类 PvpEscrowFixture，依赖 AgentFriend，声明 pvpqa 命令）。此插件禁止安装到正式服。配置测试 AgentFriend JAR 后运行：

    node paper/plugins/AgentFriend/tests/pvp-escrow-stage.mjs baseline  <隔离目录> <Java21可执行文件> <含mineflayer及prismarine-nbt的package.json>
    node paper/plugins/AgentFriend/tests/pvp-escrow-stage.mjs candidate <隔离目录> <Java21可执行文件> <含mineflayer及prismarine-nbt的package.json>

测试脚本只启动自己的 JVM；故障注入会直接终止该隔离 JVM。使用 baseline 复现两个原错误后，替换测试目录里的 AgentFriend JAR，再运行 candidate；测试产出各自的 escrow-report.json。玩家存档通过 NBT 文件独立回读。故障夹具不进入发布 JAR。

## 既有异常托管记录

旧格式没有事务阶段，无法断定原物品是否曾被移走。新代码保留原记录并锁定该角色；整个文件无法解析时，不把它当空库，也不允许继续使用受影响的背包。没有记录被自动删除或升级。

1. 在获得独立维护授权后，离线备份原 escrow 文件、其临时文件、对应 UUID 的 .dat 和 .dat_old，并保留同一时间窗口的日志、备份和物品转移记录。先在复制环境中对账。
2. 按 UUID 核对当前背包、原快照和外部转移情况。必须能证明快照是唯一原件，才能在副本中将该行明确登记为新格式 held（唯一事务 UUID、实际槽位总数、非空槽数和完整原槽位），再测试恢复。若当前玩家文件已确认为完整原包，则只归档和核销该行，不重发物品。
3. 证据不一致时保留原文件和锁，逐项人工核对；不要整库清空、用旧存档覆盖新进度或反复恢复同一条旧记录。

代码回退前，先在隔离副本核对所有未结托管。旧版插件不识别这些恢复阶段；未结记录没有对账前，不可直接换回旧版继续运行。

## 2026-11-04 发布记录

PR #60 的六项 CI 已通过，合并提交为 8d17d2b3。官网 0.8.39 已上线。33 项云端隔离检查通过，切换前的 SQLite 备份已在 E/F 两盘验证。正式验收确认 16 类原数据、16 个有效会话及下载目录均已保留。

AgentFriend 0.4.47.54-rpg 已正常重启上线。原 JVM 退出后才更新两盘冷备，再安装新 JAR。28 项启动后检查通过，807 份角色相关文件在安装前后摘要一致。实战与故障注入证据来自隔离服。女神任务已恢复。维护入口已消费。[发布清单](../manifests/issue43-security-20261104.json)。
