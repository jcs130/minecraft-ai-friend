# 从一次生活实践改进程序

在当前目标需要重复、已理解的行为时使用本页。自己根据当前配方、材料、身体状态和历史实践选择一项小试验；示例不是固定任务，也不要求为了练习额外收集材料。现有工具负责执行，程序只提出动作。

## 先查事实，再写最小改动

1. `status`、相关只读工具确认前置条件；合成先 `lookup_recipe`。用 `skill_catalog` 查已有版本与实践，再 `skill_read(name, version)` 读源码、fixtures 和真实实践记录。默认读取可能是最新草稿，运行始终指定已测试、已晋升的 version。
2. 写新程序时用 `skill_draft(turn_id, name, source, fixtures, description)`。修订沿用同一 name，并提供 refinement 对象：run_ids 填本技能已有的 1–3 个真实实践 ID；hypothesis 写由哪些失败或不足推断原因；expected_outcome 写改后应观察到什么。不要填任务 ID、另一技能 ID 或编造编号。预期和假设不是已发生的事实。
3. `skill_test` 对本次返回的 version 运行 fixtures；失败按具体用例修订后重测，再 `skill_promote(turn_id, name, version)`。新版本会保留旧版本；晋升只证明这些样例通过当前内核，不证明泛化能力或世界效果。

## 程序与 fixture 契约

源码定义纯函数 `next(state, memory)`，同步返回 JSON 对象；无文件、网络、进程、游戏对象或模型调用，不使用随机数和时间。state 是控制器本次身体观察，常用 `counts`、`hp`、`hunger`、`task`；`execution.lastExecution` 提供上一步工具、回执状态与完成确认，`execution.lastResult` 是动作返回值，`execution.observation/evidence` 是观察和近期证据。缺失信息保持未知。

每步只选一种结果：

- 动作：`{action:{tool:"craft",args:{item_id:"minecraft:stick",count:1}},memory:{...}}`。用 `skill_catalog.actionTools` 的实际动作名；移动是 `goto`，不是 MCP 的 `move`。参数仍受原网关检查。
- 结束：`{action:null,memory:{...},done:true,reason:"观察到的结果"}`；需重新判断则 `replan:true`。必须显式 `action:null`，不能同时给动作或同时给 done、replan。
- 有界等待：`{waitSeconds:15,memory:{...}}`，范围 15–300 秒；或只读提议 `{observe:{tool:"inspect_block",args:{x:实际整数,y:实际整数,z:实际整数}},memory:{...}}`，仅支持 inspect_block、inspect_container。两者不与动作、终止标志混用。

fixtures 为 2–12 个不同输入的对象，含 state、可选 memory，以及至少一个 expectedActionTool、done、expectedWaitSeconds 或 expectedObserve。还可断言 expectedAction、replan、expectedMemory。建议覆盖正常前置条件、条件缺失、成功终态与未确认结果。样例输入只是分支测试，不能记成真实世界经历。

下面示范“只发出一次小批合成，再核对回执和产物”。仅当实时查询确认此配方、背包有相应材料且当前目标确需木棍时才考虑使用；其他目标应改成实际物品、材料与验收。count=1 是一次有界请求，产量以当前配方和真实回执为准。

```javascript
function next(state, memory) {
  const m = {...memory};
  const stop = reason => ({action:null, memory:m, replan:true, reason});
  const counts = state.counts;
  if (state.ok !== true || !counts || typeof counts !== "object")
    return stop("缺少可用的当前背包观察");
  if (m.sent === true) {
    const last = state.execution && state.execution.lastExecution;
    if (!Number.isInteger(m.before) || !last || last.tool !== "craft" ||
        last.completionConfirmed !== true || last.status !== "succeeded")
      return stop("上次合成失败或终态未确认，停止并复盘");
    if ((counts["minecraft:stick"] || 0) - m.before < 1)
      return stop("回执完成但未观察到所需产物增加");
    return {action:null, memory:m, done:true,
      reason:"已确认一次合成完成并观察到木棍增加"};
  }
  if ((counts["minecraft:oak_planks"] || 0) < 2)
    return stop("本例所需材料不足，重新选择可行目标");
  m.before = counts["minecraft:stick"] || 0;
  m.sent = true;
  return {action:{tool:"craft",args:{item_id:"minecraft:stick",count:1}},
    memory:m, reason:"按已查询配方尝试一次小批合成"};
}
```

