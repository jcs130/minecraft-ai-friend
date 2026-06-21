# 我的世界AI陪玩

> 游戏的最高配是朋友。

这是一个面向新玩家的本地/局域网 Minecraft AI 陪玩控制台。它把开服、Mindcraft、AI 队友、陪玩任务和高级配置整合到一个中文网页里。

## 产品化首页

首页优先展示“开始一次 AI 陪玩”的流程，而不是直接暴露底层配置：

- 一键启动陪玩：启动 Minecraft Server、等待服务器在线、启动 Mindcraft、启动自动陪玩。
- 准备状态清单：服务器、Mindcraft、AI 队友、自动陪玩。
- 陪玩模板：第一晚生存、新手导师、生存护卫、建筑伙伴。
- 快速指令：找食物、打怪、改善基地、探索、回基地、自由活动。

高级设置仍保留在页面下方，适合需要调试 Mindcraft、server.properties 或 Agent Profile 时使用。

## 功能

- 检查 Minecraft 服务器是否在线。
- 检查 Mindcraft 页面/API 是否在线。
- 用中文表单管理 Mindcraft `settings.js` 常用配置。
- 读取和编辑 Mindcraft Agent Profile JSON。
- 连接 Mindcraft 的本地 Socket.IO 通道。
- 查看在线 AI 玩家和当前位置、状态、动作。
- 启动/停止自动陪玩。
- 手动给一个或多个 AI 玩家下达高层任务。
- 查看 AI 玩家记忆。
- 管理 AI 村庄共享记忆：基地、公共箱子、居民角色、资源目标和村庄项目。
- 一键进入常驻生存社群模式，并按角色给在线 AI 居民派发村庄建设任务。
- 记录 AI 村民自主上报的公共设施：公共箱子、照明、道路、农场、房屋、安全边界和地标。
- 将任务事件、公共设施上报和居民状态观察镜像到 SQLite；不支持时自动降级为 JSONL 事件日志。
- 启动、停止、重启由本页面托管的 Minecraft Server。
- 读取 Minecraft 服务端最新日志。
- 向托管服务端发送控制台命令，例如 `list`、`op 玩家名`、`gamemode survival 玩家名`。
- 编辑常用 `server.properties` 配置，并在保存前自动备份。
- 生成只读服务器改造蓝图：实施就绪度、下一步清单、Paper 迁移、插件能力、直播导播、AI 社会系统和 dry-run 配置预览。
- 支持创造练习和生存助手两种陪玩模式。
- 支持云端和本地模型供应商预设：DeepSeek、阿里云百炼/通义千问、豆包/火山方舟、OpenAI-compatible、OpenRouter、本地 Ollama。
- 提供第三方 Agent 集成：OpenAPI 草案、Codex 插件草案、内置 MCP endpoint。
- 提供直播可视化 bridge，把 AI 居民任务、库存、公开思考和事件同步到可视化站。
- 支持本地/向量记忆：SQLite 记忆库、可选 Ollama/OpenAI-compatible embedding、可选 Qdrant。

## 运行

```powershell
cd mindcraft-autoplayer
npm start
```

打开：

```text
http://127.0.0.1:4177
```

## 工程文档和 Agent 维护

