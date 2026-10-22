# 千灯纪网站邮箱账号

2026-10-22，门户 0.5.0。实现与隔离测试已完成；正式发信需服主配置自己的 SMTP 服务。短信与微信尚未启用，页面不会展示可用的扫码或短信登录按钮。

## 用户流程

1. 注册网站用户名、邮箱和至少 6 位网站密码，收取八位验证码；验证成功才创建账号并登录。
2. 以后可用用户名或已验证邮箱加网站密码登录。邮箱大小写统一，不删除点号或 `+` 后缀。
3. 旧账号继续使用原用户名和密码；在“账号与权限 → 验证邮箱”输入当前网站密码，验证新邮箱后绑定。保留原网站 ID、游戏归属与所有角色存档。
4. 忘记密码时向已绑定邮箱发验证码，验证后设置新网站密码并重新登录。其他网站会话和网站 PAT 立即撤销。**不修改游戏密码。**

验证码十分钟有效、一次使用、同一邮箱一分钟冷却与每小时最多五次发送；每个验证码最多五次猜测并绑定申请浏览器。数据库保存验证码摘要与密码 scrypt 哈希，不保存明文密码/验证码。重设请求使用固定回执，不通过接口说明邮箱是否存在。发送失败不建号、不修改原密码。验证码草稿过期一天后清理。

## 发信配置

默认 `emailAuth.registrationMode=email`；SMTP 缺失时关闭新邮箱注册，旧账号正常登录，不自动退回无邮箱注册。`username` 是旧客户端/隔离夹具的兼容模式，不能当成已完成邮箱验证。

云端私有文件建议 `/var/lib/qiandengji-portal/data/smtp.json`，容器内为 `/data/smtp.json`；设置 UID 1000、权限 600，不放 Git。示例中的字段均须替换为自己的服务信息：

```json
{
  "host": "smtp.example.com",
  "port": 465,
  "secure": true,
  "user": "no-reply@example.com",
  "password": "由服主在私有文件填写的SMTP授权码",
  "from": "no-reply@example.com"
}
```

独立网站配置：

```json
{
  "emailAuth": {
    "enabled": true,
    "registrationMode": "email",
    "smtpConfigFile": "/data/smtp.json"
  }
}
```

587 使用 `secure:false`，仍强制 STARTTLS；465 使用 TLS。证书校验保持开启，最低 TLS1.2，不打印 SMTP 调试日志。正式配置后重启网站容器即可，无需重启 Paper；先用自己的邮箱实际收件，再对外宣布邮件已可用。当前仅验证隔离验证码流程和真实 SMTP 连接拒绝明文，没有真实邮箱收件证据。

Nodemailer 固定 10.2.0，参考[官方 SMTP 配置](https://nodemailer.com/smtp)。验证码的限时、单次与恢复后的会话失效参考 [OWASP 密码恢复指引](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。

## API 和测试

- `POST /api/v1/accounts`：邮箱模式返回 202 和 challengeId，不等于账号已创建。
- `POST /api/v1/auth/email/verify`：验证码完成注册、邮箱绑定或重设；用途由服务器草稿决定。
- `POST /api/v1/account/email`：登录并验证当前密码后申请绑定。
- `POST /api/v1/auth/password-reset`：发起恢复，回执不披露邮箱是否注册。
- `GET /api/v1/session`、`site` 返回真实 emailAuth 能力。`GET /account` 仅本人返回邮箱，不进入公开目录。

`npm test` 覆盖注册前后权限、浏览器绑定、过期/五次错误、限频、失败无副作用、旧账号绑定、重设后会话/PAT 撤销、角色 UUID 不变、未配置不绕过、SMTP 强制 TLS、UI 验证码与返回登录流程。手机页面使用 email/one-time-code 自动填充和数字键盘。

回退旧网站程序时保留同一持久卷，不能恢复旧 SQLite 覆盖新用户。新增两张邮箱表不修改原 owners、ownerships 或游戏认证库。旧版本无法提供邮箱登录/找回，应提前说明并保留原用户名登录。


## 可选的阿里云发信服务

[DirectMail 邮件推送](https://help.aliyun.com/zh/direct-mail/getting-started/simplified-procedure-of-sending-by-api-and-smtp)提供 SMTP/API，可直接接上当前邮箱验证流程；需开通服务、验证发信域名并创建发信地址。建议用独立子域 `mail.kangqiang.site`，按控制台要求配置 DNS，再将 SMTP 凭据放入私有配置。官网已经支持标准 SMTP，不代表这个阿里云账号已经开通发信或通过域名验证。

完整托管注册/登录可评估 [IDaaS CIAM](https://help.aliyun.com/zh/idaas/product-overview/product-function-node-idaas)，支持邮箱/手机号及社交登录；迁移时需额外保留本网站 owner 与游戏角色归属。微信仍需自己的微信应用配置。此处为方案研究，没有购买资源、开通计费产品或启用新的身份提供方。
