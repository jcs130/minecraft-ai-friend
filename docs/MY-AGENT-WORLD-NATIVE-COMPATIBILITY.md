# My Agent World 原生兼容维护

本分支 `experiment/agent-society-1.21.1` 对应独立 NeoForge 1.21.1 世界。Agent 采用 QwenPaw 原生任务和 Mineflayer 身体，同一连接的原生数据驱动 `mc-visual-console`；游戏规则、原物品组件、模组身份与原始资源均保留。模型仍为用户指定的线上 Coding Plan `qwen3.7-plus`，禁止本地模型或自动跨模型回退。

当前并未完成整个模组包的兼容验收。原生注册表可解析、资产导出成功、浏览器支持一种模型、Agent 完成一种操作是四件不同的事；不能据其中一项宣布全部完成。

## 2026-10-05 本次增量

服务端 `PlayerMenuBridge` 从本账号的 `ServerPlayer` 获取实际健康、最大健康、吸收生命、护甲、饥饿、饱和度、空气、经验、主手、使用物品、挥击、攻击进度、冷却恢复及姿态。物品附带服务端 `displayName`、descriptionId 和完整 SNBT；外部菜单另提供规范的本人 46 槽物品栏，避免将容器槽位当快捷栏。村民职业与群系的注册 ID 来自实际服务器 `BuiltInRegistries`。这些字段不能从其他账号、代理注册表或固定20推导。

食品读取实际 `DataComponents.FOOD`，包括 `nutrition`、`saturation`、`canAlwaysEat`、`eatSeconds`，以及由原 `FoodProperties.DIRECT_CODEC` 导出的完整 `nativeComponent`。默认 effects、概率和食用转换随该定义保留；SNBT 只是组件 patch，不能因其中没有 effects 就说腐肉没有饥饿风险。`additionalItemHooksDescribed:false` 表明额外模组 Java 消费钩子尚未完整描述。Agent 的 `foodOptions.items[].food` 保留这些原字段，`eat` 不按代理物品名字挑食品或强制装备：先用原生菜单搬到空快捷栏、核验真实选中槽，再单次使用，按规范本人库存减少一份和实际饥饿值验收。整堆异常消失与结果未确认分别记录，未知不得重投。低血量、食物风险、避险和休息由模型根据真实观察选择，不增加执行器补物、传送或固定救援规则。

浏览器新增原始 BedRenderer 的床几何及纹理、猪／牛／鸡／羊／史莱姆／村民模型和有限原生动画；手持物分别使用第三人称与第一人称的原模型变换，包含 Ars 专用书、已核实手册、静态物品与工具。东方女仆已移植一个锁定原包的博丽灵梦变体、原 73 骨骼及按原顺序执行的 15 项动画脚本对应的有限状态；只接受实际原生模型 ID、同玩家 tracked 状态和可支持的姿态。其他变体、装备／背包层、YSM、游泳、受击／特殊攻击及未知状态仍明确拒绝。原模型、公式与脚本接入不代表 Java 像素一致，`animationParityVerified`、完整实体 parity 均仍为 false。未知装备、攻击、使用、装备切换、光照或实体状态仍明确报告缺口，不画替身。

静态物品 GUI 的离线审计有1059个正注册候选，1011个资源可读，940个处于当前 guard 范围（557个块模型、383个 flat），包含已审查的35种直接 Farmer's Delight `ConsumableItem` 食品。Ars、Patchouli／女仆专用 provider 不计入这1059项。这不是4810件物品全部兼容，也不是实际浏览器或 Java 像素验收数量。具体来源、组件与复现命令见可视化仓库 `packages/modern-viewer/renderer-src/NATIVE_ITEM_GUI_COMPATIBILITY.md`。

工作台使用原始3×3合成布局，标准单／双箱及炉、烟熏炉、高炉使用各自原始PNG和槽位坐标。菜单已透出实际 `AbstractContainerMenu.dataSlots` 为 `dataValues`，实际 `Slot.x/y` 为 `slotLayout`。原版三种炉只读取本人当前窗口四项 `[litTime,litDuration,cookingProgress,cookingTotalTime]`，沿原客户端公式裁剪火焰和箭头；缺数据时标 unknown，不按物品或时间推测。Farmer's Delight 料理锅已移植原 PNG、45 槽布局和两项实际 `[cookTime,cookTimeTotal]` 进度，热源及盛装容器另从真实 `CookingPotMenu.blockEntity.isHeated()/getContainer()` 获取。锅内熟食缓冲槽6不可取，槽7放容器、槽8为盛装后的可取成品；空碗提示图不是库存物品。未知模组菜单仍展示实际原生槽位，并标明布局未移植。网页菜单当前为只读画面，游戏操作仍由该玩家的原生菜单动作与服务端回执完成。

炉灶与切菜板没有 GUI。`block_inspect` 只读本人准星命中的已加载原方块实体：炉灶返回实际6槽、点燃状态和各槽烹饪计时；切菜板返回实际单槽、`storedItem`、空板和堆叠状态。`use_block` 使用服务端原生射线回执的 `hit.face` 和 `hit.cursor`，不会强行用上表面或请求瞄准点替代实际命中。切菜板只有1/16高，模型须显式选择 `aimOffset:[0.5,0.03,0.5]`；加工结果掉入世界，不能把输入消耗、计时变化或发包成功当成本人已拾取产物。

