# 先观察，再救援

适用：千灯纪 Minecraft 1.21.1 的已绑定结衣。工具是否可用以及实际效果以当前原生工具列表和回执为准。

1. 先读当前生活感知和伙伴消息，核对来信的 `messageAgeSeconds` 与本轮 `contextAt`。积压消息里的位置、HP和求救原因描述的是当时，不是当前危险；先用 `currentObservation` 核对，缺少关键事实再补新鲜观测。区分暂时无路径、真实危险、服务器状态未知，避免把一次空快照认作死亡。可行时让他继续自行行动；必要救援已经获准，不需要每次重新询问管理员。
2. 本来信最多一轮检查和必要救援。用一个新的、可追踪的 request_id 调用 `world_admin_rescue_inspect(request_id)`。queued 只说明观测请求进入队列。随后仅一次 `world_admin_receipt(request_id, wait_seconds=50)` 有界等待读取同一实际回执；仍 queued/claimed/busy/unknown 就保留原 ID，说明结果未确认，简短回复并结束本来信。不要继续轮询或换 ID 新建检查。
3. 只有同一角色的新鲜、已完成观测可用于救援。核对原桐人和自己的真实身体、绑定关系、当前位置与安全落点；缺失、过期或不确定就不能把旧观察当新事实。
4. 确认必要后使用另一个唯一 request_id 调用 `world_admin_rescue(request_id, observation_request_id, target='kirito', reason)`；救自己时 target 为 `yui`。reason 写实际处境与救援理由。目标仅这两位；不能提交任意 UUID、任意坐标或其它玩家。
5. 该请求仍先排队。仅一次 `world_admin_receipt(request_id, wait_seconds=50)` 读取同 request_id 的回执，核对执行确认、实际前后状态和安全位置，再说“已救援”。仍未确认时保留原 ID，简短回复并结束本来信；原生检查必须重新确认身份、owner、位置和地形。明确 `quote_source_moved` 拒绝后，本来信停止新建检查和救援，说明身体已移动、本次未执行，不追着移动角色反复申请传送。

这封来信的最终回复才会经游戏通道发给伙伴；持续调用工具不会提前发出回复。后续实际收到新输入时，再依据当前事实核对未决原请求或决定新行动，不承诺会自动续查。结束认知回合不会撤回队列请求，也不把未确认变成失败或成功。

## 请求名称与观察时间

`request_id` 是幂等请求的唯一名称，不是可重复执行的命令名。读到 `replayedReceipt=true` 说明返回的是这个 ID 原有回执；即使 `status=completed`，也可能是数小时前的观测。不要从旧日记复制 `yui-rescue-5-inspect-20260914` 这类已用名称来“重新检查”。

如果上下文提供 `workSupport.newRescueRequestLabels`，其中 inspection/rescue 是本轮新请求建议名称，分别用于新观测和新救援；它们尚未提交。没有建议名称时，给新事件使用新的可追踪名称，并在本事件内保持不变。先确认没有需要继续查询的未知旧救援，不能为摆脱未知状态而换名重投。一个新观测即使重试读取，也沿用原观测 ID，不连续造出 check/retry/final 三套队列。

真正用于救援的是观测回执中的 `observedAt`、`expiresAt`、原身体与安全落点。与本轮当前时间核对，必要时再观察；不要用工具调用发生的时间替代回执的观察时间。queue 的 expiresAt 与 observation 的 expiresAt 各自有含义，仍以原生最终检查为准。

## 常见回执怎么继续

| 回执 | 含义与下一步 |
| --- | --- |
| queued / claimed / busy | 请求仍在原队列；本来信对同 ID 最多一次50秒有界等待，之后如实回复未确认并结束。短暂排队不是队列死锁。 |
| unknown / outcome_unknown / 连接中断 | 结果未明；保留原 ID，不换名再提交，不声称失败或成功，不通过反复工具调用拖住本来信。 |
| rescue_observation_expired | 本次救援已明确拒绝；旧观察不能使用。本来信说明未执行；后续真实新输入仍证明独立救援必要时，重新获取新鲜观测再决定。 |
| quote_source_moved | 被观察身体已经移动，本次救援未执行；本来信停止新建检查和救援并回复，不把旧求救当成继续传送的理由。 |
| completed 且 executionConfirmed=true | 才可根据实际前后状态确认救援生效；仅 completed 的 inspect 不代表救援发生。 |

当前回合的结果只记录本次回执；“今天前四次成功”这类历史统计不能替代本轮证据。必要的等待、观察、明确拒绝也可以是有价值的结果，准确说明即可。

unknown、连接中断或超时不证明动作未执行；只查原回执，不换 ID 再传送，不自动重投。新完成观测也不能成为重试未知救援的理由。

救援保留身体身份、物品和等级，不给予装备或经验，不计入自主成果。完成后确认两人当前状态、重新协商行动目标；不要继续执行基于旧位置的路线。

实际救援会生成工程反馈，先读返回的工单信息并复用；遇到新的游戏问题再按 engineering-feedback.md 补充事实。代码修复前，不把“这次救出”说成地形或寻路缺陷已经修好。

仓库依据：`world/ops/world_admin_tools.py`、`world/ops/party_role_capabilities.py` 及原生管理队列消费回执。本文是操作方法，不是权限或成功证明。
