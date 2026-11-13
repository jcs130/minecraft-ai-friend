## 0.1.28-residence 驻点已上线

服主可为一个已有绑定的原实体配置驻点。伙伴离线且女仆处于空闲随行状态时，女仆会回驻点并沿固定路线巡逻。访客在附近时可看到她转身招手，也可以点名交谈。访客的交谈没有操作权限。

`/qdmaid context <maidId>` 对绑定伙伴显示 `residence`。`resident_patrol` 表示当前执行驻点巡逻，`patrolVisitsThisRun` 只在实际到达巡逻点后增加。`awaiting_partner_at_home` 表示伙伴已上线，可以到驻点 24 格内会合，原随行规则随后恢复。`awaiting_original` 表示尚未定位到原实体，可用 `lifeState` 区分生命状态。手选驻守、工作、坐下或正在战斗时优先保留现场安排。

常驻按区块模拟运行，使用现有原生女仆和聊天入口。驻点可以使用现有客户端。驻点只启用步行、动作和访客交谈，已有私人合成工单沿用本人在线条件。[正式发布](../../../docs/MAID_RESIDENCE_DEPLOYED_20261113.md)

## 0.1.27-workshop 工位已上线

原版 Java 和未改动的 Mineflayer 直接使用现有游戏聊天和 `/qdmaid`。原版菜单照常查看真实背包，工位按当前背包的可用槽计算容量。大背包仍须实际装备。

- `/qdmaid workshop <maidId> [queryId]` 返回本人女仆的工位、可选配方和当前工单。先用 `/qdmaid list` 取得 maidId。
- `/qdmaid make <maidId> <requestId> <工位ID> <配方ID> [成品数量|once] [chest|backpack]` 下单。默认按服务端配方制作一次，使用工位补给箱。数量表示成品件数，须为 `productsPerCraft` 的整倍数，最多制作 16 次。
- 下单前请站在工位附近、同一维度能看见肥鱼的地方。隔墙被 AgentVision 遮挡也可能收到 `workshop_world`，可绕到同一侧确认看见她后再下单。
- 在附近频道点名并说明工位、材料来源与数量，也可由已配置共享对话的女仆调用 `make_at_workshop`。只向绑定伙伴的近聊提供这个工具。
- `/qdmaid receipt <maidId> <原requestId> [queryId]` 查原结果。正常接单是 `pending`。`completed` 且 `goalCompleted:true` 表示实际库存已核对，`observation` 给出 `itemId`、`count`、材料和成品所在的 `inventory`，以及到达点。完成时聊天中的工单编号可用于查询。
- 缺材料、库存已改或路线中断会附原因。可明确确认无效果的失败修正后再下新单，`unknown` 用原请求和实物核对。

更新后的 `mc_maids` 可以用 `workshop` 读取同一工位目录和 `currentOrder`，用 `make` 传 `maidId`、`requestId`、`workshopId`、`recipeId`，并按需传 `quantity`（成品件数）和 `inventory`（`chest` 或 `backpack`）。桥 0.1.30 起目录附 `table`、`supplyChest` 方块坐标。旧桥可走已有的普通命令入口，新的插件频道能力在发送前协商。

需要农场时，从 `tasks` 读取已启用的 `touhou_little_maid:farm`。先核对有权使用的耕地、工作时段与种子，再用 `task` 选择原生任务。`applied` 表示已切模式，采收和补种以方块、掉落或真实库存为准。用 `follow` 结束工作并恢复同行。

在桥的插件数据目录 `workshops.json` 登记工位。示例 UUID 和坐标均需替换成实际站点信息：

```json
{
  "schema": 1,
  "workshops": [
    {
      "id": "home",
      "maidId": "00000000-0000-0000-0000-000000000001",
      "ownerId": "00000000-0000-0000-0000-000000000002",
      "worldId": "00000000-0000-0000-0000-000000000003",
      "chest": [12, 65, 5],
      "table": [18, 65, 5],
      "recipes": ["minecraft:torch", "minecraft:stick", "minecraft:bread"]
    }
  ]
}
```

把工位放在绑定伙伴可进入的同维度地点。使用普通单箱与实体工作台，箱上留净空。箱子工单先到箱子核对，再走到工作台并回箱交付。箱内材料与成品在同一次提交中改动。背包工单到工作台后直接对可用槽提交。配方余物也放回同一个库存。现役 WorldGuard 权限、箱锁、主人身份、容器身份及库存变更均需通过检查。切换手选模式或断开可结束待处理的工单。提交不明的旧工单保留原记录，重启从原回执继续查询。

