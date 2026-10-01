# 试炼塔商人：入口与第七层的装备回收、余额补给

0.3.48 起，试炼场地面入口也有「武备补给商」和「装备回收商」，第七层驿站保留并补齐这两名商人。手柄玩家右键对应村民，使用原版 27 格购买或 54 格回收菜单；`/mycli arena shop` 菜单在入口和驿站均可开。原有按 UUID 的 `list/quote/sell/buy/wallet` 远程命令和防错卖、待领取队列保持。余额商店新增铁斧及钻石剑、头盔、胸甲、护腿、靴子，价格高于回收价；重复掉落的「潮汐探路冠」「回廊踏影靴」可按原报价机制回收，首通「星灯誓约」不可卖。

AgentFriend 0.3.44 的第七层「灯火驿站」商人右键打开原版 27 格余额商店。Java 和 Geyser 基岩玩家可点击护甲、武器与补给购买，点击漏斗查看本人个人箱和背包里的可回收装备，再点一次绿色确认。原实体绿宝石交易保留在菜单的绿宝石方块图标以及 `/mycli arena shop merchant`。第七层商店需要本人正在该层挑战；命令式 `list`、`quote`、`sell`、`buy`、`wallet` 可远程使用，方便 Agent 在个人箱被奖励塞满时自救。

Agent 命令：

```text
/mycli arena recycle list [页码]
/mycli arena recycle quote chest <1–54> [数量]
/mycli arena recycle quote bag <0–35> [数量]
/mycli arena recycle sell <quoteId>
/mycli arena shop list
/mycli arena shop buy <商品ID> [1–16]
/mycli arena wallet
```

`list` 每页最多 12 件，返回来源、槽位、当前单价和物品组件信息。`quote` 只保留本人最新一张 30 秒报价，绑定 UUID、槽位、数量及完整 `ItemStack.serializeAsBytes()` 的 SHA-256；`sell` 在主线程消耗报价并再次比较原始序列化字节的哈希、数量和可回收资格，失败不扣物也不加余额，重复调用只返回 `quote_unknown_or_consumed`。背包只扫描 0–35 槽，身穿护甲、盾牌副手及当前手持热键栏装备均不出售。带未知自定义名、非试炼战利品 lore、任何插件 PDC 或不可破坏标志的装备不开放回收；「深渊裁决」等唯一专属物品不在白名单。允许未装备的普通装备和已知试炼随机附魔装备。

回收基础价格按材质计算，附魔等级最多加 8，破损会降低基础价，单件上限 32。商店价格高于同级回收价。商品包括铁甲四件、铁剑、弓、弩、盾牌、箭、熟牛肉和金苹果。余额按玩家离线 UUID 存在 `plugins/AgentFriend/config.yml` 的 `dungeon-emerald-wallet`；不把实体绿宝石塞回背包。购买成功把完整商品先写入 `dungeon-bonus-items` 待领取队列并扣余额，同次保存；下一次开个人箱时会尽量移入 54 格双箱，箱满则继续排队。待领取队列达到 128 项时拒绝购买且不扣余额。余额和个人箱随整服 E/F 快照备份，不可单独用旧配置覆盖。

所有命令只对发起玩家 `Player.sendMessage`，格式为 `MC_ARENA_ECONOMY ` 后接一行 JSON，不广播。回执固定含 `schemaVersion`、`requestId`、`action`、`success`、`reason`、`item`、`quantity`、`balance`、`pending`；报价另含 `quoteId`、`source`、`slot`、`price`、`expiresAt`。物品信息含英文 ID、显示名、附魔数组、损耗/最大/剩余耐久、数量、`componentHash` 和可逆的 `serializedItemBase64`。客户端需要先按 `action` 分类，不要把长 Base64 展示给玩家。`requestId` 是服务端给每条回执生成的关联 ID；成交幂等键是 `quoteId`。

控制台 `/mycli admin dungeonaudit` 在每层刷怪后给出 `MC_DUNGEON_MOB`：怪物类型、主手、AI、目标与最近一次受伤来源。骷髅/流浪者持弓，掠夺者持弩，卫道士持铁斧；蜘蛛、女巫、烈焰人等保持空手和正常 AI。试炼怪物只能锁定在场参赛玩家；同场怪物的近战与投射物友伤会取消，女巫飞溅药水对同场怪物的作用强度设为零。逐层验收数据保存在隔离服 `arena-mob-audit-20261001.json`。

0.3.53 起僵尸、尸壳、溺尸也持有近战武器，复杂掩体后完全静止的怪物有受限的可达点恢复；入口可选三档试炼难度，怪物强度和稀有掉落随档位提升。数值、每日领奖限制、手柄及 Agent 入口见 [试炼难度](ARENA_DIFFICULTY.md)。为处理重复装备，控制台 `mycli admin prunetrial <在线玩家>` 先只读预览，再在完整备份后用 `apply` 回收个人箱中与背包或箱内保留件完全相同的试炼装备，所得进入余额。0.3.54 增加 `prunetrialbag`：只回收背包 9–35 格的完全相同试炼装备，快捷栏、装备栏和副手保留。

隔离服测试：`arena-economy-stage.mjs` 测双玩家 UUID 隔离、报价、跨号拒绝、重复拒绝、余额购买与私有回执；`arena-economy-restart-stage.mjs` 测重启后余额和购买物入箱；`arena-gui-stage.mjs` 以 Mineflayer 打开第七层商店和回收菜单且无协议解析错误；`arena-mobs-stage.mjs` 实走十层、逐层记录共 51 只怪物的类型、主手、AI、目标和受伤来源；`arena-friendly-fire-stage.mjs` 以试炼怪物为攻击源分别测试近战和箭矢伤害被取消，并用普通伤害作阳性对照。真实基岩手柄菜单观感以及自然飞行箭矢、女巫药水的长期战斗观测仍需后续实战复核。
