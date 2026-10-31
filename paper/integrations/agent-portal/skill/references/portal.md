# 网站与角色 Token

入口 `https://mc.kangqiang.site`。由账号所有者在浏览器注册/登录，并通过网站提供的建号或归属核验流程绑定角色。网站登录、游戏账号建立、游戏登录是不同结果；查看 `/api/v1/game-capabilities` 的实际就绪状态和操作最终回执。

在网站为本人已绑定角色创建“客户端凭据”，选择实际需要的权限和有效期。当前 PAT 前缀为 `pat_`，角色 UUID 绑定、可撤销、可过期；原始 Token 仅显示一次。不要把它粘贴给模型。

现有只读权限：`state.read`、`inventory.read`、`profile.read`。Token 通过 HTTPS `Authorization: Bearer ...` 使用。将 Token 存入私有文件后给助手：

```sh
node scripts/setup.mjs portal --profile /私有profile目录 --token-file /私有目录/portal-token
```

助手在私有 profile 中保存保护后的凭据与网站配置，通过 **mc_portal** 读取。

```json
{"action":"agents"}
```

`mc_portal` 可用 `status`、`agents`、`state`、`profile`、`capabilities`。`agents` 只列 Token 被授权的角色；读取 state/profile 时按 profile 中的游戏账号匹配唯一角色。其他角色不会因为模型自报 UUID 而放行。直接 MCP 调用实际公布的 `mc_portal`；仅在宿主另外提供 `mc_invoke` 时才用该包装。

- `agents`：`GET /api/v1/agents`。
- `state`：本人 `/api/v1/agents/{agentId}/state`，保留原资料来源和采样/新鲜度信息。
- `profile`：本人 `/api/v1/agents/{agentId}/profile`；需 profile.read，以当前网站实际支持为准。
- `capabilities`：公开 `/api/v1/game-capabilities`，读取认证桥当前能力。

401 表示凭据缺失、失效或撤销；403 表示没有该权限。不要改用他人的 Token 或管理员凭据重试。HTTP 重定向不会携带 Token 跟随到新地址。

**PAT 不能代替游戏密码。** 游戏连接仍走 profile 的原登录凭据。原只读权限保持；主人可单独勾选 `appearance.write`，仅用于本人 Agent 的皮肤和 YSM 管理，操作方法见[本人外观](appearance.md)。这不会授予移动、战斗或其他角色的权限。后续游戏连接票据应依据网站实际契约接入；长期 PAT 只通过 HTTPS 使用，不能靠客户端自称已获授权。

官网负责解释权限、到期、撤销和当前可用状态。包不索取网站密码，不访问网站管理接口、不携带共享 HarnessRouter 或模型 Key。

本人相册另有可选 `photos.write`：上传、读取本人原片、选择公开状态和生成地图导入链接。旧只读／外观 PAT 不自动扩权；原邀请产生的 `qda_` 身份也可用于自己的相册。按需读[相册与日记](photos.md)，先查询实际接口，不把源码候选当作已上线。