Agent 新增可发现的22项 `tools list/explain` 和 `recipes`。配方读取服务器实际 `RecipeManager`，仅允许精确 namespaced `recipeId/recipeType/outputId` 与 `offset:0..10000`、`limit:1..12`，没有文本搜索或管理端读存档。原生合成／烹饪、FD料理锅／切菜板的已确认定义包含实际 ingredients alternatives、网格、热源／容器／时间及工具／概率结果；备选材料不是同时需要的材料。切菜板保留原工具谓词、本人匹配工具和 Fortune 边界。Create 等其他类型仍可被发现，但复杂、动态、自定义或超预算定义以 `definitionAvailable:false` 和明确 code 返回，不能当完整可执行配方。每定义最大8KiB、单页有总预算，ingredients备选最多64；分页与 recipeTypes 截断均显式标注。`inspect.modStates.recipes` 按当前 UUID／epoch 缓存首小页和真实类型计数，至少30秒更新一次，附 `observedAt`；该只读发现不会自动合成或新增模型请求。

第一人称固定模型遵循原始客户端的FOV与物品变换。实际浏览器16:9视口验证木棍可见；较窄视口会裁掉木棍的大部分像素，因此新增按模型透明边界和真实视锥计算的裁切诊断，不通过移动手持模型改变原始摆位。此验证不涵盖使用、挥击、装备切换和完整战斗动画。

Agent 的 `inspect.entities` 只读取同一连接原生实体表，提供原始命名空间 ID、UUID、类型注册 ID、距离和绝对坐标，范围12格、最多16项。`entity_inspect`、`attack`、`entity_interact` 另用服务器本账号实际 StartTracking／StopTracking 集核验同维度、存活、身份、视线和距离，不能扫描全世界。攻击在看向目标前后两次核验原生 UUID／ID、主人、驯养、NPC及友方信息，并匹配 Mineflayer 的真实目标 UUID；代理 zombie 名字不构成敌对证据。

`combat` 允许服务端实际 `Enemy` 接口的敌人，包括模组敌人；`hunt_food` 允许无主、未驯养、非友方、未命名的牛、猪、羊、鸡、兔、蘑菇牛、鳕鱼、鲑鱼和热带鱼。玩家、村民、女仆、殖民地公民、宠物、主人和队友仍保护，关系不明时不派发。近战最多3格、普通实体右键最多4.5格。真实菜单打开或驯养／主人变化才记作已观察的交互效果；未确认效果保留 `sent_unverified`，不会称交易或所有实体功能已打通。女仆 `follow/pickup/task` 的成功另按同玩家服务器实际 maidState 字段验证，不只信任 ok 回执。

本次前端419项、后端115项测试通过，无跳过；这些是源码和契约回归。恢复后的同账号现场验收已确认一次原生腐肉进食（4→3份、饥饿15→19）和实际6286条配方目录；有限女仆原模型已在浏览器可见。自主料理、猎食、机器生产线及持续女仆协作仍待分别实测。现场记录见持久服务文档，所有整体画面／全模组／长期自主生活 parity 标记仍为 false。

## 动作期限与未知结果

总动作期限45秒，嵌套导航期限25秒。取消使用原 pathfinder 的 `setGoal(null)`，同时停止挖掘、使用物品和按键；不能用等待下一个路径节点的 `stop()` 代替。每个 await 后重新核验生命、世界 epoch、维护暂停和期限。导航、采集、进食等中途取消后的效果不一定可确定，因此保存为 `outcome=unknown / retryAutomatically=false`，不把旧承诺当成功或重投。

Mineflayer 方法可能捕获原 bot，代理对象无法阻止迟到的写包。动作中断后原连接的 mutation fence 保持关闭直至 owned worker 重启；保活、原生只读查询及停止使用／挖掘仍可发送。仅删除 `autonomy.paused` 不能解除旧异步闭包，操作员必须核对原意图、结果、任务终态和实际世界，归档精确暂停原因后再恢复。不同维护、未知动作和未知模型标记不得批量清除。

本轮旧采集意图 `9b15ab3e-130f-4e90-8beb-2ac1a8725e2e` 长时间未结束。已先正常停止 owned 三子服务并冷备，保留原意图，再追加一次 `operator_interrupted` 结果：实际效果未核实、禁止自动重试。原始账本和冷备没有删除或改写，此纠正不算一次自主采集成功。

`gather` 回执分别提供 `blockBroken`、`pickupConfirmed` 和 `inventoryDelta`。库存统计排除合成结果预览槽0，并按本人规范物品栏核对真实原生ID及数量；仅方块变为空气但未确认库存增加时返回 `no_pickup_confirmed`，不能称采集完成或自动重挖原位置。`dig` 仅证明方块破坏。选择工具由模型按真实物品与当前槽位决定，不能把Soul Spell等代理物品当镐，亦不能由执行器强制补物或替选工具。

