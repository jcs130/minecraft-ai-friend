# 自选委托路线

## 2026-10-17 探索阶段指引候选

正式仍为 **0.4.47**。女神地点清单与探索资料已热更新；完整命令指引是 **0.4.47.1 候选，待重启许可后安装**，本轮没有重启正式服。

继续使用 `tasks list/info/status`、`guild status/verify/claim` 和统一 `progress`，不增加需要另记的命令。本人状态的规范位置为 `adventure.market.guidance`，包含当前 `phase`、简短 `summary`、当前缺项 `missingConditions`、一个实际行动 `nextAction` 和查询/交付 `nextCommand`。完整指引不在每个外层状态重复复制。

| 当前阶段 | 应看到的指引 |
| --- | --- |
| 还没进入目标 | 世界与结构键匹配的公开线索、直线距离；没有线索则明确说明未知 |
| 维度不对 | 先回目标维度，不把中转坐标当目标 |
| 已开始但离开 | 保留证据，回上次记录的同一座遗迹继续，不催放弃重接 |
| 正在实地调查 | 只列缺项；缺高差就走上下通道，缺覆盖就走未经过的位置 |
| 证据已齐 | 交付当前阶段；返程不会撤销已完成的探索 |

“6个4格分区”是同一座建筑里的空间网格，不是6座遗迹或6个固定打卡方块。坐标是建筑参考位置，不是已核实入口，不证明角色到场。查询从活跃内存或已有存档读取，不采样位移、不报名、不清空任务、不发奖励、不加载区块。`guild verify` 保留原有显式验收行为。

公开结构清单为 `plugins/AgentFriend/exploration-landmarks.json`，沿用女神 `paper/ops/exploration-landmarks.json` 的16KiB/24处有界格式。更正后执行现有 `mycli admin market reload`，无需为改坐标重启；无效清单/任务配置保留此前有效市场。清单缺省时仍可用任务系统，只不给未经核实的坐标。不得把仅有 `structure_starts` 的未生成区块登记成可用建筑。

候选从已部署提交 `d37d672` 构建，只叠加本轮指引；不包含尚未上线的0.4.48公共档案馆。运行安装时只补两条神庙说明、结构清单和候选JAR，不覆盖在途定义、玩家配置或其他运营委托。后续0.4.48源码保留原档案馆功能和本轮改动，不能把源码快照当作本次已安装版本。

验证：29项Java规则检查、23项隔离联机检查、2项Node回归通过。联机使用真实已生成神庙区块的隔离副本；部分/完成证据是专用QA插件注入的测试夹具，不是代玩家完成实际委托。覆盖冻结原单、原生结构识别、私有Mineflayer回执、查询无状态变更与区块加载、缺项、跨维度、续做、错误清单回退和无奖励副作用。隔离服已正常停止。测试入口见 `paper/probe/task-guidance-stage.mjs` 与 `ExplorationGuidanceTest.java`；需要先准备明确的loopback fixture及单独QA插件，禁止指向正式服。

## 2026-10-18 近郊任务链候选

0.4.47.6 候选增加主村庄地面巡访三段、公共矿坑五段，复用现有道路、矿棚、台阶、平台和艺术厅。每段有真实范围和条件，返程独立验位置；古城改为新接的高阶可选远征。`tasks pause/resume` 可本人暂存一次性纯探索远征，保留原接单规则与调查记录，不自动换单。当前正式仍0.4.47.4，完整规则、验证与回退见 [近郊分段委托](LOCAL_TASK_CHAINS.md)。

## 2026-10-15 上线路线记录

2026-10-15：AgentFriend **0.4.42 已上线**，用于现有 Paper 千灯纪；完整冷备份为 E/F `20261015-211316`。正式状态30项、认证 Java/Agent/实际 Eye 25项、原数据16项及29份大背包对账通过。

## 玩家与 Agent 的入口

```text
/mycli tasks --help
/mycli tasks list
/mycli tasks list combat
/mycli tasks info tm_starter_blade
/mycli guild accept tm_starter_blade
/mycli tasks status
/mycli guild claim
```

只需记住 `/mycli`，从帮助或返回的 `nextCommand` 逐层发现。`tasks list/info/status` 查询免费，不报名、不换职业、不替换在途委托。列表每页最多七张，用 `--page N` 续读；全部新入口支持 `--json`。原 `guild market/engineering/accept/claim`、`life` 和统一 `progress` 保持兼容。

技能罗盘 → 旅途指南 → 自选委托路线；公会菜单右下角、新手入门页也有入口。选择路线后先看详情，再点击明确的接单按钮。原版箱式菜单可由 Java、基岩与 Mineflayer 使用，不要求客户端安装新模组。

## 六条路线

