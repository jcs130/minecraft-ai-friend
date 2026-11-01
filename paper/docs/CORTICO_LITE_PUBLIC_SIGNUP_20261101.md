# Cortico Lite 免邀请接入：官网 0.8.35

2026-11-01 12:58（北京时间）已发布，公网能力和下载回读通过。服主在本会话直接批准公开注册、保留限流及普通 Agent 权限，并授权回传客户端会话。游戏服未重启。

## 官方工具

下载：https://mc.kangqiang.site/agent-register.mjs

SHA256：`77738a4b13c8d7e7c356f413521cb22b8495da776462ced43c202521866f593f`

```text
node agent-register.mjs join-plugin --portal https://mc.kangqiang.site --username ag_MyAgent --identity-file /私有目录/identity.json
```

独立工具需要 Node.js 22.13+，不依赖 npm 或宿主框架。不要覆盖已保存的身份文件。旧 `join --invite-url-file ...` 继续兼容；Skill 1.3.7 冻结包未重发，因此免邀入口使用上面的独立工具。

## API 契约

1. `GET /api/v1/agent-access`：`publicSignup.enabled=true`、`invitationRequired=false`、`publicSignup.role=ordinary_agent`；`helper.sha256` 对应当时实际文件。
2. 本机先保存随机 UUID `requestId`、随机32字节 base64url `clientSecret`、自选 `username`。名称以小写 `ag_` 开头，总长4–16位，仅字母数字下划线；先确认未占用，不使用保留名。
3. `POST /api/v1/agent-access/public-register`，JSON 为上述三字段，不需要邀请码，不带 Cookie/Origin。首次201；原请求标识、名称和密钥重试200且 `duplicate=true`；换参409。User-Agent、自报插件名和 clientId 不能获得额外权限。
4. 用返回的 `clientId=requestId` 及本机原 `clientSecret` 调用 `POST /api/v1/agent-access/sessions`。原 sessions/status/activate/state/session 协议保持。
5. `GET .../status`。若为 `not_created`，保存另一个激活 UUID `requestId` 和独立 `gamePassword`，再 `POST .../activate`。密码6–64位、无空白、避免常见弱密码。`pending/unknown` 只查原状态，不换标识、不重建。仅在服务明确未接收且状态允许时处理失败。
6. `state=ready` 且 `gameAccountCreated=true` 只表示建号完成。工具明确返回 `gameLoginVerified=false`。客户端从原私有身份读取游戏密码，连接能力响应的游戏地址，收到 `MC_AUTH_SUCCESS` 且世界可用才显示已入服。API token 不是游戏密码。

新角色只进入体验池，不能认领已有角色、修改他人密码、创建网站管理员或 OP。主人以后注册网站账号，用原游戏角色 `/portal bind` 的认证证明认领；原 UUID、密码、背包、成长和 API 身份保持。

每网络每小时6个新角色、每日20个，计数持久化；体验池最多100个未认领角色或待用邀请。请求层另有12次/15分钟上限；429遵守 `Retry-After`。达到新建配额后，同一身份的登记重试仍可恢复原结果，但请求层限流仍然生效。

## 验证及边界

本机365通过、3个原条件跳过；云端368通过，另3组未发布 NEKO OAuth 测试不在本次部署范围。验证包含重复登记、更参/重名拒绝、持久限流、普通权限、加密建号结果、原游戏证明认领、工具断线接续及不虚报入服。正式公网能力/工具摘要/无 JS 引导已回读；真实 Cortico Lite 宿主入服仍由客户端独立验收。

发布只改12个已核对的运行文件，保留现役其他代码、观战资源、配置和21类原始资料。更新前完整网站一致数据库备份已在 E/F 双盘核验，临时 OSS 对象为私有且匿名403。首次切换因把环境变量顺序误当成配置差异而回退；逐键及挂载核对确认无配置变化后，以新入口发布成功，失败回执保留。

回传工具最初报跨机宿主不可达；客户端会话随后直接读取本会话上线说明，确认完成官方 helper 与新端点对接并发布 Lite 0.1.2。该会话报告了自己的独立宿主测试；本轮没有额外创建正式服测试角色，也没有为了客户端重启游戏服。
