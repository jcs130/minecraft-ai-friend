# 寻路与到达：研究结论（2026-09-17）

问题：桐人在农田反复 `goto` 同一坐标却不推进，是否应该换一个更好的寻路算法？
结论：**不该换，因为问题不在寻路**。本文给出证据链、真正的根因，以及值得动手的排序。

## 一、现状：numen 的寻路是 Baritone 的完整移植

读部署源码 `runtime/numen-walk-only-source/`（75 个 `core/pathing/**/*.java`）：

| 包 | 内容 | 判据 |
| --- | --- | --- |
| `astar/` | `AStarPathFinder`、`AbstractNodeCostSearch`、`BinaryHeapOpenSet`、`CutoffPath`、`Favoring`、`Avoidance`、`SplicedPath`、`PathNode` | 类名与 Baritone 逐一对应 |
| `moves/` | `Movement{Traverse,Diagonal,Ascend,Descend,Fall,Parkour,Pillar,Placement}`、`MovementHelper`、`CalculationContext`、`ActionCosts`、`ToolSet` | Baritone 的移动原语体系 |
| `goals/` | `GoalBlock`、`GoalNear`、`GoalGetToBlock`、`GoalXZ`、`GoalYLevel`、`GoalComposite`、`GoalRing`、`GoalRunAway`、`GoalAvoidEntities` | Baritone 的目标库（含"差 N 格即可"） |
| `execute/` | `PathExecutor`(34KB)、`PathingCore`、`PlayerNav`(24KB)、`SprintPolicy`、`AimProcessor`、`ExecHarness` | 执行与输入生成 |
| 自研增量 | `cache/PathCaches`、`LoadedOnlyView`、`calc/PathPlannerPool`、`util/NavProfiler`、`settings/NavSettings` | 缓存、并行搜索池、性能剖析、75 项可调参数 |

即：**MC 寻路的业界基准（Baritone 的 A* + 移动原语）已在跑**，且额外加了缓存与规划线程池。
加权 A* 因子 `COST_HEURISTIC = 3.563`（`calc/NavGoal.java` 里自注为"故意的 legacy parity，归一化是已标记的后续项"），与 Baritone 同源策略一致。

## 二、候选替代算法为什么不适用

| 算法 | 适用前提 | 在本题为何不适用 |
| --- | --- | --- |
| **JPS / JPS+** | 均匀代价栅格，提速 10–40× | 3D 体素里移动代价高度不均（走/跳/搭/挖/落各不同），跳点前提被破坏；且本题的瓶颈不是搜索速度 |
| **Theta\*** | 任意角路径更平滑 | Baritone 系刻意用**离散移动原语**保证可执行性与可复现性；任意角路径在 MC 物理下要额外做路径跟随，收益不抵风险 |
| **D\* Lite / 增量重规划** | 世界频繁变化、重规划昂贵 | numen 已有 `PathCaches` + 缓存视图，重规划不是瓶颈 |
| **HPA\* / 分层** | 超远距离 | 本题发生在 1–2 格尺度，分层无用 |
| **流场导航** | 大量同质 agent | 单主体场景无收益 |
| **局部连续控制器**（pure pursuit / P 控制 + 死区） | **精确落位** | **这一个才是真缺口**，见第四节 |

## 三、本轮故障的真实根因：不是寻路

### 证据链

1. **每一次 goto 都报成功**：`navigationOutcome.state = "success"`、`reason: "destination reached by native task"`，位置也确实到达过（`final_x/z` 落点在目标附近）。同一坐标 `(-638.5, 64.9375, 1055.5)` 在 14:35:06 与 14:39:09 两次都报成功。
2. **失败的是 farm 工具，不是移动**：`world/survival/world_actions.py` 的 plant 前置校验：
   ```python
   if item not in CROPS or block['block'] not in AIR:
       raise GatewayError('invalid_planting_target_or_seed')
   ```
   即 **plant 的 `x/y/z` 必须是土壤上方那一格空气**（`world/survival/AGENT.md` 原文：「plant 指土上空气格」）。他传的是**土壤格本身**。
3. **动作日志实锤**：同一格的成功调用是 `plant(x=-639, y=65, z=1054)`（13:51:06，y=65 = 泥土 y=64 上方）；循环期他的自述是 `plant(-639, 64, 1054)`——**y 少了一格，落在泥土格上，非空气**。他在 13:51 用对过，之后退化了。
4. **错误契约缺口放大了误判**：同文件里相邻分支 `plant_requires_farmland` 带完整 details（requested/target/support/expectedSupport/dispatched/instruction 六字段，明说"仅改变站位不会改变请求格下方的方块"），而 `invalid_planting_target_or_seed` **不带任何 details**。他据此把参数错误**误诊为站位问题**，转向精确 goto——而 goto 从来没错。
5. **循环的成因是重规划，不是寻路**：目标未达成 → 重发同一调用 → 再 goto 同一坐标 → 再失败。系统自己的 crystallization 探测已标到连续 15 次重复。