| 路线 ID | 内容 | 本轮入门或日常委托 |
| --- | --- | --- |
| `combat` | 指定怪物、数量与武器的讨伐；原战法牧及副本委托 | `tm_starter_blade`：持剑近战讨伐僵尸/尸壳 3 只；`tm_starter_archer`：弓弩射杀骷髅类 2 只；`tm_spider_patrol`：剑斧清理蜘蛛类 4 只 |
| `crafting` | 制作装备和工具，成品留给本人 | `tm_starter_equipment`：石剑 → 盾牌；`tm_starter_tools`：石镐 → 石斧 |
| `exploration` | 真实走查；原下界、末地、群系、遗迹和原图寻宝 | `tm_starter_trail`：主世界 3 个不同区域、48 格新路线、15 秒有效行进 |
| `supply` | 公共物资回补 | `tm_restock_light`：亲手制作 → 交付火把 16 支；`tm_restock_shield`：制作 → 交付普通盾牌 1 面 |
| `engineering` | 现有工程场地的房屋、道路、桥梁和机关 | 沿用已登记场地及结构验收；未开放场地不会伪称可接 |
| `life` | 自愿农事、钓鱼、摄影、写作和居民事务 | 原生活公会七类任务继续使用 `life board`，居民事务按实际目标归类 |

路线是任务目录，不是新的职业锁定。没有先完成农业才能打怪、制造或探索的要求；同一公会任务槽仍只能接一单，生活任务槽保持独立。`beginner=true` 只表示入门推荐。入门大多本人一次，三项日常巡守/后勤本人每日一次；查询 `repeat` 及实际可接状态。

新手三证改为报名后 **读技能目录 → 成功施法 → 完整交付任意一项委托**。战斗、制造、探索、后勤、工程及原生活委托均可。多阶段委托只完成第一步不算毕业。保留旧 `proof.life` 和 `MC_WORLD.life`，新增同值 `commission` 字段表示任意委托证明；已完成的旧生活实习不会清零，也不要求补做另一张冒险委托。报名之前的旧完成记录不会被追记为报名后的实践。

## 出发补给与回补

用 `/mycli guild shared` 获取**门口**武器、护甲、补给、杂物及同类扩容箱的实际坐标，再到箱旁按需领取。不在欢迎信息写死可能变动的箱体坐标。大厅内部私产服从原领地授权，不能当公共箱。

回补先制作、交制造阶段，再按物品和数量 `guild claim`。沿用既有 `DONATE`：检查普通物品及容量、扣本人随身物品、放入公共库存。仓库满或不可用时不扣物、不结算，保留在途任务。直接把公共成品拿出来再交，不能跳过制造阶段；已经手工放进公共箱的物品不会被重复记作命令交付。

## 运营配置

新增文件 `plugins/AgentFriend/route-contracts.yml`，与 `task-market.yml`、`resident-contracts.yml` 合并校验，总计最多 64 张任务。内容默认资源及部署快照分别位于仓库 `plugins/AgentFriend/resources/`、`config/AgentFriend/`。

```yaml
schema-version: 1
tasks:
  example_patrol:
    route: combat
    beginner: true
    repeat: daily
    title: 村外巡守
    description: 持剑亲自击败三只僵尸，出发前到门口公共箱补给。
    icon: STONE_SWORD
    reward: {fame: 4, emeralds: 1, bonus: BREAD, bonus-count: 2}
    steps:
      - title: 持剑讨伐
        description: 本人以剑近战完成最后一击，达标后交付。
        goal: kills
        target: 3
        combat:
          mobs: [ZOMBIE]
          weapons: [SWORD]
          attack: melee
```

`weapons` 支持剑/斧家族 `SWORD/AXE`，精确材质如 `STONE_SWORD`，以及 `BOW/CROSSBOW/TRIDENT/MACE/ANY`。`attack` 为 `melee/projectile/any`。怪物、武器、攻击方式和数量错误时拒绝整次重载，保留上一版有效目录；不会把错误的数量字符串默认为一只。村民、动物、玩家及未知实体 ID 不能写成讨伐对象。

`combat` 仅用于 `kills`。带该条件时，由真实死亡、直接攻击或发射事件验证**本人最后一击**：近战记录实际攻击时的武器；箭、弩箭和三叉戟记录发射时的武器、发射者及接单阶段。射后换武器不改证据，接单前/上一阶段射出的弹体不计；队友击杀、环境死亡及未验证的伤害不计。同一实体 UUID 不能重复提交。没有 `combat` 的旧 `KILLS` 保留原试炼团队规则，避免改坏老任务。

```text
# 控制台；运行 0.4.42 后日常调整无需重启
mycli admin market reload
```

在途规则、阶段、奖励和原 ID 冻结保存；修改 YAML 只影响之后接单。旧任务不填 `route` 时按实际目标归类，可以显式覆盖分类。不要改写玩家在途快照或复用旧 ID 表示另一种任务。

## 结果和隐私

Agent 默认一份私有 `MC_TASKS` JSON；超过短消息预算的详情用既有 `MC_PAGE` 无损分片，按 `nextCommand` 续读后拼接 `json_fragment.data`。真人默认中文；实际附身的 Eye 只收中文摘要。原生自定义频道为 `mcagent:tasks`。不广播查询、怪物条件或本人进度。普通玩家也能查询，不需要 OP。

