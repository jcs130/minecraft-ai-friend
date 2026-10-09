# 自然建筑保护与原生通行实练

功能始于0.4.6候选，现已随AgentFriend 0.4.7正常备份重启上线；结构目录启用、缓存无解析错误、原生实练查询已正式核验。发布时间和验收见 [维护记录](OPERATIONS.md)。

## 建筑是什么

当前 Better Villages、Dungeons and Taverns、Explorify、Ships、Structory、Structory Towers、StructurePack 和 Terralith 使用原版方块、结构模板与数据包。Java、Geyser 基岩和 Mineflayer 能看到实际方块，无须安装建筑客户端模组。

这些包包含房屋、船、塔、地牢，也包含故意破损的遗迹。不能保证每座都有从地表直通内部的入口：例如现有亡灵墓穴使用经过勘察的付费地下城入口。保护功能不会替建筑补路、自动开门、传送或替 Agent 操作。

## 保护范围

服务端读取已加载区块中的自然生成结构引用与原始结构片段，包含边界两端。既有建筑与以后新生成的建筑使用同一规则，不靠肉眼材质猜测建筑，也不定时扫描全世界。

默认保护六个包命名空间：`nova_structures`、`explorify`、`ships`、`structory`、`structory_towers`、`mjstructure`。另列五种原版村庄、哨塔、古城、两种海底废墟，以及当前 Terralith 的房屋、法师塔、地下建筑等实际结构 ID；Terralith 的碎石、尖峰等地形特征不在默认目录。

| 操作 | 规则 |
| --- | --- |
| 挖墙、拆门、拆梯子、拆箱体、在片段内垫块或改地形 | 拒绝；普通玩家和游戏内 OP 都没有拆建绕过 |
| 原生开关木门、活板门、按钮、拉杆，走楼梯和爬梯 | 正常交互；仍遵守原有领地和 WorldGuard 权限 |
| 容器取放 | 继续按原归属规则；公会门内私产仍归萌萌，门口公共箱可用 |
| 农作物收割和补种 | 默认保留；不能拆耕地、地基或用整块南瓜等充当施工例外 |
| 爆炸、火烧、末影人搬块、僵尸破门 | 阻止对受保护建筑的方块破坏；不取消正常战斗伤害 |
| 活塞与水流 | 同一建筑内部的机关可运行；阻止外部推块、灌水和流体冲毁门梯等设施 |
| 树木、苔藓等扩散改造与展示物破坏 | 阻止其覆盖或破坏建筑；原有作物生长保留 |

实际禁区是结构片段的并集。`areas[]` 显示结构的外包范围，标记 `shape=structure_piece_envelope`、`envelopeOnly=true`；不能把外包范围内的所有村庄空地当成禁区。保护只检查服务器已知的自然结构元数据；手工粘贴的 schematic、普通玩家建筑、缺失结构元数据的旧建筑应继续使用 [领地](LANDS.md) 或 WorldGuard 区域。

`generated_structure` 拒绝会同时返回中文和本人 `MC_PROTECTION` / `mcagent:protection`，提示目标、世界、边界和正确走法。其他规则优先命中时保留原原因码。不能根据一次允许永久缓存权限。

结构起点还未加载或解析失败时，`unknown_generated_structure_bounds` 会暂缓相关区块拆建；门和梯子仍可使用。先沿原通路靠近、稍后重查；持续异常联系服主。不会为查边界强行加载或生成远处区块。缓存最多 256 个区块、128 个结构起点，未知记录最早一秒后重查，没有新增巡检计时器。

## 让 Agent 实际练习

入口为 `/mycli world practice start`，或技能罗盘 → 旅途指南 → 村庄新生活 → 开门与爬梯实练。`/mycli explain world.practice` 可发现用法；`status` 查本人进度，`stop` 暂停。原来的三项新手实习及进度不变。

1. 走到合法木门前，使用原有方块交互打开一扇关闭的门，再从门洞实际走到另一侧。铁门需使用原有按钮或拉杆；本练习的开门证明选择木门。
2. 在现有梯井贴住梯面向前移动，必要时按跳跃，沿同一梯井连续爬升至少三格。

练习只允许生存/冒险模式，排除观战、创造飞行、滑翔、载具、漂浮和传送；还检查实际门洞穿越、爬梯状态、连续高度、移动样本和时间。不会授予技能、发奖、替玩家开门或移动。暂停/退出后已获得的证明保留在本人玩家数据，重启后仍可查询。

`MC_WORLD type=practice` 返回本人 `steps[]/verifiedSteps/completed/active`；成功动作发 `type=practice_progress`，附实际世界、坐标、时间和 `source=server_observed_native_action`。这是一次实际操作证明，不表示模型长期掌握；以后卡住仍应观察并调整原有操作。

Mineflayer 的原有 `activateBlock`、移动控制和 pathfinder 已支持木门与梯子。导航保护建筑时应禁止挖掘和垫块，例如 `canDig=false`、`allow1by1towers=false`、`scafoldingBlocks=[]`；这是客户端已有能力的使用建议，本次不改远端 Agent 客户端。

## 运营与回退

配置位于 `plugins/AgentFriend/structure-protection.yml`。添加建筑包时把真实结构命名空间或 ID 加入目录；不要把结构标签 ID 当作结构 ID。

```text
mycli admin structures audit
mycli admin structures reload
```

仅控制台/RCON 可修改规则。合法配置热加载并清空缓存；非法配置保留上次有效规则。初次启动配置无效会阻止本插件启用，不能在保护失效时继续宣称已保护。

停用此功能可把 `enabled` 设为 `false` 后热加载；这不移除原有领地、村屋和副本保护。换回旧 JAR 会失去此新增保护与练习入口，但本功能不改结构存档，已获得的练习 PDC 可保留。发布仍需完整 E/F 快照与正常停启。

## 验证边界

专项脚本 `plugins/AgentFriend/structure-practice-stage.mjs` 只连接固定隔离端口，实际 Mineflayer 登录、挖掘、放置、原生交互与移动；控制台定位、物资和机关夹具仅用于隔离测试，不作为练习证明。真实手机/Xbox 的按键与文字排版需设备验收；Java 原版协议通过不等同基岩真机验收。

最终同一候选 JAR 的隔离操作 38 项、正常重启 8 项通过；包括真实门洞穿越、连续原生爬梯、传送不计证明、拆建取消与物品回滚、农作物收割补种、内部活塞伸缩、外部推块阻止、爆炸保护、公共/私有箱边界，以及真实附身的受控 Java Eye 收到本人练习提示。热缓存 5,000 次查询约 4.1 毫秒，查询前后已加载区块数均为 491，原生结构引用集合保持；这不是冷探索或 16 个 LLM 长期游玩的容量承诺。候选摘要见 [版本清单](../manifests/structure-practice-0.4.6.json)。

0.4.6候选时期另有正式服0.4.5的只读核查，历史证据保留：CortiLan 的观景塔领地内访客不能拆建，塔外与村庄空地允许；没有全服禁建。该领地规则早于本候选功能；若要共同改塔，应给协作者单独授权这块领地。

来源：[Paper 区块结构 API](https://javadocs.papermc.io/paper/1.20.6/org/bukkit/Chunk.html)、[Dungeons and Taverns](https://modrinth.com/datapack/dungeons-and-taverns)、[Mineflayer pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)。
