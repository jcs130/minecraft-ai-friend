# 从一次生活实践改进程序

## 从整个技能库选择程序

先调用 `skill_catalog` 读取持久化可用目录，不要用 shell、glob 或递归扫描技能文件夹。目录由管理接口在草稿、晋升、共享发布时原子更新；其中 activeVersion 是当前候选，draftVersion 不代表可执行。再按名称用 `skill_read` 获取必要正文、测试与实践，避免每轮读完整代码库。测试是否匹配当前内核仍在执行准入时核对。外部恢复导致目录损坏时报告维护，不自行遍历全盘或编辑通过标志。

现有控制器在身体空闲、安全边界且没有待复盘任务时，可让 Jev 从已晋升、当前内核测试通过的程序中选一个。`skill_draft` 可附 `routing={intents:["木棍","stick"],maintenance:false}`：关键词只用于本地粗筛，实际还会以当前身体和空 memory 运行一次纯函数预览，只有提出可执行首步的程序进入候选。必须提供空 memory 的正例和 `expectedActionTool:null,replan:true` 的前提不足反例。`maintenance:true` 仅用于与目标无关的必要自理，例如饥饿时吃饭。已有程序默认不自动加入，Agent 可根据真实实践修订并晋升。

Jev 只看到最多7个程序的首步参数和一个慢系统选项，选择后重新检查版本、身体、目标和执行边界，排入原 skill-job；不会直接执行模型生成的参数。每次慢系统决策/目标修订最多自动选一个程序，结束或失败后交回原认知流程复盘，避免自动重复合成、装备来回切换和失败重试。选择、程序、动作回执以 practiceRunId/name/version/turnId 关联；`done` 不代替实践验收，也不证明已掌握。

初始 `base_*` 共27个程序：安全食物、9类装备及盾牌、木板和12种配方、短程导航、收获补种、睡觉。其中15个支持自动候选；需工作台的9种配方要求 `memory.table={x,y,z}`，先读取真实方块；导航/农耕/睡觉要求 `memory.target={x,y,z}`，农耕还需 `memory.seed`。先 `skill_read` 查看准确契约和测试；所有坐标来自真实感知，不从名字猜测。持有工作台不等于附近已放置工作台。初始实现可继续按实际失败证据修订，安装器不覆盖已有同名程序。

## 系统 1 候选决策

已测试程序可返回 `choose:{question,candidates:[{id,description,action}],context:{...}}`，context 可省略，与 action、observe、waitSeconds、done/replan 互斥。提供 2–8 个依据当前观测构造的候选；每个 action 必须包含完整的现有 tool/args，或为 null（交回慢系统）。现役官方 Jev 只选候选，不生成参数。context 是最多 2048 字节的局部事实对象：可放当前目标距离、观察到的障碍、最近动作的实际进展；先检查 observation.fresh/result.ok，缺失事实标未知，不能复制历史思考或整个环境。控制器自动提供身体、当前目标、上次执行摘要和各候选的确切参数。

分类在原控制器的单个异步槽内进行，复用 HTTPS 连接；等待期间不推进程序 memory/steps，也不占身体租约，原生动作回执与只读交流继续处理。目标、程序版本、身体身份、维度、物资或主要生命状态改变时旧选择作废。超出 5 秒或身体条件变化最多重新观察两次，仍不稳定才 replan。官方 confidence 不等于选中概率；confidence 低于 0.75、服务失败或 null 候选直接交回 Qwen，不自动改用本地模型。原身体租约、权限、预算、回执和未知动作不重放继续生效。

例如当前已知路线的小段移动与“返回慢系统重新规划”二选一；先确认候选坐标确实可行，不把模型置信度当寻路或安全证明。fixtures 用 expectedChoice 核验候选生成，用另一个观察/记忆样例核验终止或失败分支。测试不调用模型，运行时才选择；选择记录与实际 action 回执分别核验，不把选择成功当任务完成。

当前是结构化状态→有界原生动作的快慢控制，不是逐帧视觉或已训练 WASD 控制。Qwen 负责小目标、前置条件、候选程序、终止/失败条件和必要复盘；确定性步骤直接用已测试程序，有需要比较的选项才调用 Jev；原生任务持续执行导航/交互。accepted 后等同一原生任务的回执，不能每 250 ms 重发动作。执行结束、异常、目标变化才唤醒慢系统。交流使用现有只读 session，可与程序/原生动作并行，不能借旧 turn_id 写身体。

候选参数使用程序动作的契约，不省略字段。例如装备为 `{tool:"equip_item",args:{item_id:"minecraft:iron_sword",action:"equip",slot:"mainhand"}}`，不是 MCP `equip` 的简写。`expectedChoice` 只比较候选生成结果，错误参数也可能与错误 fixture 一致；真实网关仍会拒绝，收到具体拒绝后修订而非重复启动旧版。

在当前目标需要重复、已理解的行为时使用本页。自己根据当前配方、材料、身体状态和历史实践选择一项小试验；示例不是固定任务，也不要求为了练习额外收集材料。现有工具负责执行，程序只提出动作。

## 先查事实，再写最小改动