`tasks status` 分开显示冒险与生活任务；主线毕业仍从 `status/progress main` 读取。查询不自动交付、刷新验收或释放过期任务；工程复核用原 `guild verify`。奖励沿用本人个人箱/待入箱队列。`available` 是查询时的资格快照，真正接单和交付仍重查；发出命令、出现菜单或客户端预测结果都不是完成证明。

## 发布、验证与回退

按 [维护流程](OPERATIONS.md) 另行确认、提前提醒、检查真人和活动副本、完整双盘冷备份后部署唯一 AgentFriend JAR。同步新版 `onboarding.yml`、新增 `route-contracts.yml` 及小满的 BetonQuest 对话，后者沿其原生重载入口更新；不使用 Paper `/reload`。没有新增第三方插件、客户端补丁、建筑施工或世界迁移，FOM 不在本次范围内。

```powershell
./paper/plugins/AgentFriend/build.ps1 -MinecraftVersion 1.21.1
./paper/plugins/AgentFriend/test-task-routes.ps1
node paper/probe/task-routes-stage.mjs M
node paper/probe/task-routes-compat-stage.mjs F
# 隔离服正常冷启动后，回读同一轮记录：
node paper/probe/task-routes-resume-stage.mjs M
```

探针只允许回环 `25840/25841` 及固定测试 MOTD；使用冷备份副本、独立 QA 账号和怪物。基岩协议测试只在该回环副本允许自签链，不改变正式 Xbox 认证。手机/Xbox真机画面另验。选填诊断插件源码在 `tests/TaskRoutesProbe.java`，不能打进正式 AgentFriend；最终候选复测移除该插件。

若只撤回新内容，在 0.4.42 上禁用新任务并 `market reload`，保留在途冻结规则让玩家完成。直接降回 0.4.41 会丢失新武器条件的解释能力，不能让新 `combat` 在途单据由旧 JAR 继续结算；须先安全停发并处理这些在途单据，保留原账本和备份。不要为撤回功能回滚玩家物品或整个世界。

具体摘要、测试结果与未覆盖范围见本轮发布清单；现役女神资料箱同步相同玩家说明。

### 本轮结果

同一 JAR（SHA256 `78e39073c251bdb14d426858e4933c8075618ad04832bcb56f4e8d85914c2e01`）通过 **169 项**：规则 43、CLI 回归 49、原生 Java/Agent/实际 Eye 流程 60、旧 Java 与基岩协议 7、正常冷启动回读 10。以上为部署前隔离验收；随后经服主确认完成正常备份重启，正式核验见页首与发布清单。

实际验收包括：纯查询不报名；普通 Java 中文、Agent 单份 JSON、Eye 中文、外人收不到；八阶段长详情可无损拼回；错误怪物/武器/魔法不计，弓箭发射后换剑仍正确计数；制造只交第一步不毕业；回补满仓保留物品与任务，成功时本人少 16 支火把、公共仓库多 16 支；实际走查满足区域、距离、行进时间；在途讨伐 1/4、四次最终交付与毕业状态冷启动后保持。另有明确标注的旧格式存档夹具验证旧任务和旧生活证明兼容。

原失败均留在私有证据中，包括界面标题类型、未加载场地、客户端预测合成、仓库空 `Items` 字段、聊天 SNBT 缩略，以及一次基岩 OpenID 网络握手失败；修正夹具后复验，不能拿失败的中间快照声称物品丢失或服务端判定异常。最后使用原生输出槽位、原生库存数量查询和完整 NBT 克隆备份；未重放结果未知的合成。隔离服已正常保存停止，最终包不含诊断插件。

源码、发布文件摘要与维护边界见 [候选清单](../manifests/task-routes-candidate-20261015.json)。E/F 双盘候选与原始回执在 `repairs/task-routes-20261015`；候选副本另存；正式部署使用更新前完整冷备份 E/F `scheduled/20261015-211316`。

### 正式发布与协议核验

服主确认“可以重启”后，180/60/10秒预告、真人/副本/PvP门禁通过；原Afu-MC-DailyBackup正常停启，E/F完整冷备份20261015-211316均先于安装完成。正式Paper1.21.1 build133 / AgentFriend0.4.42 / Eye0.1.16，31插件启用、52委托/7场地、欢迎修订12。正式状态30项、认证Java/Agent/真实Eye25项、原数据16项通过，29份原背包逐行与物品摘要一致。普通难度与三维度keepInventory=true保留。手机/Xbox真机、远端Web更新及16自主Agent长期负载未验。启动期间server.properties仅日期注释变化，全部设置值一致；标准客户端需声明minecraft:register中的mcagent:tasks订阅才能接收该自定义频道，私有中文/JSON聊天回执照常可用。ag_账号默认单份机器回执，实际Eye中文不转发JSON；真实原生菜单浏览没有接单，原大背包仍能打开。测试期间未替真实玩家接单、转移物资或发奖。


女神收尾：现役资料源/副本摘要一致，真实游戏提示及解析器验收通过；实际read_file读取TASK_ROUTES和SERVER_UPDATES，119字中文正确说明六条任选、农业非前置、/mycli tasks逐层入口与旧证明/任务保留，未发游戏测试消息。初次普通console长答、漏列只读glob_search的夹具失败均保留。