**0.1.26 伙伴动作，已随 0.1.27 上线。** 同维度附近交谈使用当前已选模型。绑定伙伴可说“肥鱼，跟我走”“稍等一下”或“请去钓鱼”，模型可以设置一次实际模式。访客可以交谈。原生本人 `chat` 继续读取原车万女仆历史和摘要，附近交谈只保留同一连接和维度的最近四组问答。

每段附近交谈从第一条起最多 120 秒、6 条请求。文字、语音识别、点名和直接接话共用这段限额。收到告别或模型选择收尾时会结束。`closed` 是无台词的终态，`replied` 可带 `conversationClosed`。动作在 `observation.actions` 中独立报告。收到 `applied` 或 `appliedMode` 时按真实状态继续行动。回复为空也能查询原动作回执。交谈收尾后仍可用 `/qdmaid follow <maidId> <requestId>` 切换。短等 60 秒后由原生 AI 恢复随行。

`context.fishing` 提供原生钓鱼任务、主手鱼竿、工作时段、乘坐、抛竿和最近一次实际收竿的状态。先给主手装备鱼竿，带到有空椅子或船的水边。`touhou_little_maid:fishing` 已设置表示开始执行任务。用 `hookActive` 观察抛竿，用 `lastRetrievedAt` 观察收竿，再查看附近掉落或 `inventory`。切回 `follow` 会离开钓鱼座位。其他原生任务及条件通过 `tasks` 查询。

**0.1.25 过门随行已部署**：下界门换维度成功后，服务端使用角色实际抵达的地点安排随行。跨维度接应半径读取女仆的跟随配置，肥鱼为 32 格；同世界的远距传送沿用原规则。原伙伴需要在出发时已加载、可移动并处于随行状态，目标附近也要有已加载的安全落点。跨维度后请通过 context 核对当前维度、位置和 ownerDistance。

**2026-11-11，0.1.24联合候选，尚未正式加载：** [快速接话与同行距离](../../../docs/MAID_FAST_FOLLOWUP_20261111.md)将固定五秒间隔改为滚动30秒最多6次实际玩家请求；主动邀请不占玩家预算，模型忙碌仍拒绝新请求，`chat_cooldown` 会返回实际等待说明。伙伴附近交谈24格、其他访客8格，ASR不得超过实际可听距离；原生本人 `chat` 仍16格。伙伴可用“拜托啦肥鱼～”等自然呼语；第三人称提及、私聊和全服喊话不扩大触发。联合候选包含32／16／64格跟随实现，但不代表正式实体配置已写入。以实际版本和上下文字段为准。

**2026-11-10，0.1.20交谈已正式加载，原主人格采用与耳听待验：** 同一现场发言者的连续接话改为120秒/最多6句；仅原肥鱼复用当前选定的原生模型，在安静同行和真实场景变化后适度主动聊天，回执含 `initiatedBy:maid`。不自动执行工具，不切换原脑，不重放未知请求。原生私人交谈记忆不进入公开聊天。下文45秒/3句为旧版行为；以实际运行版本为准。见[候选及已生效公告](../../../docs/MAID_COMPANION_DIALOGUE_20261110.md)。

**0.1.17候选，尚未正式加载：** `context.speech.ambientSource/ambientPack` 说明原录音来源，`voice` 说明生成回复所用克隆音色；`sent` 仍不证明耳听。自动护卫可在8格内可见敌对怪物尚未锁敌时触发，夜间只临时切原生脑活动，保留主人的作息/停留/手选工作和低血量优先。实际版本以服务器返回为准，不能因读到本文就假定正式服已有。详见[候选](../../../docs/MAID_VOICE_PATROL_20261110.md)。

# 女仆操作协议0.1.15-inventory-receipts（服务端已部署，原客户端采用待验）

**0.1.15 已部署**：`slotCount` 是底层总槽数；保留字段 `availableSlots` 表示已解锁容量，绝不是空槽数。按 `indexBase:0`、`usableSlotIndexes`、`freeSlotIndexes`、`lockedSlotIndexes` 和 `freeSlotCount` 判断是否可用。默认未装背包通常只有0–5可用，6–35锁定；`slots` 仅列真实非空物品，不包含菜单装饰。锁定槽返回 `maid_slot_unavailable` 和当前合法范围。

经主人身份核验后，`transfer/equip` 的加载、距离和原生物品预检失败会持久保存 `status:rejected`、`observation.effectsApplied:false`、错误和指引。首次写入及同参数重放的外层 `ok:false`；查询原回执的 `ok:true` 只表示查询成功，仍须读取 `data.status`。重复相同 ID 返回原拒绝；改变参数复用 ID 返回 `request_conflict`。只有明确 `rejected` 才可在重新观察、纠正参数后以新ID发起新的操作。`unknown` 或 `receipt_missing` 仍是不确定结果，不允许换ID重投；旧版缺失回执不会自动补写。校验后的执行异常不会被错误标为拒绝。

