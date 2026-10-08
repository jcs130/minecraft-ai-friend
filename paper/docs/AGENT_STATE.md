# Agent 魔力与技能冷却状态频道

0.3.96 增加可选 `trialRescue`，schemaVersion 仍为 1。字段为 `downed/radius/seconds/instruction/downedTeammates[]`，后者含 UUID、姓名、世界、x/y/z、按秒更新的 `progressMs`。系统提示明确：同队存活队员在倒地者 4 格内连续停留 10 秒自动救起，清完当前层/室也会自动复活，全队倒下才失败撤离。倒地者停止移动、攻击和施法，等待恢复回执。规则见[组队救援](TRIAL_RESCUE.md)。

0.3.85 起，`abilities[]` 增加 `mycli:support`「支援传送术」，`cooldownMs=20000`，成功施放后立即更新本人实时冷却。是否有可支援敌人另看 `mcagent:village.supportAvailable/supportCommand`，不能仅凭冷却为 0 判断可传送；8 魔力、事件新鲜度及落点仍由服务端施法时验证。状态 schemaVersion 继续为 1。玩法与拒绝回执见 [村庄守望](VILLAGE_SUPPORT.md)。

AgentFriend 0.3.64 的出站频道 `mcagent:state` 向每位在线玩家自己的连接发送本人的 AuraSkills 魔力、可施放技能冷却和当前穿戴装备的被动效果。频道与登录名无关，也不会把一个玩家的数据发给其他连接。负载为无长度前缀的 UTF-8 JSON：

```json
{"schemaVersion":1,"mana":{"current":23.0,"max":32.0},"abilities":[{"id":"mycli:heal","name":"范围治疗","level":1,"cooldownMs":12000,"cooldownRemainingMs":0,"icon":"minecraft:glistering_melon_slice"}],"equipmentEffects":[{"id":"gear:renewal","name":"春灯治愈","radius":5.0,"periodMs":4000,"requiresOutOfCombatMs":8000,"passive":true}]}
```

AuraSkills 资料尚未加载时 `mana` 为 `null`，加载后发送数值。`abilities[]` 是本人已可用的 `/mycli` 与 MagicSpells 技能；`cooldownMs` 是总冷却，`cooldownRemainingMs` 是发送瞬间的剩余冷却，归零可用，`icon` 是可选的 1.20.6 原版物品 ID。读取不到的冷却填 `null`，客户端不可据此断言可施放；魔力不足、缺少目标等仍可能阻止施法。登录和重生会发初始快照；成功施法后的下一游戏刻发送；魔力恢复和冷却变化每秒检查一次，冷却归零也发一包，内容不变不重发。轮询距离上一包不足一秒时会延后到下一轮。整包最多 16 KiB。数据只走客户端自定义负载，不产生聊天、动作栏或全服公告。

`equipmentEffects[]` 只列出该玩家**胸甲槽已生效**的被动，未穿戴时为空数组。当前可为 `gear:ember`（4.5 格火焰光环，每 2000 ms）、`gear:renewal`（5 格治愈光环，每 4000 ms，双方须脱战 8000 ms）或 `gear:leech`（15% 实际伤害吸血，每击最多 2 HP）。这是被动说明，不应作为可点击施法的 `abilities[]`。它也加入 `mcviewer:state`，客户端可选择展示；旧客户端忽略新增字段即可。主动群疗的 ID 是 `mycli:heal`，旧 `/cast heal` 也会转入这个效果，不再把 `magicspells:heal` 作为可用技能列出。

支持已注册频道的客户端，也向未注册频道的 Mineflayer 连接单播原版 custom payload。客户端按 `mcagent:state` 过滤并解析 JSON；`mana:null` 表示等待数据，不能当成 0 魔力。登录、死亡重生后应以最新快照替换旧值；断线重连时清除本地缓存。`mcviewer:state` 仍单独提供 AuraSkills 等级和经验；其旧字段 `abilities[].cooldownMs` 表示剩余冷却，不能与本频道的新字段混用。

`/mycli` 的 `MC_CLI_*`、`MC_DUNGEON`、`MC_ARENA_ECONOMY` 等命令回执仍是执行者本人的系统聊天。`mcagent:protection` 已是私有插件消息。试炼层公告只投递给该层玩家，试炼结束通知发给本次参赛者；原版玩家加入、退出和玩家正常聊天另按服务器现有规则显示。直播镜头 CortiEye 目前会镜像 CortiLan 收到的系统聊天，所以其个人回执会在这条观战连接中出现；这不是向全服广播。

隔离验证：`node paper/probe/agent-state-stage.mjs`，在 Paper 1.20.6 的 25566 隔离服上以两个独立 Mineflayer 玩家覆盖注册/未注册频道、初始状态、施法、自然恢复、冷却开始与归零、重生、跨账号隔离、无状态聊天副本和数值未变不重发。`node paper/probe/skill-event-stage.mjs` 另覆盖星芒箭及 MagicSpells 圣愈术的实际冷却。
