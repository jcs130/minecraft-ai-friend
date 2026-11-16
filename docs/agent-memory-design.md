# 千灯纪常驻自演化 Agent：记忆系统设计与 Phase 1 实现

状态：Phase 1 最小可行版本（本地分支 `feat/agent-memory-phase1`，未推送、未部署、未连接任何正式服务器）。

## 1. 架构

```
Mineflayer 身体 (agent-mc-world)                       Supervisor / DSH / MCP 宿主
  core/world.ts emit() ──► MinecraftAgentClient.host.pushEvent ──► journal（原有，不变）
                                         │
                                         └─► eventObservers[]（新增、默认为空、只读旁路）
                                                   │
                         agent-mc-memory ◄─────────┘
   EpisodeSource (minecraft-source.ts) ── 只保留有意义事件 + 规则抽取三元组
          │
          ├─► Cold: SqliteColdStore（append-only 原文 Episode，按 scopeKey 分区）
          ├─► Warm(本地): LocalTemporalGraph（SQLite 双时态边，版本化失效）
          └─► Warm(可选): GraphitiMemoryGraph ──HTTP──► graphiti-sidecar (Python, graphiti-core + Kuzu/FalkorDB)
                                                         LLM 抽取（OpenAI 兼容，如 DeepSeek）+ 嵌入（hash/OpenAI）
   Tools: memory_query / memory_recall_at / memory_recent / memory_remember
          └─► MinecraftAgentClient.extraTools（新增、默认为空、不能覆盖核心工具）
```

| 层 | Phase 1 实现 | 之后 |
| --- | --- | --- |
| Hot（会话摘要 + Persona） | 未实现；由宿主（DSH）现有上下文负责 | Phase 2：按需检索拼装临时上下文 |
| Warm（时态知识图谱） | 本地双时态图（默认）+ Graphiti sidecar（hybrid） | Phase 2：混合检索、多跳；Phase 3：反思写回 |
| Cold（原文、快照、思考链） | Episode 原文 append-only | 世界快照、Worker trace、OSS 归档 |

## 2. 数据模型

- **Episode**：`kind`（chat/whisper/player_join/player_leave/death/respawn/inventory/task/location/home/skill/note/event）、
  `occurredAt`（现实时间）、`recordedAt`（系统时间）、原文 `text`、`actors`、`world`、`data`、`importance`、`source.ref`
  （宿主事件 cursor，用于溯源与重放去重）。
- **Entity**：Agent / Player / Location / Building / Skill / Item / Task / Topic / World。
- **Fact（边）**：`subject relation object [= value]`，带 `validAt/invalidAt`（何时为真）与 `createdAt/expiredAt`
  （何时写入/不再被相信），`episodes`（溯源）、`supersededBy`（被哪条事实取代）。
- **关系策略**（`relations.ts`）：KNOWS、FRIENDS_WITH↔HOSTILE_TO、LIKES↔DISLIKES、IS_ONLINE、LOCATED_AT、HOME_AT、BUILT_AT、
  OWNS、HAS_LEVEL、LEARNED、PARTICIPATED_IN、HAS_STATUS、DIED_AT（事件型，每次死亡单独保留）。

### 矛盾处理（本地后端）

1. 相同断言再次出现 → 只追加 episode（confirmed），不产生新版本。
2. 与现有事实矛盾（排他关系值变化，或冲突关系）→ 旧版本 `expiredAt=now`，写入其关闭副本 `invalidAt=新事实 validAt`、
   `supersededBy=新事实`；新事实写入。**从不删除**。
3. 显式否定（"我不再喜欢…"、物品用光）→ 只关闭现有事实。
4. 乱序到达的旧事实 → 作为历史写入（`invalidAt` 截断到已知的较新事实），不覆盖当前真相。

查询：`currentFacts`（未过期且未失效）、`factsAt(t)`（`validAt ≤ t < invalidAt`）、`factsAt(t, knownAt=K)`（K 时刻的信念）、
`history`（全时间线）。

## 3. 与现有代码的衔接

- **世界身份**：复用 `agent-mc-world-identity/v1`。地点实体名 = `世界key|标签`；世界未知时用连接本地命名空间，与
  `worldScopedRealm` 一致，未知世界的坐标绝不并入其他世界。
- **分区**：`WorldRequestFacts.experience.scope`（realm/account/agent，与 `mc_memory` 笔记本同形）→ `scopeKey`。
- **不重复存背包**：`InventoryDeltaTracker` 只记录贵重物品数量变化、普通物品首次获得/用光；常见方块忽略。
- **核心改动（agent-mc-world）**：`MinecraftClientOptions.eventObservers` 与 `extraTools` 两个可选字段，默认不存在时行为完全不变；
  观察者在 journal 写入后调用、拿到惰性 facts、异常被隔离；额外工具不能覆盖同名核心工具。
