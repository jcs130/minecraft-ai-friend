# 网站与 Agent Skill 接入契约

日期 2026-10-22。网站 **https://mc.kangqiang.site**，公网游戏入口 **micro.kangqiang.site:25702**；实际探测 25702 返回 Velocity，默认 25565 当前拒绝连接。内网按原网关地址连接。源码在 `paper/integrations/agent-portal`。

## 发布边界

网站0.7.0已发布，提供自己的ag_角色注册/绑定/改密、邀请链接与提示词、私有设定图、皮肤/YSM与下述只读API。SMTP尚未配置，邮箱注册流程不代表现在能投递确认邮件；既有网站账号和主人发出的Agent邀请可用。正式账号桥已经授权上线，现役LoginGuard0.1.5，真实1.20.6/1.21.1登录和恢复检查通过；仍以 `/api/v1/game-capabilities` 的实际ready为准，不能把API注册当作游戏建号成功。当前源码 `64b9a305`，见[接入发布](AGENT_PORTAL_JOIN_APPEARANCE.md)。

用户自己的 Agent 负责模型、规划循环、长期记忆和人设。Skill 是本地 stdio MCP + Mineflayer 执行/观察/回执，不向网站提交模型 Key，不提供共享模型凭据或公网通用 RCON/Numen 控制接口。

## 安装包

网站“连接中心/帮助”和 `/join` 提供同源固定下载：`/downloads/qiandengji-agent-1.1.0.zip`，2,782,362字节、44份清单文件，含固定 `agent-mc-world 0.4.0` 无画面SDK、34项工具及10个原核心工作/移动例程。

SHA256：`6a1be95fa174e37c330a756ffdbc32f0924254099390d1fc99a236c451d8fe7d`。包内无现役角色资料、世界、模型Key或用户凭据；先读SKILL.md，再按需读references/invite.md与核心资料。1.0.0原下载及摘要保留以兼容旧链接，不作为当前推荐安装包。

## 两套凭据

- `MC_GAME_PASSWORD`：游戏账号密码，只由本地登录适配器发送原 /login 或首次 /register，不给 LLM。
- `QD_PORTAL_CLIENT_TOKEN`：网站创建的 `pat_...` 只读凭据，`Authorization: Bearer ...`，限定单个真实游戏 UUID、权限和 1–90 天期限。只能在本人已核验角色上创建；撤销后下次读取立即失败。网站密码变更/恢复会撤销 PAT。
- **PAT 不是 Minecraft 登录票据**，没有已实现的 game.connect/OAuth 自动进服能力。网站注册 Agent 后应等待原 account job 最终 succeeded，unknown 只查原请求，不自动重发。
- LoginGuard 紧凑自动 MC_AUTH_STATE 不承诺带 username；客户端须等待实际授权成功和世界 PLAY 就绪，不能把密码验证通过当成最终入服。

## API

| 请求 | 最少权限 | 内容 |
| --- | --- | --- |
| GET /api/v1/agents | state.read | 该 PAT 对应的本人角色 |
| GET /api/v1/agents/{id}/state | state.read | 真实保存属性/进度；inventory.read 才含背包 |
| GET /api/v1/agents/{id}/connection-config | state.read | 不含秘密的门户地址、用户名、原 UUID 与环境变量名 |
| GET /api/v1/agents/{id}/profile | profile.read | 本人可选文字设定、私有参考图目录与创作授权状态 |
| GET /api/v1/agents/{id}/references/{referenceId} | profile.read | 本人的 PNG/JPEG/WebP；不得当成公开图片 URL |

`id` 是网站盐化的 24 位 hex ID，**不等于游戏 UUID**；换另一网站库不能假设相同 id。Bearer 放 Header，不放 URL。只读 PAT 不能注册、改密或写设定图；这些动作需要网站本人会话、Origin/CSRF，敏感操作需近期重验密码。

设定图上传最多 3 张、每张 4MB、边长 4096，默认仅本人/网站管理员可见。`useReferences=false` 时不能作为创作参考；`availableForGeneration=true` 表示资料已准备，**不表示网站已实现生成或调用模型**。真实游戏相机/YSM/皮肤保持独立。

## 另行设计的真人准入

其他接入工作流提出“真人必须先网站登记，正版可免游戏密码、离线玩家设独立游戏密码”的后续方案；当前没有对现役玩家启用此门禁，也未给普通非 ag_ 玩家增加网页建号。游戏凭据继续由 LibreLogin 唯一管理；网站 owner 密码独立，不能混用。网站→游戏改密已实测，游戏内改密→网站最新密码核验与并发改密的完整双向场景尚需后续隔离验收。

当前未实现微软/Minecraft OAuth、正版与网站账号的一次性联合准入、Xbox/XUID 网站证明或完整 FOM 客户端重打包。通用游戏绑定 proof 可以验证已设密码的离线角色，不能声称是正版证明；不得仅用 ag_ 前缀授予豁免。以上不能随着本次网站发布偷偷改变生产认证规则。


## 服主归属与未绑定角色

网站owner jcs130已绑定4指定角色及140测试身份。`GET /agents`中的`isOwn`才表示本人归属，管理员read access并不表示全部角色属于自己。`GET /roster`只有公开`claimable`，不包含owner ID或原游戏UUID。管理名/Eye的false不能解释为普通角色已被某用户领走。暂未上线正式认领桥与SMTP，不能称注册/认领完整开放；既有账户登录与已绑定归属正常。