若宿主注册了 `qiandengji:maids`，即使命令由普通聊天入口发送，结果也从该插件频道返回，服务器不重复发送聊天副本。客户端须在发送前按原请求ID登记等待者，并接收 `ok:false`；不要因错误帧缺少 `data.maidId` 丢弃它。

**0.1.14-companion 已部署**：原肥鱼在附近点名且回复成功后，同一玩家、连接、维度有45秒接话窗口；每个已完成回复最多承接3条后续输入，仍需8格范围并遵守原节流。公屏、私聊、旁人和跨维度不继承此窗口。对话声音优先于日常短句，后者可被中断；`speech.transport=simple_voice_chat_position` 不依赖客户端女仆投影的实体 UUID，仍需连接 Simple Voice Chat，`sent` 不等于耳听验收。

`context.companion` 返回原生自动护卫状态。仅已配置的原肥鱼在闲置跟随、有合适武器、附近可见怪物正在攻击主人或本人时切到原生战斗；脱战5秒、低血量或武器不合格时恢复陪伴。主人手选任务和停留优先，不另启模型行动循环。她在主人原位置16格内、处于跟随时，会跟随成功的远距／跨维度传送，落点必须已加载且安全；不召回远方或未加载女仆，不创建替代实体。`applied` 仍只是设置成功，必须核对维度、位置及 `ownerDistance`。

桥 0.1.30 候选通过原生注册表匹配主手武器，包含近战、弓、弩、三叉戟与弹幕。弓弩按原生弹药条件就绪。`context.companion` 返回 `mainHand`、就绪的 `equippedAttackTask`、`partnerRange` 和下一步。伙伴距离由原跟随停止距离推导，按 16 格最低值计算。可见敌对目标仍须在女仆 8 格内，并通过原生目标检查。驻点、坐下或手选工作继续优先。VortexRPG 的玩家施法入口仍要求在线玩家角色。

旧聊天回执超过4000字符时仅省略静态帮助，标记 `compactHelp:true`；身份、生命事实、动作终态和原请求ID保留。插件频道返回完整内容。仍超长会明确返回 `response_requires_plugin_channel`，客户端应在 `qiandengji:maids` 查询原请求，不能换ID重做动作。基础协议和命令入口不变。

**0.1.11-social 已部署**：`nearby [queryId]` 返回附近可见女仆的 `maidId/name/owned/publicChatEnabled/chatCommand`，可选 MCP 为 `{action:"nearby"}`。`chat` 允许同维度 8 格内访客与已开放女仆交流；其 `observation.conversation="nearby_visitor"`，不包含主人记忆或工作工具。本人 `chat` 的原生历史／工具保持，`receipt` 按原请求查询，不重放。真人用右键→点击交谈→输入话语，或 `/qdmaid say <maidId> <话语>`；这种便利入口只发简短中文，Agent继续用结构化 `chat`。参见[发布说明](../../../docs/MAID_PUBLIC_DIALOGUE_20261107.md)。

**0.1.12-conversation 已部署**：附近文字/ASR 中点名“肥鱼，你好”，复用公共交流；主人工作仍用原 `chat`。新增 `context.appearance` 表示实际 YSM/原生模型，旧顶层 `modelId` 仍为备用原生模型；`damageProtected`、`conversation` 与 `speech` 分别解释保护、交谈方法和统一音色发送状态。字段须按存在性检测，`sent` 不等于真人听到。服务端部署不代替客户端自主交流、真人麦克风或耳听验收。详见[设置核对](../../../docs/MAID_CONVERSATION_20261108.md)。

复用本人已登录的游戏连接。宿主调用标准命令发送能力即可，不需要让模型写 `bot`、`Buffer` 或底层协议。`maid-port.mjs` 是可选的千灯纪适配器，不是新的 Agent 循环。

先 `/qdmaid list` 取得自己的 `maidId`，再按需查询。只使用服务器返回的 UUID、槽位和工作 ID；悦灵只是原版投影，不代表她是普通悦灵。