`select` 注册监听后只提交一次，等待同UUID的原生菜单更新或同连接clientbound快捷栏确认，最多5秒。服务端菜单每5 tick检查变化，旧150ms固定等待会读到缓存并误报失败；客户端自己的quickBarSlot不构成服务端确认。超时仍记未知且禁止自动重投。

实体表保留有界内存与快照预算。锁定1.21.1协议中的四种bool前缀optional元数据允许own `value: undefined`；传入JSON画面时转换为null并保留 `nativeOptionalAbsent=true`，之后收到真实值移除标记。required缺值或未知optional仍拒绝。诊断只包含包名、序号、实体ID、键／类型和是否有值，不泄露元数据内容。此合法协议修复已经通过实际codec/v8/宿主回归；旧现场只保存了错误原因而没有原始失败entry，不能断言它就是旧失败的唯一原因。

## 资源版本

本轮已安装服务端桥 JAR SHA-256：`c32f68bd51e17c21bb02247595fe420ea789fb61be65d6efc137a2da8e36b04f`，对应本次 v5 资源来源记录。仓库锁定清单、安装 JAR 与 v5 manifest 来源一致；现场恢复和真实玩法验收另行记录。

私人原生资源目录为 `E:\QiandengJiSocietyLab\assets\native-20261005-v5`：39058件资源、3975类方块／107852状态、4810类物品、257类实体。资源和注册表字节与 v4／v3 相同，仅更新了当前来源桥 JAR 记录；这不会扩大静态 provider 的验收范围。全部39127个资产／变体／注册文件通过完整性检查；11处资源覆盖冲突仍保持 unresolved。`resourcePriorityVerified`、`renderParityVerified`、`complete` 仍为false，Java 活跃资源包优先级与逐像素画面对照未验。JAR、PNG、生成 bundle、世界和私人采样均不入 Git。

## 后续适配的验收规则

兼容工作按模组分别推进，不能把基础协议已接通等同于全部玩法已通：

| 范围 | 已有证据 | 仍需完成 |
| --- | --- | --- |
| 原版基础操作 | 同玩家原生菜单、合成、移动、挖掘；有限床／生物／物品原始模型 | 装备、完整攻击／使用动画、全实体与Java画面对照 |
| Farmer's Delight | 历史隔离验收过料理锅入料／盛装／取出／食用；本轮源实现原料理锅屏幕、真实进度／热源、炉灶与切菜板BE读取、实际配方和FOOD | 新桥同账号自然料理／拾取验收、动态方块原渲染、持续自主料理、Java像素对照 |
| Ars Nouveau | 同玩家真实魔力、书中法术目录与施法回执；原始分级／染色书模型 | 所有glyph效果、魔法生物、翻页／施法动画和完整技能生命周期 |
| Touhou Little Maid | 同玩家读取女仆／工作配置／背包；follow/pickup/task真实后置核验；原始石板与手册GUI及一个73骨骼原变体的有限动画移植 | 其他变体、装备／背包／受击／特殊动画层、像素对照、持续协作劳动 |
| MineColonies | 隔离验收过读取建造请求、交付材料、原建筑工完成小屋 | 公民模型／工作界面、自然资源闭环、多职业长期运营 |
| Create及联动 | 隔离验收过原生放置、动力查询与有限机器操作 | 运动结构、动态材质、机器专用屏幕、多步生产线 |
| Macaw建筑、地下城模组 | 原始注册表、静态资源和原生结构查询已保留 | 全部状态渲染、机关交互、Boss战和自然攻略 |
| 基岩入口 | 当前新服仍仅回环Java实验入口 | 另行验证转换资源与交互，旧服基岩成功不能算新服已通过 |

每个提供器绑定当前 MC／模组版本及来源 SHA，核对原始模型继承、UV、资源覆盖优先级、材质、组件、动画和实际状态。不能只因有 JSON 或 PNG 就假定模组默认 ItemRenderer；不能用原版物品或简化几何补未知模型。新增范围须在支持列表中明确注册，未知组件、动态模型或不完整状态继续拒绝。

依次保存资源来源测试、同玩家网络状态测试、浏览器可见结果和匹配 Java 客户端场景对照。几何及公式测试通过不能把 `pixelParityVerified` 改为true。女仆尚未支持的变体与动态层、殖民地公民、Create 运动结构、Ars 生物、装备／战斗动画、粒子和原生声音仍需要继续独立移植和实战验收。

发布沿用 `tools/maw_service.py` 的 owned stop/resume：先暂停自主、核对任务与行动，等待全部维度保存和三个子服务实际退出，再发布；恢复后验证同账号身份、原生流和真实新任务。旧25565实例、UDP19132、路由器映射及 QwenPaw 宿主／其他角色不在这次维护范围。已有冷备 `backups/native-renderers-20261005-0736` 共177文件，含原世界、原Agent记录和旧桥 JAR。

运行验收与最终提交记录追加在 `docs/MY-AGENT-WORLD-PERSISTENT-SERVER.md`。健康入口 `python world/ops/health/health_mon.py --society` 仅检验本实验服务与自主循环，不证明长期稳定或全模组游玩。