与上例配套的 fixtures；复制到 skill_draft 的 fixtures 参数，source 只放上面的 JavaScript：

```json
[
  {"state":{"ok":true,"counts":{"minecraft:oak_planks":2,"minecraft:stick":0}},"memory":{},"expectedActionTool":"craft","expectedAction":{"tool":"craft","args":{"item_id":"minecraft:stick","count":1}},"expectedMemory":{"before":0,"sent":true},"done":false,"replan":false},
  {"state":{"ok":true,"counts":{}},"memory":{},"expectedActionTool":null,"done":false,"replan":true},
  {"state":{"ok":true,"counts":{"minecraft:stick":4},"execution":{"lastExecution":{"tool":"craft","completionConfirmed":true,"status":"succeeded"}}},"memory":{"before":0,"sent":true},"expectedActionTool":null,"done":true,"replan":false},
  {"state":{"ok":true,"counts":{"minecraft:stick":4},"execution":{"lastExecution":{"tool":"craft","completionConfirmed":false,"status":"accepted"}}},"memory":{"before":0,"sent":true},"expectedActionTool":null,"done":false,"replan":true},
  {"state":{"ok":true,"counts":{"minecraft:stick":0},"execution":{"lastExecution":{"tool":"craft","completionConfirmed":true,"status":"failed"}}},"memory":{"before":0,"sent":true},"expectedActionTool":null,"done":false,"replan":true}
]
```

## 真正运行一次，再复盘

开始前必须有本条生活输入提供的原 turn_id，且本轮身体动作尚未消耗（actionsUsed=0）。已经直接行动的回合只整理结果，把程序试验留给下一正常生活回合；不要伪造编号、续租或另起模型任务。先 `remember` 保存试验目标、确切版本、预期和下一步，保持 `finish_turn=false`。

然后 `skill_start(turn_id, name, version, memory={}, max_steps=3, objective=..., summary="已提交本次试验，等待实际执行后核对结果。")`。summary 用你自己的最多600字简短总结，只陈述排队与待验证事项。本例的 objective 可取：

```json
{"description":"在当前配方和资源允许时完成一次小批木棍合成","checks":[{"kind":"inventory_gain","item":"minecraft:stick","count":1},{"kind":"action_completed","tool":"craft","count":1}]}
```

objective 最多4条检查，count 为正整数；inventory_gain 检查指定物品净增量，action_completed 检查该实际动作的完成回执。根据本次小目标设置，不能拿已存在的物品冒充新增。检查通过只说明本次观察满足目标；拾取、其他世界变化仍可能影响物品数量，不自动证明因果或熟练掌握。

`skill_start` 返回排队成功不等于执行完成；受理后本轮租约已关闭。提供 summary 时，成功回执会让 QwenPaw 直接用你的总结结束当前原生回合，省去额外模型调用。不再 remember、执行身体动作或轮询等待。未提供 summary 的旧调用仍兼容，此时自行给出最终文字结束。参数被拒绝则按具体字段修正，不能当成排队成功。控制器按原任务边界执行，不需要每步调用模型。

下一正常生活回合用 `skill_read` 查这次实践：核对 practice ID、确切版本、目标检查、动作回执和前后状态。失败、未确认或结果不符合预期时，记录实际差异与待验证原因，再用该实践 ID 修订同一技能；重测新版本，再决定是否试运行。需要回退时读取保留的旧版本，对当前内核重测后重新晋升，并显式指定版本运行。无证据支持的改动不做。

将确实观察到的结果写入当前 remember 与个人笔记，保留 practice ID 和版本；若使用了自己的 Markdown 工作流，再对该工作流 learning_feedback。不能用程序名称冒充 qd-learned 工作流。一次成功只报告该次结果，跨材料、地点或前置条件的多次独立实践支持后再总结可复用能力；不把 expected_outcome 或自述 done 当成掌握证明。