**运行方式0.1.10-harness已部署。** `/qdmaid brain <maidId> [queryId]` 查询当前选择及 `choices:[{id,label,model,configured}]`；`/qdmaid brain <maidId> <requestId> <返回的choice>` 切换。MCP使用 `mc_maids {action:"brain",maidId}` 查询，选择时增加 `choice,requestId`。仅原肥鱼和原主人启用共享运行方式，对话未结束时拒绝切换；保留原女仆、历史和物品，不另开身体或控制循环。真人 `/qdmaid brain-menu <maidId>` 使用普通27格菜单。运行方式与模型分开显示，configured不等于当前推理成功，仍按原 `chat → receipt` 验收。详见[Harness接线](../harness/README.md)。

| 用途 | 命令 |
| --- | --- |
| 本人女仆 | `/qdmaid list [queryId] [page0]` |
| 状态、死亡与遗物 | `/qdmaid context <maidId> [queryId]` |
| 背包、武器和护甲 | `/qdmaid inventory <maidId> [queryId]` |
| 原生工作及所需物品 | `/qdmaid tasks <maidId> [queryId]` |
| 原生模型对话 | `/qdmaid chat <maidId> <requestId> <1–140字文本>` |
| 给女仆物品 | `/qdmaid transfer <maidId> <requestId> put <maidSlot> <count> <playerSlot>` |
| 取回物品 | `/qdmaid transfer <maidId> <requestId> take <maidSlot> <count> [playerSlot]` |
| 穿戴、持物或卸装 | `/qdmaid equip <maidId> <requestId> main\|off\|head\|chest\|legs\|feet <maidSlot>` |
| 跟随、停留、坐下 | `/qdmaid follow\|stay\|sit <maidId> <requestId>` |
| 切换工作 | `/qdmaid task <maidId> <requestId> <observedTaskId>` |
| 原操作结果 | `/qdmaid receipt <maidId> <originalRequestId> [queryId]` |
| 真人背包及装备菜单 | `/qdmaid menu <maidId>`，或右键本人女仆 |

例：观察到本人快捷栏 0 有一把剑、女仆背包 0 为空，先 `transfer … put 0 1 0`，再以**另一个 requestId**执行 `equip … main 0`，最后查 `inventory` 验证实际主手。护甲使用同样流程。空女仆背包槽与装备槽交换可卸装；保留附魔、耐久和原生绑定诅咒限制。玩家槽采用 Bukkit 0–35，0–8 是快捷栏，**不是 Mineflayer 窗口槽编号**，适配层需转换。

主人 `chat` 距离 16 格且同维度，使用原 TLM 已配置的模型、记忆及工具；访客 `chat` 距离 8 格且同维度，只提供隔离公共交流。`talk` 保留旧外部宿主留言箱语义，**不能把它当作模型对话**。`speak` 只是作者提供的发言，也不是模型生成。

## 回执及终态

服务器系统消息为 `QD_MAID {JSON}`，或从 `qiandengji:maids` 插件频道返回同一 JSON：

```json
{"schema":1,"protocol":"qiandengji-maids/v1","recipientUuid":"本人UUID","action":"chat","requestId":"chat-001","ok":true,"sampledAt":"ISO时间","data":{"maidId":"女仆UUID","operationId":"chat-001","status":"pending","goalCompleted":false,"observation":{"nextCommand":"/qdmaid receipt 女仆UUID chat-001"}}}
```

写操作的 requestId 为 1–48 位字母、数字、下划线或连字符。先持久保存 ID，再发送。相同 ID/动作/参数返回原回执并标 `replayed:true`；换参数复用 ID 返回 `request_conflict`。超时不能换 ID 自动重投。查询用原 ID，查询自身可用新的 queryId。

| status | 含义 |
| --- | --- |
| `applied` | 原生设置或物品交换已应用；不代表工作目标完成 |
| `rejected` | 主人已认证，库存预检明确拒绝且未转移物品；纠正前先读原回执及最新槽位 |
| `pending` | 对话已交给原生入口，尚未确认回复 |
| `replied` | 读取到此次原生历史的回答；`observation.reply` 为正文，不能据此认定提到的游戏动作完成 |
| `queued` | 旧 `talk` 留言已进外部宿主收件箱，不等于已有回答 |
| `unknown` | 结果不确定；保留原 ID 查证，不自动重放 |

对话超时、期间死亡、原生 UI 插入另一条消息或服务重启均不能伪报回复成功。模型异常仍保留原生报错；桥接回执只声明自己能证实的结果。完成时额外发送 `action:"chat-result"`，requestId 为原操作 ID；离线后仍可查询保存的 receipt。

错误保留 `ok:false,error`，增加 `nextStep` 和 `data.message`；权限不足会提示本人查询，超距会要求核对维度坐标，死亡会给遗物指引，护甲错误会明确部位及物品条件。

## 生命状态与事件

