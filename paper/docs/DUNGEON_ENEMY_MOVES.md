# 墓穴首领与试炼塔精英招式

| 敌人 | 预警 | 命中 | 应对 |
| --- | --- | --- | --- |
| 墓穴终室的亡骸守墓者 | 橙色扇形，读条 1.7 秒 | 4.5 格内的 110° 扇形，基础伤害 6 点 | 绕到侧面或背后，或退出扇形 |
| 试炼塔三层的霜墓执斧者 | 青色直线，读条 1.4 秒 | 5.5 格长、1.6 格宽，基础伤害 4 点；实际受伤时附带 2.5 秒缓慢 I | 横移出霜线 |

招式开始时锁定朝向。地面粒子、音效和屏幕副标题先提示，挥斧才结算伤害。判定以出招时的范围和命中时的站位为准，检查遮挡，并沿用场次伤害、护甲与倒地规则。目标移动出范围后可避开。同一怪物的普通近战在读条和收招期间暂停。阵亡、房间失效或场次暂停都会清除读条。

招式通过原版协议发送字幕、粒子和动画。Agent 可以从私有 `mcagent:state` 读取 `enemyMoves`，其中包含原怪物 UUID、阶段、剩余刻数、朝向、范围和应对说明。现有副本状态和试炼塔状态的 JSON 也带相同字段，前提是本人参战且能看见怪物。肥鱼或其他身体是否能根据这些字段自行走位，应靠实战验收确认。

`plugins/AgentFriend/config.yml` 的 `dungeon-enemy-moves.enabled` 默认关闭。启用后只影响新开的墓穴场次与冒险、末日难度试炼塔。旧存档继续按开场时规则恢复。关闭配置并正常启服可停止招式，保留世界、场次进度、奖励和玩家资料。

## 扩展选择

现役 MythicMobs 可继续编排更多精英招式。当前样板使用游戏本身的挥手、粒子和伤害路径。ModelEngine 4 可为需要专属骨骼动作的首领制作模型。Java 和基岩资源分别配置，Geyser 的基岩资源包和实体映射需另外验收。 [MythicMobs](https://wiki.mythiccraft.io/mythicmobs) · [ModelEngine](https://wiki.mythiccraft.io/modelengine) · [Geyser 资源包](https://geysermc.org/wiki/geyser/packs/)

Better Mob Combat Neo 1.3.4 是 NeoForge 1.21.1 的动作候选，发布者标注客户端和服务器都需要安装。适合在独立整合包确认依赖、攻击时机和普通客户端进服后再决定是否采用。 [版本说明](https://modrinth.com/mod/better-mob-combat-neo/version/Ogitv6bW)

## 隔离复验

`paper/probe/encounter-arcane/stage.mjs` 的 `weapon`、`crypt` 和 `tower` 分别使用合成角色，通过 Java 1.21.1 协议验证刻印、墓穴和试炼塔。两项战斗探针默认测命中，带 `--dodge` 时测躲开预警后的结果。探针要求环回隔离服、固定测试端口和显式测试标记。墓穴使用正式地形的只读副本，试炼塔使用隔离服生成的塔。正式服和基岩设备另验。
