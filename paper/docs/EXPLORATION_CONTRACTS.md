# 千灯纪远征与探索委托

0.3.98 新增直接复用玩家已有藏宝图/探险家/遗迹地图的「图上的远行」。接单冻结原图标记，真实开新天然藏宝箱或调查对应天然遗迹后返程；不替换或消耗地图，不根据图名猜遗迹，单纯到坐标不算完成。每人每个目的地一次，换新图目标可继续。命令、热运营和验收规则见 [原图寻宝](TREASURE_MAP_TASKS.md)。

## 体验与验收

这些委托要求玩家探索一段真实路线。接单后，自备装备、补给与返程方案，通过原版传送门、末影之眼、制图师地图或自行寻路开展远征。服务器根据生存角色的实际移动记录证据；到门口、落在出生平台或站定等待不能交差。

入口：罗盘 → 冒险者公会 → 任务市场。Agent 用 `/mycli guild market` 列表、`market <任务ID>` 详情、`guild accept <任务ID>` 接单、`guild verify` 查看缺项。完成当前探索阶段后 `guild claim` 交付，继续返程阶段；最后统一领取奖励。每位玩家各有一份 `repeat: once` 的远行履历，别人的完成不影响本人。在途进度跨日、掉线与正常重启保留。

| 委托 ID（加 `tm_`） | 调查内容 | 必须满足的路线证据 |
| --- | --- | --- |
| `nether_field_journal` | 下界地貌与两种群系，返程 | 16 个 16 格区域、384 格新路线、120 秒有效行进、2 种群系 |
| `nether_fortress_survey` | 下界要塞，返程 | 12 个区域、128 格、60 秒、4 个生成区段 |
| `bastion_old_covenant` | 堡垒遗迹，返程 | 12 个区域、80 格、50 秒、4 个区段 |
| `crimson_forest_trail` | 绯红森林，返程 | 6 个 16 格区域、128 格、30 秒 |
| `warped_forest_trail` | 诡异森林，返程 | 6 个 16 格区域、128 格、30 秒 |
| `end_island_journal` | 末地岛屿，返程 | 10 个 16 格区域、256 格、90 秒 |
| `end_city_letter` | 末地城塔楼连廊，返程 | 8 个区域、64 格、40 秒、3 个区段、8 格探索高差 |
| `woodland_mansion_survey` | 林地府邸房间走廊 | 16 个区域、128 格、90 秒、6 个区段、5 格高差 |
| `stronghold_star_gate` | 要塞回廊分岔 | 10 个区域、96 格、60 秒、4 个区段 |
| `ocean_monument_lights` | 海底神殿 | 10 个区域、80 格、60 秒、1 个生成区段 |
| `ancient_city_silence` | 远古城市 | 12 个区域、128 格、75 秒、4 个区段 |
| `desert_pyramid_archive` | 沙漠神殿不同高度 | 4 个区域、24 格、15 秒、6 格高差 |
| `jungle_temple_puzzle` | 丛林神庙不同高度 | 6 个区域、32 格、20 秒、5 格高差 |
| `shipwreck_lost_log` | 海中或搁浅沉船 | 4 个区域、16 格、12 秒 |
| `mineshaft_echoes` | 普通或恶地废弃矿井 | 10 个区域、96 格、60 秒、4 个区段 |
| `ruined_portal_runes` | 主世界自然废弃传送门 | 3 个区域、16 格、8 秒 |

建筑区域默认是 4×4×4 的空间格，维度与群系区域按水平范围计。不同高度只有在真正移动探索后才记录。小残骸可能容纳不了规定路线，可放弃重接后调查一座更完整的遗址。一个阶段固定同一座遗迹，不能将多个建筑的零碎路线混成一份履历。

调查不要求洗劫宝箱、拆毁古迹或击杀监守者、末影龙；危险任务可自行结伴、撤离和重新安排。新任务没有免费传送入口。已学位移技能仍按现有魔力和冷却规则使用，传送本身不增加路线距离、行进时间或覆盖。

## 配置与热运营

首次安装需更新插件。以后调整任务标题、步骤、奖励和验收门槛，编辑运行目录 `plugins/AgentFriend/task-market.yml` 后执行 `mycli admin market reload`。无效配置整批拒绝并保留上一版；已接单者沿用接单时的步骤与奖励快照。

