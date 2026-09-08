# 村民交易与公会交付

适用：千灯纪 Minecraft 1.21.1。村民原生交易与公会实物合同是两套流程，报价、资格和结算各自查询。

## 村民交易

从当前 `look` 获得真实商人的 `entity_id`，在四点五格内且看得见时读取 `villager_offers`。每页四条，按返回的 `nextOffset` 判断是否需续读。报价包括实际库存与指纹；职业名称或历史攻略不能证明他现在卖什么。

选定一条后核对背包输入、输出容量和报价，保留至少三个背包空槽，并满足当前空手要求。桐人使用有效 `turn_id` 调用 `trade(entity_id, offer_index, quote)`，index 和 quote 原样取自本次报价；每次只成交一次。价格变化、缺货或前置条件拒绝就根据新事实重新规划。

用该次交易回执和物品增减验收。看见村民、打开菜单、工具受理或经验增加都不足以单独证明目标物品已到手。结果未知时不重复支付。

## 公会合同

用 `guild_board` 读取今天真实合同、本人的承接情况、材料/奖励及收货 NPC 的当前信息。`quest_id` 取看板返回的 `YYYY-MM-DD:N`，不要猜编号或把公示当作已经接单。

接取前检查本人资格、每日限制和柜台位置；准备实际材料后到指定收货 NPC 附近，再调用 `guild_deliver`。接近楼内 NPC 时核对入口与真实高度：相同 x/z 不等于同一层，近距验证按同维度三维位置执行。历史 NPC 坐标不用于传送、重建角色或伪造交付。

一次接取、释放或交付都需要当前动作租约。`claimed` 是接取，`completed` 才是交付结算结果；核对货物扣除、奖品入包及功勋。`outcome_unknown` 时只用原 `request_id` 查询 `guild_receipt`，不重新交付。

公会策划角色可运用配方和生活知识提高合同合理性，但仍只生成调用方要求的候选 JSON，遵守本次角色/物品白名单，不因阅读此页获得接取、发布或发奖工具。新候选不覆盖当天已发布、已承接的合同。

依据仓库：`world/survival/mcp_server.py`、`world/survival/world_actions.py`、`world/survival/guild.py`、`world/ops/skills/qd-guild-planning/SKILL.md`。
