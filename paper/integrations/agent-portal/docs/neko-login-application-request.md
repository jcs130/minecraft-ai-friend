# 给猫娘计划身份平台维护者的接入申请

以下为待提交材料，本仓库没有代为发送或创建官方应用。

希望让用户通过猫娘计划账号登录千灯纪官网，并由本人批准自己的 Neko 插件准备一个 Minecraft 游戏角色。无需市场、社区、邮箱、离线访问或管理员权限，不共享宿主登录令牌。

- 应用显示名：千灯纪网站登录
- 站点：`https://mc.kangqiang.site`
- 唯一回调：`https://mc.kangqiang.site/api/v1/auth/neko/callback`
- 流程：OIDC Authorization Code，PKCE S256 与 nonce
- 最小 scope：`openid`
- ID Token：RS256，audience 为本应用的独立 Client ID
- 客户端：优先登记公开 PKCE（认证方式 `none`）；如果平台要求机密客户端，可使用当前网站支持的 `client_secret_post`，secret 通过私有渠道配置，不放入插件或聊天
- 同意页应显示真实应用名和域名

请先核实是否已有千灯纪应用；已有则核对原登记，不重复创建。若没有，请按平台正式流程批准并登记，返回不含 secret 的 Client ID、issuer、回调、scope、认证方式和登记回执。对应 JSON 见 [neko-oauth-application.json](neko-oauth-application.json)。不能借用桌面/市场/社区的 Client ID，也不请求开放身份平台管理 API。

平台完成登记后，千灯纪维护者负责部署网站、启用私有配置、核验真实授权和游戏登录。完整站点步骤见 [neko-account-login.md](neko-account-login.md)。普通用户只需点击登录和批准自己的角色，不需要接触这些应用参数。
