# Agent 直播观察舱

2026-09-21：复用独立管理台，新增真实记录驱动的直播界面与轮次详情。没有新建 Agent、推理服务或记忆库；仅 panel 增加只读数据挂载和 HTTP 投影。游戏、角色配置、模型调度与学习机制保持原路径。

## 使用入口

- 完整观察舱：`http://127.0.0.1:19091/observatory`。
- 带既有世界第三视角：`http://127.0.0.1:19091/observatory?camera=third`。视角来自原 19092 世界查看器，不新增游戏控制通道。
- OBS 侧栏：`http://127.0.0.1:19091/observatory?layout=sidebar`。添加浏览器源，建议 480×1080，配合游戏捕获；不需要开启世界 WebGL 预览。
- 完整执行轨迹：`http://127.0.0.1:19091/#trace`。支持轮次选择、工具/目标搜索、状态筛选、参数展开、动作前后观察和时间线。

1920×1080 桌面视口采用单屏布局；480×1080 侧栏也同时展示 L1/L2/L3。小屏幕回归自然滚动。暂停刷新只影响页面读取，不暂停游戏角色。全屏是浏览器全屏；没有代用户开播。

## 数据口径

| 层 | 现有来源 | 展示内容与限制 |
| --- | --- | --- |
| L1 | survivor.json、controller.json、episodes.jsonl、turn-actions、action-receipts、memory.json | 最近保留 20 轮，每轮最多 40 个游戏动作；精确 turnId/actionId 关联，输入身体快照仅在 active 中留存时显示。动作耗时为受理到终态观察，不是纯工具 CPU 时间。轮次时间含等待、推理、执行。 |
| L2 | 桐人 learning/index、drafts、memory 目录，world-skills/index、evolution-board | 知识文件索引、草稿目录、本地启用/停用技能、共享来源与版本、反馈反例；没有新增知识库。文件数/启用数不等于实际能力或游戏效果。 |
| L3 | 原 team.sqlite3、engineering/config、receipts、state | 只读查询 category=improvement 最近 24 条，工程基线/固定测试计划、测试与候选提交回执；不把候选提交当部署，也不证明递归改进收益。 |

Agent 决策摘要来自其主动保存的目标、观察、复盘和下一步计划。没有伪造完整内部思维链。原始 Prompt、逐 Token 思考、所有原生模型工具、单次模型推理耗时及调用计费并未完整记录。Jev 最近选择是独立历史记录，不能仅凭时间接近归入所选轮次。

当前认知状态与最近动作分别标记；先前轮次摘要明确注明。机制图展示架构关系，不声称所有边都有逐轮调用证据。世界变化只比较同身体、同维度且两端有效的观察，未知不显示为零。

HTTP 轮询每 5 秒；轨迹后端缓存 5 秒，RSI 缓存 15 秒。已有知识计数/行为统计继续按原生成频率工作，页面单列采样时间。文件读取与列表均有界，目录只用于固定索引；页面不返回密钥、私有原生消息或知识全文。Host/Origin/CSP/只读路由保护保持，未新增公网监听。

## 参考与实现

- [Langfuse Agent Graphs](https://langfuse.com/docs/observability/features/agent-graphs)：参考执行节点、关系与详情的交互方式。
- [Langfuse Observability](https://langfuse.com/docs/observability/overview)：参考输入、输出、工具、时间分开记录的口径。
- [React Flow](https://reactflow.dev/)：参考节点与动态连线的视觉组织。
- [LangChain Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui)：参考工具结果展开与阅读结构。

本页采用原管理台原生 JS/CSS/SVG，实现只读节点详情、动态连线、最新动作高亮、暗色直播布局和减少动态效果支持；未引入这些项目的服务端、SDK、React 构建链，也未向外部平台发送轨迹。

## 验证与运维

`node --test world/tests-ai/agent-observatory.test.mjs world/tests-ai/admin-panel.test.mjs` 验证投影、精确关联、未知时长、跨身体比较拒绝、RSI 分类、只读 HTTP、来源限制与原管理台回归。

`python tools/agent_observatory_health.py` 是新增只读探针，已接入 `probe_panel_smoke`。panel 沿用 Docker restart 与 `/healthz` 守护。上线只重新创建 panel 以增加挂载；后续模块更改只重启 panel。其它已有 panel-smoke 失败按原结果保留，不补写历史验收哈希。

本机浏览器已验证真实工具记录、L2 技能详情、L3 工程提案详情、游戏视角连接以及 1920×1080/480×1080 无页面溢出。完整健康结果保存在本机 `reports/agent-observatory-panel-smoke.json`，不进入公开源码。
