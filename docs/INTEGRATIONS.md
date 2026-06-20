# 第三方 Agent 集成设计

这个项目应该同时是一个独立产品和一个可被第三方 Agent 调用的本地能力层。Codex、小龙虾或其他 Agent 不需要直接理解 Minecraft Server、Mindcraft、settings.js、profile JSON，只需要调用稳定的本地接口。

## 集成形态

### 1. HTTP / OpenAPI

默认控制台已经提供本地 HTTP API，适合最广泛的接入方式：

- Web 前端调用。
- 第三方 Agent 通过 HTTP 调用。
- 自动化脚本、桌面应用、启动器插件调用。

OpenAPI 草案见：`integrations/openapi.yaml`。

### 2. Codex 插件

Codex 插件可以把本项目注册成“我的世界AI陪玩”能力，让 Codex 直接调用本地 API：

- 查询 Minecraft/Mindcraft/AI 玩家状态。
- 启动服务器和 Mindcraft。
- 给 AI 队友下发高层任务。
- 读取日志和记忆。
- 调整安全白名单内的配置。

插件草案见：`integrations/codex-plugin/`。

### 3. MCP Server

MCP 适合更通用的 Agent 生态。建议后续提供一个轻量 MCP adapter，把 HTTP API 映射成工具：

- `minecraft_status`
- `start_minecraft_server`
- `start_mindcraft`
- `send_companion_task`
- `get_agent_memory`
- `read_minecraft_log`

MCP 设计草案见：`integrations/mcp/README.md`。

## 推荐工具语义

### 查询状态

Agent 应先调用状态接口，确认服务器、Mindcraft 和 AI 玩家是否在线。

### 启动陪玩

Agent 可以调用一键流程，也可以按步骤执行：

1. 启动 Minecraft Server。
2. 等待 `minecraft.tcpOpen=true`。
3. 启动 Mindcraft。
4. 等待 `mindcraft.httpOk=true`。
5. 启动自动陪玩。
6. 下发初始任务。

### 下发任务

第三方 Agent 不应该直接控制底层 Mineflayer 动作。它应该发送高层意图，例如：

- “陪玩家完成第一晚生存”。
- “作为护卫保护玩家，不要贴身跟随”。
- “改善基地照明，不要拆已有建筑”。

底层行为由 Mindcraft 和本项目的自动陪玩策略处理。

## 安全边界

- 默认只监听 `127.0.0.1`。
- 第三方 Agent 不应获得 API key、keys.json 或服务器 secret。
- 配置写入必须继续使用白名单。
- 外部启动的 Minecraft Server 不允许被强制停止。
- 危险命令和 `allow_insecure_coding` 应默认关闭或明确提示。

## 后续实现建议

- 增加 `POST /api/experience/start`：把前端一键启动流程下沉到后端，方便 Agent 调用。
- 增加 `POST /api/preset-task`：用稳定枚举下发预设任务。
- 增加 token-based local auth，可选开启。
- 增加 MCP adapter 包。
- 增加 Codex 插件 manifest 和工具说明。