1. `status`、相关只读工具确认前置条件；合成先 `lookup_recipe`。用 `skill_catalog` 查已有版本与实践，再 `skill_read(name, version)` 读源码、fixtures 和真实实践记录。默认读取可能是最新草稿，运行始终指定已测试、已晋升的 version。
2. 写新程序时用 `skill_draft(turn_id, name, source, fixtures, description)`。修订沿用同一 name，并提供 refinement 对象：run_ids 填本技能已有的 1–3 个真实实践 ID；hypothesis 写由哪些失败或不足推断原因；expected_outcome 写改后应观察到什么。不要填任务 ID、另一技能 ID 或编造编号。预期和假设不是已发生的事实。
3. `skill_test` 对本次返回的 version 运行 fixtures；失败按具体用例修订后重测，再 `skill_promote(turn_id, name, version)`。新版本会保留旧版本；晋升只证明这些样例通过当前内核，不证明泛化能力或世界效果。

## 程序与 fixture 契约

源码定义纯函数 `next(state, memory)`，同步返回 JSON 对象；无文件、网络、进程、游戏对象或模型调用，不使用随机数和时间。state 是控制器本次身体观察，常用 `counts`、`hp`、`hunger`、`task`；`execution.lastExecution` 提供上一步工具、回执状态与完成确认，`execution.lastResult` 是动作返回值，`execution.observation/evidence` 是观察和近期证据。缺失信息保持未知。

区分两层状态：原始动作回执的成功终态是 `status:"completed"`；程序读取的 `state.execution.lastExecution.status` 成功值是 **`"succeeded"`**。程序同时检查该值和 `completionConfirmed===true`，再核对当前装备、库存或身体等预期效果。缺失、失败或未确认不能报告 done；也不能把已确认成功的动作因状态字段混淆而再执行一次。

每步只选一种结果：

- 动作：`{action:{tool:"craft",args:{item_id:"minecraft:stick",count:1}},memory:{...}}`。用 `skill_catalog.actionTools` 的实际动作名；移动是 `goto`，不是 MCP 的 `move`。参数仍受原网关检查。
- 结束：`{action:null,memory:{...},done:true,reason:"观察到的结果"}`；需重新判断则 `replan:true`。必须显式 `action:null`，不能同时给动作或同时给 done、replan。
- 有界等待：`{waitSeconds:15,memory:{...}}`，范围 15–300 秒；或只读提议 `{observe:{tool:"inspect_block",args:{x:实际整数,y:实际整数,z:实际整数}},memory:{...}}`，仅支持 inspect_block、inspect_container。两者不与动作、终止标志混用。

fixtures 为 2–12 个不同输入的对象，含 state、可选 memory，以及至少一个 expectedActionTool、done、expectedWaitSeconds 或 expectedObserve。还可断言 expectedAction、replan、expectedMemory。建议覆盖正常前置条件、条件缺失、成功终态与未确认结果。样例输入只是分支测试，不能记成真实世界经历。

## 通用原生交互

当 `skill_catalog.actionTools` 包含 `interact_at`，程序可提出 `{tool:"interact_at",args:{button:"right",x:整数,y:整数,z:整数,hold_ticks:0,item_id:"实际携带的命名空间物品"}}`。坐标须全给或全为 null；全 null 沿当前视线使用物品。button 为 left/right，hold_ticks 为 0–100（游戏 tick），item_id 可省略；不导航，须已在目标触及范围，原工作区及保护区规则有效。食物仍用 `eat`，原生拒绝原因必须尊重。

用它组合当前目标需要的取水、施肥、工具或模组物品使用等方法，不要求维护者逐项提供专用玩法。accepted 只表示原任务受理，控制器随后查询同一原生任务；不能再次点击来催促完成。终态仅说明这次交互结束，必须依据实际库存、方块及相关效果判断程序目标。失败或未知时保留已执行前缀，先核实再修改策略。`matching_passed_tests_required` 表示当前内核下的测试资格缺失或失效，先对同一版本执行 `skill_test`，不要修改通过标志或不断重试 `skill_start`。

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

`checks` 是全部满足（AND），没有 OR 语义。只执行一次的候选程序不能同时要求 eat 和 equip_item 各完成一次；应收窄本次可观察目标，或不设置这类不适用的 objective 并如实核对实际回执。`objectiveObserved:true` 和 `programReportedDone:true` 分开报告：世界效果已达到而程序误判 replan 时，修正终止逻辑，保留原实践，不重写其结果。

`skill_start` 返回排队成功不等于执行完成；受理后本轮租约已关闭。提供 summary 时，成功回执会让 QwenPaw 直接用你的总结结束当前原生回合，省去额外模型调用。不再 remember、执行身体动作或轮询等待。未提供 summary 的旧调用仍兼容，此时自行给出最终文字结束。参数被拒绝则按具体字段修正，不能当成排队成功。控制器按原任务边界执行，不需要每步调用模型。

下一正常生活回合用 `skill_read` 查这次实践：核对 practice ID、确切版本、目标检查、动作回执和前后状态。失败、未确认或结果不符合预期时，记录实际差异与待验证原因，再用该实践 ID 修订同一技能；重测新版本，再决定是否试运行。需要回退时读取保留的旧版本，对当前内核重测后重新晋升，并显式指定版本运行。无证据支持的改动不做。

将确实观察到的结果写入当前 remember 与个人笔记，保留 practice ID 和版本；若使用了自己的 Markdown 工作流，再对该工作流 learning_feedback。不能用程序名称冒充 qd-learned 工作流。一次成功只报告该次结果，跨材料、地点或前置条件的多次独立实践支持后再总结可复用能力；不把 expected_outcome 或自述 done 当成掌握证明。
