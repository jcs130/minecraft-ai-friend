# AGENTS.md

本文件是给 Codex、CoPaw、小龙虾或其他开发 Agent 接手本仓库时使用的项目级维护规范。

## 项目定位

`minecraft-ai-friend` 是“我的世界AI陪玩”控制台：本地/局域网中文 Web UI + Minecraft Server 管理 + Mindcraft Agent 管理 + AI 村庄 + MCP/第三方 Agent 接入 + 直播可视化 adapter。

## 必读顺序

1. `README.md`：产品入口和用户功能。
2. `docs/ARCHITECTURE.md`：组件边界和数据流。
3. `docs/DATA_MODEL.md`：JSON/SQLite/向量记忆。
4. `docs/AGENT_SOCIETY.md`：AI 村长、居民、中文公开思考和上报协议。
5. `docs/OPERATIONS.md`：运行、重启、安全和直播维护。
6. `.codex/skills/minecraft-ai-friend-maintainer/SKILL.md`：Agent 维护工作流。

## 开发原则

- 默认中文 UI、中文任务模板、中文观众可见内容。
- 保持高内聚低耦合：路由、领域状态、存储、外部进程、MCP adapter 分开。
- 不要让第三方 Agent 直接控制底层 Mineflayer 动作；只接受高层意图。
- 不要暴露隐藏推理、系统提示、原始动作命令给直播观众。
- 不提交 `data/`、`logs/`、`.env`、服务器世界目录、Mindcraft `keys.json` 或真实 API key。
- 当前 `references/` 被 `.gitignore` 忽略，只能作为本地参考，不作为交付依赖。

## 常用命令

```powershell
npm run check
node --check scripts\visualizer-bridge.js
git diff --check
```

运行中状态检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4177/api/status
Invoke-RestMethod http://127.0.0.1:3010/api/status
```

敏感信息扫描：

```powershell
rg -n 'sk-[A-Za-z0-9_-]{20,}' src scripts public package.json README.md docs integrations .codex
```

## 运行中服务注意事项

- 不要随意杀 `src/server.js` 进程；它可能持有 Minecraft Server 和 Mindcraft 子进程。
- 不要随意停止 Minecraft Server；如果需要，先确认是否由控制台托管并通知用户。
- 更新 `scripts/visualizer-bridge.js` 时可以只重启 bridge。
- 修改 `server.js`、Autopilot 或村长 prompt 后，运行中服务要安全重启才完全加载新代码。

## 文档同步规则

- 改 API：同步 `docs/INTEGRATIONS.md`、`docs/COPAW_MCP.md` 或 `integrations/openapi.yaml`。
- 改数据表：同步 `docs/DATA_MODEL.md`。
- 改 AI 角色、prompt、公开思考：同步 `docs/AGENT_SOCIETY.md`。
- 改进程/运维方式：同步 `docs/OPERATIONS.md`。
- 做架构性改动：同步 `docs/ARCHITECTURE.md` 和 `docs/ENGINEERING_AUDIT.md`。