- 架构边界：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 数据模型：[docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- AI 村庄社群：[docs/AGENT_SOCIETY.md](docs/AGENT_SOCIETY.md)
- 运行维护：[docs/OPERATIONS.md](docs/OPERATIONS.md)
- 工程审计：[docs/ENGINEERING_AUDIT.md](docs/ENGINEERING_AUDIT.md)
- Agent 接手规范：[AGENTS.md](AGENTS.md)
- 项目维护 skill：[.codex/skills/minecraft-ai-friend-maintainer/SKILL.md](.codex/skills/minecraft-ai-friend-maintainer/SKILL.md)

## CoPaw / 小智 MCP 接入

控制台提供 MCP 接入层，CoPaw 可以通过自然语言调用 Minecraft AI 陪玩工具。

```json
{
  "mcp_servers": {
    "minecraft-companion": {
      "transport": "sse",
      "url": "http://127.0.0.1:4177/mcp/sse"
    }
  }
}
```

可用工具包括状态查询、启动陪玩、创建 AI、发送任务、定位玩家、激活村庄和村庄报告。完整说明见 [docs/COPAW_MCP.md](docs/COPAW_MCP.md)。
## 陪玩模式

设置页里的 **陪玩模式** 控制 Autoplayer 给 AI 下达任务时的策略。

- `创造练习`：偏建造、装饰、基地改造和短距离探索，并明确避免合成物品。
- `生存助手`：优先安全、食物、庇护所、睡觉/床、照明、基础工具、农场和短距离目标。

这个模式只影响 AI 任务策略，不会自动改变 Minecraft 服务器的 `gamemode`。


## Mindcraft 配置

页面里的 **Mindcraft 配置** 会读取“设置”中配置的 Mindcraft 目录，并整合：

- `settings.js`：服务器地址、端口、登录方式、Mindcraft UI 端口、基础角色模板、profiles、聊天、语音、翻译、视觉、上下文长度、危险代码执行开关等。
- Agent Profile：例如 `./andy.json` 和 `./profiles/*.json`，可以配置角色名、聊天模型、视觉模型、语音模型等。

保存前会自动备份原文件。API key 不在页面展示，也不建议写进 profile；应该继续放在 Mindcraft 的 `keys.json` 或环境变量里。

保存 Mindcraft 配置后，通常需要重启 Mindcraft 进程才会生效。

## 服务器配置

页面里的 **服务器配置** 可以读取和保存常用 `server.properties` 项：

- `gamemode`、`force-gamemode`、`difficulty`
- `hardcore`、`pvp`、`white-list`、`online-mode`
- `max-players`、`motd`、`level-name`
- `spawn-protection`、`allow-flight`、`enable-command-block`
- `view-distance`、`simulation-distance`

保存前会在同目录生成时间戳备份。大多数服务器配置需要重启 Minecraft Server 才会完全生效。

## 服务器管理

页面里的 **服务器管理** 分为两种状态：

- 外部进程：如果 Minecraft Server 已经从其他控制台启动，页面只检测在线状态、监听 PID 和读取日志，不会强制停止它。
- 本页面托管：如果从页面点击“启动服务器”，控制台会从 `start.bat` / `start.sh` 推断 Java 路径、内存参数和 `nogui` 参数，然后直接运行 `server.jar`。这种模式下可以从页面发送 `stop` 和其他控制台命令。

这样做是为了避免误关你正在玩的服务器，同时保留网页管理能力。

## 权限说明

玩家在游戏里执行 `/gamemode`、`/tp`、`/give` 等命令需要 OP 权限。

如果你没有 OP，可以在服务器控制台执行：

```text
op 你的玩家名
```

如果服务器没有控制台输入入口，也可以停服后编辑服务器目录里的 `ops.json`。

## AI 村庄共享记忆

页面里的 **AI 村庄计划** 会把可读快照保存到本地 `data/village-state.json`，用于让 Autopilot 给不同 AI 分配长期项目。任务事件、公共设施上报和居民状态观察会同步写入 `data/ai-friend.sqlite`；如果运行环境不支持 Node SQLite，则自动写入 `data/events.jsonl`。它只影响控制台和 Mindcraft 任务提示，不会写入 Minecraft 服务端文件。

新增的 **进入常驻生存** 会把控制台切到生存助手模式，写入长期世界目标，启用默认居民筛选，并启动自动陪玩循环。**恢复两位居民** 会确保默认居民 Profile 存在、请求 Alex 和 Luna 进服，并进入常驻生存模式。**派发村庄任务** 会读取每个居民的角色、当前项目和资源缺口，给在线 AI 发送不同的高层任务。

默认居民分工：

- `Alex`：生存管家，负责安全巡逻、基础资源、公共箱子、食物、补光和紧急处理。
- `Luna`：建筑师，负责基地、仓库、道路、围栏、照明、农田和简单住宅。
- `Milo`：矿工，负责低风险采矿、石头、煤、铁、燃料和矿点入口安全。
- `Nova`：侦察员，负责基地周边短距离侦察、道路、地标、资源点和危险点记录。
- `Ivy`：农夫，负责农田、食物、水源、动物、作物补光和可持续补给。

如果真人玩家在基地位置附近，可以先填写玩家名，再点击 **用玩家坐标设基地**。这个动作只读取服务端坐标并更新控制台共享记忆，不会修改世界方块或服务器配置。

### 指挥官和村民上报

这个系统可以按“AI村长 + 多个常驻居民 Agent”理解：

- AI村长是指挥官：保存长期目标、基地坐标、项目队列、公共设施和验收记录。
- AI村长也可以作为直播观察者：轮流巡查村民、解释建设进展，并为未来弹幕问答提供统一人格。
- 居民 Agent 执行不同角色任务，并在开始、完成或受阻时上报公共设施。
- 控制台会监听 Mindcraft 输出里的结构化上报，写入 `data/village-state.json` 快照，并镜像到 `data/ai-friend.sqlite` 事件库，所有打开网页的人都能看到。

村民上报格式：

```text
VILLAGE_REPORT {"type":"storage","title":"基地公共箱子","status":"done","public":true,"position":{"x":-100,"y":66,"z":167},"description":"已放置公共箱子","projectId":"storage-hub","checklistId":"place-chest"}
```

也可以由插件或第三方 Agent 直接调用 `POST /api/village/report` 上报。当前这是控制台共享记忆，不是 Minecraft 服务端插件存档；后续 `ai-friend-bridge` 可以把真实方块和箱子状态自动同步进来。


### 工程化数据层

当前版本是本地优先存储，不依赖外部数据库服务：

- `data/config.json`：控制台配置。
- `data/autopilot-memory.json`：Autopilot 的短期/长期任务记忆。
- `data/village-state.json`：AI 村长、居民角色、基地、公共设施、资源目标、项目和最近任务事件快照。
- `data/ai-friend.sqlite`：任务事件、公共设施上报和居民状态观察的工程化事件库。
- `data/events.jsonl`：当 Node SQLite 不可用时的降级事件日志。

`GET /api/storage` 会返回当前存储后端和最近事件。当前已经在 SQLite 中落地 `agent_status_reports`、`agent_memories` 和 `agent_memory_vectors`，向量检索可走 SQLite 本地向量或 Qdrant，失败时自动降级为词法检索。后续可以继续扩展 `tasks` 主表和 `chat_messages`，再按直播规模升级到 Postgres/pgvector。推荐拆成三层记忆：工作记忆、每个居民的个人长期记忆、全村共享记忆。任务管理按 `tasks` + `task_events` 事件流设计，AI 的每次派发、进度、受阻、完成都可追溯。

## 服务器产品化路线

如果要把 AI 陪玩升级成长期运行的 AI 村庄/直播服务器，建议先使用页面里的 **服务器改造蓝图**。它只读分析服务器目录和 `server.properties`，不会写入当前服务器。详细方案见 [docs/SERVER_PRODUCTIZATION_PLAN.md](docs/SERVER_PRODUCTIZATION_PLAN.md)。

## 关联项目

- HMCL 启动器：<https://github.com/HMCL-dev/HMCL/releases>。适合局域网和离线名配置；建议从官方 GitHub Releases 下载，并按页面提供的 SHA-256 校验文件。
- Mindcraft：<https://github.com/mindcraft-bots/mindcraft>。AI 玩家运行框架，基于 LLM 和 Mineflayer 控制 Minecraft。

## 第三方 Agent 集成

这个项目可以作为 Codex、小龙虾、Cursor、Claude Desktop 等 Agent 的本地插件能力层。推荐接入方式：

- HTTP/OpenAPI：`integrations/openapi.yaml`。
- Codex 插件草案：`integrations/codex-plugin/`。
- MCP：内置 `/mcp`、`/mcp/sse` 和 `/mcp/messages`，说明见 `docs/COPAW_MCP.md`；`integrations/mcp/` 保留 adapter 说明。

第三方 Agent 应发送高层陪玩意图，例如“陪玩家完成第一晚生存”“帮玩家找食物”“改善基地照明”，不要直接控制底层破坏性动作。

## 云端模型和本地 Ollama

控制台的“模型供应商”可以一键填入 DeepSeek、阿里云百炼/通义千问、豆包/火山方舟、OpenAI-compatible、OpenRouter 和本地 Ollama 的常用配置。密钥只从环境变量读取，不会写进页面配置。详见 [`docs/MODEL_PROVIDERS.md`](docs/MODEL_PROVIDERS.md)。

如果使用 Ollama 的 `qwen3-vl:8b`：

```text
模型接口地址：http://localhost:11434/v1
模型名称：qwen3-vl:8b
```

本地 Ollama 不需要 API key。云端模型需要配置对应环境变量，例如 `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY` 或 `ARK_API_KEY`。

## 检查

```powershell
npm run check
```
