# mc-gateway 玩家门户服务端（133）

> 千灯纪玩家门户的服务端，由女神（mc-god）开发。供贾维斯（162）的登录器门户化调用。
> **定位：真人玩家及其朋友。** 与女神域里的 MC bot / 穿越者是两条线，勿混。

## 架构原则：高内聚、低耦合，绝不打扰 AI 功能

本服务只做两件事，且只做这两件事：

1. **用户信息录入与维护** —— 注册 / 登录 / 登出 / 资料、头像、皮肤、角色、机器绑定。
2. **数据查询** —— 在线状态、玩家列表、用户资料、服务端 mods 清单与分发、健康检查。

### 与 AI 功能的耦合边界（低耦合）

| 接口 | 方向 | 说明 |
|---|---|---|
| RCON `list` | 只读 | 查询在线玩家。不执行/不写入任何世界状态。 |
| `<server>/mods` 目录 | 只读 | 生成 mod 清单与分发。不写入。 |
| 自己的 SQLite（`gateway.db`） | 自有 | 用户/会话/索引。与 AI 数据完全隔离。 |
| vLLM（8890） | **默认关闭** | 「玩家命令→LLM」是**可选解耦层**，`GATEWAY_COMMAND_LLM=1` 才启用；默认不触碰 AI 模型。 |

**绝不**：写 world-heartbeat / chronicle / village / 任何 `.json/.log`；动世界进程、`mc_npc`、9090 面板；复用它们的代码或共享内存。
**独立**：独立进程、独立端口（8011）、独立解释器（`C:\Python314\python.exe`）、独立数据目录。门户崩溃/重启 **不** 影响 AI 功能；AI 功能也 **不** 依赖门户。

## 运行

```bat
set GATEWAY_PORT=8011
set MC_DATA_DIR=C:\...\minecraft-ai-friend\mc-data
set MC_SERVER_DIR=C:\...\minecraft-ai-friend\mc-server
C:\Python314\python.exe mc_gateway.py
```
纯标准库（Python 3.11+，建议 3.13/3.14），零第三方依赖。建议作为独立 Windows 服务/计划任务常驻。

## API 契约

### 网关
- `GET /api/gateway/health` → 服务健康 + 服务端可达性。
- `GET /api/gateway/modlist` → 服务端实际加载 mods：`{modId, version, displayName, filename, size, mtime, sha256, side, definesEntitySync}`。
  - `side`: `BOTH`(客户端需同款) / `SERVER`(纯服务端，客户端不要装)。
  - `definesEntitySync=true` → 该 mod 定义自定义实体同步槽，**客户端必须装同 SHA**，否则进服崩溃（如 `settlements`）。
- `GET /api/gateway/mod/download?modId=X`（需登录）→ `{source: pan|direct, download_url, extract_code?, sha256}`。网盘通道由 `data/pan_links.json` 提供；未配置走直连。
- `GET /api/gateway/mod/file?modId=X`（需登录）→ 流式下发 mod jar（白名单 + 路径穿越防护）。

### 认证
- `POST /api/auth/register` `{username,password,nickname?}`
- `POST /api/auth/login` `{username,password}` → `{token, username, nickname, role, server_tag, skin}`
- `POST /api/auth/logout`（需登录）

### 用户
- `GET/POST /api/user/profile`、`GET/POST /api/user/skin`、`GET /api/user/info`、`GET /api/user/online`
- `GET /api/admin/player/list`（owner/admin）

### 命令（可选解耦层，默认关）
- `POST /api/player/command` `{text}`（需登录）→ `GATEWAY_COMMAND_LLM=1` 时才送本地 LLM 解析；否则返回 `disabled`。

## 安全
- 密码仅存 PBKDF2-HMAC-SHA256 哈希 + salt；账号/会话 token 绝不入共享池。
- 仅绑定局域网回环；敏感动作（管理员列表等）限 `owner/admin`。