### 两层分界的作者自述

`calc/NavGoal.java` 注释写得很清楚：

> Node-domain only: `isAt` judges feet CELLS during the search. **Live-entity arrival predicates (exact doubles, reach distances) remain the task layer's business** — they answer a different question ("is my body close enough") than the search's ("may this node end the path").

搜索层回答"这个节点能不能结束路径"，任务层回答"身体够不够近"。本次故障整个发生在**任务层的参数语义**上，搜索层无责。

## 四、真缺口（如果将来确实需要精确落位）

搜索层判定"节点到达"之后，把身体从 0.5–1.5 格误差**收敛到精确格**是**连续控制**问题，不是搜索问题。标准解法是：

- **全局离散规划**（已有：A* + 移动原语）
- **局部连续控制器**：pure pursuit / 比例控制 + 死区——读位置误差、按误差调输入、进死区即停。可用的输入原语已在 `moves/Input.java`、`core/tools/MovementOps.java`、`execute/SprintPolicy.java`。
- 或者**根本不需要精确落位**：numen 已有 `GoalNear(x,y,z,range)` 与 `GoalTwoBlocks`——交互类任务只需"进到可交互距离"，用精确 `GoalBlock` 是自找麻烦。

## 五、值得动手的排序（按性价比）

| 序 | 事项 | 成本 | 收益 |
| --- | --- | --- | --- |
| **A** | 给 `invalid_planting_target_or_seed` 补 details/instruction（照隔壁 `plant_requires_farmland` 的样子：请求格实读方块、期望语义"y 应为土壤格 +1"、support 格） | 极小（单分支） | **直接消除本轮误诊**；任何 Agent 看一眼就能自纠 —— **✅ 2026-09-17 已实现并实战验证，见下** |
| **B** | plant 放宽受理：若请求格是 farmland，则自动取其上格为目标（或返回专门错误码 `use_air_cell_above` 而非笼统 invalid） | 小 | 容忍坐标语义误用；须守住"请求格不被静默改写"的既有原则 |
| **C** | **停滞检测/重定向**（进化机制第 1 项，见 `EVOLUTION-MECHANISM-PLAN.md`） | 中 | 与根因无关地兜住**一切**循环，含将来未知的类型 |
| **D** | 精确落位的闭环接近原语（第四节） | 大 | 仅当确实出现"必须站上某格"的任务时才需要；**目前没有证据需要** |

### A 项落地实录（2026-09-17，commit `691f5f1`）

- **改动**：`world_actions.py` 拆分原合并判断，not-air 分支补 `farm_preflight` 观测（requested/target/
  expectedTarget/instruction，含 `(x,y+1,z)` 更正指引）；`numen_gateway.py` 把模型可见闸从只认
  `plant_requires_farmland` 放宽到两个码，并把 `expectedTarget` 加入白名单。**这是有意翻转一个既有决定**——
  原测试名就叫 `..._preserves_other_rejections` 且断言 not-air 不带 details；翻转理由：两个分支是同一类观测
  （单格预读、未派发、未写入），farmland 分支已确立这类信息安全且对模型可见，not-air 只是当时被漏掉。测试已同步
  改为断言新契约并写明缘由。
- **实测（够分清"代码对"与"真的管用"）**：容器内 **96/96 测试通过**；随后经女神正门
  `goddess-orders.jsonl` 递出更正指引，桐人**自己把教训写进 memory**（「plant 填作物占据的空气格 (x,y+1,z)，
  不是耕地格」），按 y=65 重种，**世界实测** `(-639,64,1054)=farmland`、`(-639,65,1054)=wheat`，
  邻格扫描另有一格小麦；**同坐标 goto 循环停止**（指令后 6 次 goto 仅 2 个不同目标，对比此前 27 次打转）。
- **一个重要反证**：agent 面向的文档**本来就写对了**——`farming.md` 有「不把土格当作播种位置」，工具描述有
  「改变站位不会纠正错误的目标高度」。**拿着正确答案仍然踩坑**，说明单靠文档不够，失败瞬间的自纠信号（本项）
  与停滞检测（C 项）才是有效层。

不建议：更换/替换寻路算法（第二节已排除）。

## 六、未验证的部分

- 未做**跨地图的到达误差统计**（只在 farm 场景观察）；"落点差 0.5–1.5 格"是动作日志与该场景的推论，不是全场景抽样。
- 未核对 numen 现行 jar 与 `runtime/numen-walk-only-source` 快照**逐字节一致**（该目录是构建期快照）；结论依赖其代表性。
- A/B 两项**尚未实现**，收益为设计判断，非实测。
