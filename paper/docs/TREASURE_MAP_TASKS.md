# 直接复用已有藏宝图和遗迹地图

正式状态：2026-10-08 23:24:01 已正式发布 AgentFriend **0.3.98**（886121字节，SHA256 `EFF8C9B52576DBC016092E3C2C2D4FCDD06E8EEFA959186EB78497EFB25CF6CC`），Java PID **25800**。E/F `20261008-232258/.complete` 均在替换前完整，正常维护任务结果0。完整证据见[维护流程](OPERATIONS.md)。
## 玩法

主手拿**现有**有目标标记的地图，接任务市场「图上的远行」`tm_map_hunt`。接单只读取地图物品已有的目标标记，不替换、不改写、不消耗地图，也不发一张任务专用地图。

```text
/mycli guild map
/mycli guild market tm_map_hunt
/mycli guild accept tm_map_hunt
/mycli guild verify
/mycli guild claim
```

真人可用罗盘 → 冒险者公会 → 任务市场接单、验收和交付。手里的原图继续用于导航；Agent 可查询原图标记的维度与 X/Z，服务器不提供宝箱深度。

- **埋藏宝藏图：**亲自打开原图对应、尚未被搜过的天然藏宝箱，再勘察周边。箱子的原版战利品保留给玩家，不提交物品。
- **探险家地图与遗迹地图：**进入原图目标对应的天然生成建筑，实际走查。同为红叉的亡灵墓穴等遗迹地图按真实建筑调查，不根据红叉猜成埋藏宝藏。
- 默认至少四个不同区域、二十四格新路线、十五秒有效行进。区域按四格划分；重复旧采样点、站定、传送位移不能增加探索证据。遗迹还要有至少一个真实生成区段。
- 完成后回到**接单位置十六格内**交回记录，才发声望、绿宝石和补给。地图、沿途所得物资留在玩家手里。
- 每人每个目的地结算一次；复制、改名、缩放地图不能重复领奖。同一天换一个新目的地可以继续接。多人各自有履历，但已经被别人搜过的旧宝箱不能冒充新发现。

支持当前服务端原版藏宝图、林地府邸/海底神殿探险家地图，以及 Dungeons and Taverns/Ships 使用原版地图目标标记生成的遗迹地图。空白地图、没有目标标记的普通地图、改名纸和多目标地图会明确拒绝；单纯给普通地图改名不会变成探险图。

## Agent 回执

`guild.map` 已登记在自发现目录，可用 `/mycli explain guild.map` 查询。既有客户端命令、消息和市场频道继续使用，无需改 Agent 客户端。

| 回执 | 含义 |
| --- | --- |
| `MC_TREASURE_MAP` | `mcagent:market` 私有 JSON，含原图 `mapId/worldUuid/dimension/x/z/icon/title/source`、接单返程位置、探索条件和状态；`mapsConsumed=false` |
| `MC_TREASURE_TARGET` | 私有文字标记坐标；来自原物品目标，不是地图中心，不含藏宝深度 |
| `MC_TREASURE_RETURN` | 私有文字返程位置 |
| `MC_MARKET_CHECK` | 沿用 schemaVersion 1；`ready/progress/reason/evidence`，证据来源 `server_map_hunt` |

看到 `return_to_acceptance_point` 表示现场调查已完成，应返回接单点；不是可在远处直接领奖。地图查询、验收免费，不执行传送。返程如使用现有传送技能，按其原规则耗魔。

地图读取使用物品原生目标元数据，地图中心不能代替目标。天然建筑校验只读玩家当前已加载区块及已加载结构起点，不调用 locate、不扫描世界存档、不生成目的地区块。宝箱证明需要原版 `buried_treasure` 战利品生成事件和玩家实际打开对应界面；自制箱、旧空箱和被取消的打开操作不算。

## 热运营

示例：[map-hunts.yml](../plugins/AgentFriend/examples/map-hunts.yml)。首次功能安装需正常发布插件；之后规则、路线门槛、奖励、文字可以修改运行目录 `plugins/AgentFriend/task-market.yml`，用控制台 `mycli admin market reload` 热加载。把新任务合并到现有 `tasks`，保留原任务和场地，不用示例文件替换整份生产配置。

新增目标 `goal: map_hunt`，只允许个人任务的最后一步，每单最多一步。`repeat: destination` 按目的地重复；可在前面加备料等原有步骤。字段：`target` 不同区域数、`zone-size`、`min-distance`、`min-seconds`、`min-sections`、`min-height-span`、`treasure-radius`、`return-radius`。接单时冻结规则、奖励、原图目标和返程位置，热调整不会改掉在途约定。

运行数据沿用 `config.yml`：

- `guild-players.<UUID>.active.market.map-hunt`：地图绑定、原始返程点、建筑实例、天然开箱证明与完成调查摘要。
- 既有探索状态：去重路线、区域、行进时间，掉线和正常重启后续接。
- `task-market.map-discoveries.<UUID>.targets/structures`：目的地及天然建筑实例结算记录，防复制图和同建筑偏移标记重复领奖；每人最多1024个目标，不自动清除旧记录。
- 既有任务市场履历：保留完成/放弃、耗时与真实证据；奖金沿用个人奖励箱及待入箱队列。

备份与回退应将插件、任务配置和完整玩家运行状态一同保留。回退到不支持 `map_hunt` 的旧插件前须处理在途寻宝快照，不能直接删除记录或重发奖励。私有测试与正式发布证据见维护记录；真实基岩/Xbox手柄画面需要相应设备验收。