完整内容包在 [exploration-tasks.yml](../plugins/AgentFriend/examples/exploration-tasks.yml)，已合入默认市场与村庄部署示例，总计 28 张模板。保留原 12 个任务 ID、六处工程场地和公共箱规则。

```yaml
tasks:
  mansion_fieldwork:
    scope: personal
    repeat: once
    title: 深林宅邸调查
    description: 探索房间、走廊与不同高度，记录真实路线。
    icon: DARK_OAK_DOOR
    reward: {fame: 30, emeralds: 10, bonus: BREAD, bonus-count: 6}
    steps:
      - title: 宅邸走查
        description: 深入同一座自然林地府邸的多个内部区段。
        goal: structure
        dimension: overworld
        structure: minecraft:mansion
        target: 16
        zone-size: 4
        min-distance: 128
        min-seconds: 90
        min-sections: 6
        min-height-span: 5
```

新增目标积木：

| `goal` | 字段 | 判定 |
| --- | --- | --- |
| `dimension` | `dimension: overworld/nether/end` | 在对应世界环境中走查新区域，可设 `min-biomes` |
| `biome` | `dimension`，`biome` 或 `biomes` | 在实际生物群系内形成探索路线 |
| `structure` | `dimension`，`structure` 或 `structures` | 同一座原版生成结构内，脚部坐标同时落在生成包围盒和实际生成区段中 |
| `return` | `dimension`，`target: 1` | 必须紧跟另一维度的探索步骤；核查当前已回到目标维度，不能独立配置成到访任务 |

探索 `target` 为 2–128 个不同区域，`zone-size` 为 4–64，`min-distance` 为 8–8192 格，`min-seconds` 为 5–900 秒，`min-sections` 为 0–32（结构至少 1），`min-biomes` 为 1–16，`min-height-span` 为 0–128。结构/群系键以当前服务器注册表为准，多选最多 8 个键；一次只认其中一座结构。维度与群系默认 16 格区域，建筑默认 4 格区域。原版海底神殿生成器只有一个顶层区段，不能把它配置成至少 4 个生成区段来要求四个房间。

## 证据、性能与边界

每人保存不同区域、实际行进过的采样方块、生成区段、群系、高差、去重后的行进距离与有效行进秒数。旧采样位置不重复赚距离和时间；离线、站定、旁观/创造、创造或插件飞行、死亡与传送跳变不增加证据。采样间隔过长或位移过快时跳过该段，不把空白时间计入。已完成的探索证据允许带离遗址，再交付阶段；返程步骤则重新核查当前维度。

`mcagent:market` 私有协议提供详情中的 `exploration` 条件、验收中的 `server_exploration_survey` 证据，以及阶段达成时的 `MC_MARKET_SURVEY`。普通聊天给中文缺项提示，原生 Eye 沿现有私有消息镜像查看。能力记录沿用 `guild assessment`，记录已验收探索阶段与原始证据，不据此推断解谜、战斗、搜刮能力或 LLM 长期自主表现。

完成履历保留区域数、距离、行进时间、区段/群系/高差和遗迹身份等汇总证据；逐点去重集合只在在途任务中保存，本版不提供完成后的轨迹回放。新一季或不同性质的委托使用新任务 ID，已有工程的全服完工账本不能通过改成个人任务来清零。

探索器每 5 tick 轮询最多 4 人，批次软预算 2 ms；只查询当前已加载区块和已加载的结构起始区块。没有运行时 `/locate`、全图扫描、同步加载或生成新区块。起始区块暂未加载时返回 `structure_unobserved_or_start_unloaded`，不是能力失败，靠近后可重试。路线集合有上限（256 区域、2048 采样位置、128 区段、64 群系）；进度每 30 秒保存，正常退出/停服会保存，突然进程崩溃可能丢失最近 30 秒。保存的行进秒数与整个任务耗时不同，后者按现有能力记录仍包含离线时间。

Java、Mineflayer 与 Geyser 基岩使用同一服务器验收和原版箱式菜单。隔离测试用普通协议客户端和受控世界夹具验证真实移动/自然结构元数据，不代表 16 个 LLM 已自主完成远征；基岩手柄画面需要真机体验。
