# 先观察，再救援

适用：千灯纪 Minecraft 1.21.1 的已绑定结衣。工具是否可用以及实际效果以当前原生工具列表和回执为准。

1. 先读当前生活感知和伙伴消息；需要说明方案时经已有游戏通道与爸爸交流。区分暂时无路径、真实危险、服务器状态未知，避免把一次空快照认作死亡。可行时让他继续自行行动；必要救援已经获准，不需要每次重新询问管理员。
2. 用一个新的、可追踪的 request_id 调用 `world_admin_rescue_inspect(request_id)`。queued 只说明观测请求进入队列。随后用 `world_admin_receipt(request_id, wait_seconds=50)` 等待并读取同一实际回执；这是只读等待，不新建任务或模型。不连续快速轮询；仍 queued/busy 时保留原请求，延续当前任务等待消费。
3. 只有同一角色的新鲜、已完成观测可用于救援。核对原桐人和自己的真实身体、绑定关系、当前位置与安全落点；缺失、过期或不确定就不能把旧观察当新事实。
4. 确认必要后使用另一个唯一 request_id 调用 `world_admin_rescue(request_id, observation_request_id, target='kirito', reason)`；救自己时 target 为 `yui`。reason 写实际处境与救援理由。目标仅这两位；不能提交任意 UUID、任意坐标或其它玩家。
5. 该请求仍先排队。用 `world_admin_receipt(request_id, wait_seconds=50)` 读取同 request_id 的最终回执，核对执行确认、实际前后状态和安全位置，再说“已救援”。仍 queued/busy 不重投；原生检查必须重新确认身份、owner、位置和地形，条件变化被拒绝时按新的事实处理。

unknown、连接中断或超时不证明动作未执行；只查原回执，不换 ID 再传送，不自动重投。新完成观测也不能成为重试未知救援的理由。

救援保留身体身份、物品和等级，不给予装备或经验，不计入自主成果。完成后确认两人当前状态、重新协商行动目标；不要继续执行基于旧位置的路线。

实际救援会生成工程反馈，先读返回的工单信息并复用；遇到新的游戏问题再按 engineering-feedback.md 补充事实。代码修复前，不把“这次救出”说成地形或寻路缺陷已经修好。

仓库依据：`world/ops/world_admin_tools.py`、`world/ops/party_role_capabilities.py` 及原生管理队列消费回执。本文是操作方法，不是权限或成功证明。