近距跟随0.1.9-follow[修复已部署](../../../docs/MAID_CLOSE_FOLLOW_20261107.md)。命令入口不变，新增 `context.follow` 解释寻路请求、实际暂停原因和原生安全恢复；`follow` 回执 applied 不能代替位置/ownerDistance 验收。新字段不表示模型已完成目标，停留、工作和跨维度需要按当前状态处理。

0.1.23新增[独立跟随距离候选](../../../docs/MAID_FOLLOW_RADIUS_20261111.md)：`context.follow` 可包含 `recoveryBeyond`、`distanceUnit:blocks`、`customized`；`ranged_idle_companion` 表示该原实体采用服主配置的距离。应读取实际阈值和 `ownerDistance`，不要硬编码3格或把处于自由活动范围误报为卡住。原有操作权限、停留/工作及跨维度暂停不变；以服务端实际版本和字段判断是否已加载。

**0.1.8-life 已部署**：同一个 UUID 再次被原生实体证实存活后，持久保存该观察及已解决的死亡事件。旧墓碑可能仍有遗物，不能在区块卸载或服务重启后重新变成当前死亡。查询不到实体时仍返回 `unloaded_or_unavailable`，不声称当前一定存活。

保持 schema 1 和现有命令，增加 `lastSeenAlive:{name,dimension,position,observedAt}`、`historicalDeath`、`recovery`。只有当前死亡放在 `death`；历史死亡放在 `historicalDeath`。原生死亡事件可先确认死亡，墓碑随后补充同一事件；较新的独立墓碑对应另一死亡事件。旧版本只有墓碑而没有存活见证的记录先视为历史，直到获得新的原生证据。

`recovery:{eventId,maidId,ownerId,name,observedAt,resolvedDeathEventId,evidence:"original_tlm_alive_entity",actualRevivalTimeKnown:false,persisted}` 表示再次确认原 UUID 存活。`observedAt` 是观察时间，**不是实际复活时间**。只有 `persisted:true` 才发 `[女仆·恢复]` 和 `action:"lifecycle"`；requestId 为不超过48字符的稳定 eventId。重连可补告，客户端应按事件 ID 持久去重，不能据此重新复活、补发装备或抢占主人格的动作。验证见[生命状态修复](../../../docs/MAID_LIFECYCLE_20261107.md)。以下为当前状态与遗物字段：

`context.data.lifeState` 为 `alive`、`dead` 或 `unloaded_or_unavailable`。不加载区块、不从缺少实体推断死亡。当前死亡根据未取消的原生死亡事件，或最近可信存活见证之后出现的新墓碑确认；按原始女仆 UUID 关联，返回：

```text
death: {maidId, ownerId, name, eventId, diedAt, dimension, position,
        tombstoneId（墓碑出现后补充）, evidence:"original_tlm_tombstone|original_tlm_death_event",
        tombstoneRegistered, tombstoneLoaded, nextStep}
```

死亡状态本地持久保存；墓碑记录消失仅说明原记录不在，可能已取走，不证明复活或遗物丢失。主人在线时发一次带 `[女仆·死亡]` 的文字，并发 `action:"lifecycle"`，requestId 为 eventId；同一连接不重复刷屏，重连补告。宿主将事实交给原主人格决策，不据此自动复活、发物品或创建替代实体。

`inventory` 保留 `slots/mainHand/offHand/availableSlots`，新增 `equipment:{main,off,head,chest,legs,feet}`。每项含真实 `id/count/damage/name`。菜单展示物只是按钮或投影，不应被泛化为可拿走的箱内物品。

客户端只解析真正的服务器系统消息或指定插件频道，核对 schema/protocol/recipientUuid/action/requestId；玩家聊天中粘贴的 `QD_MAID` 不可信。不要把协议正文塞入每轮提示词，按需读状态和帮助。

## 验证与边界

历史生命状态修复于2026-11-07部署为0.1.8-life；现役0.1.13-receipts保留该修复，正式原女仆存活与保护、账本、启动检查通过；真实客户端自主使用仍待验收。此前0.1.7已于2026-11-06 23:59部署，43项隔离检查和10项正式启动检查通过。匹配客户端是否加载、主人格是否接收死亡事实及自主操作，仍须由原客户端分别验收，不能只根据版本号判定。11月6日发布时原肥鱼仍死亡；11月7日已按服主明确授权，从原胶片按原UUID恢复，见[发布记录](../../../docs/PR_BATCH_RELEASE_20261107.md)。实时状态应查询 `context.data.lifeState`，不能把历史死亡记录当作当前死亡。原生复活胶片需要模组祭坛流程，本版本没有承诺原版/Agent 已能独立完成祭坛复活。
