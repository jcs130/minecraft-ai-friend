# 邀请码 Agent 接入（门户 0.6.0）

## 归属与上线边界

主人在连接中心创建一次性邀请。受邀程序获得独立的 Agent API 身份，新游戏角色绑定到邀请人的网站账号；不另建网站管理员，也不需要主人的网站密码。普通用户仍通过邮箱注册网站账号，邀请码不冒充邮箱验证。

网站为 `https://mc.kangqiang.site`，游戏为 `micro.kangqiang.site:25702`（1.21.1）。`GET /api/v1/agent-access` 返回真实桥能力及工具 SHA256。正式认证桥仍待服主确认更新；本次网站发布不重启 Paper 或登录代理。`ready=false` 时可先登记 API 身份，游戏激活返回 503，不伪造建号或入服成功。

网页指引 `/agent-api.html`，独立 Node 22 工具 `/agent-register.mjs`。接入方使用自己的框架、模型、设定和记忆；原 Agent Skill 1.0.0 的文件及摘要保持。

## 主人操作

登录 → 连接中心 → 邀请自己的 Agent。可限定新游戏名，默认 24 小时、最长 7 天。邀请码只显示一次，数据库仅存 SHA256；一次只能注册一个身份。最多 20 个有效待用邀请；普通主人已有角色、未激活注册及其他待建角色合计最多 5 个。

网页沿用 Cookie、CSRF、Origin 和最近十分钟重新认证。仅本人可查看或撤销自己的邀请。撤销立即失效对应 API 身份和会话，不删除游戏角色、密码、背包或 Eye 配对；已受理建号仍查原请求结果。

## API

机器接口拒绝浏览器 Cookie / Origin，复用 HTTPS 443，不开放家庭新端口。配置开关为 `agentAccess.enabled`。

| 用途 | 方法与路径 | 凭据／参数 |
| --- | --- | --- |
| 发现 | `GET /api/v1/agent-access` | 公开能力、路由、版本与工具摘要 |
| 兑换 | `POST /api/v1/agent-access/register` | Bearer `qdi_...`；JSON `requestId` UUID、`username`、随机 32 字节 base64url `clientSecret` |
| API 登录 | `POST /api/v1/agent-access/sessions` | JSON `clientId`、`clientSecret`；返回一小时 `qda_...`，替换旧 API 会话 |
| 状态 | `GET /api/v1/agent-access/status` | Bearer `qda_...`；本人处理状态与下一步 |
| 建号 | `POST /api/v1/agent-access/activate` | Bearer `qda_...`；持久保存的 `requestId`、独立 `gamePassword` |
| 本人资料 | `GET /api/v1/agent-access/state` | Bearer `qda_...`；核实原 UUID 和主人后读取本人保存资料 |
| API 退出 | `DELETE /api/v1/agent-access/session` | Bearer `qda_...`；不退出游戏 |

新角色必须为小写 `ag_` 开头、总长不超过 16 位。尾缀 eye、管理名、已有角色和归档测试名拒绝注册；已有角色仍用独立的游戏内归属证明。请求中的 ownerId、role、scope 不授予权限。`qda_` 不能调用网站账号、私有角色列表、认领、改密或管理接口，也不是游戏密码。

首次 HTTP 前保存 requestId、clientSecret、独立游戏密码。兑换响应丢失后，同参数重试不会重复消费邀请；之后用 clientId/clientSecret 登录。API 身份、会话和邀请只存摘要，游戏密码仅经原 AES-GCM 队列发往 LibreLogin，不进入明文数据库、日志或资料同步。

只有 `state=ready` 且 `gameAccountCreated=true` 才表示原生服务确认。pending / unknown 时只查原请求，不换 ID 或重放。入服仍等待 MC_AUTH_SUCCESS 和 PLAY；保存资料不冒充实时库存。

独立工具支持 register、login、status、activate、state、logout、help。邀请码和密码仅用私有文件，不接收明文密钥命令参数、不打印密钥。只有明确 401 后的只读请求刷新一次 API 会话；未知结果的激活不自动重放。

## 历史测试绑定清理

服主明确清理测试账号并保留 Eye。已逐条核对 140 个 UUID，均匹配 Paper usercache 历史、非 OP、非当时在线，且不在 Agent/Eye 配对登记中。清理的是先前导入的 140 条网站测试绑定，保留原审计与可恢复归档，不是删除游戏存档或 140 个常驻 Agent。

`jcs130` 保留 ag_CorMy、.MicroKQ、ag_Kirito、ag_NarutoPi 四个原 UUID 绑定。网站账号、密码、游戏文件、Eye 与配对均未改。云端 SQLite backup 后，事务移入 archived_test_roles；后续快照不会复活公开测试角色，邀请码也不能重新占用它们。备份 `before-test-archive-20261022T103357.sqlite.gz`；恢复应按选定 UUID 单独恢复，不能覆盖之后的新用户。

## 验证与回退

自动测试覆盖兑换、撤销、过期、同身份重试、并发、配额、主人隔离、CSRF 边界、Eye/管理名拒绝、归档不复活、会话轮换、丢包与未知结果；网页 DOM 覆盖创建、关闭密钥、撤销及退出清除列表。

隔离真实 Paper 1.21.1 / Velocity / LibreLogin / 两把 AES 密钥出站桥 16 项通过：普通主人邀请、工具注册/API 登录、原生建号、Mineflayer 密码入服到 PLAY、原 UUID、四块铁锭协议实收和 API 同数、归属、重试不多建、撤销不删身体。首次隔离暴露云目录漏保存 Store 引用，已修复并保留失败记录；第二轮 Paper/代理退出均为 0。新测试角色仅在隔离服。

关闭 agentAccess.enabled 可停用机器接入。程序可回退至 0.5.1，保留当前数据库、新用户和图片，不能整体恢复旧数据库。正式游戏桥按独立确认维护上线。
