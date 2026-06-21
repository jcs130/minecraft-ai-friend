# 第三方 Agent 集成设计

这个项目既是独立产品，也是可被第三方 Agent 调用的本地能力层。Codex、CoPaw、小龙虾或其他 Agent 不需要直接理解 Minecraft Server、Mindcraft、settings.js、profile JSON，只需要调用稳定的本地接口。

## 集成形态

### 1. HTTP / OpenAPI

默认控制台提供本地 HTTP API，适合 Web 前端、自动化脚本、桌面应用和启动器插件调用。

OpenAPI 草案见：`integrations/openapi.yaml`。

### 2. MCP Server

控制台已经内置 MCP endpoint：

- 旧式 SSE：`GET /mcp/sse` + `POST /mcp/messages`
- Streamable HTTP：`/mcp`

说明见：`docs/COPAW_MCP.md`。

### 3. Codex 插件草案

Codex 插件可以把本项目注册成“我的世界AI陪玩”能力，让 Codex 直接调用本地 API。

插件草案见：`integrations/codex-plugin/`。

## 推荐工具语义

### 查询状态

第三方 Agent 应先查询状态，确认服务器、Mindcraft、socket、AI 玩家和 Autopilot 是否在线。

### 启动陪玩

推荐按高层流程执行：

1. 启动 Minecraft Server。
2. 等待 `minecraft.tcpOpen=true`。
3. 启动 Mindcraft。
4. 等待 `mindcraft.httpOk=true`。
5. 恢复居民进服。
6. 启动自动陪玩。
7. 下发初始任务或激活村庄模式。

### 下发任务

第三方 Agent 不应该直接控制底层 Mineflayer 动作。它应该发送高层意图，例如：

- “陪玩家完成第一晚生存”。
- “作为护卫保护玩家，不要贴身跟随”。
- “改善基地照明，不要拆已有建筑”。
- “让村长派 Milo 和 Nova 去补煤和火把”。

底层行为由 Mindcraft 和本项目的自动陪玩策略处理。

## 安全边界

- 默认只监听 `127.0.0.1`。
- MCP 当前只接受 localhost 请求。
- 第三方 Agent 不应获得 API key、keys.json 或服务器 secret。
- 配置写入必须继续使用白名单。
- 外部启动的 Minecraft Server 不允许被强制停止。
- 危险命令和 `allow_insecure_coding` 应默认关闭或明确提示。

## 后续实现建议

- 增加 token-based local auth，可选开启。
- 给局域网只读直播页面和控制 API 做权限分层。
- 将 OpenAPI 草案补齐到当前 `/api/*` 和 MCP 工具能力。
- 提供可安装的 Codex 插件包。
