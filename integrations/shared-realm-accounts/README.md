# 千灯纪与 SAO 的共用游戏账号

同一网站身份继续管理原角色；**游戏密码以千灯纪 LibreLogin 为唯一来源**。网站登录密码仍与游戏密码分开。SAO 的 Forge 服务端通过本机加密邮箱调用现有认证与改密提供器，不复制两种实现的密码哈希，也不新增公网 MCP、RCON 或管理端口。

组件是独立的 Velocity `RealmAccounts-0.1.1.jar` 与服务端 Forge `maw-shared-accounts-0.1.1.jar`。原 LoginGuard、LibreLogin 和 DirectAuth JAR 不覆盖。Forge 组件没有客户端网络依赖，Mineflayer、基岩桥和原作者 Java 整合包都无需额外安装它。

服务端组件的 `displayTest="IGNORE_SERVER_VERSION"` 与 [Forge 1.20 的单侧模组说明](https://docs.minecraftforge.net/en/1.20.x/concepts/sides/)一致；不注册要求客户端应答的自有网络频道。

## 玩家与 Agent 怎么用

1. 用现有千灯纪网站账号登录，创建或绑定本人的游戏角色。新建后目录同步可能需要约一分钟，不要重复建号。
2. **千灯纪已绑定的正版 Java 身份直接进服，完成 Mojang 会话验证后免密码。** 沿用原角色 UUID、存档和各服原有权限；同名或客户端自报 UUID 不算身份验证。离线身份首次进入 SAO 的新身体使用 `/login 游戏密码`。如果身体名与千灯纪角色名不同，用 `/login 千灯纪角色名 游戏密码` 明确选择身份，例如基岩用户名带前缀的情况。
3. 已有 SAO 身体：先用它的原密码登录，再 `/sharedaccount link 千灯纪角色名 千灯纪游戏密码`。已有身体需要两端身份核验，不按同名覆盖，也不更换 UUID。
4. 关联后，普通离线身份的网站“游戏密码”入口和 SAO 的 `/changepassword 旧密码 新密码` 都写入同一 LibreLogin 原生提供器。管理员和两步验证身份继续在千灯纪原生入口改密。
5. `/sharedaccount status` 查看本人绑定和实际认证状态；`/sharedaccount status 请求ID` 查询本人已保存的回执。这些查询遵守原生登录门禁。断线后无法认证且结果未知时，由服主核对原请求，不重复提交改密。

名字大小写须准确。角色背包、任务、等级和位置仍按各世界及身体独立保存。不同平台可显式关联一个千灯纪角色，但不会合并存档。管理员须使用本人同名、同 UUID 的身体；不复制跨服 OP，也不允许用别名接管管理员身体。Eye 和系统身份保留专用入口。TOTP 不跳过；需要时输入 `/sharedaccount login 游戏密码 六位验证码`，原生验证器缺失时明确拒绝放行。详细机制与实测范围见 [正版免密与私有回执](PREMIUM_LOGIN.md)。

已认证连接的保留按原生会话策略处理，不批量踢出玩家。SAO 已关联角色禁用本地宽限会话，后续密码登录重新核验当前原生密码；不会在认证服务故障时回退到旧本地密码。SAO 自有旧账号未关联前，仍走原 DirectAuth 登录。

已关联身体的原生 `/online`、`/register` 和 `/unregister` 路径被拦截，不能在关联后改成本地身份来源。正版认证使用主服的当前绑定和 DirectAuth 原生会话握手，不依赖本地 `/online` 开关；SAO 不持久化一个可脱离主服的正版授权。原生账号未经双端证明不会按同名自动接管。

## 数据与权限

- 网站只向受限服务令牌返回已核验归属的游戏角色名称和 UUID（含本人合法 OP 身份）。没有密码、哈希、邮箱、模型 Key 或浏览器会话。浏览器 Origin/Cookie、错误令牌及过期来源都被拒绝。
- `roles_sync.py` 仅通过已有 HTTPS 网站出站。每15秒更新加密目录。两个主机存在时钟偏差时，以 HTTPS `Date` 秒级上界与完整往返时间保守计算数据年龄，缩短有效期；保留原来源时间，不把陈旧结果重新变新。
- 新关联需要新鲜的网站归属。已关联身体使用加密持久绑定，并继续核验 LibreLogin 的当前 UUID、名称、注册状态、密码、管理角色和 TOTP 规则；网站短时离线不影响这一流程。
- SAO 的原生账号保留原身份。新身体只建立随机本地凭据作为原生记录，实际玩家密码不在 SAO 再保存一份。既有账号的原哈希不作为关联后的登录来源。
- 本机邮箱使用 AES-256-GCM 与 `maw:shared-accounts:1:sao:<label>`；请求指纹采用 HMAC。每个请求有唯一 UUID。相同 ID 的结果不重做；已受理的写入在重启时转为 `unknown`，不会自动重放。
- 写入成功、身体关联和实际认证分别核对。默认真人只收到简短文字。Agent 注册 `mcagent:account` 后，仅通过本连接收到原始 UTF-8 JSON（不超过16 KiB），没有 writeUTF 前缀。SDK 0.1.1 自动注册，发出 `sharedAccount` 事件并保留最近32条回执。旧客户端可显式 `/sharedaccount format json` 开启本连接的 `MC_SHARED_ACCOUNT` 聊天回退；退出后自动清除，不向其他玩家发送。

第一条关联先留下 `pending` 标记，完成绑定后转 `active`。尚未完成的首次关联不会因空成员表阻止正常启动；丢失已提交成员表、丢失密钥或关闭已关联认证则会拒绝降级启动。正式监督器还固定服务端 JAR 和配置集合，不能删除组件后重新冻结来绕过门禁。

## 部署与运维

当前路径：

| 内容 | 位置 |
| --- | --- |
| 主要凭据 | 原 `E:/MC/private/ysm/proxy/plugins/librelogin` 原生数据库 |
| Velocity 组件配置 | `proxy/plugins/realm-accounts/config.properties` |
| SAO 组件配置 | `E:/MC/servers/sao-0.76.1/server/config/maw-shared-accounts.properties` |
| 密钥、绑定、请求、回执与归属目录 | `E:/MC/private/shared-realm-accounts/sao` |
| 只读目录发布器 | `E:/MC/ops/shared-realm-accounts/0.1.0/roles_sync.py` |
| 发布器任务 | `MyAgentWorld.SharedRealmAccounts.SAO`，当前用户、Limited、登录自启、失败重启 |

`build_velocity.py` 固定当前 Velocity、官方 LibreLogin API 和现役 LoginGuard 字节。`prepare_forge.py` 为 Forge 47.4.10 / Java17 建立隔离构建目录，使用固定 DirectAuth 1.3.1 API。完整源码、5项跨主机时钟回归、真实 Mineflayer 消费者和仅限隔离环境的原生账号夹具都在本目录。

发布时使用原 `manage-server.lock`，正常停启登录／模型代理；Paper 世界不必重启。SAO 正常保存退出后进行 E/F 成员级备份，增加新 JAR 和配置，重新冻结发布清单，再通过原监督器恢复。保持 28976/TCP、28977/TCP、28988/UDP、28989/UDP，后台和 Owner MCP 仍在回环。

**备份必须包括三个位置：SAO 世界与运行目录、原生登录代理目录、全局 `shared-realm-accounts/sao`。** 维护窗口停止相应写入与目录发布器后一起备份，校验 E/F；全局目录不在 SAO 世界目录内，不能漏掉密钥、成员和未知回执。密钥、真实配置、数据库与安装包二进制不提交 Git。

关联投入使用后，不移除 Forge 组件或清空绑定来退回旧密码。UI 回退保留本机原生认证组件和绑定；旧网站暂时不能提供新关联目录时，既有绑定仍可认证。任何回退都保留最新原生密码、成员与玩家进度，不用旧数据库覆盖新数据。结果未知先核对原 ID，不能创建新 ID 重做写入。

## 验证边界

真实隔离实例使用现役字节的 LibreLogin/LoginGuard，以及 Forge1.20.1/DirectAuth1.3.1。覆盖新身体登录、旧身体双重证明、UUID与三枚铁锭保持、双向改密、旧密码拒绝、重连和重启、重复ID、冲突ID、未知不重放、网站离线、过期目录、本地OP拒绝、密钥丢失和禁用后的降级拒绝。首次失败的创建回执保留在隔离账本，未重放或伪造成功；最终组件的成功记录独立保存。

网站在原0.8.31镜像上增量发布0.8.32，保留原九个下载、账户、归属和观战挂载。完整回归354通过、3项原有跳过；最终页面与账号相关检查另做针对性验证。手机尺寸真实无头浏览器检查不等于基岩真机或全部模组功能验收。