- **与 `mc_memory` 笔记本的关系**：并存。`mc_memory` 是宿主可编辑的笔记/方法库；本模块是自动从事件生成的时态事实图。
  Phase 2 计划把 `relationship` 笔记作为 Episode 导入，并在玩家进服回忆时合并两者。
- **DSH**：DSH 插件（独立仓库 dsh-minecraft-agent）尚未接入；接入只需构造 `MinecraftAgentClient` 时套用 `withAgentMemory()`。

## 4. 目录结构

```
packages/agent-memory/
  package.json  tsconfig.json  vitest.config.ts  pnpm-workspace.yaml  README.md
  src/
    types.ts            Episode / Fact / MemoryGraph / ColdStore 契约
    scope.ts            scopeKey、世界命名空间、实体 id
    relations.ts        关系排他/冲突/事件策略
    sqlite.ts           node:sqlite 打开（Node ≥22.13，无原生依赖）
    cold-store.ts       append-only Episode 日志（触发器禁止 UPDATE/DELETE）
    local-graph.ts      本地双时态图（版本化失效、point-in-time、knownAt）
    graphiti-client.ts  Graphiti sidecar HTTP 客户端
    memory.ts           AgentMemory / ScopedMemory 门面，hybrid 异步队列与降级
    minecraft-source.ts EpisodeSource：事件映射、偏好抽取、家/地点/技能/任务/背包增量
    tools.ts            memory_query / memory_recall_at / memory_recent / memory_remember
    integration.ts      createMinecraftMemory、withAgentMemory、环境配置（默认关闭）
    index.ts
  scripts/smoke.ts      合成场景冒烟（local / graphiti）
  tests/                vitest（含对 agent-mc-world 类型兼容的编译期检查）
  graphiti-sidecar/
    pyproject.toml
    agent_memory_sidecar/{config,embedder,service,app,__main__}.py
    tests/test_sidecar.py
packages/agent-mc-world/src/client/runtime.ts   eventObservers / extraTools 可选钩子
packages/agent-mc-world/tests/runtime-event-observers.test.ts
```

## 5. 后端选择

- 默认 **本地 SQLite 双时态图**：零服务、零模型、确定性，可在 Agent 进程内常驻；也是测试基准与 sidecar 故障时的降级。
- **Graphiti + Kuzu（嵌入式）** 作为 Phase 1 的 Graphiti 后端：无需额外数据库服务即可在本机跑通。
  注意 graphiti-core 0.31 已将 Kuzu 驱动标为弃用（上游 Kuzu 已停止维护），且其驱动缺 `_database` 和全文索引，
  sidecar 内有兼容补丁。长期部署建议切换 `AGENT_MEMORY_GRAPH_DRIVER=falkordb`（需要一个 FalkorDB/Redis 服务）。
- LLM：OpenAI 兼容接口，可用 DeepSeek（`json_object` 结构化输出）。DeepSeek 没有嵌入接口，默认使用确定性 hash 嵌入
  （只有字面重叠，没有语义）；配置真实嵌入服务后语义检索才有意义。

## 6. 路线图

- **Phase 2 分层检索注入**：按当前对话/附近玩家/任务，从图谱（当前有效事实 + 多跳邻居）和冷层原文召回 top-N，
  以预算受控的临时上下文注入 Worker/Supervisor；接入 `mc_memory` relationship 笔记；DSH 插件接入；真实嵌入。
- **Phase 3 反思闭环**：失败（死亡、任务失败）、里程碑、游戏日结束、上下文压力、玩家反馈触发异步反思 Worker：
  收集子图 + 原文 + trace → 结构化反思 → 写新边/失效旧边、更新 importance；低重要性降级到冷层。小模型抽取、大模型反思。
- **Phase 4 自演化与多会话路由**：主题级合并（社区/摘要节点）、规则与技能沉淀到方法库、多 Agent/多会话共享与隔离策略。

## 7. 验证（Phase 1）

- vitest：agent-memory 19 项；agent-mc-world 新增 3 项钩子测试，原有全量测试与 typecheck 见提交说明。
- pytest：sidecar 4 项（配置不接受明文密钥、hash 嵌入、HTTP 契约与校验、Bearer 鉴权）。
- 真实冒烟：本机 Graphiti + Kuzu + DeepSeek，5 个合成 Episode（进服、私聊偏好、设家、搬家、离线），未连接任何 MC 服务器。

> Phase 1b: the integration glue is owned by the Harness Runtime — see [agent-harness-design.md](agent-harness-design.md).
