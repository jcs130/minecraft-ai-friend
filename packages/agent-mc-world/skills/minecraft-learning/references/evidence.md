# 记录、反思与复用

先读取实际 tool help；例子中的 ID 必须替换为真实回执。

```json
{"action":"experience","operation":"list","input":{"operation":"flight","limit":4}}
```

```json
{"action":"experience","operation":"get","input":{"id":"<returned experience ID>"}}
```

```json
{"action":"experience","operation":"reflect","requestId":"<same-real-event-and-revision>","input":{"ids":["<actual evidence ID>"],"summary":"Flight landing allowance","lesson":"Describe measured effect and revised method.","conditions":"Observed applicable conditions.","counterexample":"Failure or untested conditions.","verdict":"unclear"}}
```

稳定 requestId 用于重复提交和崩溃恢复。同 ID 换内容会冲突。`helpful` 需要至少一条带终态和前后观测的完成操作，但依然只是 Agent 结论。`harmful` 和 `unclear` 可保留拒绝或无结果证据。反思写入本地游戏笔记，返回 note ID/revision；远端同步显式调用 notebook sync。

SDK `client.call(name,args,{requestId,attribution:{controller:"system1",sessionId,decisionId,method:{id,revision},memoryRefs}})` 或 MCP `_meta["agent-mc/v1"].attribution` 提供采用来源。记录只存参数白名单和输入哈希；完整执行证据仍在原归档。自建宿主决策可用公开 `client.learning.recordDecision(...)`；这是宿主报告，不声称核心调用了模型。新主机只需消费核心包，不依赖 Pi。

`decision.after` 是记录时采样，不冒充模型输入时环境；输入用 contextHash 对应宿主观察归档。`operation.before` 是提交时观察，after 随终态更新。缺少结构化采样的旧适配器为 null。没有独立执行回执的控制/法术只保留 dispatch 与采样，不能标成 completed。

在线 list/stats 只查最近 1024 条并注明窗口。旧记录保留在各自哈希文件中，可按 ID 读取；离线脚本统计一个明确 scope 的全部记录。旧进程遗留 pending/unknown 需原始回执核对，禁止自动重放。失败记忆、旧方法版本保留；本版本不自动改变模型权重或放宽执行权限。

个人记忆仍由宿主管理。可保存游戏 note 引用，或把个人经验引用传入 memoryRefs，避免拷贝其他 Agent 的私密人格资料。跨服共享去标识方法、适用条件与合成测试，不共享活体坐标、账号、权限或凭据。
