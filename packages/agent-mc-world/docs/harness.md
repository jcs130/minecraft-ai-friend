<!-- Owner: src/client/runtime.ts, src/client/metrics.ts, src/mcp/server.ts, scripts/build.mjs -->

# Agent MC World Harness

项目可定义为 **面向 Minecraft 的具身 Agent Harness**：为 Agent 提供环境连接、工具、持续动作执行、直接反馈、方法制品入口、可视化与技术观察。Cortico 是可选宿主适配器，MCP/SDK 让其他 Agent 使用同一执行层；千灯纪玩法不在通用包内。

主决策、目标解释、长期记忆与学习评价由接入的 Agent 提供。游戏引擎可在主模型思考期间继续导航、脚本和快战术；它并不自带一个与宿主竞争的系统 2。向量数据库也不是运行此 Harness 的前提。

## 覆盖与边界

| 能力 | 此包可用部分 | 接入方需要提供或验证 |
| --- | --- | --- |
| 系统 1 | 通用生存/战斗反射、受阻建议、小动作及控制权 | RPG 快战术仍待拆出，通用入口不开放法术；效果按实际场景验证 |
| 系统 2 | 工具与事件、当前事实、按需指南、持续任务与脚本入口 | Agent 自己的主模型、任务编排与事件唤醒；Cortico 接入时由 Persona/Core 提供 |
| 自我改进 | 原生接口、可组合方法执行器、源码/制品、哈希和执行回执 | Agent 自己提出、修改、评价、采用/回退、索引与检索；需要真实改善和复用证据 |
| 现代化画面 | 第一人称、第三人称、2.5D、原始素材、聊天记录、粒子、YSM 状态与动画 | 服务端实际投递与支持范围；浏览器验证不等于 Java 全场景一致 |
| OBS 游戏层 | 透明 HUD、手持/使用动作、小地图、布局编辑、观战目标切换与过期清理 | OBS 浏览器源及游戏捕获由使用者配置；观战需服务端相应协议 |
| LLM 技术分析 | 通用元数据入口、调用/首输出耗时分位数、token 与缓存样本、方法版本链；独立指标页面 | 宿主真实插桩；模型服务队列和生成速率用服务端指标，不能由 MCP 猜测 |
| 记忆与演出 | 执行日志与制品；可连独立观察页面 | Agent 记忆、PowerContext/向量、VTuber/TTS/歌曲分别装配 |

代码已提供入口不表示 Agent 已采用或学会。方法的 `validated`、`executed`、`evaluated` 与世界净变化分别记录。维护人员写的方法必须保留作者，不能计作 Agent 自主编写。

## 开启技术页面

在 MCP 私有配置顶层加 `"metricsPort":17841`。为每个实例分配不同指标端口、游戏账号、数据目录和 `viewerPort`。默认 `metricsPort:0` 关闭 HTTP 观察；启用后只允许本机 GET `http://127.0.0.1:17841/api/harness/metrics`，不提供连接或操作接口。

从安装包复制 `dist/monitor/overlay.config.example.json` 到自己的私有目录，在其中设置：

```json
{
  "port":17840,
  "harness":{"metricsUrl":"http://127.0.0.1:17841/api/harness/metrics"},
  "models":[
    {"id":"main","label":"系统 2","metricsUrl":""},
    {"id":"system1","label":"系统 1","metricsUrl":""}
  ],
  "brain":{},"tts":{},"connections":{}
}
```

在安装目录运行（Python 3.10+，无需额外 Python 依赖）：

```powershell
python node_modules/agent-mc-world/dist/monitor/server.py --config D:/agents/mc/private-monitor.json
```

- 运行概览：`http://127.0.0.1:17840/brain`。首页紧凑展示当前阶段、系统 1 / 系统 2 响应耗时与最近失败；方法记录、请求参数和资源读数按需展开。缺失数据只标为未接入，不显示空指标墙。
- OBS 指标小窗：`http://127.0.0.1:17840/overlay`，440×290，背景透明。
- OBS 游戏 HUD：游戏连接后 `http://127.0.0.1:<viewerPort>/?obs=1`。编辑布局用 `?obs=1&obsEdit=1`，复制布局链接到 OBS；通常浏览器源宽 1920、高 1080，底下放游戏捕获。
- 完整网页画面：`http://127.0.0.1:<viewerPort>/`；OBS HUD 本身不绘制世界地形。游戏画面由实际玩家连接提供，未连接时不产生当前坐标或背包事实。

填写 `models[].metricsUrl` 时只用提供元数据的 `/metrics`；不要填写聊天补全接口。服务全局指标与当前 Agent 宿主上报分别展示。Cortico 逐次策略可另接 `brain.metricsUrl`；若现役未加载只读投影，该区域保持未验证，不自动改为控制请求。

## 宿主模型插桩

在真实模型传输开始/结束时，调用 `mc_trace`。每次重试使用新的 id；前缀与角色不能在同一个 id 中变更。下面是协议例子，数字应替换为实际测量，不应由语言模型生成：

```json
{"kind":"model","id":"request-42-attempt-1","phase":"start","role":"system2","model":"local-main","effort":"medium"}
```

```json
{"kind":"model","id":"request-42-attempt-1","phase":"finish","role":"system2","model":"local-main","outcome":"success","elapsedMs":8500,"ttftMs":6100,"inputTokens":20000,"cachedTokens":16000,"outputTokens":500,"reasoningTokens":100}
```

支持 `system1 / system2 / background`。耗时是宿主测得的请求往返，首输出时间单独测；reasoningTokens 应包含在 outputTokens 内。未知字段省略。缓存比例按同一请求有成对读数的输入 token 加权，并公开样本数。MCP 看不到宿主内部调用，未插桩的通道不能据零条记录判断没有调用。

直接 TypeScript 宿主可使用 `runtime.metrics.report(...)` 与 `serveAgentMetrics`，MCP 客户端也可读取 `mc_metrics` 或 `mc://metrics`，无需 HTTP。

## 方法进化记录

先通过 `mc_artifact put` 保存源码/方法制品与执行回执，再上报 `kind:"method"`、唯一事件 `id`、`method`、`author`、`stage`、`sourceHash`、`artifact`；修订可附 `parentHash`，执行/评价可附 `executionId` 与 `receipt`。哈希应由宿主对实际源码计算。阶段支持 authored、revised、validated、executed、evaluated、reused、reverted。

制品句柄必须确实存在。上报事件会保存为 `traces-<run>.jsonl`，页面公开来源及最多 12 条索引，不暴露源码正文。上报的 outcome 仍是宿主评价；页面不会自动宣布环境验证或能力提升。展开真实回执、比较世界净变化和相似场景表现后，Agent 再决定保留、修订或回退。完整方法库和检索由 Agent 管理，不全量塞入提示词。

工具时钟从实际游戏工具调用开始到返回结束。`mc_do` 返回受理不等于任务终态，后续仍读取 `mc_events` 和执行轨迹。近 10 分钟统计仅覆盖当前进程，有界缓存被截断或启动不足 10 分钟会标为部分。元数据接口拒绝额外字段，不接收提示词、对话或凭据。

## 本次发布验证边界

安装包构建与源提交、画面 bundle、字体和指标页面逐文件哈希关联。离线协议、回执、浏览器及界面测试不创建正式服样本。本次发布不重载现役可米；外部 Agent 首次登录与游戏验收按 [接入指南](agent-mcp.md) 执行。
