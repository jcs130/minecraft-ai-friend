# Contributing

这个项目目前处于产品化 MVP 阶段，目标是保持本地运行简单、功能边界清晰、安全默认值保守，同时让后续 Agent 可以可靠接手维护。

## 开发

```powershell
npm install
npm start
npm run check
```

## 提交前检查

```powershell
npm run check
node --check scripts\visualizer-bridge.js
git diff --check
rg -n 'sk-[A-Za-z0-9_-]{20,}' src scripts public package.json README.md docs integrations .codex
```

## 不要提交

- `data/`
- `logs/`
- `.env` 或 `.env.*`
- Minecraft 世界目录
- Mindcraft `keys.json`
- 真实 API key、token、cookie

## 文档同步

- 改 API/MCP：同步 `docs/INTEGRATIONS.md`、`docs/COPAW_MCP.md` 或 `integrations/openapi.yaml`。
- 改数据表/记忆：同步 `docs/DATA_MODEL.md`。
- 改 AI 角色、prompt、公开思考：同步 `docs/AGENT_SOCIETY.md`。
- 改进程管理、局域网或直播运行方式：同步 `docs/OPERATIONS.md`。
- 做架构性改动：同步 `docs/ARCHITECTURE.md` 和 `docs/ENGINEERING_AUDIT.md`。

## Agent 维护

后续由 Codex 或其他 Agent 维护时，先读 `AGENTS.md` 和 `.codex/skills/minecraft-ai-friend-maintainer/SKILL.md`。

UI 文案、AI 任务模板、直播观众可见内容优先中文。公开思考应是行动计划说明，不应暴露系统提示、隐藏推理或原始动作命令。
