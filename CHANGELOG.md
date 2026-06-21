# Changelog

## Unreleased

- Added configurable parallel resident dispatch so multiple AI villagers can receive LLM-backed tasks concurrently.
- Added live observer focusing for the `live` account, including a UI action, REST endpoint, and MCP tool.

- Added AI village shared memory for settlement settings, resident roles, resource targets, project tracking, and Autopilot task context.
- Added resident society mode APIs and Chinese UI controls to activate survival village mode, set the base from player coordinates, and dispatch role-aware village tasks.
- Added resident infrastructure reporting so AI villagers can record public builds into shared village state.
- Added AI village chief commander metadata and per-resident persona/storage scopes for the multi-agent control console.
- Expanded the original AI village design to two default resident roles with optional expansion, task event tracking, mine project support, and engineering docs for the future SQLite memory/task layer.
- Added a restore-residents society API and UI action to create/start resident agents and activate resident mode.
- Added a local DataStore layer with SQLite-first event persistence and JSONL fallback for task events, infrastructure reports, and resident observations.

- Added a read-only server productization blueprint for Paper migration, plugin capabilities, livestream directing, AI society design, and dry-run server.properties recommendations.

- Added cloud/local model provider presets for DeepSeek, Aliyun Qwen, Doubao/Volcengine Ark, OpenAI-compatible gateways, OpenRouter, and Ollama.
- Added a model provider API and Chinese UI controls to apply presets and sync the selected model into Mindcraft Agent Profile JSON.
- Added provider-specific environment variable detection and safe Mindcraft child-process key aliasing.

## 0.1.0 - 2026-06-21

- 建立“我的世界AI陪玩”产品化 MVP。
- 新增一键启动陪玩首页、准备状态清单、陪玩模板和快速指令。
- 整合 Minecraft Server 启停、日志、控制台命令和 server.properties 管理。
- 整合 Mindcraft settings.js 中文配置和 Agent Profile JSON 编辑。
- 新增自动陪玩策略、记忆查看、Mindcraft 状态检测和 AI 玩家状态展示。
