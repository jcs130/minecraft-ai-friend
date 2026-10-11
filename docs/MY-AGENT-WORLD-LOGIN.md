# My Agent World 混合登录

本说明针对 NeoForge 1.21.1 新服，旧千灯纪 Paper 服保持原状。服务端使用 MixAuth 1.3.3，客户端不需要安装登录模组。固定发行件、SHA256/SHA512 和配置模板见 `tools/mixed_auth_support.py`；上游为 [MixAuth](https://github.com/truscdo/MixAuth)，[1.21.1 NeoForge 发行页](https://modrinth.com/mod/mixauth)。

## 玩家登录

- **正版 Java**：使用官方正版会话启动同版本 NeoForge 整合包，直连 `192.168.3.163:28976`。登录时走 RSA 加密挑战及 Mojang `hasJoined` 会话验证，验证通过免注册、免密码。验证失败会断开，不降级为同一个正版身份的离线登录。
- **离线 Java**：同一地址。首次输入 `/register 密码 再输一次密码`；以后每次连接输入 `/login 密码`。密码至少 8 个字符、最多 72 UTF-8 字节。`/auth changepassword 新密码 再输一次新密码` 可修改本人密码。请勿把密码发到普通聊天或公屏。
- **基岩**：地址 `192.168.3.163`、UDP `28988`。当前兼容桥向后端呈现离线 Java 身份，按上述命令注册/登录。此处的“正版免密”指验证过的正版 Java 会话；没有把基岩名字当作正版 Java 身份。手柄专用登录表单尚未实现。

关闭 `trusted_login_window_hours`，共用 IP、代理或家庭网络不会使离线账号免密。未登录时由 MixAuth 冻结角色、隐藏物品栏并限制普通交互；自有原生接口额外返回私有 `authentication_required`，不读背包、地形、女仆、殖民地、法术和模组菜单，也不允许通过基岩管理桥生成令牌或修改模型设置。

正版 UUID 和同名离线 UUID 是不同身份，拥有独立物品与权限。MixAuth 不把所有正版名字一律封给正版玩家：同名离线账号可以是另一 UUID；不要以名字推断所有权，不自动合并存档、OP 或 Numen 令牌。

## Agent

**Mineflayer / Native SDK** 使用 `host=192.168.3.163, port=28977, version=1.21.1, auth=offline`。此入口作原生协议适配，当前不代理正版加密登录；先注册/登录，再调用原生 SDK。未登录的查询/动作会返回 `ok=false, code=authentication_required`，没有世界数据。不要对这一状态继续规划或重放动作。

常驻 MawExplorer 使用仅存于运行目录的 `agents/maw-explorer/game-login.json` 自动提交一次登录密码，并通过本人原生 capabilities 回执确认完成后才开放决策。文件不进 Git、不回显密码；原来的人工暂停及旧 unknown 动作不解除。登录失败不会自动注册、改密码或反复重试。

**Numen MCP** 仍使用 `http://192.168.3.163:28984/numen/mcp` 和本人 Bearer 令牌。无需主人 Minecraft 客户端在线，也不需要给假玩家设离线密码。仅实际 `NumenPlayer` 实例、持久名册的身体 UUID、名称和所有者一致时，服务端为这个自己创建的身体提供内部可信上下文；真实网络玩家无法凭同名、IP 或自报 UUID 获得该上下文。MCP 所有权、单控制器租约及动作去重照常检查。

## 维护与验证

配置：`server/world-life/serverconfig/mixauth-server.toml`；数据库：`server/mixauth/mixauth.mv.db`；密码用 BCrypt cost 12。备份必须包含数据库、配置、玩家存档和私有 Agent 登录文件，不能只备份世界 region。数据库使用嵌入式 H2，冷备时停服；不得同时启动两个进程访问同一数据目录。

管理员重置密码前先确认 UUID。使用服务端控制台的 `auth setpassword` 时不要把口令写入公开命令记录或工单；已有账户不应被批量重新注册。自动部署的预置只新增 MawExplorer 的密码，不覆盖已有密码。

隔离服实测覆盖：离线首次注册、错误密码拒绝、正确密码和原 UUID 恢复、同 IP 重连仍锁定、7 类原生协议拒绝无数据、登录前私有管理拒绝；伪造正版 UUID 接到加密挑战后被 Mojang 204 拒绝且不转离线。另跑 Numen 创建/移动/菜单/恢复/去重、只读网页、女仆和原生 SDK 回归。真实正版会话免密与实际基岩手机输入仍须由对应客户端完成最终验收；不索取 Microsoft 密码或访问令牌。

只读巡检：`python world/ops/health/health_mon.py --society-mixed-auth-smoke`。有界实际整包验证：`tools/smoke_numen_server.py --full-pack --maid-config --viewer --mixauth-jar <已校验发行件> --bridge-jar <隔离候选桥> --output <全新 research 目录> --node <Node 路径>`。验收报告保留在私有 research，不上传数据库、凭据、世界或上游 JAR。

回滚先停服、备份当前认证数据库和世界，再恢复同一发布前的两个自有桥 JAR、worker 源码与配置；移除 MixAuth 会让离线入口失去密码保护，因此不能在对外可达状态下无提示地卸载。不得删除现有账户数据库来“修复”登录。
