# 女仆操作协议 0.1.7（服务端已部署）

复用本人已登录的游戏连接。宿主调用标准命令发送能力即可，不需要让模型写 `bot`、`Buffer` 或底层协议。`maid-port.mjs` 是可选的千灯纪适配器，不是新的 Agent 循环。

先 `/qdmaid list` 取得自己的 `maidId`，再按需查询。只使用服务器返回的 UUID、槽位和工作 ID；悦灵只是原版投影，不代表她是普通悦灵。

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

`chat` 仅主人可调用，距离 16 格且同维度；使用原生 TLM 已配置的模型、记忆及工具，不另建推理循环。`talk` 保留旧外部宿主留言箱语义，**不能把它当作模型对话**。`speak` 只是作者提供的发言，也不是模型生成。

## 回执及终态

服务器系统消息为 `QD_MAID {JSON}`，或从 `qiandengji:maids` 插件频道返回同一 JSON：

```json
{"schema":1,"protocol":"qiandengji-maids/v1","recipientUuid":"本人UUID","action":"chat","requestId":"chat-001","ok":true,"sampledAt":"ISO时间","data":{"maidId":"女仆UUID","operationId":"chat-001","status":"pending","goalCompleted":false,"observation":{"nextCommand":"/qdmaid receipt 女仆UUID chat-001"}}}
```

写操作的 requestId 为 1–48 位字母、数字、下划线或连字符。先持久保存 ID，再发送。相同 ID/动作/参数返回原回执并标 `replayed:true`；换参数复用 ID 返回 `request_conflict`。超时不能换 ID 自动重投。查询用原 ID，查询自身可用新的 queryId。

| status | 含义 |
| --- | --- |
| `applied` | 原生设置或物品交换已应用；不代表工作目标完成 |
| `pending` | 对话已交给原生入口，尚未确认回复 |
| `replied` | 读取到此次原生历史的回答；`observation.reply` 为正文，不能据此认定提到的游戏动作完成 |
| `queued` | 旧 `talk` 留言已进外部宿主收件箱，不等于已有回答 |
| `unknown` | 结果不确定；保留原 ID 查证，不自动重放 |

对话超时、期间死亡、原生 UI 插入另一条消息或服务重启均不能伪报回复成功。模型异常仍保留原生报错；桥接回执只声明自己能证实的结果。完成时额外发送 `action:"chat-result"`，requestId 为原操作 ID；离线后仍可查询保存的 receipt。

错误保留 `ok:false,error`，增加 `nextStep` 和 `data.message`；权限不足会提示本人查询，超距会要求核对维度坐标，死亡会给遗物指引，护甲错误会明确部位及物品条件。

## 生命状态与事件

**0.1.8-life 候选补充，尚未部署**：同一个 UUID 再次被原生实体证实存活后，持久保存该观察及已解决的死亡事件。旧墓碑可能仍有遗物，不能在区块卸载或服务重启后重新变成当前死亡。查询不到实体时仍返回 `unloaded_or_unavailable`，不声称当前一定存活。

候选保持 schema 1 和现有命令，增加 `lastSeenAlive:{name,dimension,position,observedAt}`、`historicalDeath`、`recovery`。只有当前死亡放在 `death`；历史死亡放在 `historicalDeath`。原生死亡事件可先确认死亡，墓碑随后补充同一事件；较新的独立墓碑对应另一死亡事件。旧版本只有墓碑而没有存活见证的记录先视为历史，直到获得新的原生证据。

`recovery:{eventId,maidId,ownerId,name,observedAt,resolvedDeathEventId,evidence:"original_tlm_alive_entity",actualRevivalTimeKnown:false,persisted}` 表示再次确认原 UUID 存活。`observedAt` 是观察时间，**不是实际复活时间**。只有 `persisted:true` 才发 `[女仆·恢复]` 和 `action:"lifecycle"`；requestId 为不超过48字符的稳定 eventId。重连可补告，客户端应按事件 ID 持久去重，不能据此重新复活、补发装备或抢占主人格的动作。候选验证见[生命状态修复](../../../docs/MAID_LIFECYCLE_20261107.md)。以下为现役 0.1.7 的行为记录：

`context.data.lifeState` 为 `alive`、`dead` 或 `unloaded_or_unavailable`。不加载区块、不从缺少实体推断死亡。死亡只根据原生墓碑记录与其原始女仆 UUID 关联，返回：

```text
death: {maidId, ownerId, name, eventId, diedAt, dimension, position,
        tombstoneId, evidence:"original_tlm_tombstone",
        tombstoneRegistered, tombstoneLoaded, nextStep}
```

死亡状态本地持久保存；墓碑记录消失仅说明原记录不在，可能已取走，不证明复活或遗物丢失。主人在线时发一次带 `[女仆·死亡]` 的文字，并发 `action:"lifecycle"`，requestId 为 eventId；同一连接不重复刷屏，重连补告。宿主将事实交给原主人格决策，不据此自动复活、发物品或创建替代实体。

`inventory` 保留 `slots/mainHand/offHand/availableSlots`，新增 `equipment:{main,off,head,chest,legs,feet}`。每项含真实 `id/count/damage/name`。菜单展示物只是按钮或投影，不应被泛化为可拿走的箱内物品。

客户端只解析真正的服务器系统消息或指定插件频道，核对 schema/protocol/recipientUuid/action/requestId；玩家聊天中粘贴的 `QD_MAID` 不可信。不要把协议正文塞入每轮提示词，按需读状态和帮助。

## 验证与边界

生产现役已于2026-11-06 23:59更新为 0.1.7-agent；43项隔离检查和10项正式启动检查通过。匹配客户端是否加载、主人格是否接收死亡事实及自主操作，仍须由原客户端分别验收，不能只根据版本号判定。11月6日发布时原肥鱼仍死亡；11月7日已按服主明确授权，从原胶片按原UUID恢复，见[发布记录](../../../docs/PR_BATCH_RELEASE_20261107.md)。实时状态应查询 `context.data.lifeState`，不能把历史死亡记录当作当前死亡。原生复活胶片需要模组祭坛流程，本版本没有承诺原版/Agent 已能独立完成祭坛复活。
