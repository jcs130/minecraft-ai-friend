# My Agent World：隔离服首个可运行切片

2026-10-03。此分支 `experiment/agent-society-1.21.1` 用来验证“Agent 在有居民、职业、生产需求和伙伴的世界里长期生活”。**这是独立实验服，当前千灯纪 Paper 正式服不迁移、不停服、不改端口或存档。** 实验运行目录为 `E:\QiandengJiSocietyLab`；所有存档、模组 JAR、日志与缓存留在该目录，不提交 Git。

## 当前已做到

- Minecraft 1.21.1、NeoForge 21.1.248、Java 21，实验服只监听 `127.0.0.1:28976`，显示名为 **My Agent World**。无公网映射、RCON、基岩入口或自动启动。
- [MineColonies 1.1.1319](https://www.curseforge.com/minecraft/mc-mods/minecolonies/files/8138370) 及官方要求的 [Structurize](https://www.curseforge.com/minecraft/mc-mods/structurize/files/8610535)、[Multi-Piston](https://www.curseforge.com/minecraft/mc-mods/multi-piston/files/7097877)、[BlockUI](https://www.curseforge.com/minecraft/mc-mods/blockui/files/7541336)、[Domum Ornamentum](https://www.curseforge.com/minecraft/mc-mods/domum-ornamentum/files/7789217)；[Touhou Little Maid 1.5.3](https://www.curseforge.com/minecraft/mc-mods/touhou-little-maid/files/8061852) 和 [Farmer's Delight 1.3.4](https://www.curseforge.com/minecraft/mc-mods/farmers-delight/files/8765184)。版本、下载地址与 SHA-256 在 [`manifests/society-lab-1.21.1.lock.json`](../manifests/society-lab-1.21.1.lock.json)。
- 生活与生产：加入 [Create 6.0.10](https://www.curseforge.com/minecraft/mc-mods/create/files/7963363)、其服务端必需的 Ponder 1.0.82、Create: Dragons Plus 1.11.9，以及 [Create: Central Kitchen 2.6.2](https://modrinth.com/mod/create-central-kitchen/version/whbguqT1)。Central Kitchen 的 Farmer's Delight 联动条件由现有 1.3.4 满足。Create 的 Flywheel 是客户端依赖，不放进服务端。
- 魔法与建筑：加入 [Ars Nouveau 5.13.2](https://www.curseforge.com/minecraft/mc-mods/ars-nouveau/files/8993194)、[Ars Creo 5.4.0](https://modrinth.com/mod/ars-creo/version/LqOllHms) 及 Curios、GeckoLib、Patchouli；建筑补充 Macaw's Bridges 3.1.2、Roofs 2.3.2、Furniture 3.4.1、Windows 2.4.2。均为 1.21.1 NeoForge 对应文件；实际 JAR SHA-256 见版本锁。
- 地下城探索：加入 [Dungeon Crawl 2.3.17](https://modrinth.com/mod/dungeoncrawl/version/D7lKpb69) 的地下程序生成迷宫，以及 [YUNG's Better Dungeons 5.1.3](https://modrinth.com/mod/yungs-better-dungeons/version/RqX5d3pv) 与所需 [YUNG's API 5.1.8](https://modrinth.com/mod/yungs-api/version/K3Dp2T0P)。三者均锁定 NeoForge 1.21.1 文件、下载校验值；原实验存档与模组已先备份到 `E:\QiandengJiSocietyLab\snapshots\before-dungeons-20261003`。新结构需要在未生成区块中寻找，已有建筑、居民与存档未重建。
- 可攻略的 Boss 地下城：加入 [Fantastic Dungeoneer 1.0.3](https://modrinth.com/mod/fantastic-dungoneer/version/TjDQPKML)。项目介绍有随机房间、多层 Boss 房、机关和战利品；实际 JAR 指定 Minecraft 1.21.1、NeoForge 21.1.190+，没有额外依赖。它加入自定义机关，Java 端需对应模组客户端；基岩的资源与机关交互仍待逐项转换验证。
- 车万女仆的 Curios 数据包含 `scroll`、`feet`、`spellbook` 三个当前没有注册的饰品槽位，首次联合起服时出现三条错误。仓内 [`maw_curios_maid_slots`](../world/society-datapacks/maw_curios_maid_slots) 数据包覆盖女仆槽位清单，仅保留已注册项；复测已无这三条错误。Create: Dragons Plus 仍报六条未识别数据映射类型的警告；其具体相关机器交互尚未验收，不把“能起服”视作全功能通过。
- 复用仓内 Numen 0.1.3 源码，`core:neoforge:build` 成功。实服日志注册了 39 个身体工具、16 类任务，并加载女仆联动。此处只证实模组初始化，不等于女仆已经完成农耕、搬运或战斗。
- 新的 `maw_agent` 命令仅限控制台/4 级权限，按 **身体 UUID** 执行 Numen 工具，没有桐人、CortiLan 等姓名特判。`list` 返回每个身体的 owner UUID、身体 UUID、维度、绝对坐标、生命与最大生命；`invoke` 返回 callId 和受理结果；`receipt <bodyUuid> <callId>` 只允许对应身体取回任务终态。对未知结果不得盲目重试。地下城定位的最终回执带结构 ID 与绝对 x/y/z；定位结果中的 y 只是结构搜索定位值，进场前仍需观察地表和寻路。
- 实验性施法 CLI：`maw_agent commands` 返回命令清单及 `legacyMycliParity=false`；`maw_agent spell list <bodyUuid>` 只列该身体**主手真实 Ars 法术书**中已配置且有效的槽位、名称、配方、glyph ID 与原生魔力；`maw_agent spell explain <bodyUuid> ars_nouveau:slot_N` 解释一个已配置法术；`maw_agent spell cast <bodyUuid> ars_nouveau:slot_N` 走 Ars 的服务端施法路径，缺法术书、无效槽位和无魔力能力会拒绝。正魔力花费的法术只有观察到魔力确实扣除才返回 `ok=true`；原生交互返回 `CONSUME` 但没有扣魔力时返回 `ars_cast_not_confirmed`，避免把魔力不足误报为施法成功。回执中 `effectVerified=false` 表示通用 CLI 尚未核查命中、伤害或生成效果，Agent 仍要观察世界事实。不会凭 CLI 凭空授予法术、书或魔力，也不能把 Ars 的复合法术冒称为旧服的单个技能 ID。
- 自动冒烟会启动全新独立进程，查询 Minecraft 状态包核对版本与显示名，召唤两个不同 owner 的测试身体，分别调用 `task_status`；检查 Ars 魔力与真实法术书目录、拒绝无书施法；让 Agent 查阅农夫乐事料理锅、Create 传动轴、Ars 入门法术书、Macaw 屋顶和桥墩的真实合成配方，并分别定位 Dungeon Crawl、YUNG 与 Fantastic Dungeoneer 地下城，收取完整终态与绝对坐标，检查跨身体回执隔离。验证错误工具被拒后遣散两个身体、存档并正常退出。最近一次通过记录在实验目录 `smoke-*.log`，退出码 0。
- 新增模组交互验收：在隔离服测试身体旁临时放置农夫乐事料理锅，以身体执行 `interact_at` 原生右键，再用 `inspect_gui` 读回真实 `CookingPotMenu`、9 个容器槽及机器数据。`interact_at` 的差异回执现在会指出 `opened GUI: CookingPotMenu`，避免 Agent 把成功打开界面误读成“什么都没发生”。测试结束关闭界面、移除临时锅并正常存档；最终通过日志为 `E:\QiandengJiSocietyLab\smoke-1791008821.log`。新版 Numen JAR 已更新到隔离服，旧版备份在 `E:\QiandengJiSocietyLab\snapshots\before-menu-receipt-20261003`。此项只证明模组菜单能打开和读取；食材入锅、烹饪产物与真实食用仍未通过。
- 冒烟对服务端或模组的 `ERROR`/`FATAL` 日志判失败。这个只绑定回环且离线模式的实验服偶有 Mojang 公钥网络抓取失败，脚本单独计为 `offlineKeyFetchWarnings`，不会把它当成模组启动失败；原始日志仍保留。
- 2026-10-03 整服冒烟通过，日志为 `E:\QiandengJiSocietyLab\smoke-1791007439.log`，正常存档退出。实验身体在测试中临时得到写有 `Self -> Heal` 的 Ars 入门书；`list` 与 `explain` 读出了真实 glyph 和 60 魔力消耗，受伤后调用 `cast`，魔力 61.25→1.25、生命 12→16.5；紧接着再施放，Ars 虽返回 `CONSUME` 但没有扣魔力，CLI 正确回报失败。这是隔离服冒烟的临时道具，不意味着真实玩家或 Agent 已免费学会此术。旧 `/mycli` 专项 13 项测试通过；Numen Fabric/NeoForge 构建及 `:ai:test :agent:test :api:common:test :core:common:test` 通过。Numen 全量 GameTest 仍有 4 项失败：三项与蓝图/安全方块实体数据有关，其中安全数据标签明确缺失；`creative_pillar_out_empty_handed` 未完成攀高。失败记录在 `world/numen-src/core/neoforge/runs/gametestserver/logs/latest.log`。这些失败未被忽略，正式迁移前须定位修复并重跑。实际攻击法术命中、地下城房间/战利品和完整 Boss 通关也尚未验收。

## 复建与验收

在本实验分支根目录操作；机器须有 Python 3 和 Java 21。下例的 Python 是当前 Codex 自带运行时，换机时可替换成自己的 Python 3。命令会写入 `E:\QiandengJiSocietyLab`、本工作树的构建目录以及当前用户的 Gradle 缓存；不会修改正式服或系统 Java 安装。

```powershell
$python = 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:JAVA_HOME = 'E:\MC\jdk\jdk-21.0.12.1+1'
& $python -X utf8 tools\society_lab.py prepare --accept-eula
Push-Location world\numen-src
& .\gradlew.bat :core:neoforge:build --no-daemon --console=plain
Pop-Location
& $python -X utf8 tools\society_lab.py install-numen
& $python -X utf8 tools\build_society_bridge.py
& $python -X utf8 tools\society_lab.py verify
& $python -X utf8 tools\society_lab.py smoke
```

`prepare` 首次需要明确接受 Minecraft EULA，后续重复运行不覆盖已有配置。脚本拒绝把源码树、`E:\MC`、`E:\Cortico` 或原项目目录当实验目标；已存在但哈希不符的 JAR 会报错而不是被静默替换。模组和本地构建产物都按版本锁核对，数据包与仓内源文件逐字节核对；若升级其中一个，需重新锁定版本并完成整套冒烟。首次合并新模组前保存的实验世界和旧模组快照在 `E:\QiandengJiSocietyLab\snapshots\before-create-ars-20261003`。

实验服默认关闭。手动临时启动时，在 `E:\QiandengJiSocietyLab\server` 目录执行 Java 21 的 `-Xms512M -Xmx3G @libraries/net/neoforged/neoforge/21.1.248/win_args.txt nogui`，在控制台输入 `stop` 正常退出。它没有公网或 LAN 入口，其他玩家不会误入测试世界。

## Agent 与多端边界

### Mineflayer 与模组操作的实测结论

2026-10-03 在仅绑定 `127.0.0.1:28976` 的隔离服，用现有 Cortico 安装的 Mineflayer 4.37.1、`version: "1.21.1"`、离线测试名 `MawMineflayerQA` 进行了实际登录。服务端在配置协商阶段踢出，原因是 `neoforge.network.negotiation.failure.vanilla.client.not_supported`，要求安装 NeoForge 21.1.248。**因此旧 Mineflayer 不能直接连新服；旧 Paper 千灯纪的 Mineflayer 连接不受影响。** Mineflayer 的[原版版本支持](https://github.com/PrismarineJS/mineflayer)仅说明 Minecraft 协议版本，不等于能完成 NeoForge 协商；上游也有[同类 NeoForge 拒绝报告](https://github.com/PrismarineJS/mineflayer/issues/4097)。换版本号或装旧 Forge `FML|HS` 适配库，不能视为已经解决此 1.21.1 NeoForge 问题。[NeoForge 自定义负载文档](https://docs.neoforged.net/docs/1.21.1/networking/payload/)说明模组还可使用配置期和游玩期专用消息，接入后仍须按模组实现动作与状态解释。

### 复用旧服的 Mineflayer 网关：已完成隔离联机

旧项目 `world/src/neoforge-handshake/` 原来就有可用的“神社之门”：前端接原版 Mineflayer，后端替它完成 NeoForge CONFIG 通道协商，再把区块方块状态与物品网络 ID 映射为原版可读 ID。旧服另有 `world/survival/` 的 NumenGateway 原生身体路径；观察和具身操作是两条不同路径，不能把旧网关误当成所有模组玩法的完整客户端。

本次在新实验模组组合上实际复测：协商探针 4 轮进入 PLAY，学到 459 条通道；网关缓存后 1 轮可入服。Mineflayer 4.37.1 经 `127.0.0.1:28977` 登录、生成身体、收到 90 个区块列，并读到脚下 `sand` 方块。新模组组合的专属号表从**同一套模组的独立诊断副本**导出（额外的只读 `labregistry` 只注册 `/labids dumpids` 命令，不注册方块/物品）：3,975 种方块、4,810 种物品，生成 107,852 条状态映射和 4,810 条物品映射；1,060 个原版方块的状态数全部匹配。旧服的 `idmap.json` 没有被覆盖。

为隔离运行，网关新增 `GATE_LISTEN_HOST`、`GATE_CACHE_FILE`、`GATE_IDMAP_FILE`；本次仅绑定回环，知识缓存和新号表均写在 `E:\QiandengJiSocietyLab\research`。`tools/build_lab_registry_dump.py` 可从当前 NeoForge 库构建只读诊断 JAR，`build-idmap.cjs` 可通过 `MINECRAFT_DATA_DIR`、`IDMAP_DUMP_DIR`、`IDMAP_OUTPUT_FILE` 重建**实验专用**映射。启动网关须设 `GATE_VANILLA=0`，因为这套模组有必需协商通道；冒烟入口为 `world/src/neoforge-handshake/smoke-mineflayer.cjs`。模组清单或版本一变，必须重新导出/构建号表，并重测区块、背包与交互；网关前门目前是离线用户名模式，**不得直接开放局域网或公网**。

本机复测命令（先启动隔离服，配置仍只在当前 shell 生效）：

```powershell
$env:NODE_PATH='E:\Cortico\node_modules\.pnpm\mineflayer@4.37.1\node_modules'
$env:GATE_VANILLA='0'
$env:GATE_NEOFORGE_TIME_BRIDGE='1'
$env:GATE_LISTEN_HOST='127.0.0.1'
$env:GATE_CACHE_FILE='E:\QiandengJiSocietyLab\research\gate-knowledge-28976.json'
$env:GATE_IDMAP_FILE='E:\QiandengJiSocietyLab\research\lab-idmap.json'
node world\src\neoforge-handshake\gate.cjs 28977 127.0.0.1 28976
# 另一个终端：node world\src\neoforge-handshake\smoke-mineflayer.cjs 127.0.0.1 28977
```

此验收只证明 Mineflayer 可以通过网关入服并读取原版可表达的地形。模组方块/物品目前会近似成原版代理物，不能保证 Agent 知道其原始注册名、机器状态或配方；Create、MineColonies、Ars、女仆、地下城机关的自定义负载和 GUI 尚未完成。网关的 NeoForge 协商路径没有收到原版 `update_time` 包，但抓到了每秒一次的 `neoforge:custom_time_packet`。新增的可选 `GATE_NEOFORGE_TIME_BRIDGE=1` 将它按 NeoForge 21.1.248 的真实字段转成原版时间包；实测 6 个自定义时间包对应 6 个 Mineflayer `update_time`，另一轮冒烟收到 3 个。协议解析器对部分模组解锁配方包仍有 `PartialReadError`，不得据此宣称模组配方可用。下一步应把 Mineflayer 用作兼容的网络/移动底座，按玩家 UUID 增加**只读原生语义查询 + 受权限约束的模组动作适配器**，每种玩法按真实前后状态核验；现有 Numen 身体能执行部分原生模组动作，但与一个 Mineflayer 账号合并为同一身体仍待实现。

当前有两条已验证的底座：Mineflayer 经旧服网关可作为原版协议的玩家入服、移动和观察；服务端原生 [Numen 身体](https://github.com/Dwinovo/minecraft-numen) 可操作部分真实模组能力。它们现在是**两个不同的身体路径**，并未统一为同一个玩家 UUID。Agent 的模型/控制器可以继续用现有语言与规划代码；现有 `maw_agent` 仅是 4 级控制台实验入口，按 owner/body UUID 隔离结果，**尚无可交给每个 Agent 的认证 sidecar**。要让 Agent 长期生活，需先完成身份绑定、持久任务回执和故障恢复，再为各模组做“查询状态 → 执行动作 → 独立核验效果”的专用工具。对只能通过客户端画面操作的界面，可另行评估[NeoForge 客户端控制桥](https://github.com/Campione01/MineClient-Bridge)；它在此环境尚未安装或验收，不作为现成方案承诺。

| 内容 | 隔离服已经实测 | 后续验收门槛 |
| --- | --- | --- |
| 原版身体与世界观察 | 双 owner 身份、身体状态、配方、地下城结构绝对坐标 | 多 Agent 常驻、掉线恢复、每人最小权限入口 |
| Ars Nouveau | 真实法术书目录、`Self → Heal` 扣魔力并回血 | 攻击法术目标/命中、法术学习与旧 `/mycli` 完整语义 |
| Farmer's Delight | 真实料理锅右键打开、`CookingPotMenu` 与槽位/数据可读 | 放食材、加热、产出、取出与食用的完整闭环 |
| Create | 传动轴合成配方可读 | 安装机器、动力传递、工作状态与产物读取；逐个专用交互 |
| MineColonies | 模组启动、配方和研究加载 | 建殖民地、读取真实工单、交货、确认居民任务消失 |
| Touhou Little Maid | 联动模块加载、模型工具注册 | 召唤、下达工作、确认女仆搬运/农耕/战斗实际发生 |
| 地下城 | 三类结构定位得到绝对坐标 | 进入房间、识别机关与 Boss、通关及战利品核验 |

实施顺序先做料理锅完整闭环，再做殖民地“缺料 → 生产 → 交货”与 Create 设备，然后才扩展女仆和地下城。每项验收都保留机器可读的失败原因及真实世界前后状态；不能把命令已受理或界面已打开当作产物完成。

`maw_agent commands`、`list`、`summon`、`invoke`、`receipt`、`spell list|explain|cast`、`dismiss` 是目前的实验控制面。例如先调用 `maw_agent invoke <bodyUuid> locate_structure {"structure":"dungeoncrawl:dungeon"}`，保存返回的 `callId`，再查 `maw_agent receipt <bodyUuid> <callId>`；只有 `finalKnown=true` 且 `outcome.success=true`、`data.found=true` 才用 `data.x/y/z`。另两类结构可用 `betterdungeons:skeleton_dungeon` 与 `dungeoneer:cobblestone_dungeon`。入口、房间、怪物、战利品与基岩版呈现尚未逐项实测。**外部 Agent 身份认证、长期调度与故障恢复尚未接入**。不把 4 级控制台口令直接交给每个 Agent；下一步以独立 sidecar 将 token 绑定到单一身体 UUID，再提供每人的只读殖民地需求与受租约约束的动作。

`receipt` 目前只保存在进程内、最多 256 条，重启后无法补取；它解决了当前在线 Agent 的同步/异步结果可见性，尚不是持久任务账本。未知终态只能核对世界事实，不能据“受理”自动重放操作。

排除候选：Not Enough Trials 的 Modrinth 页列出 1.21.1 NeoForge，但下载的 6.4、5.0、4.0 JAR 内 `minecraft` 依赖范围都是 `[1.21,1.21.1)`，不包含本服的 1.21.1。Trial Catacombs 1.1.0 的 JAR 虽声明与 Salinity 1.0.0 相容，隔离服实际启动时报 `NoSuchFieldError: com.salinity.ModAttributes.ATTACK_RANGE`，因此已从运行模组清单移除。这两项不能凭项目页称为兼容。

旧千灯纪的 `/mycli commands|list|explain|cast`、女神技艺、冷却、技能升级和机器 JSON 回执仍在正式服代码与线上服务中，此实验分支没有改动它们；**它们还没有完整移植到 NeoForge 新服**。当前 `maw_agent spell` 是真实 Ars 施法的第一段适配，不是旧 `/mycli` 的全部替代。将来切换服务端前须逐项复现旧技能 ID、查询说明、施法权限/消耗/冷却、Agent 专用结构化回执、手柄及基岩入口，并以实际施法和客户端画面验收。达不到这些门槛就继续保留 Paper 正式服。

MineColonies 自带居民职业、建筑与资源请求；这为社会循环提供世界事实，但目前只验过启动、配方和研究加载，尚未建立第一座殖民地或验证建筑工单、居民工作与 Numen 交互。Create、农夫乐事和 Ars 的标准合成配方已通过 Numen 查询；Ars 自愈与料理锅打开/读取已实测，旋转动力、料理产出和女仆工作还需逐个实操验收。下一条核心闭环是“居民缺材料 → Agent 查询 → 真实交货 → 请求消失”，之后再让 Agent 生产材料与烹饪。

基岩版在此实验服**尚未接入**。后续可用 ViaProxy/Geyser 与逐项注册表翻译，让基岩玩家体验原版可表达的方块、物品和互动；MineColonies、女仆、Create、Ars 的专用 GUI、机器状态、粒子和容器协议不能仅靠改物品名视为已经兼容。Java 真人客户端也需要对应 NeoForge 模组包，且 Create 还需客户端 Flywheel。两端都要在隔离服实际联机验证，再考虑开放入口。当前千灯纪 Paper 的 Java、基岩和 Mineflayer 入口继续运行，不因为此实验改变。
