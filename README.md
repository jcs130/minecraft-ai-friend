# 我的世界AI陪玩

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
- 启动、停止、重启由本页面托管的 Minecraft Server。
- 读取 Minecraft 服务端最新日志。
- 向托管服务端发送控制台命令，例如 `list`、`op 玩家名`、`gamemode survival 玩家名`。
- 编辑常用 `server.properties` 配置，并在保存前自动备份。
- 支持创造练习和生存助手两种陪玩模式。
- 支持云端和本地模型供应商预设：DeepSeek、阿里云百炼/通义千问、豆包/火山方舟、OpenAI-compatible、OpenRouter、本地 Ollama。
- 提供第三方 Agent 集成草案：OpenAPI、Codex 插件、MCP adapter 设计。

## 运行

```powershell
cd mindcraft-autoplayer
npm start
```

打开：

```text
http://127.0.0.1:4177
```

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

## 关联项目

- HMCL 启动器：<https://github.com/HMCL-dev/HMCL/releases>。适合局域网和离线名配置；建议从官方 GitHub Releases 下载，并按页面提供的 SHA-256 校验文件。
- Mindcraft：<https://github.com/mindcraft-bots/mindcraft>。AI 玩家运行框架，基于 LLM 和 Mineflayer 控制 Minecraft。

## 第三方 Agent 集成

这个项目可以作为 Codex、小龙虾、Cursor、Claude Desktop 等 Agent 的本地插件能力层。推荐接入方式：

- HTTP/OpenAPI：`integrations/openapi.yaml`。
- Codex 插件草案：`integrations/codex-plugin/`。
- MCP adapter 草案：`integrations/mcp/`。

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