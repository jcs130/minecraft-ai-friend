# 原生进食回执

`eat` 继续使用 Numen 的 `InventoryOps.eatItem`、`EatCompanionTask` 和当前任务槽。实际吃喝、消耗、动画、饥饿恢复与模组效果都由原生物品使用处理。

旧外部驱动只读到 `task_status` 变空闲。它没有保留 Numen 的 `TaskRecord` 终态，因此进食被记为 `observed_ended`，`completionConfirmed=false`。这不是“吃失败”的证据，也不能通过事后背包变化改写成成功。2026-09-14 原动作 `2227b9119f3141eaa400238f5e9fda69` / `t48` 的记录保持原样。

服务端既有交互桥增加两条内部管理员命令：

- `qdworld eat <actorUuid> <actionId> <base64url-json>`：只提交一次原生食物任务。
- `qdworld eating <actorUuid> <actionId>`：只读同一请求的原生回执。

它与放置交互共用世界内的 `data/qiandeng-interactions` 日志，但校验 `tool=eat` 与精确参数，不能用另一个命令或物品重用同一 ID。受理占位在派发前持久化；原生 `SUCCESS/FAILED/TIMEOUT/CANCELLED` 及真实结果按原任务保存。满饥饿等原生失败正常返回，不能误称已消耗。初始响应丢失只查询原 ID。

Numen 的普通长期任务持久化会在重启后重新调用工具。此处同一服务器线程在派发该外部单次食物请求后清除它的重放登记；桥保留原请求日志。未取得终态便中断的请求在重启后继续报告未知，不能再吃一次。其它原生任务的行为保持原样。

Python `food_actions.py` 验证身体 UUID、动作 ID、物品参数、任务 ID、桥 epoch 和互相一致的原生状态；`numen_gateway.py` 还校验身体维度及当前身体 epoch。身体空闲而原记录尚未结算时继续等待回执。旧版进食不补造回执。

原生自卫反射也会冻结进食的 15 秒执行预算，外部驱动因此给有新原生回执的 `eat` 设置 60 秒总等待截止。它复用原导航的一次精确 `task_stop` 和持久停止日志实现，保留导航 300 秒、原方法名和旧日志兼容；食物停止记录在 `action-stops/<actionId>.json`。仅控制器执行截止，只读 MCP 查询不取消动作。提交停止后，食物必须从原 `qdworld eating` 请求得到真实终态，不能读导航回执或把空闲当成功。丢停止 ACK 仅查询；有原停止占位、状态未知或发生重启时不重复停止或进食。旧版食物回执不启用这个截止。

本次停机另外存在控制器在动作锁外读临时 `unknown.json` 的竞争；正常动作提交过程中该占位短暂存在。进食缺终态与这个误暂停是两个问题，不能把旧 `observed_ended` 当成本次停机的唯一原因。

验证入口：`tests/test_survival_food_receipts.py`、`tools/smoke_world_interaction.py --run-isolated`。后者使用独立的全新 Minecraft 世界、模组副本和内部网络，包含真实吃一份、满饥饿不消耗、丢首 ACK 后只读查询、同 ID 不重吃，以及关服中断跨重启不重放；生产效果仍须以部署后实际任务回执为准。

本次隔离实机报告为 `runtime/interaction-qa-ae87649ff654/result.json`：35 项全部通过，72 个模组、0 模型调用、0 生产世界改动，QA 容器已清理。真实 Python `FoodActions` + RCON 正常模式面包 8→7、丢首 ACK 模式 7→6，均取得原生 SUCCESS 且饥饿 15→20；每次仅一次提交。满饥饿得到 FAILED，关服受理后重启得到未知，面包不再减少，原生重放登记为空。保留此前 `interaction-qa-d109b8c70636` 失败报告：新食物命令的 base64 尾部 `=` 不符合 Brigadier word；修复为无 padding 编码后重测，不改写失败记录。Linux 食物 11 项、原网关 31 项、世界动作 52 项测试通过。被测服务端候选 SHA256 为 `1f3c18027ee921827cbe06e34edfed3d811867043f5b484d48e886a4ce3a4dbd`，此处记录本身不代表已部署。

总等待截止在上述实机 QA 之后补入 Python，Java 与 `FoodActions` 均未改变。新增 `test_survival_food_deadline.py` 的 8 项回归与原导航截止 8 项通过，覆盖准确取消、停止 ACK 丢失、未知与重启不重发、只读观察不停止、自然成功不误停、旧回执不套新接口、food epoch 不匹配。35 项实机 QA 不冒充已覆盖生产中的 60 秒取消分支。
