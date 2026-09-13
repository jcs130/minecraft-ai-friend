# 桐人回合收尾与原生交互回执

2026-09-14 源码增量，生产部署及持续自主验收须以对应运行记录为准。

## 维护前收尾

在现有 survivor 容器中执行：

```powershell
docker exec qiandengji-survivor-1 python /survival/control.py drain
docker exec qiandengji-survivor-1 python /survival/control.py status
```

`drain` 持久记录请求，不立即撤销当前原生任务的 lease，也不调用模型取消或原生 `task_stop`。当前任务沿用原生活 session 继续；控制器确认原生回合已经结束、当前身体动作不再在途后，在现有 tick 内写入 `enabled=false`、`pauseReason=operator_drain` 和 `drain.status=completed`。维护者应等待该状态，不能把 `requested` 当作已经可以停止服务。

已运行程序在当前物理动作收尾后的安全边界暂停，保留程序状态；尚未开始的下一步或下一轮模型不会提交。请求到达本轮上下文构建期间时，提交前的共享锁复核会阻止新的模型预留。已有 unknown、异常中断或取消不确定仍走原来的阻断路径，drain 不清理这些证据，也不将它们改名为正常收尾。

恢复仍使用原控制入口：

```powershell
docker exec qiandengji-survivor-1 python /survival/control.py resume
```

原有恢复检查继续生效。成功恢复后，当前 `drain` 移入 `lastDrain`；控制器的 `operator_drained` 历史记录保留任务、回合、生活 session、请求和终态证据。`drain.status=completed` 只说明调度收尾完成，不声明所有游戏目标已经完成。

## 导航总等待上限

Numen 自卫等原生反射抢占当前导航时会冻结其执行预算，因此身体和服务器正常 tick 仍可能长期无法结束导航。现有 survivor 控制器在自己的 tick 内，对持久 `goto` 回执增加五分钟总占用上限；不启动新循环，不修改战斗策略，其它技能不适用。

到期后先重新读取身体、维度、原 navigation epoch 与原 native task ID。若已得到严格匹配的终态则直接收尾；若仍为同一在途导航，先在 `/state/survival/navigation-stops/<actionId>.json` 持久记录停止意图，再仅一次调用 `task_stop(task_id)`。之后只读查询真实终态：原生 cancelled/failed 作为动作失败交回模型，若已自然成功则保留成功。未知停止结果仍阻断，进程重启不能重发，原暂停清理也不能重复发送泛停。

2026-09-14 的 `t22` 是本次诊断期间按明确授权执行的一次精确维护停止，原模型回合此前已经 completed。`runtime/t22-native-stop-evidence-20260914.json` 保留同身体、同 epoch、同任务的前后观察及原生 cancelled 终态，原控制器随后自然记录 failed 并完成 drain。这是恢复现场的证据，不能说成尚未部署的新总等待上限自动生效。

## 放置、农耕、开容器的原生回执

这三种交互使用同一个持久 `actionId` 作为原生请求 ID：

```text
qdworld interact <actorUUID> <actionId> <base64url-native-args>
qdworld interaction <actorUUID> <actionId>
```

前者每次动作只发送一次。之后只能发送后者，读取同一原生 `TaskRecord` 的回执。响应必须匹配 actor、request、参数、工具与进程 epoch。明确原生拒绝（例如 `OCCLUDED`）返回普通动作拒绝，完整保留原生 `TaskResult`。不能用“身体 idle”替代任务终态。

首个响应丢失、为空或 JSON 无法解析时，Python 在原有有界轮询次数内继续读取同一 ID；不重发交互。明确身份或 epoch 冲突、缺少可信终态等情况仍为 unknown，保留全局阻断。

严格匹配的原生成功终态只证明点击已经结束。实际成功仍须验证目标方块、物品消耗或物理容器身份。已经结束但预期效果未验证时，返回 `action_rejected`，附带 `verified=false`、最新观察与原生终态，供模型重新观察和规划；不声明效果成功，也不自动重试。旧的未接入回执桥的 native 工具不适用这一变更。

每个桥接请求的有界诊断位于：

```text
/state/survival/world-interaction-receipts/<actionId>.json
```

其中记录阶段、尝试次数、错误代码、最早故障、最近 8 个事件和已校验原生回执，不保存任意原始 RCON 日志。网关 unknown 回包也带诊断阶段和代码。原生持久回执查询本身不执行游戏动作。

## 历史恢复边界

2026-09-13 的木板放置 `e403c77593c74954b1d800f5f14ecd55` 来自旧的回执缺失链路。一次性工具 `tools/reconcile_legacy_placement.py` 默认只读预览，要求精确任务、调用、回合、session、失败日志时刻、暂停状态和新旧观察匹配。它以原生 `FAILED(OCCLUDED)` 日志为主要证据，将原 unknown 文件原始字节归档，当前回执标记为拒绝；不伪造原生 request ID 回执，不重放、不退款、不恢复控制器。

2026-09-14 泥土动作 `aebfd209996a4ad59ac9e587ed2d72d8` 当时在提交后约 330 毫秒返回 unknown，比持久原生成功终态早约 17 毫秒；稍后的只读观察显示目标为 dirt、库存 43→42。这支持早期响应链路未完成确认，不支持“16 轮效果检查耗尽”的断言。当时未保存细分错误，不能进一步断言唯一根因。后验恢复须保留当时 unknown，并依据同 ID 持久终态和新观察单独归档。

## 代码验证

当前改动通过 68 项控制器测试（含 7 项 drain 和 2 项导航上限接线场景）、8 项导航上限测试、18 项快执行测试、41 项 Linux 生活 session/伙伴队列测试、52 项世界动作测试和 31 项 Linux 网关测试。导航测试覆盖精确停止、到期时已成功、身份/epoch/任务不匹配、不适用动作、暂停、丢 ACK、停止未知、崩溃后不重发及只读状态查询。旧木板恢复另有 10 项测试，覆盖四个提交中断点。独立 Minecraft 的真实原生交互及丢失首个 ACK 验收由 `tools/smoke_world_interaction.py` 运行，`runtime/interaction-qa-a13ef76bf7d8/result.json` 为本轮 23 项全部通过报告；报告与部署记录需分别核对，单元测试不替代实机持续自主验收。
