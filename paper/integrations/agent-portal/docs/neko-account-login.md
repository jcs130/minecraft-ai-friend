# 猫娘计划登录与插件接入（开发候选）

这是千灯纪作为独立 OIDC 网站使用猫娘计划账号的实现。默认关闭，尚未登记或部署到公网；不修改 Neko 主程序、插件 SDK 或市场工作流，不读取宿主的 OAuth、市场或社区令牌。

## 一次性站点登记

向猫娘计划的官方身份服务登记千灯纪自己的应用：

| 项目 | 值 |
| --- | --- |
| Issuer | `https://auth.project-neko.cn/` |
| 回调地址 | `https://mc.kangqiang.site/api/v1/auth/neko/callback` |
| 授权流程 | Authorization Code，PKCE S256 |
| Scope | `openid` |
| ID Token 签名 | RS256 |
| 客户端认证 | 独立登记的公开 PKCE 客户端（none），或登记的机密客户端 |

发现文档：<https://auth.project-neko.cn/.well-known/openid-configuration>。当前发现文档没有动态客户端注册端点；不可借用 `neko-desktop`、`neko-servers-desktop-prod` 或 `neko-servers-web-prod`。Client ID 不是用户密码；如服务方要求 Client Secret，放在服务器私有环境中，不写入仓库、插件包或对话。

在实际运行容器的私有环境中设置 `PORTAL_NEKO_OAUTH_ENABLED=true`、`PORTAL_NEKO_OAUTH_CLIENT_ID=平台实际登记的ID` 和 `PORTAL_PUBLIC_ORIGIN=https://mc.kangqiang.site`；机密客户端另设 `PORTAL_NEKO_OAUTH_CLIENT_SECRET`。`ENABLED` 只接受小写 `true/false`，默认关闭。也可在真正挂载到 `/app/config.local.json` 的私有配置中设置 `nekoAuth.enabled=true/clientId`，不能只把文件放在宿主机而不挂载。默认镜像不会复制私有配置。未配置、非 HTTPS 或借用其他应用 ID 时，能力接口返回不可用，插件不提交角色申请。

登记材料见 [neko-oauth-application.json](neko-oauth-application.json)，它是待提交模板，不是登记回执。交给猫娘计划身份平台的应用管理者，要求启用 PKCE S256；若平台要求机密客户端，则明确登记 `client_secret_post` 并私下配置 secret。不要猜测或对公开 auth 域名调用管理 API。官方 [neko-auth-client](https://github.com/Project-N-E-K-O/neko-auth-client) 是网站登录 SDK，不提供生产客户端登记权限；目前未查到可核实的普通用户自助登记入口。

实际启用按以下顺序进行：平台返回独立应用登记 → 整合当前官网并备份配置、SQLite 与持久卷 → 配置容器环境和可信 HTTPS 代理 → 正常发布官网 → 匿名检查 `/api/v1/auth/neko` 为 200/available=true、`/neko-login.js` 为 200 → 本人真实登录与回调 → 插件批准一次固定角色申请 → 验证建号结果和游戏自动登录。原账号关联应单独测试归属、密码和角色保持。未完成真实授权前不发布为可用能力。

部署同时使用已脱敏的 `deploy/nginx.conf.example`：访问日志只记路径，不记查询串或 Referer；精确回调抑制普通代理错误中的请求 URI。还需检查实际 CDN、负载均衡和其他代理日志。这个源码示例修订没有应用到线上，不能据此声称现有线上日志已脱敏或曾经泄露。权限和日志策略由站点维护者在真实部署中核实。

部署前先整合最新官网候选，备份网站私有配置和数据；不能用旧公开源码覆盖更新的线上内容。本功能不要求重启或部署 Paper、LoginGuard、Java、模型或 Neko。实际 OAuth 和完整新账号入服应在登记和网站部署后另行验收，未由离线通过代替。

## 用户体验

网站 `/join` 提供「使用猫娘计划账号登录千灯纪」。首次已验证的官方 `issuer/clientId/subject` 建立普通网站 owner，无需用户另设网站密码。已有千灯纪账号必须先用原方式登录，再选择关联；不按同名或邮箱匹配原账号，不创建管理员。已关联账号可用同一 Neko 身份重新验证，以更新网站近期认证；不同身份不会取代原绑定。

插件显式发起一笔新角色申请，生成自己的私有 `qnp_` 凭据与密码。浏览器以近期验证的、已关联网站账号批准该固定角色；插件随后使用原游戏账号桥的名字、限额和密码校验建号，并仅查询原作业。浏览器批准不启动游戏，网站不向插件提供 Neko 令牌或网站会话。

## 接口边界

- `GET /api/v1/auth/neko` 只读公开能力，不新建浏览器会话。
- `POST /api/v1/auth/neko/start` 需要同源、CSRF 与原浏览器会话；模式为 login/link/reauth。原浏览器会话在异步换码完成后再次检查；身份变更与新会话在同一 SQLite 事务内完成，注销和切换账号不会被迟到回调撤销。
- `GET /api/v1/auth/neko/callback` 只接受官方 HTTPS 回调，绑定临时 HttpOnly/Secure/Lax 浏览器 Cookie、一次性 state、PKCE 与 nonce。换码超时不重放；校验固定 issuer、独立 aud/azp、RSA 签名、期限及 subject，不把令牌或原始提供方错误回传。
- `POST /api/v1/neko-plugin/requests` 创建十分钟授权申请；同一请求只能对应一个固定新角色和建号请求 UUID。
- `GET /api/v1/neko-plugin/requests/:id/preview` 只显示待批准昵称。`approve` 需要 CSRF、已关联 owner 与十分钟内的近期认证，批准期七天。
- 插件的 `status/activate/renew` 拒绝网站 Cookie/Origin，只接受自己生成的 `Bearer qnp_…`。`activate` 在原作业提交前持久标记；响应丢失、原作业缺失或未知时不重发。不提供任意角色、重置密码、认领旧身份或任意游戏命令。
- 过期禁止新激活；已提交原作业的 pending/终态仍可查询以恢复连接保存。尚未提交的过期申请可显式 renew，保持角色/请求/凭据不变，再由本人授权；已尝试或未知请求不能 renew。

## 验证

`node --test tests/neko-auth.test.mjs tests/neko-login-routes.test.mjs` 覆盖签名、issuer/aud/nonce、PKCE、Cookie/state、CSRF、HTTPS、现有 owner 保留、注销/切换期间的迟到回调、SSO 同身份重验、窄权限批准及过期查询恢复；只使用临时 SQLite 和隔离假 IdP，不触发真实账号、服务器或模型。

正式验收另核对用户端官方授权页、回调、原角色保留、一次性新角色准备和后续显式开始。截图排除密码、令牌和身份文件。候选完成不等于公网启用或公开发行。
