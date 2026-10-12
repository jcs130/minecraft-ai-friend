# 商旅公会交易信息板

2026-10-12：商旅交易板已随 AgentFriend **0.4.27 正式部署**；见[联合发布与回退](COMPLETED_FEATURES_RELEASE_20261012.md)。下方候选说明为原测试时点。

## 发布状态

本功能已并入 AgentFriend **0.4.25 候选**（另含[特色道具识别](CUSTOM_ITEM_IDENTITY.md)）；正式仍为 **0.4.23**。需要正常重启 Paper 加载，尚未替换正式 JAR，也未排队重启。下方 0.4.24 固定摘要验收为前一候选的历史证据，合并候选的复验另见特色道具清单。

## 玩家入口

- 技能罗盘 → 村庄新生活 → 商旅公会交易信息板。
- 溪畔商栈（已有商旅公会）的门牌：右键打开交易板。旧门牌同样可用，无须拆建。
- 馆内商旅掌柜·阿栈 → 商旅公会交易板；原委托、导师交易按钮继续保留。
- `/mycli trade menu` 可直接打开同一原版菜单。

每页 36 条报价。底排提供上一页、刷新、我要买、全部交易、我要卖、按物品查询、停止定位、公会位置和下一页。图标保留真实商品的物品名称、附魔、药水与地图元数据；说明显示交换的全部成本、结果、商人、位置和是否售罄。点击报价定位商人，顶部提示方向和距离，原技能罗盘指向商人；位置每秒更新。走近后右键商人，使用原有交易界面成交。

查询与定位免费且只读。定位会替换本人原先的队友追踪；之后可以重新 `/mycli locate <队友>`。商人死亡或离开已加载范围，定位会结束并提示重新查询。跨世界时显示实际世界和坐标，不能用主世界指针作为跨维度路线。没有远程交易或免费传送；原 `/mycli life visit harbor` 仍按既有传送术收费。

## Agent 用法

```text
/mycli explain trade
/mycli trade find 面包
/mycli trade buy 附魔书
/mycli trade find 经验修补
/mycli trade sell 小麦
/mycli trade buy minecraft:diamond_pickaxe
/mycli trade list 2
/mycli trade info <返回的商人ID> [页]
/mycli trade locate <返回的商人ID>
/mycli trade stop
/mycli trade hall
```

`buy` 表示玩家买入：匹配商人给出的物品；`sell` 表示玩家卖出：匹配支付给商人的非绿宝石物品，并要求商人给绿宝石。`find` 匹配交易两侧，也包括物物交换。可用常见中文物品名、完整原版物品 ID，以及中文/英文附魔名。中文别名在 `plugins/AgentFriend/trade-directory.yml` 中；它只影响搜索和文字展示，不定义任何交易、价格或库存。

文本查询私发中文摘要和 `MC_TRADE {JSON}`，schema 为 1，不公屏广播。经过授权并实际附身的 Eye 沿原镜像机制接收本体私有报价和定位提示。原版实际村民交易窗口保留原专用桥接；信息板属于一般容器，其自动窗口镜像仍受 SpectatorPlus 既有 `screens.require-client-mod` 开关控制。本功能不改全服弹窗策略，不宣称未装该客户端模组的 Eye 自动收到一般容器窗口。

| 字段 | 含义 |
| --- | --- |
| `type` | `offers`、`locate`、`hall` 或失败 `result` |
| `mode` / `query` | 买入、卖出、全表或某商人的查询条件 |
| `page` / `pages` / `total` | 按消息长度分页，每页最多 4 条；须使用返回的页数继续读取 |
| `scope` / `observedAt` | `loaded_merchants_only`；实际读取报价的 Unix 毫秒时间 |
| `merchantId` / `uuid` / `entityUuid` | 短编号、商人稳定完整 UUID、当前实体 UUID；Shopkeepers 商店 ID 与实体 ID 不混用 |
| `costs` / `result` | 全部支付材料和获得物品，含 ID、数量、名称、真实附魔等级 |
| `direction` | `player_buys`、`player_sells` 或 `barter`，均从玩家视角 |
| `source` / `priceScope` | 原版当前配方参考价，或 Shopkeepers 本人报价 |
| `outOfStock` / `remainingUses` | 是否售罄；原版配方的剩余次数。Shopkeepers 未提供数量时不虚构库存 |
| `location` | 实际世界名与方块坐标 |
| `truncated` / `unavailableMerchants` | 超过有界查询上限或部分商人读取失败，不宣称全表完整 |
| `metadataTruncated` / `detailsTruncated` | 极长插件物品的聊天元数据被省略，原版图形页仍保留真实物品元数据 |
| `reason` / `nextStep` | 失败原因和下一步，如重查准确商人 ID、换页或等区块加载 |

JSON 按序列化长度切页，预留消息封装空间，避免 Prismarine-chat 的 `messagestr` 4096 字符上限截断 JSON。不能只读取第一页后宣布没有其他报价。排序按商店/职业/稳定商人 ID 分组，村民走动不导致排序反复变化；商人进出加载范围或解锁交易后仍须重新查询。

## 真实数据与性能边界

