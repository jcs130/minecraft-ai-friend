# 账号登录与 Agent 接入

**2026-10-12 当前规则已上线：**同名共用原存档；本次通过官方会话校验的正版免服务器密码；已有密码的离线账号先 `/login 密码`。普通新账号没有预设密码，进入世界后 `/register 新密码 新密码`（至少六位）。本人正版登录后也可直接用 register 重设忘记的服务器密码。配对 Eye 随已认证在线本体免密旁观。

操作、正式实际连接验证、备份和回退统一以[自助登录](SELF_SERVICE_LOGIN.md)为准。下面安装结构及旧发布回执用于追溯；历史“首次等候区注册、至少八位、只凭名字强制正版”已被本节覆盖。

## 部署结构

2026-10-11 发布目标：Paper 1.20.6-151，Velocity 3.4.0（现役固定构建），LibreLogin **0.24.0**，NanoLimboPlugin **1.0.11**，LoginGuard **0.1.0**。正式完成情况与快照编号见本页末尾的发布回执。

现有 Java 入口仍为 `192.168.3.163:25565`，依次经过原 LAN 网关、Velocity 和 Paper。LibreLogin 装在 **Velocity** 上；未认证连接停留在独立空白等候区，不进入 Paper，因此不能移动游戏角色、聊天、使用 `/mycli`、`/backpack` 或打开真实背包。登录有两分钟时限。

认证等候区使用 `127.0.0.1:25587`。所有新增服务仍只监听回环地址，未新增公网端口。Paper 保持 `online-mode=false` 和原离线 UUID 算法；不能擅自改成随机 UUID、正版 UUID 或现代转发，否则会改变既有背包、技能、领地的身份归属。

基岩入口保留原 Geyser + Floodgate 的 Xbox 身份验证，直接连接 Paper，不重复要求 Java 密码。普通 Java 入口继续拒绝伪造的 `.` 前缀 Floodgate 用户名。手机/Xbox 真机操作仍须独立验收。

## 玩家如何登录

| 账号 | 操作 |
| --- | --- |
| 新离线玩家 | `/register 新密码 再输入一次密码`，至少八位且不能是弱密码；以后每次 `/login 密码` |
| 已登记的普通 Agent | 服主指定的首次临时密码为 `123456`；`/login 123456`。这是已建立账号的临时值，不是新玩家的注册密码规则 |
| 已配对 Eye | 本体认证并进入世界后自动观战，无需密码；本体退出时断开 |
| 已绑定正版的管理员（含小鱼） | 本人正版启动器官方校验后自动登录，原存档 UUID 保留 |
| 离线管理员、Goddess | 各自独立强密码，不使用 Agent 默认密码；本机私有交付文件为 `E:/MC/ops/auth-credentials/<准确账号名>.env` |
| 新正版名字 | 正版客户端在线验证后自动进入；冒名的离线客户端不能完成在线加密验证 |
| 已注册为离线身份的正版玩家 | 先用原密码登录，再使用 LibreLogin `/premium 当前密码`，按提示确认；后续使用正版客户端。小鱼已由服主授权直接关联，无需这一步 |

账号名大小写须与原账号一致，例如 `ag_CorMy`、`ag_NEKO`。截图中的 `corti` 原先被网关当作保留管理员名直接挡住；现在允许进入密码验证，不能免密进入。

离线 IP 会话自动登录关闭。密码错误三次会锁定该账号十分钟；计数跨重连和正常重启保存，五分钟内的错误累计。新注册每 IP 上限为五个，网关通过可信 HAProxy 头转发真实来源，避免所有人都被算作回环地址。预登记账号无需重新注册。

离线玩家可使用 `/changepassword 旧密码 新密码`。离线管理员新密码至少十六位。修改 Agent 密码后必须同步其运行端环境变量，否则登录门禁会安全退出。

## Agent 客户端接入

新增模块 `paper/ops/mineflayer-login-gate.mjs`。创建 bot 后立即安装，在 `gate.ready` 成功后才初始化任务、移动、物品操作和自主循环：

