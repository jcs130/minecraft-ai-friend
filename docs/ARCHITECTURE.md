# 架构说明

## 模块

- `src/server.js`：本地 Web 控制台和 HTTP API。
- `src/minecraft-server.js`：Minecraft Server 检测、启动、停止、重启、日志和控制台命令。
- `src/server-properties.js`：安全读写 server.properties 的白名单配置。
- `src/mindcraft-client.js`：连接 Mindcraft 本地 API/Socket.IO。
- `src/mindcraft-config.js`：读取和保存 Mindcraft settings.js 与 Agent Profile。
- `src/autopilot.js`：自动陪玩循环、任务策略、LLM 调用和记忆。
- `src/village-state.js`：AI村长、居民角色、村庄项目、公共设施和任务事件的本地状态。
- `src/model-providers.js`：云端/本地模型供应商预设、密钥环境变量检测和 Mindcraft 子进程环境映射。
- `public/`：中文产品化前端。

## 数据流

1. 前端调用本地 API。
2. API 管理 Minecraft Server 和 Mindcraft 进程。
3. Mindcraft 控制 AI 玩家进入 Minecraft Server。
4. 自动陪玩循环读取 Mindcraft 上报状态，生成高层任务。
5. 任务通过 Mindcraft API 下发给 Agent。

## 本地数据

- `data/config.json`：本地控制台配置，不提交到 Git。
- `data/autopilot-memory.json`：自动陪玩记忆，不提交到 Git。
- `data/village-state.json`：AI村庄共享状态，不提交到 Git；后续会迁移到 SQLite。
- `logs/`：本地日志，不提交到 Git。
- Minecraft Server 和 Mindcraft 项目位于用户配置的外部目录。

## 安全边界

- Web 控制台默认只监听 `127.0.0.1`。
- `server.properties` 只暴露白名单字段。
- Mindcraft API key 不在页面展示。
- 云端模型密钥只从环境变量读取；供应商预设只保存 Base URL、模型名和供应商 ID。
- Agent Profile 保存时会过滤明显的密钥字段。
- 外部启动的 Minecraft Server 只检测，不强制停服。


## 集成层

项目保留本地 Web 产品形态，同时提供给第三方 Agent 的集成接口。

- `integrations/openapi.yaml`：描述本地 HTTP API。
- `integrations/codex-plugin/`：Codex/Agent 插件草案。
- `integrations/mcp/`：MCP adapter 草案。

集成层的原则是“高层意图输入、底层行为托管”。第三方 Agent 调用 `POST /api/task` 下发自然语言目标，或调用 `POST /api/village/report` / `POST /api/village/task-event` 写入共享事实；由本项目和 Mindcraft 负责具体 Minecraft 行为。
