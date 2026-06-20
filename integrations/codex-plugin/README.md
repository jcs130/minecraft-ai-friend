# Codex 插件草案

这个目录是“我的世界AI陪玩”作为 Codex/Agent 插件的草案。

当前项目已经提供本地 HTTP API；插件层要做的是把这些 API 暴露给 Codex 或其他 Agent，让它们可以通过稳定工具调用管理 Minecraft/Mindcraft。

## 建议能力

- `getStatus`：查看服务器、Mindcraft、AI 队友、自动陪玩状态。
- `startMinecraftServer`：启动本地 Minecraft Server。
- `startMindcraft`：启动 Mindcraft。
- `startAutopilot`：启动自动陪玩。
- `sendCompanionTask`：给 AI 队友发送高层陪玩任务。
- `getMinecraftLogs`：读取服务端日志。
- `getAutopilotMemory`：读取 AI 陪玩记忆。

## 使用边界

- 只面向本地 `127.0.0.1`。
- 不暴露 API key。
- 不提供任意文件读写。
- 不建议第三方 Agent 直接发送低层破坏性命令。

## 后续

等 Codex 插件格式稳定后，可以把 `ai-plugin.json` 换成正式 manifest，并把 OpenAPI 文件作为工具 schema 来源。