```js
import {installLoginGate} from './mineflayer-login-gate.mjs';
const bot = mineflayer.createBot(existingOptions);
const gate = installLoginGate(bot, {
  password: process.env.MC_LOGIN_PASSWORD,
  log: code => console.log(code),
});
try {
  await gate.ready;
  startTasks(bot);
} catch (error) {
  console.error(error.message);
  // 门禁已经退出连接；停止本轮，不要无限重试错误密码。
}
```

每个运行进程单独加载自己的 `MC_LOGIN_PASSWORD`，不要把密码提交到代码、仓库、启动参数或日志。服务器上的私有 `.env` 是交付与本地服务使用的凭据；它不会自动设置另一台电脑的环境变量。远程客户端代码不在本机，本次未替远端修改启动入口。

普通 Agent 需要密码登录；配对 Eye 自动登录。默认 Eye 配对仍按账号名匹配，只有本体完成认证并进入游戏世界后，Eye 才能借用它的在线身份；本体退出则断开 Eye。`live` 也有自己的密码。女神桥由原维护脚本加载独立环境变量，使用同样的密码门禁；离线房管没有免密通道；已绑定正版房管依靠官方会话验证。

| 私有系统标记 | 客户端处理 |
| --- | --- |
| `[MC_AUTH_LOGIN]` | 等待提示稳定后只发送一次 `/login` |
| `[MC_AUTH_REGISTER]` | 不自动注册未知身份，记录原因并退出 |
| `[MC_AUTH_PASSWORD_OK]` | 仅密码阶段通过，不能开始任务 |
| `[MC_AUTH_SUCCESS]` | 已认证且进入游戏后端，可以开始任务 |
| `[MC_AUTH_WRONG]` / `[MC_AUTH_LOCKED]` / `[MC_AUTH_UNAVAILABLE]` / `[MC_AUTH_DENIED]` | 记录错误代码并退出，不刷屏重试 |

原先 `spawn` 事件可能只表示已进入空白登录区；不能把它当成认证成功。门禁只接收完整的系统标记，不接受公屏里包含类似文字的玩家发言。配方包兼容模块仍需启用，见 `MINEFLAYER_CLIENT_COMPAT.md`（以仓库实际同名文档为准）。

## 配置摘要

正式配置在 `E:/MC/private/ysm/proxy/plugins/librelogin/config.conf`；游戏客户端和代码不应读取数据库。

| 配置 | 值 |
| --- | --- |
| 数据库 | `librelogin-sqlite`，`user-data.db`；单认证代理、单游戏服使用 SQLite |
| 密码算法 | `BCrypt-2A` |
| UUID | `new-uuid-creator=CRACKED`，23 个预登记身份保留原 UUID |
| 正版自动验证 | `auto-register=true`；身份冲突 `BLOCK`，不覆盖旧存档 |
| 登录超时 | `seconds-to-authorize=120` |
| 新密码长度 | `minimum-password-length=8`，管理员额外要求至少十六位 |
| 错密 / 注册限额 | `max-login-attempts=3`；额外持久十分钟锁定；`ip-limit=5` |
| IP 会话 | `session-timeout=0` |
| TOTP | **未启用**，原因见下文 |

如果以后使用多个认证代理，改用共享 MariaDB/MySQL，并先迁移原数据库，不能让每个代理各自生成一份身份。LibreLogin 的实际配置结构为：

```hocon
database {
  type=librelogin-mysql
  properties.mysql {
    host="数据库内网地址"
    port=3306
    database="librelogin"
    user="专用数据库用户"
    password="从私有配置提供"
  }
}
```

### 两步验证的当前限制

LibreLogin 0.24.0 的 TOTP 需要 Protocolize。官方发布页没有可直接下载的对应附件，官方 Maven/下载站本次返回 403，不能验证取得组件。因此本次保持 `totp.enabled=false`，管理员先使用独立强密码；**没有完成管理员 TOTP 实测**。

特别处理了原插件在缺少 Protocolize 时可能略过 TOTP 的行为：如果账号已存在 TOTP 密钥而组件缺失，LoginGuard 拒绝登录，不会降级成仅密码放行。以后取得并验证官方组件后，才开启 `/2fa`、`/2faconfirm`，并实际验证 `/login 密码 验证码`。

## 验证与回滚

