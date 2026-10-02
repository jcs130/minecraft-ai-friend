# 冒险者公会接待员与共享箱

正式服中心为 `(-489, 66, -502)`。从村庄走到大厅南侧入口，门内左手边是“公会接待员·阿莉娅”。右键她打开 27 格原版容器菜单：今日任务、绿宝石余额商店、装备回收、公共储物指引及原版实体绿宝石交易。购买和回收复用试炼经济账户及原有报价确认规则，不从公共箱自动扣物或扣款。手柄和基岩客户端只需原版交互键；Agent 可用 `/mycli guild trader` 查询位置，用 `/mycli arena shop list|buy`、`/mycli arena recycle list|quote|sell`、`/mycli arena wallet` 管理本人交易。

大厅东南侧是四组真实的 54 格双箱。牌子分别写“武器”“护甲”“补给”“公共杂物”；它们只是整理建议，箱子本身没有类型限制。每个箱子所有人共用，存入即表示其他玩家和 Agent 可取走，也可能被取空；不适合放唯一任务物品。个人试炼箱及其待领取队列仍按 UUID 隔离，不会自动转移到共享箱。`/mycli guild shared` 给出以下绝对坐标；对每组任一半使用原版开箱、`deposit`、`withdraw` 即可。

服主需要替在线玩家整理普通物资时，可在控制台先执行 `mycli admin sharetrial <玩家>` 看计划，再执行 `mycli admin sharetrial <玩家> apply`。仅无元数据且在明确白名单内的普通物品会从该玩家个人试炼箱转进四组实体共享箱；带名称、附魔、刻印、绑定或个人功能的物品保留，目的箱容量不足则整组留在个人箱。玩家和 Agent 仍可直接用原版箱子操作自主分享；此管理命令不处理随身背包或尚未入箱的奖励队列。

| 分类 | 箱子左半坐标 x,y,z | 容量 |
| --- | --- | --- |
| 武器 | `-473,67,-495` | 54 格 |
| 护甲 | `-473,67,-493` | 54 格 |
| 补给 | `-473,67,-491` | 54 格 |
| 公共杂物 | `-473,67,-489` | 54 格 |

`MC_GUILD_SHARED` 文字回执仅发给执行命令的玩家，含 `id/name/dimension/x/y/z/scope=public/slots=54`。Agent 算路到箱旁再对实体方块操作；库存应每次开箱重新读取，不能把上次观察当作预约。箱体、牌子和地台在 `guild-services-mask.tsv` 的原始材料快照中受防拆、防爆和活塞保护；箱内物品保持普通双箱同步和存取语义。此快照与世界 UUID、世界存档、`plugins/AgentFriend/config.yml` 必须一同备份或恢复。

发布或移植时先在隔离服执行控制台 `mycli admin surveyservices`，核对大厅坐标、23 栋原村屋边界及自然地面。E/F 双盘完整备份后，且无人类玩家、无活动试炼时，执行一次 `mycli admin buildservices`。命令在施工前写入 `guild-hall.services-building=true`；施工成功后生成 `guild-services-mask.tsv` 并置 `services-built=true`。若中断，保留标记与现场，检查或从施工前整套快照恢复；不要删除标记重跑，也不要单独换回旧 JAR 后继续让玩家编辑新建筑。建成后再做一次完整备份，新备份含箱内物品及接待员实体。

隔离服验收脚本 `plugins/AgentFriend/guild-services-stage.mjs` 使用两个 Mineflayer 1.20.6 账号：四组箱子确认为 54 格，同一双箱两半跨账号存入与取出铁剑，拆箱被拦，NPC 菜单依次打开余额商店、回收和原版村民六条交易。`guild-services-persistence-stage.mjs prepare|verify` 在 JVM 正常重启前后确认箱内物品保存、接待员只有一个。基岩手柄的牌子排版和实际开箱手感仍需真人客户端目视确认。