- 原版：只读当前已加载的成年有职业村民及流浪商人，不分配职业、不调用 `setRecipes`，不修改交易使用次数或库存。试炼专用商人不混进村庄集市。
- Shopkeepers：通过实际 2.23.3 公共 API 读取活动实体商店，使用本人的 `hasTradingRecipes`、`getTradingRecipes`、`isOutOfStock`。当前三家集市管理员商店自然汇入；不依靠 `world-life.yml` 的商品描述拼接虚假报价。私人玩家商店不默认公布。
- 原版村民折扣、声望和其他玩家正在交易时的临时价格，以现场交易窗口为准；标为 `current_recipe_reference`。不能据此承诺个人最终价格。
- 公用实体索引最多缓存 3 秒，报价按查看者分别缓存最多 3 秒。刷新按钮重读本人报价；不把另一人的商店权限或库存结果复用给本次查看者。
- 最多 128 位商人、每位 32 条、总计 2048 条；达上限明确标记。不会加载远处区块、扫描整个存档、生成新地形或调用模型。
- 新的村民交易、正常解锁/补货及公开管理员商店会在后续查询中自动出现，不需要改代码或手写价格表。新中文别名保存后需下次加载插件时读取；不影响原版 ID 搜索和实际交易。
- 图形界面只展示物品副本，取消两侧点击与拖拽，避免展示物品被拿走、塞入个人物品或误成交。沿原窗口生命周期处理移动关闭。

## 隔离验证

测试入口为 `plugins/AgentFriend/trade-directory-stage.mjs` 和 `trade-directory-bedrock-stage.mjs`。拒绝正式端口，仅运行在绑定回环、路径含 `staging` 的副本；创建和调整的是专用 QA UUID 村民，不能对正式服运行。

```powershell
$env:MC_STAGE_PAPER='E:/MC/staging/ysm-release-20261011/paper'
$env:MC_TEST_OPS='E:/MC/ops'
$env:MC_TEST_REPORT_DIR='<新建私有验收目录>'
$env:MC_TEST_REQUIRE_FROM='E:/MC/probe/package.json'
$env:MC_TEST_BEDROCK_REQUIRE_FROM='E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json'
node paper/plugins/AgentFriend/trade-directory-stage.mjs live-1
node paper/plugins/AgentFriend/trade-directory-bedrock-stage.mjs 1
# 正常停止并重启同一隔离服，再运行冷启动复验；不能覆盖旧回执。
node paper/plugins/AgentFriend/trade-directory-stage.mjs cold-1
```

验收包含真实村民/三商店报价、中文与附魔书搜索、交换方向、双材料、售罄、分页、防取放、私有消息、真实原版成交、原门牌、附身 Eye 和 Geyser 原版容器转换。基岩协议客户端不等于手机/Xbox 真机画面验收；远端 Agent 无须安装新客户端补丁。

2026-10-12 最终同一候选 JAR 验收通过：

| 回执 | 结果 | 范围 |
| --- | --- | --- |
| `trade-live-final.json` | 34 项通过 | Mineflayer 实际连接；三家 Shopkeepers 商店与原版村民、中文搜索、分页、真实附魔/双材料/售罄、查询不改配方、菜单防取放、实际成交、旧门牌和掌柜按钮、私有消息及附身 Eye 定位 |
| `trade-bedrock-final.json` | 8 项通过 | 基岩协议 1.26.51 经隔离 Geyser 连接，中文查询、买卖方向、商人坐标、原版商品菜单和物品说明 |
| `trade-cold-tail.json` | 23 项复验通过 | 正常停服重启后重建相同 UUID 的真实报价，附魔书及第二材料保留；再验菜单、现场成交、物理入口、Eye 和商人死亡后结束定位 |

三份回执的 `candidateSha256` 与源码构建产物及隔离实际加载文件一致：`2210dbf29f2b6668ef4e6f67e65e256cdcb1079cb36eadacc0eb338d0ae90400`。早期分页与夹具失败回执保留，不计入通过；Mineflayer 长消息截断问题已通过按序列化长度分页修复。最终隔离服已正常停止，不留测试后台服务。

私有证据在 E/F `MC/ops/repairs/trade-directory-20261012`；公开候选摘要见 `paper/manifests/trade-directory-candidate-20261012.json`。正式只读复核仍为 0.4.23，原 JAR 摘要 `3f6820dabef89738f4ac254b9e8ee5277b824a5b4d22ff66a0ab7546d81105db`。本轮没有改正式玩家物品、村民交易、世界或排队发布；不将隔离基岩协议测试当作手机/Xbox 真机画面验收。

## 上线和回滚

上线只需通过既有维护流程正常停服、E/F 完整快照后替换唯一 AgentFriend JAR，等待用户明确批准这次 Paper 重启。`trade-directory.yml` 首次自动从 JAR 释放。旧溪畔商栈门牌已能交互，无须自动改写现存方块。发布后再同步女神现役资料箱和更新公告，不能提前将候选写成已上线。

不新增玩家账本、不迁移物品、不改村民配方或已有商店配置。回滚时正常停服换回 0.4.23；可保留别名文件。无需回退世界、背包或账号数据库。