隔离实测 13 项：预认证隔离、禁止自定义命令/背包/聊天、普通 Agent 登录及原 UUID、登录后的 `/mycli inventory` 和 Minepacks、`corti` 独立密码、禁止管理员开启免密、跨重连错密锁定、新玩家注册、重新登录、正版名字冒名拒绝。另用女神实际依赖验证本地密码登录；认证服务停止后的网关拒绝也通过。

单元测试覆盖伪造成功提示、超时退出、无密码退出、错误日志脱敏、认证心跳失效、真实 IP 头顺序与注入防护；Windows PowerShell 5.1 部署校验 11 项和维护账号校验 5 项通过。失败过的早期测试回执保留，不据此覆盖最后成功记录。

尚未完成：真实正版客户端成功自动登录、管理员 TOTP、手机/Xbox 真机、远端自主 Agent 登录入口更新。SkinsRestorer 沿用原存档与 UUID；真实原账号普通皮肤显示需要登录后继续观察，不能把插件无加载错误当作全部皮肤视觉验收。

发布私有证据与恢复材料：

- `E:/MC/ops/repairs/authenticated-release-20261011`，F 盘同名副本。
- `cold-backup-receipt.json`：本次正式停服完整 E/F 快照编号。
- `deployment-rollback/applied.json`：每个替换目标及原文件；`consumed-plan.json` 为实际发布清单。
- `credentials/`、`accounts.private.json`、数据库和运行配置不得提交 Git。

回滚步骤：按维护预告和真人退出规则正常停服，暂停原 Watchdog，先备份**当前**认证数据库、凭据、玩家与模型数据；确认 Paper、代理和模型 Worker 全部停止。依据 `applied.json` 恢复有 `Before=true` 的原文件，移除本次 `Before=false` 的新增文件；三个旧插件 JAR 也按清单恢复。再由原维护任务启动，检查 LAN、基岩、原 UUID、背包与模型绑定。通常只回退插件/配置，不回退更新后已经产生的世界进度。

不能只删除 LibreLogin JAR 或只把 HAProxy 配置改回去；必须同时回退网关、代理、认证门禁、女神启动环境及对应插件。认证回退会恢复旧入口保护规则，操作期间保持入口停用。

