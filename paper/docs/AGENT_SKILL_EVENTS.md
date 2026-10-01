# 技能生效事件：`mcagent:event`

AgentFriend 0.3.57 在技能实际生效后，以 clientbound plugin message **只向施法者的连接**发送事件。消息是原始 UTF-8 JSON 字节，没有 `writeUTF` 长度前缀；单包不超过 16 KiB。不会广播，也不会把 JSON 写入聊天、动作栏或标题。Java 和 Mineflayer 客户端可订阅 `custom_payload` 的 `mcagent:event`；未发送 `minecraft:register` 的 Mineflayer 连接同样能收到。基岩客户端仍通过原版标题、音效和粒子获得施法提示，不能假定 Geyser 会将 Java 自定义频道传给基岩设备。

```json
{"schemaVersion":1,"kind":"skill","id":"starbolt","title":"星芒箭","body":"命中 僵尸","tone":"arcane","position":{"x":-589.5,"y":92.62,"z":-326.15}}
```

`position` 是当前世界的绝对坐标，使用数值而非“前方几格”：单体命中用命中点，霜环、焰浪用范围中心，探矿用矿石方块中心，归乡用实际落点，其他技能用效果发生位置。协议没有维度字段；接收端应结合施法者当前维度解释坐标，不要把另一个维度的同名坐标画进当前画面。`tone` 取 `arcane`、`healing`、`frost`、`fire`、`movement`，未知值可按 `arcane` 显示。`id` 保留技能内部稳定 ID，包括 `conjure_bread` 等具体造物项。

自定义战斗、探矿、移动、召唤、探敌和女神技艺在成功效果执行后发送；MagicSpells 的治疗、饱食、闪现和造物只在 `NORMAL` 且 `HANDLE_NORMALLY` 的成功回调后发送。无目标、未学会、魔力不足和冷却中的尝试不产生成功事件。事件是视觉/提示信号；Agent 的战斗决策仍应以实体生命、位置、魔力和 `/mycli` 私有回执为准。

隔离服真实协议验收脚本为 [`../probe/skill-event-stage.mjs`](../probe/skill-event-stage.mjs)：两个不同账号分别测试注册/未注册频道、只发本人、冷却和无目标不发、星芒箭命中点、霜环中心、归乡落点、MagicSpells 治疗生效以及聊天里无 JSON 副本。
