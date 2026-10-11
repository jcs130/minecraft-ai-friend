# My Agent World 混合登录

本说明针对 NeoForge 1.21.1 新服，旧千灯纪 Paper 服保持原状。服务端使用 MixAuth 1.3.3，客户端不需要安装登录模组。固定发行件、SHA256/SHA512 和配置模板见 `tools/mixed_auth_support.py`；上游为 [MixAuth](https://github.com/truscdo/MixAuth)，[1.21.1 NeoForge 发行页](https://modrinth.com/mod/mixauth)。

## 玩家登录

- **正版 Java**：使用官方正版会话启动同版本 NeoForge 整合包，直连 `192.168.3.163:28976`。登录时走 RSA 加密挑战及 Mojang `hasJoined` 会话验证，验证通过免注册、免密码。验证失败会断开，不降级为同一个正版身份的离线登录。
- **离线 Java / Mineflayer Agent**：同一账号尚未设密码时直接进入，每次登录私下提醒。进入后用 `/password 新密码 再输一次新密码` 设置；`/register` 仍兼容。设过密码的账号以后用 `/login 密码`，已登录时可用 `/password` 修改。密码至少 8 个字符、最多 72 UTF-8 字节。请勿把密码发到普通聊天或公屏。
- **正版基岩 / Xbox**：地址 `192.168.3.163`、UDP `28988`。Geyser 验证 Xbox 登录后自动进入，不需要注册或密码；沿用该账号原来的 Java 离线 UUID、背包和世界进度。若该名字以前已经设置过离线密码，首次绑定须输入一次原密码；绑定完成后重登免密，避免拿同名 Xbox 账号接管已有离线角色。改 Xbox 名字不会自动合并身份，需服主核对后迁移。手柄专用离线密码输入表单尚未实现。

关闭 `trusted_login_window_hours`，已设密码的离线账号不会因共用 IP、代理或家庭网络免密。等待密码或已绑定 Xbox 身份验证时由 MixAuth 冻结角色、隐藏物品栏并限制普通交互；自有接口返回私有 `authentication_required`，不读背包、地形、女仆、殖民地、法术和模组菜单，也不允许通过基岩管理桥生成令牌或修改模型设置。未设密码的离线账号没有身份凭据，按本服调试策略允许进入；提醒不等于账号已受密码保护。

Xbox 证明由现有本机私有管理桥提交：校验 Geyser 的 `validate-bedrock-login=true`、真实 XUID、本人连接收到的随机 nonce 和有效期。普通玩家名称、IP、客户端自报 UUID 或自定义负载均不能证明正版身份。绑定记录保存于 `server/config/maw-login-private/bedrock-identities.json`，已绑定 UUID 不接受离线 `/register`、`/password` 或密码登录绕过。正式服不得使用隔离 UDP 探针所需的关闭 Xbox 校验配置。

正版 UUID 和同名离线 UUID 是不同身份，拥有独立物品与权限。MixAuth 不把所有正版名字一律封给正版玩家：同名离线账号可以是另一 UUID；不要以名字推断所有权，不自动合并存档、OP 或 Numen 令牌。

## Agent

**Mineflayer / Native SDK** 使用 `host=192.168.3.163, port=28977, version=1.21.1, auth=offline`。此入口作原生协议适配，当前不代理正版加密登录。新账号可直接使用本人 SDK，建议进入后设置独立密码；已有密码先登录。`ok=false, code=authentication_required` 表示仍在等待认证，没有世界数据；不要继续规划或重放动作。

常驻 MawExplorer 使用仅存于运行目录的 `agents/maw-explorer/game-login.json` 自动提交一次登录密码，并通过本人原生 capabilities 回执确认完成后才开放决策。文件不进 Git、不回显密码；原来的人工暂停及旧 unknown 动作不解除。登录失败不会自动注册、改密码或反复重试。

**Numen MCP** 仍使用 `http://192.168.3.163:28984/numen/mcp` 和本人 Bearer 令牌。无需主人 Minecraft 客户端在线，也不需要给假玩家设离线密码。仅实际 `NumenPlayer` 实例、持久名册的身体 UUID、名称和所有者一致时，服务端为这个自己创建的身体提供内部可信上下文；真实网络玩家无法凭同名、IP 或自报 UUID 获得该上下文。MCP 所有权、单控制器租约及动作去重照常检查。

## 维护与验证

配置：`server/world-life/serverconfig/mixauth-server.toml`；数据库：`server/mixauth/mixauth.mv.db`；密码用 BCrypt cost 12。备份必须包含数据库、Xbox 绑定记录、配置、玩家存档和私有 Agent 登录文件，不能只备份世界 region。数据库使用嵌入式 H2，冷备时停服；不得同时启动两个进程访问同一数据目录。设置密码在原生异步 BCrypt 队列计算，再回主线程核对同一连接；断线后不会替新连接改密码。

管理员重置密码前先确认 UUID。使用服务端控制台的 `auth setpassword` 时不要把口令写入公开命令记录或工单；已有账户不应被批量重新注册。自动部署的预置只新增 MawExplorer 的密码，不覆盖已有密码。

本轮隔离实服覆盖首次免密、每次提醒、入服设置密码、错误密码拒绝、原 UUID 恢复、已有密码账号首次 Xbox 绑定、私有桥/nonce/XUID 隔离及伪造正版会话拒绝，运行 `tools/smoke_maw_guest_login.cjs <隔离目录>`。真实 UDP 探针实际下载五个包、发送持物交互、打开并重开指南/Key 表单、以魂符召唤原生归属女仆。Xbox 身份证明测试使用受信本机桥夹具，不能替代真实 Xbox 手机免密验收；也未使用真实正版 Java 会话。

只读巡检：`python world/ops/health/health_mon.py --society-mixed-auth-smoke`。有界实际整包验证：`tools/smoke_numen_server.py --full-pack --maid-config --viewer --mixauth-jar <已校验发行件> --bridge-jar <隔离候选桥> --output <全新 research 目录> --node <Node 路径>`。验收报告保留在私有 research，不上传数据库、凭据、世界或上游 JAR。

回滚先停服、备份当前认证数据库、Xbox 绑定和世界，再恢复同一发布前两个自有桥 JAR、Geyser MawAgents 扩展与对应构建清单。旧桥没有 Xbox 绑定保护，已绑定账号在开放离线入口时不可直接退回旧策略；先停接入并制定身份迁移。不得删除现有账户数据库来“修复”登录。
