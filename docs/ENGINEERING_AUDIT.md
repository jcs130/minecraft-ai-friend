# 工程审计记录

日期：2026-06-22

本记录用于说明当前架构设计是否已经生效，以及下一步需要怎么保持高内聚、低耦合。

## 审计结论

| 领域 | 状态 | 结论 |
| --- | --- | --- |
| Web 控制台 | 已生效 | `public/` 只调用 HTTP API，不直接接触文件系统或密钥。 |
| HTTP API / 组合根 | 部分生效 | `server.js` 正确承担组合根职责，但文件偏大，应逐步拆 route/service。 |
| Minecraft Server 管理 | 已生效 | 独立在 `minecraft-server.js`，有托管/外部进程边界。 |
| Mindcraft 通信 | 已生效 | `mindcraft-client.js` 封装 HTTP/Socket，业务层通过高层方法调用。 |
| Autopilot | 已生效 | 自动任务循环和 LLM 任务生成集中在 `autopilot.js`。 |
| AI 村庄领域模型 | 已生效 | `village-state.js` 管角色、项目、公共设施和上报解析。 |
| 数据层 | 已生效 | `data-store.js` SQLite 优先，JSONL 降级；已覆盖事件、观察、状态、记忆和向量。 |
| 向量记忆 | 已生效 | `vector-memory.js` 独立封装 embedding、SQLite/Qdrant/词法降级。 |
| MCP 接入 | 已生效 | `mcp-server.js` 提供 localhost-only MCP 工具层。 |
| 直播可视化 | 已生效 | `visualizer-bridge.js` 作为独立 adapter，不污染核心领域逻辑。 |
| 密钥安全 | 已生效 | 代码只保存环境变量名，不保存真实 key；profile 写入会过滤明显密钥字段。 |

## 主要风险

1. `server.js` 继续增长会降低可维护性。下一轮新增较大功能时应先拆分。
2. 公共设施事实依赖 AI 自报，真实方块/箱子状态缺少服务器插件校验。
3. AI 输出格式仍依赖 LLM 遵守 prompt，直播层已过滤，但更好的方案是 schema 化上报。
4. 局域网开放控制台前必须补鉴权和只读/控制权限分离。
5. `references/` 当前被 `.gitignore` 忽略，第三方参考项目不能作为交付源码的一部分。

## 保持高内聚低耦合的规则

- 新 HTTP endpoint 只做参数解析、调用 service、返回 DTO。
- 新领域规则优先进入 `VillageState`、`Autopilot` 或独立 service，不堆进 UI。
- 新持久化字段必须先更新 `DataStore`，再更新 `docs/DATA_MODEL.md`。
- 新第三方接入必须走 `src/mcp-server.js` 或 OpenAPI，不绕过内部边界。
- 新直播展示必须通过 adapter 清理观众可见文本，不直接展示原始 prompt 或动作命令。
- 涉及密钥的修改必须做 `sk-` 扫描，且只提交环境变量名和 `.env.example` 占位。

## 建议拆分路线

优先级从高到低：

1. `src/routes/*.js`：把 `/api/*` 路由从 `server.js` 拆出去。
2. `src/services/society-service.js`：承载居民恢复、社群激活、村长派发。
3. `src/services/commander-service.js`：承载村长 LLM prompt、结果清洗、任务下发。
4. `src/services/live-observer-service.js`：承载观察者选择和直播镜头策略。
5. `src/prompts/`：集中 AI prompt 模板，便于审查中文和安全要求。

只在真正需要新增行为时拆，不做无收益的大重构。

## 本次验证

必须通过：

```powershell
npm run check
node --check scripts\visualizer-bridge.js
git diff --check
```

建议抽查：

```powershell
Invoke-RestMethod http://127.0.0.1:4177/api/status
Invoke-RestMethod http://127.0.0.1:3010/api/status
```