官方来源：[LibreLogin 0.24.0](https://github.com/kyngs/LibreLogin/releases/tag/0.24.0)、[NanoLimboPlugin 1.0.11](https://github.com/bivashy/NanoLimboPlugin/releases/tag/1.0.11)、[LibreLogin 两步验证](https://github.com/kyngs/LibreLogin/wiki/2FA)。

## 正式发布回执

2026-10-11 晚间已生效。Paper PID36640，仅重启一次；Goddess PID42720完成独立强密码登录，原UUID `b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd`，原OP及旁观者模式3均实读确认。AgentFriend0.4.22/CortiEyeMirror0.1.13/AgentAppearance0.3.1与上述认证组件均加载。

完整停服快照为 E:/MC/backups/scheduled/20261011-211820 与 F:/MC-backups/scheduled/20261011-211820，两个 `.complete` 均在正式文件替换前生成；原 Backup 任务结果0。计划任务启动入口不允许修改，本次沿用原任务：先合作式正常停服，再运行原任务做冷备份，离线固定摘要发布，最后由原 Watchdog 启动。没有修改计划任务的动作、触发器或身份。

正式 LAN 入口8项通过：未认证不能进入 Paper/真实背包，新账号注册、再次密码登录、环境变量门禁、原离线UUID、`/mycli inventory`、54格Minepacks、世界实体加载与 `corti` 登录提示。启动前/后各305项文件与数据检查通过；原23份Minepacks内容、原领地/技能/模型文件保持。正常启动引起HOCON换行与WorldGuard YAML排序变化，按解析值核对；职业账本只新增本次专用QA行，原玩家记录逐项保持。

最初正式启动暴露回调登记竞态：初始化与首个定时巡检并发，管理员密码证明被重复消费。新并发测试在旧版复现48份订阅，修正版稳定为三种各一份；修正版再通过女神实际依赖登录与正式女神连接。修复只正常停启代理/Worker，未二次重启Paper，认证数据库有单独E/F前像。初始发布清单及失败记录保持，最终Guard摘要见 `guard-hotfix-receipt.json`。

正式三维度普通难度/keepInventory=true，基岩UDP入口响应。短采样平均约6ms，不代表16个自主Agent长期性能验收；真实正版成功、TOTP及真机画面验证仍保留前述限制。

### 最终监听与发布补充

收尾发现LibreLogin自动创建的NanoLimbo使用通配监听，现改为NanoLimbo插件显式登记`auth`，配置为`127.0.0.1:25587`，停用默认未使用的first等候区。LoginGuard只在auth登记地址确为回环地址时就绪，错误通配地址会关闭新登录。隔离真实女神客户端通过，正式25581/25582/25583/25584/25587逐端口实读均为127.0.0.1；LAN直连内部端口拒绝，原Java/基岩入口保持。配置另有E/F前像及`loopback-receipt.json`，最终Guard摘要以该回执为准；原始发布/首次修复清单作为历史保留。最终307项数据核验通过（此前305项加两项等候区配置），Paper仍PID36640，当前Goddess PID42720。

并发与通配地址回归源码：`integrations/login-guard/tests/RefreshConcurrencyTest.java`，用构建目录`classpath.txt`编译运行；普通参数模拟64次并发初始化，第二参数`0.0.0.0`验证错误监听地址拒绝就绪。Node回归可运行`node --test paper/ops/auth-proxy.test.mjs paper/ops/mineflayer-login-gate.test.mjs paper/ops/agent-gateway-login.test.mjs paper/ops/agent-gateway-sessions.test.mjs paper/ops/ysm-services.test.mjs`。

完整回退还须先逆序处理两个补充回执：`loopback-receipt.json`及其`loopback-before`前像，再处理`guard-hotfix-receipt.json`及`guard-hotfix-before`，最后处理原`deployment-rollback/applied.json`。这样不会遗漏后补的NanoLimbo配置与维护助手变更。全过程保持入口停止，先保全当前数据库与世界；不要在线复制数据库或覆盖更新后的玩家进度。

## 修改文件清单

| 部分 | 文件 |
| --- | --- |
| 登录与客户端 | `ops/agent-lan-gateway.mjs`、`auth-proxy.mjs`、`mineflayer-login-gate.mjs`、`goddess-bridge.mjs` |
| 维护和建库 | `ops/manage-server.ps1`、`content-deploy.ps1`、`ysm-services.mjs`、`bootstrap-login-accounts.py` |
| 补充插件 | `integrations/login-guard/`下的构建脚本、Java实现、哈希工具、README和并发/监听回归 |
| Node测试 | `ops/auth-proxy.test.mjs`、`mineflayer-login-gate.test.mjs` |
| 发布说明 | 本页、`SERVER_UPDATES.md`、`GODDESS_CURRENT_RULES.md`、`PENDING_FIXES_RELEASE_20261011.md`、`AGENT_FEEDBACK_AND_SYNC.md`、`DUNGEON_PARTICIPATION.md`、`COMPASS_MENU.md`、`OPERATIONS.md`、两层`AGENTS.md`及`manifests/authenticated-release-20261011.json` |
| 正式私有配置 | 原代理`velocity.toml`、LibreLogin配置/中文提示/全新SQLite库及官方依赖、LoginGuard配置、NanoLimbo显式auth配置、`ops/agent-auth.json`、`ysm-services.json`和23份独立环境文件；完整绝对路径清单在实际发布及两个补充回执中 |

正式回连还观察到原`ag_NEKO`以UUID `6e8b395e-4349-3d44-99f5-b7488825e426`完成认证进入世界；不是同名探针。远端自动登录代码是否已经接入，仍需对应运行端确认。

## 深夜补充

多版本代理5.12.1/PacketEvents2.14.0与正版/Eye新策略已上线，Paper未再次重启。当前Guard摘要与回退步骤见[正版与Eye](PREMIUM_EYE_LOGIN.md)，Java实测版本见[多版本](JAVA_CLIENT_COMPATIBILITY.md)。管理员曾一律要求密码、Eye曾需要密码的描述为首次安装历史；不能再用作当前引导。
