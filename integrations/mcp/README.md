# MCP Adapter 草案

MCP adapter 可以让 Cursor、Claude Desktop、Codex、小龙虾等 Agent 通过标准工具协议使用“我的世界AI陪玩”。

## 工具建议

- `minecraft_status` -> `GET /api/status`
- `start_minecraft_server` -> `POST /api/minecraft/start`
- `start_mindcraft` -> `POST /api/mindcraft/start`
- `start_autopilot` -> `POST /api/autopilot/start`
- `stop_autopilot` -> `POST /api/autopilot/stop`
- `send_companion_task` -> `POST /api/task`
- `read_minecraft_log` -> `GET /api/minecraft/logs`
- `read_agent_memory` -> `GET /api/memory`

## 实现方式

第一版可以做一个很薄的 Node.js MCP server：

1. 读取本地控制台地址，默认 `http://127.0.0.1:4177`。
2. 每个 MCP tool 调用对应 HTTP endpoint。
3. 对危险能力做二次确认或默认禁用。
4. 返回结构化 JSON，便于上层 Agent 做规划。

## 安全建议

- 默认不提供 `minecraft_command`，或只允许白名单命令。
- 不提供任意配置写入工具，先只开放读取和高层任务。
- 对“停止服务器”“切换模式”“给 OP”这类操作保留显式确认。
