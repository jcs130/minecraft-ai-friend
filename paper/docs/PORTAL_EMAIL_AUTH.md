# 千灯纪网站邮箱账号

2026-10-23，门户 **0.7.1已部署到阿里云**。用户名和至少6位密码即可注册，邮箱可选；正式DirectMail域名和TLS发信认证已接通，真实邮箱收件仍待本人验收。短信与微信尚未启用，页面不会展示可用的扫码或短信登录按钮。

## 用户流程

1. 用网站用户名和6–128位密码即可注册并登录，邮箱可留空。若填写邮箱，必须收取八位验证码并验证成功后才建号。未绑定邮箱时不能通过邮件找回密码，也可稍后在账号页补绑。
2. 以后可用用户名或已验证邮箱加网站密码登录。邮箱大小写统一，不删除点号或 `+` 后缀。
3. 旧账号继续使用原用户名和密码；在“账号与权限 → 验证邮箱”输入当前网站密码，验证新邮箱后绑定。保留原网站 ID、游戏归属与所有角色存档。
4. 忘记密码时向已绑定邮箱发验证码，验证后设置新网站密码并重新登录。其他网站会话和网站 PAT 立即撤销。**不修改游戏密码。**

验证码十分钟有效、一次使用、同一邮箱一分钟冷却与每小时最多五次发送；每个验证码最多五次猜测并绑定申请浏览器。数据库保存验证码摘要与密码 scrypt 哈希，不保存明文密码/验证码。重设请求使用固定回执，不通过接口说明邮箱是否存在。发送失败不建号、不修改原密码。验证码草稿过期一天后清理。

## 发信配置

默认 `emailAuth.registrationMode=optional-email`，这是服主明确选择的轻量注册方式；没有SMTP时仍可留空邮箱注册，不能默默丢弃用户填写的邮箱。严格 `email` 模式仍要求验证且缺SMTP时关闭新注册；旧 `username` 模式兼容保留，不把该模式的账号当成已验证邮箱。全站 `allowRegistration=false` 仍阻止所有模式的新注册。

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
    "registrationMode": "optional-email",
    "smtpConfigFile": "/data/smtp.json"
  }
}
```

587 使用 `secure:false`，仍强制 STARTTLS；465 使用 TLS。证书校验保持开启，最低 TLS1.2，不打印 SMTP 调试日志。正式配置后仅需更新网站容器，无需重启Paper。已在云端用原Nodemailer完成实际SMTP TLS握手和账号认证；SPF、DKIM、DMARC、MX、所有权与CNAME记录全部通过。发信地址为 `noreply@mail.kangqiang.site`，华东杭州SMTP `smtpdm.aliyun.com:465`。原8条DNS记录完整保留，新增仅限mail子域的6条记录。没有把SMTP认证等同于真实邮箱收到验证码；该项仍待本人收件确认。

Nodemailer 固定 10.2.0，参考[官方 SMTP 配置](https://nodemailer.com/smtp)。验证码的限时、单次与恢复后的会话失效参考 [OWASP 密码恢复指引](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。

## API 和测试

- `POST /api/v1/accounts`：可选邮箱模式留空返回201并登录；提供邮箱或严格邮箱模式返回202和challengeId，验证前不创建账号。
- `POST /api/v1/auth/email/verify`：验证码完成注册、邮箱绑定或重设；用途由服务器草稿决定。
- `POST /api/v1/account/email`：登录并验证当前密码后申请绑定。
- `POST /api/v1/auth/password-reset`：发起恢复，回执不披露邮箱是否注册。
- `GET /api/v1/session`、`site` 返回真实 emailAuth 能力。`GET /account` 仅本人返回邮箱，不进入公开目录。

完整 **148项** Node/API/DOM测试通过，新增10项覆盖可选邮箱、留空注册、发信不可用、格式错误、严格模式兼容、关闭注册、两条页面流程和实际版本号。公网10项检查验证0.7.1、两条能力、原游戏桥、CSRF、非法注册不建号、验证码拒绝和前端字节摘要；没有在正式库创建测试账号。390px注册表单已实看，邮箱不是必填且无横向溢出，非手机真机验收。

回退到0.7.0须同时恢复云端 `email-registration-20261023/config.before-optional-email.json`，因为旧程序不识别optional-email模式；再启用保留的 `qiandengji-portal-prev-before-registration-20261023`。保留同一持久卷，不能恢复旧SQLite覆盖新用户。新增两张邮箱表不修改原 owners、ownerships 或游戏认证库。旧版本无法提供邮箱登录/找回，应提前说明并保留原用户名登录。


## 可选的阿里云发信服务

[DirectMail 邮件推送](https://help.aliyun.com/zh/direct-mail/getting-started/simplified-procedure-of-sending-by-api-and-smtp)提供 SMTP/API，可直接接上当前邮箱验证流程；需开通服务、验证发信域名并创建发信地址。建议用独立子域 `mail.kangqiang.site`，按控制台要求配置 DNS，再将 SMTP 凭据放入私有配置。官网已经支持标准 SMTP，不代表这个阿里云账号已经开通发信或通过域名验证。

完整托管注册/登录可评估 [IDaaS CIAM](https://help.aliyun.com/zh/idaas/product-overview/product-function-node-idaas)，支持邮箱/手机号及社交登录；迁移时需额外保留本网站 owner 与游戏角色归属。微信仍需自己的微信应用配置。此处为方案研究，没有购买资源、开通计费产品或启用新的身份提供方。


## 本次发布记录

源码 `77632a91`、镜像 `sha256:b5d2e4233265120b12ec9149ae54ba3402d2e167a543ee0e005195b0ce701080`。原一个网站管理员、六条角色归属、141条测试归档和全部原密码保持。首次候选因健康接口仍返回写死的旧版本号，被部署检查拦截并自动回退；补为读取实际package版本、新增回归后最终发布通过。Paper和登录代理未重启，其他对话未发布的3D页面没有随包上线。

详见[机器清单](../manifests/portal-registration-release-20261023.json)。私有SMTP凭据仅在云端600权限文件和E/F受限私有目录，代码、日志、下载包与网页均不含凭据。
