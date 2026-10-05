# My Agent World：隔离服首个可运行切片

2026-10-03—04。此分支 `experiment/agent-society-1.21.1` 用来验证“Agent 在有居民、职业、生产需求和伙伴的世界里长期生活”。**这是独立实验服，当前千灯纪 Paper 正式服不迁移、不停服、不改端口或存档。** 实验运行目录为 `E:\QiandengJiSocietyLab`；所有存档、模组 JAR、日志与缓存留在该目录，不提交 Git。

## 当前已做到

- Minecraft 1.21.1、NeoForge 21.1.248、Java 21，实验服只监听 `127.0.0.1:28976`，显示名为 **My Agent World**。无公网映射、RCON、基岩入口或自动启动。
- Mineflayer 玩家路径已实测殖民地“读取建造单 → 从本人背包补仓 → 原生建筑工完成 1 级小屋”，完工状态重启后保留；也能读取居民健康、饱食度、天气停工和工作 AI 状态。材料由隔离 QA 提供，自主采集/合成及更多建筑仍待验收。下文提供通道、客户端接口与验收边界。
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
- Numen 身体在隔离服能以 `interact_at` 打开农夫乐事料理锅，再用 `inspect_gui` 读回真实 `CookingPotMenu`、9 个容器槽及机器数据；此路径尚未测试入锅与食用。随后另一条 Mineflayer 玩家路径通过原生菜单桥完成了取米、入锅、盛装和食用的完整闭环，见下文。Numen 与 Mineflayer 目前仍是不同身体，不能把两边的能力混为同一 Agent 已获得的能力。
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
$env:GATE_SKIP_MOD_RECIPES='1'
$env:GATE_BRIDGE_COOKING_POT_GUI='1'
$env:GATE_EXTRA_PLAY_CHANNELS='maw_agent:menu_state,maw_agent:menu_action,maw_agent:world_state,maw_agent:world_query,maw_agent:colony_state,maw_agent:colony_query,maw_agent:colony_action'
$env:GATE_LISTEN_HOST='127.0.0.1'
$env:GATE_CACHE_FILE='E:\QiandengJiSocietyLab\research\gate-knowledge-28976.json'
$env:GATE_IDMAP_FILE='E:\QiandengJiSocietyLab\research\lab-idmap.json'
node world\src\neoforge-handshake\gate.cjs 28977 127.0.0.1 28976
# 另一个终端：node world\src\neoforge-handshake\smoke-mineflayer.cjs 127.0.0.1 28977
```

新建存档的入服测试又定位到一个硬缺口：NeoForge 发来的 682,039 字节 `declare_recipes` 包含原版解析器不认识的模组配方序列化器，解析器把它误读为超大数组并停止后续区块解析。实验网关新增可选 `GATE_SKIP_MOD_RECIPES=1`，只在 1.21.1 PLAY 期跳过包号 `0x77`；Mineflayer 随后收到 141 个区块列与 3 个时间包，正常出生。代价是原版配方簿数据缺席；不能用这一开关宣称 Agent 会制作模组物品，配方要另走服务端原生查询。此选项默认关闭，不能套用到其他 MC 协议版本。网关的 NeoForge 协商路径没有原版 `update_time`，`GATE_NEOFORGE_TIME_BRIDGE=1` 将 `neoforge:custom_time_packet` 转成原版时间包。

### 同一 Mineflayer 玩家操作原生菜单：隔离服已验证

2026-10-03 在另一个可随时丢弃的副本 `E:\QiandengJiSocietyLab\research\registry-server`（`127.0.0.1:28978`）测试，网关前门只绑 `127.0.0.1:28980`。原版箱子可以右键打开；农夫乐事烹饪锅实际发 `neoforge:advanced_open_screen`，原版 Mineflayer 不会把它认成窗口。实验网关仅对**已核对的**烹饪锅菜单 ID 25 和标题转换成原版 9×1 容器，保留服务端窗口 ID 与 9 个真实容器槽位。号表生成器也修正了按整个 `farmersdelight` 命名空间匹配 `/light/` 的误判；料理锅现在近似成炼药锅，炉灶近似成熔炉。近似方块只是视觉和基础点击底座，**不是模组注册身份**。

原版协议解析器还会丢弃含模组自定义物品组件的完整容器同步包。实测箱里有 3 颗钻石时，Mineflayer 的普通窗口仍显示空格；网关收到原始 `0x13` 包，但它没有变成可用的 `window_items`。因此新增服务端原生、按连接单播的菜单协议。先在上述隔离副本验收，随后将新版桥接 JAR 构建进**停机中的**主实验服 `E:\QiandengJiSocietyLab\server`；旧 JAR 备份在 `E:\QiandengJiSocietyLab\snapshots\before-native-menu-20261003`。千灯纪 Paper 正式服未改动。主实验服还没有启用网关常驻或开放任何新端口：

- 服务端把当前玩家自己的 `AbstractContainerMenu` 通过 `maw_agent:menu_state` 发为原始 UTF-8 JSON。含 `schemaVersion=1`、`kind=menu_state`、玩家 UUID、`windowId`、真实 `menuType`、`stateId`、按真实槽位排序的 `slots`、手上游标物品。每件物品有完整注册 ID、数量和含组件的 SNBT。登录、开窗及内容变化时发送；变化检查为每 5 游戏 tick 一次。超 64 KiB 会明确发 `menu_state_error`，不会悄悄给过期状态。
- Agent 把 `requestId`、`windowId`、`slot`、`button` 和上次状态里的 `expectedItemId`、`expectedCount`、`expectedSnbt`、`expectedCarriedSnbt` 作为原始 UTF-8 JSON 发到 `maw_agent:menu_action`。服务端从**这条玩家连接**取身份，只允许操作本人正在打开的有效菜单，先核对窗口、目标槽位及手上游标的完整组件，再调用原生 `ClickType.PICKUP`。成功/失败都经 `maw_agent:menu_state` 的 `kind=action_receipt` 私发，内含新状态与明确原因；不进聊天或公屏。每个在线玩家最近 32 个 `requestId` 只执行一次。若点击后状态过大无法装入单包，回执保留操作结果并标记 `stateUnavailable=true`；客户端立即废弃旧快照，避免按旧槽位继续点击。断线或超时后先核对世界状态，不能盲目重放；回执暂未持久化。
- 网关要设 `GATE_EXTRA_PLAY_CHANNELS='maw_agent:menu_state,maw_agent:menu_action'` 才能向 NeoForge 声明这两个**可选**通道。`menu-client.cjs` 的 `attachMenuClient(bot)` 提供 `current()`、`click(slot, button)`、`events`；它自动带完整槽位前置条件与随机 `requestId`，超时不会自行重试。菜单适配是通用玩家功能，没有 CortiLan 姓名特判。

实际验收：一个 Mineflayer 账号从原版箱取 3 颗钻石，放进本人背包，重开箱确认；重复同一个请求没有第二次执行。另一个账号把 `touhou_little_maid:smart_slab_init` 放入箱子再取回，重开后注册 ID、数量与含自定义组件的 SNBT 完全一致。料理锅的原生状态准确报告 `farmersdelight:cooking_pot` 与 9 个容器槽，并读回先前通过原版点击放入的 2 块生牛肉。又让 Agent 从箱子取出 `farmersdelight:rice`，放进另一口由点燃炉灶加热的料理锅；8 秒后第 6 槽出现 `farmersdelight:cooked_rice`。该槽原生 `mayPickup=false`，直接点只得到 `no_change`；Agent 取碗放入第 7 槽，成品转到第 8 槽后才能领取。成品移入背包、重开锅确认已取走；角色饥饿值 0 时用原版使用物品动作吃下，饥饿值升到 6，手里留下碗。即“取原料 → 烹饪 → 盛装 → 取出 → 食用”全部在同一个 Mineflayer 玩家身上通过真实服务端状态验证。新版本状态还给出每槽 `mayPickup` 和料理锅 `slotRoles`（0–5 原料、6 暂存、7 餐具、8 成品、其余玩家背包），避免 Agent 把图标当可取物。Mineflayer 普通窗口仍可能显示空，Agent 应以原生状态为准。隔离副本的 JAR 通过 `tools/build_society_bridge.py --root E:\QiandengJiSocietyLab\research\registry-server --server-dir E:\QiandengJiSocietyLab\research\registry-server` 构建；实际测试的脚本和日志在实验目录 `research` 下。

### Create 机器身份与动力：同一 Mineflayer 玩家已实测

隔离副本里，同一 Agent 的快捷栏确实有 `create:shaft`，但 Mineflayer 的原版 `heldItem` 为空，`bot.placeBlock` 拒绝操作。底层原版 `held_item_slot` 加 `block_place` 仍能让服务端使用该玩家手里的真实模组物品：传动轴放入世界、快捷栏数量 1→0。原版区块映射把轴与曲柄都显示成 `stone`，所以新增按连接单播的 `maw_agent:world_query` → `maw_agent:world_state`，由服务端对**本人当前准星**做 8 格原生射线查询，返回维度、绝对方块坐标、注册 ID、方块属性、方块实体类型以及 Create 动力方块的原生 `speed`、`theoreticalSpeed`、`overstressed` 等状态。没有可见目标就返回失败；不接受任意坐标查询，不发送方块实体 NBT 或隐藏库存。`world-client.cjs` 提供 `look()`、`lookAtBlock()`；如果目标被遮挡，后者返回 `different_visible_block` 而不伪报预期方块。服务器对每个玩家最多每 2 tick 应答一次，不广播。

`native-block-client.cjs` 的 `placeNativeHeld` 先核对服务端私有菜单状态里的真实物品 ID、数量与 `selectedHotbarSlot`，再以该玩家连接发送原版放置包，最后重新瞄准目标并查询服务端原生方块 ID；未知结果不自动重放。隔离服以此放置 `create:shaft`，原生回执为 `create:shaft`、`axis=y`、`create:simple_kinetic`，物品 1→0。随后放置 `create:hand_crank` 于轴上并右键转动；曲柄与从侧面可见的轴均返回速度 32、理论速度 32、未过载。直接从上方查询被曲柄挡住的轴时，服务端只返回眼前的 `create:hand_crank`，证明原生查询不会穿过机器展示下层方块。双玩家同时查询得到了两个不同的玩家 UUID 与各自私有回执。测试产物和脚本仅在 `E:\QiandengJiSocietyLab\research\registry-server`；正式千灯纪未修改。

这证明 Mineflayer 能操作一组真实 Create 方块并读取动力，不等于已能设计、建造、运行完整工厂。应继续实测压力网络、加工配方、物品运输与故障恢复。实验网关须在 `GATE_EXTRA_PLAY_CHANNELS` 额外声明 `maw_agent:world_state,maw_agent:world_query`；公开前门仍必须做按 Agent 身份认证，不能把这个离线测试入口直接开放。更新后的桥接 JAR 已部署到**停机中的**主实验服，旧版备份在 `E:\QiandengJiSocietyLab\snapshots\before-create-world-query-20261003`；`verify` 和整服 `smoke` 通过，后者日志为 `E:\QiandengJiSocietyLab\smoke-1791022969.log`，服务端正常存档退出。6 项相关协议单测通过。正式千灯纪继续运行，未改动。

这完成的是**同一个玩家身体的容器读写与一道料理闭环**，还没有完成所有模组玩法。其他农夫乐事食材生产、Create 加工物流、MineColonies 专用建造界面、女仆命令、Ars 法术书学习与施法、地下城机关，都要逐项用真实模组状态做“查询 → 操作 → 核验”。部分界面不是 `AbstractContainerMenu`，不能仅靠通用菜单通道覆盖。原来的 Numen 身体与这个 Mineflayer 玩家仍是两个身份；今后可把 Numen 原生工具逐步改为作用于当前已认证的玩家，而不能把 4 级控制台入口直接暴露给 Agent。主实验服更新版本锁后 `verify` 与原有整服 `smoke` 已通过，最终日志为 `E:\QiandengJiSocietyLab\smoke-1791017491.log`；测试进程正常存档退出。体检时增加了超大回执的旧状态失效处理，并运行了 3 项协议单测；更新前的 JAR 备份在 `E:\QiandengJiSocietyLab\snapshots\before-menu-size-20261003`。隔离副本还验证了完整游标前置条件：故意提交错误 `expectedCarriedSnbt` 得到私有 `cursor_changed`、`changed=false`，目标槽位未变。

### MineColonies 的 Agent 工单与交货：隔离服已跑通

随后补上受限的原生建造动作：同一个 `maw_agent:colony_action` 通道可处理 `found`、`place_builder`、`request_build`。`colony-client.cjs` 对应提供 `.found(...)`、`.placeBuilder(...)`、`.requestBuild(...)`。前两项要求玩家本人背包有市政厅或建筑工小屋物品、完整 SNBT 与槽位相符、目标在本人 8 格内且位置可放置；建城遵守 MineColonies 的已有殖民地间距及世界出生点距离配置，建筑工小屋还需原生 `PLACE_HUTS` 权限和可放置判定。申请施工需原生 `MANAGE_HUTS` 权限及同一殖民地的建筑工小屋。所有回执只发给本人；这些动作仅覆盖初期两种建筑，不允许任意方块或蓝图路径注入。

另一个隔离账号 `MawColonyFoundQB` 从本人菜单状态取得两件小屋物品的原生 SNBT，经 Mineflayer 连接在 (600,64,600) 建立 ID 3 的 `Agent Village 600`，在 (603,64,600) 放建筑工小屋，两件物品各扣 1，`request_build` 产生 `type=build` 的原生施工单。原版 Build Tool 的 BlockUI 没有被 Mineflayer 模拟；桥接调用的是对应服务端原生建城、建筑登记和施工 API。停服存档并重启后，本人查询仍返回殖民地、两座建筑和施工单。此时没有居民，施工未完；重启后状态返回 `inactive`，与诊断副本中此前已有居民的殖民地相同，不能据此声称已经实现自动建完。测试服夹具 JAR 未复制到主实验服。

官方流程里，市政厅和建筑工小屋要用 [Build Tool](https://minecolonies.com/wiki/buildings/townhall/) 放置；建筑工会依 [建造单及所需资源](https://minecolonies.com/wiki/buildings/builder/) 工作，物资请求通常由小屋、仓库和快递员处理。Mineflayer 不能直接操作这套 BlockUI。因此新增服务器原生 `maw_agent:colony_query` → `maw_agent:colony_state`，以及带前置条件的 `maw_agent:colony_action`。三者都是可选的 NeoForge PLAY 通道，JSON 为原始 UTF-8，只通过当前玩家连接单播，不进入聊天。`colony-client.cjs` 提供 `attachColonyClient(bot)` 的状态、交货与受限建造动作。网关启动时必须把这三个通道加入 `GATE_EXTRA_PLAY_CHANNELS`。

`status` 不接受任意坐标，只读本人当前所在、128 格内或本人拥有的殖民地，返回殖民地 ID、中心绝对坐标、状态、居民姓名与工作建筑、建筑等级与小屋库存摘要、真实开放请求 token/类型/数量/候选物品、建造单及是否被认领。每次最多 24 行，单包最多 16 KiB；超限明确失败。库存摘要按物品注册 ID 合并，不能代替完整组件检查。请求的 `displayItems[].count` 是展示图标的堆叠数量；实际所需数量看 `requestedCount`。普通访客看不到库存摘要。

`deliver` 要指定 `buildingPosition`、请求 `token`、本人背包槽 0–35、数量及该槽原生 `expectedSnbt`。服务器从连接取得玩家 UUID，只接受 8 格内、本人有成员权限、该建筑仍持有的开放 `IDeliverable` 请求；核对实际背包物品完整组件、数量和请求类型后，沿 MineColonies 原生小屋库存路径存入实际物品，再扣本人背包并尝试原生请求结算。回执带 `accepted`、背包剩余、`requestStillOpen`；物资即使已存入小屋，也可能还需居民领取。客户端看到超时、断线或 `delivery_outcome_unknown_check_inventory` 时，应重查库存和请求，不能盲目重发。在线同一连接最近 32 个 `requestId` 缓存回执以防重复执行；跨断线持久幂等账本仍未做。

完整 `expectedSnbt` 可从同一玩家的 `maw_agent:menu_state` 获取：原版背包菜单槽 36–44 对应快捷栏库存槽 0–8，菜单槽 9–35 对应库存槽 9–35；其他模组菜单应按真实槽位映射核对。客户端支持带原 `requestId` 复查同一连接内的缓存回执；断线后幂等缓存不在，必须先重查世界与库存。

实际验收在可丢弃的 `E:\QiandengJiSocietyLab\research\registry-server`（`127.0.0.1:28978`，网关 `28980`）：用**仅存在该诊断副本**的 `maw_colony_lab` 4 级测试夹具建立 ID 1 殖民地（中心 5,64,4）、市政厅与建筑工小屋。这个夹具经 `tools/build_lab_colony_setup.py` 构建，**未安装到主实验服**；它绕过 Build Tool，仅用于构造真实 MineColonies 状态，这条诊断测试本身不证明 Agent 已会建城。先以模组 API 建立一条诊断用的 16 块橡木板请求：Mineflayer 读到 token 和建筑坐标，故意提交错误 SNBT 得 `inventory_components_changed`、`accepted=0`、背包仍 16；正确交货后 `accepted=16`、背包归零、请求消失。服务端 `data get block 8 64 4` 显示小屋 `inventory` 中有 16 块木板；重启后 `status.buildings[].stock` 仍返回 16。

进一步从已修复蓝图路径的小屋发起真正的建造单：建筑工 Jimmy 认领，`workOrders` 报 `type=build, claimed=true`，本人状态从休息转为工作。他先后亲自提出 `Tool` 型“锄头”和“斧头”需求；同一 Mineflayer 账号分别交付木锄、木斧后，两条真实请求都从列表消失，背包各减 1。木斧交货时重复发送**相同** `requestId`，两次收到完全相同的缓存回执，背包没有再次扣物。至此证明“居民/建筑需求 → Agent 查询 → 本人交货 → 请求结算”的首条完整链成立；尚未完成整座建筑、仓库快递员流转，而原版 Build Tool 界面仍未适配；受限的建城接口见上文。

主实验服 `E:\QiandengJiSocietyLab\server` 已更新桥接 JAR 与版本锁，保持停机、无新增对外端口。更新前 JAR 备份在 `E:\QiandengJiSocietyLab\snapshots\before-colony-bridge-20261003`。正式千灯纪 Paper 服未触动。

受限建城版桥接 JAR 已部署到停机中的 `E:\QiandengJiSocietyLab\server`，SHA-256 为 `40347fff1450e21f6da61ecac74efe7e13e6d21e1d3888e9625a7bd08847a58c`；前版备份在 `E:\QiandengJiSocietyLab\snapshots\before-colony-build-20261003`。版本锁 `verify` 和整服 `smoke` 均通过，日志为 `E:\QiandengJiSocietyLab\smoke-1791032544.log`，服务端正常存档退出。建城操作只在隔离副本实际执行；正式千灯纪和对外端口未改动。

### 殖民地启动与施工可观测性：2026-10-03 续验

此前在重启后立即查询到 `inactive`、零居民，是殖民地尚未加载和无人持续在线时的瞬时状态。隔离服让建城账号保持在线后，约 5 秒转为 `active`，约 30 秒产生第一位居民并自动分配建筑工；约数分钟达到配置的 4 位初始居民。白天建筑工提出真实的木镐请求，Mineflayer 玩家从本人背包交付后请求结清。这证明启动、自动招募及首个工作循环可以运行；`inactive` 应结合持续在线后的复查判断，不能单凭登录瞬间判为存档损坏。

`maw_agent:colony_state` 现在给每座建筑增加 `constructionPending`。拥有成员权限时，建筑工小屋再给 `construction.stage`、最多 12 条全局材料记录 `resources[]`、`resourceCount` 和 `resourcesTruncated`。每条材料含物品注册 `id`、名称、`needed`、原生模块报告的 `availableReported`、`inDelivery`。`needed` 随施工消耗变化；`availableReported` 是 MineColonies 模块的缓存值，不能代替实时背包或小屋库存核对。真实回执在 `clear` 阶段列出泥土 151、橡木栅栏 54、石板 16、木板 13、Rack 2 等 11 类材料，稍后降为 10 类；这让 Agent 能先规划采集与合成，而非只等到工人逐项发请求。

MineColonies 的 `getProgress()` 内部游标是蓝图扫描位置，不是世界绝对坐标；桥接只透出阶段，不透出那个游标。建筑 `position`、工单 `position`、居民 `lastPosition` 仍为世界绝对坐标。隔离验收核对建造单持续存在、居民上岗、材料需求被读取，以及 `construction` 不含伪装成世界位置的字段。建筑工仍处于清场阶段，**尚未验收小屋实际完工**，也未证明 Agent 已能自行采集合成全部材料。测试时研究副本观察到一次 Touhou Little Maid 的蜘蛛寻路缓存反射错误（`ClientLevel` 被专用服务器拒载），服务器继续运行且没有反复刷屏；在长期稳定性验收前需复测这项模组兼容性，不把该错误归因于殖民地施工。

这版桥接 JAR 已更新到停机中的主实验服，SHA-256 为 `326e67aef4c128a41d7f14037710ad1f75a3739a937a23b14066d0a76cf9e4c6`，前版和锁文件保存在 `E:\QiandengJiSocietyLab\snapshots\before-colony-progress-20261003`。版本锁 `verify`、整服 `smoke` 和 4 项客户端协议测试通过；整服日志为 `E:\QiandengJiSocietyLab\smoke-1791037336.log`，实验服正常存档退出。研究副本的 Mineflayer 实测返回 ID 3、4 位居民、`constructionPending=true`、`construction.stage=clear` 和实际材料清单。正式千灯纪及公网入口未改。

当前有两条已验证的底座：Mineflayer 经旧服网关可作为原版协议的玩家入服、移动和观察；服务端原生 [Numen 身体](https://github.com/Dwinovo/minecraft-numen) 可操作部分真实模组能力。它们现在是**两个不同的身体路径**，并未统一为同一个玩家 UUID。Agent 的模型/控制器可以继续用现有语言与规划代码；现有 `maw_agent` 仅是 4 级控制台实验入口，按 owner/body UUID 隔离结果，**尚无可交给每个 Agent 的认证 sidecar**。要让 Agent 长期生活，需先完成身份绑定、持久任务回执和故障恢复，再为各模组做“查询状态 → 执行动作 → 独立核验效果”的专用工具。对只能通过客户端画面操作的界面，可另行评估[NeoForge 客户端控制桥](https://github.com/Campione01/MineClient-Bridge)；它在此环境尚未安装或验收，不作为现成方案承诺。

### 建造材料补仓与居民状态：2026-10-03—04 续验

建筑工的 [原生资源面板](https://minecolonies.com/wiki/buildings/builder/) 可以把所需材料直接存入小屋；不必等待每一项都有开放请求。现已为同一 Mineflayer 玩家增加 `colony.stockResource({ buildingPosition, inventorySlot, quantity, expectedSnbt, requestId })`，对应 `maw_agent:colony_action` 的 `kind=stock_resource`。它只接受 8 格内、本人有殖民地成员权限、正在施工的建筑工小屋，核对本人实际槽位的完整 SNBT、物品组件和数量；物品必须仍在该工单的材料需求中，数量不能超过当前需求减去小屋内同组件库存。这个上限不包括工人背包；Agent 应结合原生 `availableReported` 规划，避免重复备料。无法接受的部分保留在玩家背包。

执行沿用 MineColonies 原生库存插入与请求结算，实际扣除接受数量。私有回执包含 `accepted`、`inventoryRemaining`、`neededAtValidation`、`stockBefore/stockAfter`、建筑绝对坐标和 `resolutionError`。同一在线连接最近 32 个 `requestId` 可回放相同回执；断线或 `stock_outcome_unknown_check_inventory` 应先核对原生库存、请求和施工状态，不自动重放。`menu.current()` 每 5 tick 更新，交货后必须等新库存快照再使用 SNBT。状态查询间隔至少 10 tick；`rate_limited` 不是工单消失。材料列表在登录加载、天气停工及原生重新计算期间可能暂时为空，要持续在线后复查；也必须核对回执中的 `colony.id` 和 `member`，因为状态查询优先选择当前位置附近的殖民地。

成员查询的 `citizens[]` 增加原生 `paused`、`asleep`、`saturation/maxSaturation`、`jobStatus`、`loaded`；实体已加载时给 `health/maxHealth`，工作 AI 为枚举时给 `aiState`。不强制加载实体或修改 AI。测试实际区分了 `rain / idle / init` 与 `working / building_step`：默认工人会雨天停工，不能把暂时空材料列表判成库存丢失。`jobStatus` 和 `aiState` 都是模组原始字段，不能只凭 `idle` 推断施工停止。

隔离副本验收中，错误 SNBT、非建材（钻石）和过量提交都被拒绝且没有扣物；4 块橡木板正确入库、背包 16→12，相同 `requestId` 未二次扣除，重启后小屋库存仍为 4。随后通过同一玩家连接补入 Rack 2、泥土 151（64+64+23）、橡木栅栏 54、原版石板、木板、工作台、炉子与火把等材料，建筑工进入 `build_solid` 并实际取用、消耗材料。输入材料由 QA `/give` 提供，不证明自主采集/合成。施工区有水坑，静止测试玩家曾溺水、重生到另一殖民地；保留失败记录后，让观察者远离施工区，只在交货时靠近，并仅在 QA 给观察者水下呼吸、固定晴天和白天。没有修改建筑等级或替工人放置蓝图。

2026-10-04 00:09:12（本机时区），原生服务端触发 `Build a Builder Building` 成就；00:09:14 玩家连接读回 ID 3 的建筑工小屋 `level=1`、`built=true`、`constructionPending=false`、`workOrders=[]`，工人最终为 `idle`。途中短暂的 `inventory_full` 由原生工作流程处理，无需替工人清空库存。为隔离怪物干扰，QA 后半段临时设为和平难度；正式服和主实验服的难度未变。随后正常存档停服、冷启动，同一玩家再次读到 1 级已完工小屋与空工单，工人及余料仍保留。这验收的是一座真实原生小屋，不代表市政厅已完工、完整殖民地运营或自主生产已完成。

新桥接 JAR 已部署到停机中的主实验服，SHA-256 为 `0e80e1d5a2acd0027432167bbb5e0972620636e12422e86d0c3a10a4cce8d774`；更新前 JAR/锁保存在 `E:\QiandengJiSocietyLab\snapshots\before-colony-stock-20261003`。5 项客户端协议测试、版本锁 `verify` 与整服 `smoke` 通过，整服日志为 `E:\QiandengJiSocietyLab\smoke-1791042543.log`。隔离复测脚本为 `research\colony-stock-verify.cjs`、`colony-stock-negative.cjs`、`colony-completion-watch.cjs`；追踪回执为 `colony-current-trace.jsonl`、`colony-completion-trace.jsonl`，冷启动核验为 `colony-after-restart-result.json`，完工原生日志为 `colony-construction-complete-20261004.log`。研究副本和网关已正常退出；正式千灯纪及其公网入口未改。

附加地形诊断中，另一个新账号 `MawColonySiteQC` 从世界出生点被 QA 控制台传送约 850 格后超时，未取得有效区块观察；这个失败未修复或计入通过。近处持续在线、物资交货、建造及冷启动回连已通过，但远距离传送与新账号区块加载还须单独复测网关和 Mineflayer 的解析链，不能据小屋完工宣称所有移动场景稳定。

### 初始模组道具导致断流：2026-10-04 续验

已单独复现并定位上段超时：`MawColonySiteQC` 在远处冷登录时，背包同步 `window_items`（PLAY `0x13`、125 字节）触发 `array size is abnormally large`；后端解析流随后停止，30 秒后原生服务器判定 `Timed out`。同一地区的空背包新账号能接收 402 个区块并持续在线，不能把这个故障归因于传送距离或地形。服务器库存核验发现两项原生组件：女仆初始道具的 `touhou_little_maid:init_maid_owner` 与指南书的 `patchouli:book`，原版物品解析器不知道它们的网络类型。

`tools/build_lab_registry_dump.py` 的只读诊断导出现在增加 `components.tsv`。本模组包实测 183 项，女仆主人 UUID 网络 ID 为 86，Patchouli 书 ID 为 88；这些号只能用于**同一版本、同一模组包**，不能当跨版本常量。诊断 JAR 仍只装在研究副本，不进入主实验服。当前导出另存 `E:\QiandengJiSocietyLab\gateway\components.tsv`，SHA-256 为 `6b730093bffe970690a3d50676f1f0e245a57f999a268fc11bdddd4f13dff388a`。

网关增加可选 `GATE_COMPONENTS_FILE`，读取实际类型表并使用独立的后端物品解析器。依据安装 JAR 的实际 `STREAM_CODEC`，目前专用适配固定 16 字节 UUID 和 ResourceLocation 字符串这两项；只用于背包、槽位、装备、交易、物品粒子及实体物品元数据包，不改变原版前门协议或共享解析缓存。发给原版 Mineflayer 的物品投影不包含其无法识别的模组组件；**服务端真实 ItemStack 不改，完整注册 ID 与组件仍从本人 `maw_agent:menu_state.slots[].snbt` 读取**，授权取放、建造和交货仍核对该原生 SNBT。未适配的新组件明确断连并说明协议原因，不伪造成功库存或留死解析流等心跳超时。其他复杂模组物品（包括 Ars 自定义法术组件）仍需逐项扩展与验证。

沿用上面的隔离网关配置，额外设置：

```powershell
$env:GATE_COMPONENTS_FILE='E:\QiandengJiSocietyLab\gateway\components.tsv'
```

两个全新普通账号 `MawColonySiteQE`、`MawColonySiteQF` 均实测完成：模组自然发放初始道具 → 通过本人原生菜单接口取起/放回女仆道具 → 从出生点传送到 (620.5,62,601.5) → 小幅移动 → 保持在线超过 30 秒并收到 3 次心跳 → 复查完整主人绑定 SNBT 与 4 件初始道具数量完全不变。殖民地查询正确返回 ID 3、`member=false`，已完工小屋仍是 1 级；普通访客没有被授予成员权限。该账号的真实位置可到达，但原版代理把小屋核心近似成 `stone`，仍不能把代理方块名作为模组身份。

保留的限制和失败：恢复解析后的旧 QA 账号曾因原落点在施工水坑上方而溺水，不能把这次死亡当成协议掉线；女仆蜘蛛寻路缓存反射错误再次出现，服务器继续运行。两次新账号传送都出现一阵 `moved too quickly` 与反复位置纠正，随后恢复并完成在线窗口；第二次试用既有 `GATE_SELF_TELEPORT_ACK=1` 没有消除警告，因此不修改默认值，不宣称远距离移动完全稳定。还须单独查收发队列与旧移动包。

6 项新增组件/断连文案回归与既有菜单、殖民地、观察适配回归合计 17 项通过，主实验服版本锁 `verify` 通过；服务器桥接 JAR 没有改变。真实回执保存在研究目录的 `MawColonySiteQE-travel-menu.jsonl`、`MawColonySiteQF-travel-menu.jsonl`，含原生取放结果、组件、旅行前后状态与心跳计数。研究服正常存档停止后，从区域文件导出的 `native-builder-scene.json` 保留 2,978 个原生方块，包含真实小屋、两件储物架和市政厅核心；无缺失区块。这份数据可重建简化体素视图，不能冒充游戏截图或完整模组渲染。

研究服和网关现已正常退出，主实验服继续保持停机；原 Paper 千灯纪及公网端口未改动。自主采集合成、更多原生物品组件、其他殖民地建筑及女仆工作仍待独立闭环验收。

### mc-visual-console 源码准备：2026-10-04

按用户要求，已将 [jcs130/mc-visual-console](https://github.com/jcs130/mc-visual-console) 完整克隆到 `E:\mc-visual-console`，当前为 `main`，提交 `2b0d5e11a9805fa666139f0b42b096ade880251b`。本服采用它作为后续 Agent 画面的源码来源，不将生成的 Minecraft 贴图、客户端 JAR 或浏览器 bundle 提交到 Git。现代渲染器入口为 `packages/modern-viewer/renderer-src`，其锁定依赖已通过 `npm ci --no-audit --no-fund` 在该子目录安装；现有装备、钓鱼、页面与通用技能预设共 11 项源码测试通过。没有运行完整仓库测试，也没有完成新实验服的实时 WebGL 验收。

接入应复用**执行动作的同一个 Mineflayer bot**，由宿主将该连接已经接收到的区块、实体、装备、菜单、生命、天气等数据按 `renderer-src/SOCKET_PROTOCOL.md` 转为 Socket.IO 事件。浏览器入口包含第一人称、第三人称和地下城视角；不能另登录一个新观察账号，便宣称画面和背包属于正在行动的 Agent。页面与宿主的数据桥接是两层，安装依赖或提供静态页面不等于已出现游戏画面。

版本边界已核对：最新可复建导出器与构建器**明确绑定 1.20.6**；仓库中的旧 `packages/modern-viewer/src`、`viewer-service` 记录过 1.21.1 宿主实验，但所需派生资产没有随源码入库，且没有覆盖最新画面合约。新服为 1.21.1 NeoForge，不能把这两段历史拼成“直接支持全部模组”的结论，也不能简单改版本字符串或将 1.20.6 state ID 套到新服。

后续实时适配按以下数据边界推进：

- 方块：以此模组包实际 `blocks.tsv` 的注册名和属性建立渲染表，从对应 1.21.1 客户端与已锁定模组导出模型、贴图。网关当前将部分 Create/MineColonies 方块近似为 `stone`，浏览器不能从这个有损投影反推出原生 ID；须另接账号已收到区块的原生状态流，处理加载、卸载、方块更新和维度切换。只读准星接口仍用于动作核验，不扩大为隐藏区块扫描。
- 物品与窗口：以本人的 `maw_agent:menu_state` 补充真实物品 ID、数量及完整 SNBT，再适配为 `avatarState` / `interactionState`；保留槽位、角色与 `mayPickup`，不把模组菜单图标当作可领取物，也不由前端代理物品名称授权操作。
- 模组状态：Create 转速、殖民地工单与成员权限分别来自本人 `maw_agent:world_state`、`maw_agent:colony_state`。魔力和冷却要接真实服务端状态，缺失时显示未知，不编造恢复；既有通道尚不代表 Ars 技能 HUD 已接通。
- 验收：在独立回环端口上验证真实 WebGL、同账号移动、床/村民/机器显示、原生物品取放及重连；再补健康探针、可管理的起停与故障恢复。当前未启动可视化常驻服务、未修改千灯纪服务或公网映射。

### 原生贴图与建模要求：2026-10-04

用户进一步明确：新服的网页画面必须使用与对应模组 Java 客户端一致的贴图和建模，**禁止原版近似渲染**。兼容协议的代理物品/方块不能作为新画面的渲染依据；未接通的原生渲染应明确报不可用，不静默画成石头或原版生物。静态资源一致、世界数据一致和最终渲染一致须分别验收。Create 动态机械、女仆骨骼动画、Domum 组合材质等不能仅凭复制 JSON/PNG 声称一致。用户随后明确网页也能实现动画，**Three.js 作为优先显示路径**；应移植原始动画规则、材质和真实状态，Java 客户端作为对照。不能因为模组使用 Java 渲染器就直接转去视频串流；其他显示后端须基于实际发现的限制判断。Mineflayer 继续作为 Agent 的操作连接。

诊断导出工具新增 `block-states.jsonl` 与 `entities.tsv`，只在研究副本安装和执行。实测导出 3,975 种方块、107,852 个状态；每个状态保存真实 `stateId`、注册名、属性、`renderShape` 与 `hasBlockEntity`，不推测原版属性顺序。状态表 SHA-256 为 `9a4379ec448a72f4616626769b36a3258317e37eeda6c78c5f3e4e7c78448ad7`。主实验服及 Paper 正式服没有安装诊断 JAR。

`E:\mc-visual-console` 的实验分支 `experiment/native-mod-rendering-1.21.1` 新增 `renderer-src/tools/native_viewer_assets.py`。从官方哈希验证的 1.21.1 客户端、已锁定的 26 件模组/构建 JAR、当前 NeoForge universal JAR 及嵌套库导出 39,058 份资源，原样保存命名空间、模型、UV、贴图、动画元数据和资源覆盖版本。正式候选目录为 `E:\QiandengJiSocietyLab\research\native-viewer-assets-20261004-v2`；初版导出保留供排障，不作为新候选。导出后独立核对原始资源、覆盖版本与注册表共 39,127 个文件哈希通过。

报告中 2,908 种方块的 JSON 模型依赖和面贴图齐全，1,067 种方块保守标记为需要原生/特殊渲染核验；这个分类不是实际渲染通过率。其中 11 处不同来源的同名资源需要核对覆盖或资源栈合并语义，atlas 定义不能只取最后一份。全部原始版本保存在 `asset-variants/`，工具不偷偷选择替代模型。报告的 `renderParityVerified=false`、`complete=false`；`--verify --require-render-parity` 在完整渲染和资源优先级尚未验收时明确拒绝。8 项新导出/校验回归通过，不能据此宣称实时 WebGL 已通过。

为保留兼容投影丢掉的原生身份，网关新增**默认关闭**的按连接镜像：

```powershell
$env:GATE_NATIVE_VIEWER='1'
$env:GATE_NATIVE_STATES_FILE='E:\QiandengJiSocietyLab\research\registry-server\dump\lab-registry-ids\block-states.jsonl'
```

`mcviewer:native_packet` 只向本次玩家连接发送收到的原生核心世界/实体/物品包，并在原版映射和组件投影**之前**序列化。这是 Node 宿主用的独立二进制协议：`MCNP` + `deflateRaw(v8.serialize(envelope))`，单条不超过 1 MiB、解压上限 16 MiB；信封包含版本 1、Minecraft 1.21.1、实际状态表哈希、连续序号、包名及完整参数。`native-viewer-packet.cjs` 的 `attachNativeViewerPackets(bot, expectedHash)` 接在执行动作的同一个 bot 上，提供私有 `packet` 事件；表哈希不符、序号缺失或解码失败时明确标不可用，不继续混入代理数据。它不扫描存档、不加载额外隐藏区块、不另登录观察账号、不广播或写入聊天，也没有开放新网络端口。既有魔力/技能频道的 UTF-8 JSON 格式不变。该镜像保留核心包，不代表 Create 等所有自定义动态负载已经适配。

隔离验收使用普通 `MawNativeViewQA` 连接，原生数据流与普通 Mineflayer 同账号并存。实际观察到建筑工核心 `(603,64,600)` 原生 ID 74628、`minecolonies:blockhutbuilder`、`facing=north`；两件储物架为 75101 / 75095，分别保存朝向和 `blockrackair` / `blockrackfull` 属性，而普通兼容流三者均为 `stone` / ID 1。第一轮 47 秒共收到 402 个区块柱、33,474 个连续原生包，无流错误、生命 20；验收脚本因猜错储物架注册名而失败，原结果仍保留，不能将这条断言失败掩盖为已通过。

按真实注册名 `minecolonies:blockminecoloniesrack` 纠正验收，并补区块卸载处理后，第二次独立回连 47 秒通过：201 个区块柱、31,393 个连续原生包、生命 20、无协议/流错误，上述四件模组方块的原生 ID/属性均读回。额外镜像线流量 7,729,096 字节，当前逐包发送，浏览器宿主仍需按帧合并实体变化并测 CPU/帧率，不能称性能优化已经完成。新协议与既有客户端适配共 20 项回归通过。研究服正常存档退出、网关已关闭；本轮未向 Paper 服发出停启、配置或网络修改操作。当前只完成资源和原生数据接缝，完整浏览器网格、模组运行时渲染、GUI 与实时性能还要逐项验证。

### Three.js 原始模型与动力动画：2026-10-04

`E:\mc-visual-console` 实验分支新增 `renderer-src/src/native-viewer/model-loader.js`、`create-kinetics.js` 和只读网页验收入口。逐文件核对原始模型/PNG 哈希，保留父模型、子级纹理覆盖、原始 UV 和元素旋转。当前 Create 适配锁定本服 6.0.10 JAR，核对实际安装字节码与其提交 `ac0c444d9828da3453ae8cc65338e8de063286fb`：轴依据真实 RPM、轴向与绝对位置的相位规则转动；曲柄加载完整握柄模型，并复现每 tick 四分之一速度追踪与 partial tick 插值。没有把原始握柄简化成木板，也没有从兼容代理的石头状态猜出机器。

首次真实采样因误用区块方块实体坐标字段失败；修正为协议提供的 `x/z` 后，普通账号 `MawWebRenderQA` 收到真实轴 `42909` 和朝上曲柄 `43432`，但第一次转动触发 `world_particles`（包号 `0x29`，68 字节）解码长度错误，被网关明确踢出。该失败记录仍在 `research/create-viewer-capture-1791054474570.json`；它只有正转更新，不能当完整成功。

根因是网关沿用原版粒子注册表和 codec。只读诊断增加 `particles.tsv`，仅在研究副本部署新版诊断 JAR 并导出；原生状态表哈希保持不变。粒子表 SHA-256 `0f82f3bb29200e4d6244c86d330fe665c477ff61c90b6835af5b72c67e84a153`，本服 `create:rotation_indicator` 的实际网络 ID 为 112，不能把 112 当跨包常量。依据安装的 Create 与 Ponder/Catnip 字节码实现 `INT color + FLOAT speed/radius1/radius2 + INT lifeSpan + VarInt Axis.ordinal`。新增可选配置：

```powershell
$env:GATE_PARTICLES_FILE='E:\QiandengJiSocietyLab\research\registry-server\dump\lab-registry-ids\particles.tsv'
```

必须与同一模组包的 `GATE_COMPONENTS_FILE` 配套使用。两种原版 trial-spawner 粒子在 minecraft-data 中的名字与真实注册名不同，已按实际导出名建立明确别名；其余按注册名查网络 ID，不靠旧编号猜。未适配的模组粒子 codec 明确失败。已适配的 Create 粒子原样进入本账号 `mcviewer:native_packet`；原版前门没有等价表达，所以不投影为替代粒子，也不让原版 serializer 接收未知类型。没有广播或聊天副本。当前网页模型预览还没有画这些粒子。

补齐后，普通账号在 (5.5,64,-3.5) 用正常右键、潜行右键转动 (3,65,-2) 的既有曲柄；执行动作与采集原生状态使用同一玩家连接。首次靠近位置由研究服 QA 传送，不能称自主走到机器。第三次独立连接实测 9.640 秒，生命 20、2 件原生方块、10 条动力更新、2 条原生旋转指示粒子，速度集合为 `[-32,0,32]`，无流错误、无踢出。成功记录为 `research/create-viewer-capture-1791055128811.json`；退出时两件机器均收到停止状态。原协议与新增粒子回归共 22 项通过。

```powershell
# 在 E:\mc-visual-console\packages\modern-viewer\renderer-src 执行
node tools/serve-native-create-preview.mjs `
  E:\QiandengJiSocietyLab\research\native-viewer-assets-20261004-v2 `
  E:\QiandengJiSocietyLab\research\create-viewer-capture-1791055128811.json 28982
```

入口仅监听回环，按清单读取资源，并核对 Host/Origin；不接受游戏控制命令或任何管理凭据。真实浏览器显示曲柄与轴共 35 个原始模型面，按钮分别读回 `32/-32/0 RPM`，握柄惯性也使用原始规则。页面明确是“联机记录回放、非完整世界画面”。首版 CSS 造成画布与父容器反复增高，已用绝对定位消除反馈，重新加载后长时间保持视口 400 px、页面 1,134 px；没有把失败页面当成功。6 项模型/动画回归与既有 8 项资源回归通过。

本轮验证了 Three.js 可以承担这组原生机械动画，**还没有验收完整场景光照、所有朝向、实体动画、特殊材质和实时全世界渲染**。不能改写 `renderParityVerified=false`。原生 Minecraft 联机研究服务已正常存档停止，网关已关闭；只读网页模型预览可供本机查看。本轮没有停启、配置或修改原 Paper 千灯纪，也没有更改路由器/防火墙。

### 实时原生世界与普通动作同步：2026-10-04 续验

在前一轮 Create 记录回放之后，`mc-visual-console` 实验分支增加 `native-world-host.mjs`、`serve-native-world-preview.mjs` 与 `world-preview.html/js`。这次页面读取的是**正在联机的同一个 Mineflayer 动作玩家**，不是回放，也不是另外登录的摄像机。原生 `map_chunk`、卸载、单方块/批量变化、方块实体和位置统一进入按连接隔离的世界状态。哈希绑定真实模组包状态表，使用实际维度高度；不读存档或额外加载区块。默认只展示水平 ±10 格、下 5/上 10 格，并报告缺失区块。换维度/重生递增 epoch、清空旧场景；断流/序号缺口明确不可用。

网关的 `mcviewer:native_packet` 增加 `update_time/game_state_change`，NeoForge 时间桥转换出的真实时间包进入本账号原生流；不发送聊天或虚构周期状态。网页以真实世界 age 驱动轴的相位，时间包间按 20 tick/s 插值，并将曲柄的 tick 追踪与浏览器帧率分开。服务器低 TPS、全方向、光照与特效的视觉对照还须验证，不能据此开启完整画面验收标记。

静态方块通过原始模型面实例化绘制。新增普通 multipart 的实际属性条件；石头/沙子的加权变体经过 1.21.1 官方客户端字节码核对：`BlockBehaviour.getSeed → Mth.getSeed` 使用绝对方块位置，`LegacyRandomSource/WeightedBakedModel` 保留 Java 整数溢出和随机序列。不是世界种子，也不是网页随机选图。已核对默认种子的范围只有石头/沙子，模组种子覆盖、UV lock、加权 multipart、染色及特殊 loader 等仍明确拒绝。独立 Java 21 夹具在七组含负坐标/世界边界的位置验证了序列。

真实验收仍在可丢弃的 `research/registry-server`（`127.0.0.1:28978`，网关 `28980`），动作账号 `MawWebRenderQA` 未获得 OP。原生状态先通过曲柄普通右键/潜行右键的 `32/-32/0 RPM` 与真实时间更新；浏览器也看到正反转。普通圆石放置首次失败，服务端私有消息明确为 `com.minecolonies.coremod.permission.no`，未把客户端超时写成通过。给该账号研究城镇 1 `Maw Lab` 的 officer 成员权限后，普通 `placeBlock/dig` 在 `(3,64,-3)` 的原生状态为 `0→14→0`；实际前进同步更新本人绝对位置。没有停用殖民地保护或修改生产服权限。圆石由 QA 控制台提供，不证明 Agent 自主采集合成。

成功记录为 `E:\QiandengJiSocietyLab\research\live-native-world-1791075856948.json` 与 `live-native-world-1791075952328.json`，后一份 `passed=true`、生命 20、原生包序号 6630，夹具标记 `opGranted=false`、`autonomousAcquisitionVerified=false`。前面的三份失败（缺测试物品、放置超时、原生殖民地权限拒绝）仍保留。201 个区块列实际加载；区域约 2,600 个非空气方块中约 2,200 个以原始模型绘制，24 项状态/模型/材质缺口在网页列出，测试区域没有缺失区块。不能把代理画面、未显示的水体或草木当作完整原生场景。

```powershell
# E:\mc-visual-console\packages\modern-viewer\renderer-src；复用此版本依赖。
$env:NODE_PATH='E:\Cortico\node_modules\.pnpm\mineflayer@4.37.1\node_modules'
node tools/serve-native-world-preview.mjs `
  E:\QiandengJiSocietyLab\research\native-viewer-assets-20261004-v2 `
  E:\minecraft-ai-friend-society-lab\world\src\neoforge-handshake\native-viewer-packet.cjs `
  MawWebRenderQA 28980 28983
```

只读本机网页 `http://127.0.0.1:28983/` 提供区域视角/本人视角及未适配列表，无游戏动作或管理凭据接口。宿主应把 `attachNativeWorld` 和 `attachNativeViewerPackets` 挂到**已有动作 bot**，在登录前完成挂载，用本人连接实际注册的维度信息；不可用第二个观察者代替执行者视野。默认保留最多 512 个已经收到的区块列，SSE 合并快照并处理背压，不扩展 Agent 可知范围到未加载存档。

回归通过 16 项网页模型/变体/原生世界测试与 12 项网关原生包/组件协议测试。最终浏览器另验收一次断流：场景清空，包序号/方块数归零，位置、动力与时钟等待新状态、视角按钮禁用；本机预览重启后 SSE 自动恢复同账号的新序号与快照。浏览器没有 warn/error。真实截图保存在 `research/live-native-world-positive-20261004.jpg`、`live-native-world-follow-20261004.jpg` 与 `live-native-world-final-20261004.jpg`；这些私人实测记录、Minecraft 资源和存档不进 Git。主实验服依旧没有开放新公网入口，原 Paper 千灯纪没有停启、配置或路由器/防火墙改动。这里只启动研究副本、研究网关与本机只读预览；不安装全局常驻服务。

**首轮边界：**这次首轮同步验证尚无原生实体、全游戏光照、GUI/背包、染色、水体、动画贴图或网页粒子显示。下面的环境适配进一步补上部分内容。模组自定义方块实体渲染仍需逐项移植；整个场景尚未达到 1:1，`completeSceneParityVerified` 与 `renderParityVerified` 继续为 false。当前检查页不能作为 Agent 完整视觉输入。之前的 Create 静态记录回放入口保持可用。

### 原生环境渲染与区块解码：2026-10-04 续验

隔离研究服更新了注册表导出诊断模块，并补回仓内已有的女仆饰品槽数据包；旧 JAR 与导出目录已留备份。主要实验服的锁定模组清单、Paper 正式服、网络入口都未改。Java 21 编译成功，控制台实际导出 3,975 个方块、4,810 个物品和 107,852 个状态。新增 `solid`、`blocksMotion`、`canOcclude`、`dynamicShape`、`hasOffsetFunction`、原生 `fluid` 属性与静态 `occlusionBoxes`；动态形状或取不到的遮挡不伪装成方块。新的 `block-states.jsonl` SHA-256 为 `039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712`，旧导出哈希不能继续混用。网关 native stream 与网页 assets v3 同时切换到这一原生哈希，兼容动作 ID 表没有替换。

资源新导出到 `E:\QiandengJiSocietyLab\research\native-viewer-assets-20261004-v3`，保留 39,058 份原始资源文件。独立校验核对资源与来源等共 39,127 份文件，完整性通过；资源优先级与全场景渲染验收仍为 false。资源、客户端 JAR、私有参考输出与存档均在 Git 外。

网页继续接 MawWebRenderQA 本人的实际连接，读取真实 CONFIG 群系定义、原生 quart ID 和完整 64 位 hashed seed。适配了八角群系扰动、半径 2 颜色混合、原始草/叶颜色图、已核对的原版颜色提供器与部分植物偏移；未知模组提供器和沼泽噪声染色明确列为未适配。水体读取真实 FluidState 高度及邻居遮挡，移植原版加权角高度、流向纹理 UV、still/flow/overlay 原始纹理与背面规则；不会从兼容的原版代理方块推断水位。

新增原生 UV lock 和 `.mcmeta` 帧尺寸/顺序/时长处理，浏览器通过 GPU UV 选择完整原始 PNG 的帧；插帧按原始整数 RGB 混合、保留当前 alpha。直接调用匹配官方 1.21.1 客户端类核对了 96 组 UV、5 组 64 位种子扰动距离、9 组流向角、5 组真实草颜色与原生液体高度累加。参考工具最初混用了签名客户端类与无签名默认包测试类，失败记录保留；改为独立命名包和专用 classpath 后通过。未以这类数值对照宣称已完成 modded Java 场景验收。

测试发现 prismarine-chunk 1.41.0 对状态位宽硬限 16 位，本包实际需 17 位。网页宿主仅扩展自己的原生区块列解码，保留依赖原样；大于 256 种状态的 direct palette、损坏位宽与长度均有回归。32 项 Node 回归、8 项资源导出回归通过。研究服重连后现场区域 2,615 个非空气方块绘制 2,568 个，实服 6 个水体状态全部生成几何，无未收到区块，WebGL 无报错。随后在研究服 `(8..10,63,4..6)` 建 3×3 小水池、`(7,64,5)` 放原版海晶石，分别用于实时液体更新和原始插帧 shader 检查；这些是控制台提供的 QA 设施，不是 Agent 自主采集/建造证明。

最终实际 WebGL 页面显示 2,616 个非空气方块、2,569 个已绘制方块，小水池及启用插帧的海晶石原始纹理可见，浏览器无 warn/error。日志巡检发现研究服副本漏带已有的 `maw_curios_maid_slots` 数据包，启动出现 `scroll/feet/spellbook` 三条未注册槽位错误；补回仓内原文件并 `reload` 后，Curios 加载 11 个槽位、2 种实体，不再报这三条错误。原失败启动日志保留；Create Dragons Plus 的六条数据映射警告仍在，不称整服全功能通过。

**仍需继续：**沼泽草地噪声、红树苗等偏移、含水方块及模组液体、方块实体、资源覆盖冲突、完整游戏光照/水中雾、原生 atlas UV shrink/mipmap/透明面排序、实体、GUI 和粒子。动画资源加载时钟尚未与 Java 客户端相位同步。网页 `http://127.0.0.1:28983/` 是临时本机只读检查入口，三个研究进程只监听回环，不是常驻生产部署；当前页面仍不能作为已经一致的 Agent 完整视觉输入。

### 自然材料生存试玩与原生合成：2026-10-04

普通账号 `MawWebRenderQA` 通过研究网关 `127.0.0.1:28980` 连接 NeoForge 研究副本 `28978`，动作与网页原生观察继续共用同一条 Mineflayer 连接。该账号沿用研究城镇的 officer 成员权限，没有 OP；本轮没有 `give`、管理传送或创造模式。开局实际生命 10、饥饿 0，背包只有模组自动发放的四件引导道具。既有 QA 机械、水池和城镇设施不是本轮自然建造成果。

本轮实际走到自然红树，清掉挡路的根和树叶，徒手采集并拾取 5 个红树原木。原生世界逐个核对 `(0,65,-7)`、`(0,66,-7)`、`(0,67,-7)`、`(0,68,-7)` 与 `(-1,67,-7)` 变为空气，5 个原木进入本人库存。4 个原木手工合成 16 个红树木板，留下 1 个原木；再合成工作台、木棍、木斧和农夫乐事切菜板。工作台实际放在 `(3,64,-5)`，用其真实 3×3 菜单合成工具与模组配方。将保留的原木放上切菜板、持木斧加工，原生方块实体库存由原木变空，木斧耐久增加，随后本人走近拾取 `farmersdelight:tree_bark ×1` 和 `minecraft:stripped_mangrove_log ×1`。13:14:06 的 `natural_survival_loop_verified` 保存了结果。这是实际生存动作的受控脚本闭环，**没有运行主模型长期自主决策，也不证明全部模组已能自由游玩**。

新增 `world/src/neoforge-handshake/native-crafting-client.cjs` 的 `craftNativeGrid(menu, {ingredients, outputId, outputCount})` 复用本人原生菜单和 `PICKUP` 回执，不依赖被网关跳过的模组配方书。例如在空的本人 2×2 合成栏中，木棍配方可传 `ingredients=[{slot:1,id:'minecraft:mangrove_planks'},{slot:3,id:'minecraft:mangrove_planks'}]`、`outputId='minecraft:stick'`、`outputCount=4`。背包菜单材料/产物槽为 9–44，工作台为 10–45；合成输入分别为 1–4 和 1–9，结果槽为 0。必须由真实服务端计算产物，不重建或猜测 ItemStack。该 helper 对同一菜单加互斥锁，检查玩家 UUID/窗口、完整 `mayPickup[]`、空鼠标物品/空输入、材料数量及空产物槽；保存原始 SNBT，逐次核对回执、数量和组件。只取一次结果，返回 `remainingInputs`，不会把多次合成藏在一次调用里。拒绝、菜单切换、组件变化和未知终态均停止，保留当前世界/库存供检查，不自动退款或重放。重启后的最新权限检查也在实服合成木棍 4 个通过。

试玩发现并修复三个接缝。原生菜单报 `menu_state_error` 后必须清除旧快照，避免用过期槽位继续点击。Mineflayer 强制 `lookAt` 只更新本地旋转，必须等下一 physics tick 发出后再请求服务端视线；同时 `ServerPlayer.pick` 会使用插值的旧/头部渲染旋转，现改为当前身体 `getXRot/getYRot` 与 `level.clip`，保留真实眼高、8 格距离、首个可见方块和遮挡规则。只是把 partial tick 改成 1 仍不足以修复头部旋转延后问题。放置 helper 新增明确的 `verificationOffset`，薄板可使用 `[0.5,0.05,0.5]`；工作台右键打开菜单则返回 `placement_opened_menu`，不拿另一窗口的槽位继续判断。

初次采木被自然根叶遮挡、工作台右键打开 GUI、薄板放置已成功却中心点验证失败等记录都保留。后者通过原生状态及消耗库存确认实际已放置，再走到可见位置检查，没有盲目重复发放或放置。最终用原来的空板移到 `(5,64,-3)`，helper 返回原生 `farmersdelight:cutting_board`、朝南、数量 1→0。一次诊断脚本选错主手为木斧，被 `native_item_not_selected` 拒绝且没有放置；更正本人槽位后才进行新操作。

仅研究副本正常存档停服一次，部署并重启当前旋转修复。旧桥备份为 `E:\QiandengJiSocietyLab\research\maw-agent-bridge-before-native-play-20261004.jar`，SHA-256 `0e80e1d5a2acd0027432167bbb5e0972620636e12422e86d0c3a10a4cce8d774`；研究候选 JAR 为 `80183dd6e983b54613aba40c5ef8999af6ec5b290b1090f6013f814c62a00f8f`。Java 21 编译通过，构建记录指向研究目录；主要实验服 JAR/锁定清单没有同步替换。冷启动后材料、加工产物、工作台与空板都保留。同连接 8 次反向转头再瞄准可见薄板全部读回正确，耗时 4–80 ms，包含本地等待 tick，**不能当整服延迟基准**；此前瞄准工作台时实际藤蔓遮挡的失败也照留。相关菜单/视线/放置/合成及既有组件/原生包回归 37 项全部通过。

网页实验分支补上锁定 Farmer's Delight 1.3.4 的空切菜板原始模型/PNG。只在本人原生方块实体确认空库存时绘制；顶部物品尚未适配，不能将占用板显示成空板。真实浏览器对同一玩家放入去皮原木后列出 `NATIVE_CUTTING_BOARD_TOP_ITEM_RENDERING_UNSUPPORTED` 和原生 ID/数量；空手取回并走近拾取后恢复空板模型，旧空板缓存没有残留。最终页面区域有 2,608 个非空气方块、2,560 个已绘制方块，13 项明确缺口，0 个未收到区块，浏览器无 warn/error。39 项网页原生渲染回归通过。这里仍没有完整 Java 场景对照，`completeSceneParityVerified` 与 `renderParityVerified` 均为 false。

**实际玩法边界：**Mineflayer 普通兼容世界把切菜板映射为 `stone`，其物理/寻路会误认完整方块碰撞；这轮靠本人原生视线、真实手工动作和少量逐步移动走通，不能据此称通用模组寻路已完成。下一阶段须单独导出实际 collision shape 并适配本人 physics/pathfinder；静态 `occlusionBoxes` 是遮挡，不是可直接替用的碰撞数据。持续食材生产/补给、原生实体和 GUI、殖民地自主采集合成交货、女仆工作、多 Agent 常驻及基岩实验入口仍须实际验证。

另只读核查了历史和本轮 13:18:13 再次出现的 `NodeEvaluatorBurningCacher` 报错：车万女仆 1.5.3 在对 `minecolonies:blockhuttownhall` 反射方法时解析到客户端 `ClientLevel` 签名，专用服拒绝该类；源码 catch 会禁用此次缓存并回退原生燃烧判断。它是已记录的优化兼容缺口，本次没有造成研究服退出，但不能称全模组日志零异常。本轮未关闭此优化或修改模组字节码，Create Dragons Plus 的数据映射警告也仍保留。

私有证据保存在 `E:\QiandengJiSocietyLab\research`：`native-survival-harvest-loop-20261004.json`（首次采集/合成/加工）、`native-survival-restart-raycast-20261004.json`（重启及视线/薄板放置）、`native-survival-play-20261004.json`（最终回连、权限合成和画面空/占用转换），以及 `native-survival-play-preview-20261004.png`。资源、存档、完整原生 ItemStack 与私有诊断 stdin harness 不进 Git，也不开放 HTTP 动作执行接口。研究服、研究网关、本机只读网页 `http://127.0.0.1:28983/` 当前供查看，均只监听回环；是临时诊断进程，未安装常驻服务。原 Paper 千灯纪、路由器/防火墙和其他服务未改动。

| 内容 | 隔离服已经实测 | 后续验收门槛 |
| --- | --- | --- |
| 原版身体与世界观察 | 双 owner 身份、身体状态、配方、地下城结构绝对坐标 | 多 Agent 常驻、掉线恢复、每人最小权限入口 |
| Ars Nouveau | 真实法术书目录、`Self → Heal` 扣魔力并回血 | 攻击法术目标/命中、法术学习与旧 `/mycli` 完整语义 |
| Farmer's Delight | 同一 Mineflayer 玩家取米、入锅加热、加碗盛装、取出并食用，饥饿值 0→6；自然采木→本人原生合成切菜板/木斧→切割→拾取树皮/去皮原木 | 更多配方、食材生产与长期补货、原生模组碰撞/寻路 |
| Create | Mineflayer 放置传动轴与曲柄、右键驱动；本轮追加真实漏斗进料、手摇磨石加工及面粉领取 | 更多压力网络、加工机器、物流与自然材料生产 |
| MineColonies | 同一 Mineflayer 玩家建立市政厅和建筑工小屋、发起施工单、读取居民工单与工作状态、按材料清单补仓；原生工人完成 1 级建筑工小屋，冷启动后完工、居民和库存保留 | 自主采集/合成、完整 Build Tool 与其他建筑类型、仓库快递员、护卫与多人长期运营 |
| Touhou Little Maid | 普通玩家使用本人绑定初始召唤道具；本人女仆模式切换、拾取、原生背包取回、成熟小麦收割与重新种植 | 自主获得女仆、长期农田运营、餐食、战斗及实体画面 |
| 地下城 | 三类结构定位得到绝对坐标 | 进入房间、识别机关与 Boss、通关及战利品核验 |

料理锅的 Mineflayer 闭环与 Create 基础动力链已完成。接下来做殖民地“缺料 → 生产 → 交货”，再扩展 Create 加工物流、女仆和地下城。每项验收都保留机器可读的失败原因及真实世界前后状态；不能把命令已受理或界面已打开当作产物完成。

`maw_agent commands`、`list`、`summon`、`invoke`、`receipt`、`spell list|explain|cast`、`dismiss` 是目前的实验控制面。例如先调用 `maw_agent invoke <bodyUuid> locate_structure {"structure":"dungeoncrawl:dungeon"}`，保存返回的 `callId`，再查 `maw_agent receipt <bodyUuid> <callId>`；只有 `finalKnown=true` 且 `outcome.success=true`、`data.found=true` 才用 `data.x/y/z`。另两类结构可用 `betterdungeons:skeleton_dungeon` 与 `dungeoneer:cobblestone_dungeon`。入口、房间、怪物、战利品与基岩版呈现尚未逐项实测。**外部 Agent 身份认证、长期调度与故障恢复尚未接入**。不把 4 级控制台口令直接交给每个 Agent；下一步以独立 sidecar 将 token 绑定到单一身体 UUID，再提供每人的只读殖民地需求与受租约约束的动作。

`receipt` 目前只保存在进程内、最多 256 条，重启后无法补取；它解决了当前在线 Agent 的同步/异步结果可见性，尚不是持久任务账本。未知终态只能核对世界事实，不能据“受理”自动重放操作。

排除候选：Not Enough Trials 的 Modrinth 页列出 1.21.1 NeoForge，但下载的 6.4、5.0、4.0 JAR 内 `minecraft` 依赖范围都是 `[1.21,1.21.1)`，不包含本服的 1.21.1。Trial Catacombs 1.1.0 的 JAR 虽声明与 Salinity 1.0.0 相容，隔离服实际启动时报 `NoSuchFieldError: com.salinity.ModAttributes.ATTACK_RANGE`，因此已从运行模组清单移除。这两项不能凭项目页称为兼容。

旧千灯纪的 `/mycli commands|list|explain|cast`、女神技艺、冷却、技能升级和机器 JSON 回执仍在正式服代码与线上服务中，此实验分支没有改动它们；**它们还没有完整移植到 NeoForge 新服**。当前 `maw_agent spell` 是真实 Ars 施法的第一段适配，不是旧 `/mycli` 的全部替代。将来切换服务端前须逐项复现旧技能 ID、查询说明、施法权限/消耗/冷却、Agent 专用结构化回执、手柄及基岩入口，并以实际施法和客户端画面验收。达不到这些门槛就继续保留 Paper 正式服。

MineColonies 的首条真实居民需求闭环已在 Mineflayer 身体上实测；本轮进一步用上一轮自然采集的木材合成木铲，交给研究城镇 1 的建筑工并关闭其真实需求。受限接口已能让本人建立初期两座建筑，尚未覆盖完整 Build Tool。Create、农夫乐事和 Ars 的标准合成配方已通过 Numen 查询；本轮本人普通 Mineflayer 连接也完成 Ars 自愈和 Create 磨粉，女仆完成拾取及单株收割/重种。下面记录各项真实验收与 QA 材料边界。

基岩版在此实验服**尚未接入**。后续可用 ViaProxy/Geyser 与逐项注册表翻译，让基岩玩家体验原版可表达的方块、物品和互动；MineColonies、女仆、Create、Ars 的专用 GUI、机器状态、粒子和容器协议不能仅靠改物品名视为已经兼容。Java 真人客户端也需要对应 NeoForge 模组包，且 Create 还需客户端 Flywheel。两端都要在隔离服实际联机验证，再考虑开放入口。当前千灯纪 Paper 的 Java、基岩和 Mineflayer 入口继续运行，不因为此实验改变。

### 普通 Mineflayer 本人模组操作：2026-10-04 续验

本轮仍使用研究副本 `127.0.0.1:28978`、网关 `28980`、只读实时预览 `28983`，同一个非 OP 生存账号 `MawWebRenderQA` 执行动作和接收原生世界包。没有另建观战账号或通过 Numen 管理员身体代做。各宿主可复用的接口、准确参数和前置条件见 [MINEFLAYER-MOD-OPERATIONS.md](MINEFLAYER-MOD-OPERATIONS.md)。

新增 `PlayerMaidBridge` / `maid-client.cjs` 和 `PlayerSpellBridge` / `spell-client.cjs`。服务端从发送连接取得真实 ServerPlayer，女仆仅本人已驯服、同维度、已加载且8格内；施法仅本人当前主手真实 Ars 法术书。两组查询、动作及回执均是各连接私有 JSON 自定义负载，无按用户名特判、无需 OP。动作使用请求指纹、组件/选中槽前置条件与短期去重缓存；断线或超时结果未知时不自动重发。缓存只在当前服务端进程内，不能当跨重启的永久交易日志。

| 闭环 | 实际终态与证据 | 材料边界 |
| --- | --- | --- |
| 女仆召唤及搬运 | 使用本人绑定 `smart_slab_init` 真实右键，变为 `smart_slab_empty`，生成本人女仆；开启跟随/拾取后红树根进入真实女仆背包，再从原生菜单取回本人库存。女仆另拾取了拆除机械支撑掉落的泥土 | 初始召唤道具来自此前入服配置，红树根来自上一轮自然采集；不是接口凭空召唤或模拟库存 |
| 女仆农耕 | `touhou_little_maid:farm` 切换后，单株成熟小麦 `age=7→0`，女仆真实 bag 增加小麦1、种子3，收到模组原生农耕进度 | 一株成熟小麦和耕地由研究控制台提供，验证真实收割/重种，不证明长期自然农田生产 |
| Ars 自愈 | 本人主手 Self→Heal 书被真实二进制组件解码；施法前生命10、魔力100，原生执行后生命13、魔力40。饥饿随后会扣血，本人连接独立观察到生命提升。立即再次施法时魔力40、`CONSUME`、实际耗魔0且生命不变，正确回执失败 | 配置过自愈的书是 QA 夹具；尚未验证自然制书、glyph 学习或所有攻击法术。通用回执 `effectVerified=false`，具体治疗由独立血量验收 |
| Create 磨粉 | 玩家放置磨石 `(8,66,-3)`、其下 `facing=down` 曲柄和其上向下漏斗；本人原生漏斗菜单投入小麦1，手摇后磨石实际转速 −32，负载128SU/容量256SU；OutputInventory 出现面粉3、种子1。空手右键领取后输出清空，本人原生库存出现 `create:wheat_flour`×3、种子×1 | 机器、漏斗、小麦与临时泥土支撑由 QA 提供，玩家本人放置/进料/驱动/取物。此配方面粉正常可能为1–3，本轮实际3，不能写为固定配方产量 |
| 自然工具交货 | 上轮自采红树木材合成木铲，普通前进至可交互范围，按实际请求 token 交给研究城镇1建筑工；接受1、本人剩余0、`requestStillOpen=false`。后续库存同步独立确认无木铲 | 本轮木铲未由管理员提供；城镇成员权限和研究城镇来自此前测试。交货不等于整座建筑已完成 |

女仆最初会在召唤约半分钟后触发网关解析失败，定位到原生 `entity_metadata` 中的 `touhou_little_maid:maid_chat_bubble`。原来原版协议遇到未知 serializer 会失去字节边界。新增诊断导出 `entity-data-serializers.tsv`，取 `EntityDataSerializers.getSerializedId` 的实际网络 ID，而非写死257；编译网关后端协议支持 TLM 日程和五种气泡结构。真实119字节失败包完整解码、重新编码逐字相同；修复后当前真实连接已连续完成上述所有动作，没有新增协议失败捕获。原生扩展元数据保留；原版投影仅去掉原版无法表达的自定义字段。

`ars_nouveau:spell_caster` 的实际 STREAM_CODEC 是固定 i32/字符串/布尔/法术槽 map，不能按 NBT 读取。新增独立有界 codec，保留颜色、音效、glyphs及名称。当前空粒子 timeline 书通过原生包与多组件邻接验证；非空 timeline、未知 entity serializer 或粒子仍明确报不支持，不能悄悄丢弃后宣称魔法完整兼容。

实测还确认了两个操作细节：Mineflayer4.37.1 的登录身份在 `bot._client.uuid`，不存在 `bot.uuid`；女仆菜单真正 `close_window` 才解除原生 Brain 暂停。此版本 `hunger` 初始化为0且任务不引用它，不能把它作为女仆没饭吃的判断。原生空背包菜单的最后两槽引用同一 bag index5，按真实菜单操作，不重复统计。

维护工具修复了 `--server-dir` 下仍检查固定28976端口的问题：构建前及安装前读取目标 `server.properties` 的真实 TCP 端口并检查占用。本轮曾在运行时安装遇到 Windows JAR 文件锁，编译成功但当时没有发布；随后正常存档停止研究服、备份旧研究 JAR、重新构建安装并重启。研究桥新 SHA-256 为 `9a5251a3f65bd1b47e2b29ccc3903466f8813b83ada998f5e48528df7107d747`。状态表仍是 `039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712`，没有更改世界 ID 映射。主实验服锁定清单及旧 Paper 两个25565监听进程保持原样。

验证：Java21编译和安装成功；网关/五客户端相关 Node 测试74项全通过，构建端口回归6项全通过。真实连接已超过13分钟、无新增协议失败。实时网页同连接继续收到原生包；区域16项模型/材质缺口被明确列出，未收到区块为0；女仆实体、GUI、完整光照仍未验收，`completeSceneParityVerified=false`。不得把同连接数据成功当作1:1画面已完成。

另有已记录的模组兼容异常：TLM 首次检查附近 MineColonies townhall 的燃烧属性时捕获并打印 `RuntimeDistCleaner: ClientLevel for invalid dist DEDICATED_SERVER`。研究服未崩溃，随后女仆拾取与农耕实测通过；这仍是待定位的模组间兼容缺口，不能说整服日志无错误。网关启动自动学习探针使用原版解析器时也会打印模组命令/物品包解析警告；它与实际动作连接的 backend codec 是两条路径，不纳入普通玩家兼容通过证据。

私有证据位于 `E:\QiandengJiSocietyLab\research`：`mod-play-native-20261004.json`、两份修复前失败记录、`mod-play-protocol-failures-20261004.jsonl` 与 `mod-operations-live-preview-20261004.png`。原始包、完整组件、第三方 JAR、世界存档及诊断动作 stdin harness 不进 Git。新服的基岩接入、旧 `/mycli` 全量移植、原生模组碰撞/寻路、复杂加工与长期自主生活继续列为未验收；本轮只部署研究副本，没有修改旧服、路由器、防火墙、其他服务或新开公网入口。

### 食物、加工状态与攻击施法：2026-10-04 16:50 续验

仍只在原研究副本28978、网关28980与同一普通玩家画面28983执行。动作通过本人 Mineflayer 连接及原生菜单，玩家未授 OP、未用 Numen 身体或管理员传送代做。测试完成前保存研究世界；升级时 `list` 确認在线0，`save-all flush` 正常停服，备份原桥、日志及26.4MB研究世界，才构建与重启。旧 Paper 两个25565监听进程与映射保持原样，主实验服锁定清单未更新。

真实食品闭环：上一轮磨出的 `create:wheat_flour`×3中使用1；铁锭3由QA提供，玩家本人工作台合成空桶。首次转向取水后桶未变化，记录为失败；普通步行/跳跃绕过胸箱与施工边缘，从村外侧水源正常右键取得水桶。原生2×2菜单合成面团1，实际剩余面粉2，空桶留在网格并PICKUP回包。QA再提供熔炉1、煤1，本人正常放置熔炉 `(7,64,1)`、真实菜单进料，200tick烤出面包1。取出并吃下后饱食度8→13、面包剩余0。初次放置未验证成功和私有诊断脚本空槽判断报错均保留，未冒充自然采得铁/石/煤。

`PlayerWorldBridge` 新增准星当前可见磨石的 `block.processing`。input/output使用实际库存和完整SNBT；timer取真实剩余加工工作量；recipeId/duration取本服RecipeManager；RPM、压力与容量只读现有BE缓存。沿用8格、第一命中块与已加载规则，不创建动力网络，不读取管理员存档或墙后机器。无网络时容量/压力为null；超过16KiB明确回执 `world_state_too_large`，不截断组件或把编码异常变为踢人。

用本人女仆上轮真实收割的小麦1，经原生女仆菜单取回后投入原漏斗，第二次完整实测状态序列：

| 时点 | 原生返回与实际变化 |
| --- | --- |
| 空磨石 | `waiting_input`，input/output为空、timer0、0RPM，无网络容量 |
| 小麦入料、未摇 | `waiting_power`，小麦1、timer0，真实配方 `create:milling/wheat`、duration150 |
| 摇动加工 | `processing`，timer146、processingSpeed2、advancing=true，−32RPM、128/256SU |
| 暂停摇动 | `waiting_power`，timer132保留、advancing=false、0RPM |
| 再次持续驱动 | `output_ready`，input空，实际面粉3、种子1、timer0 |
| 空手取回 | 本人原生库存得到面粉3、种子1，机器output清空并回到 `waiting_input` |

`invalid_input/overstressed/output_blocked/ready_to_process` 已实现原生条件，尚未逐个制造游戏夹具验收。测试两次随机产量都为面粉3不改变配方1–3的真实范围。

攻击施法使用QA提供的真实 Ars `Projectile + Harm` 书。原桥先走 `Item.use` 动态分派至服务端 `SpellBook.use`，更新原生书tier/已知glyph奖励；再重读本人主手、组件、槽位、caster、mana和cooldown，只调用一次原生cast。5.13.2服务端use本身返回PASS且不施法；原生validator、费用折扣、Cast/Resolve/Damage取消事件与弹射命中事件仍生效。初次编译因方法解析需要GeoItem失败，改为Item公开方法后Java21构建成功，旧研究JAR未在失败时更换。

普通AI尸壳QA目标 UUID `79ad6914-ed42-45bd-8e5c-7bfc60de28f9`，原生Health20→15.08，客户端目标entity337的damage_event cause/direct均77（施法者entity76的wire+1），魔力100→75、消耗25。私有记录最初把默认5伤害写成15，随后追加明确更正为控制台实际15.08f，原错误不删除。通用回执仍 `effectVerified=false`，实际伤害由独立目标Health及受伤事件验证，不用扣魔替代命中证明。

**该攻击脚本没有自动战斗/撤离循环**：施法后普通尸壳反击并杀死QA玩家，自动重生后又在出生点受击及接触仙人掌死亡一次，记录保留。操作员随后仅清除唯一tag的QA尸壳，没有清除自然怪物、传送或赐予无敌。原连接正常复活，女仆拾取了部分死亡掉落；本人原生女仆菜单取回小麦、桶和攻击书，再普通步行回磨石完成上表。掉落/死亡不是断线，也不证明自主生存通过。出生点危险、模组代理碰撞与宿主战斗反射仍须单独完善。

实体协议新增有界 `ars_nouveau:spell_resolver`、`ars_nouveau:vec3` codec，使用导出名称绑定真实动态网络ID。真实原生弹射entity479元数据保留owner76、`QA Projectile Harm`、完整颜色、原生 `fire_family` 音效、两glyph与timelineCount0；同连接前端保持正常，原生世界序号继续递增。射向空中用于保留弹射实体较长生命周期并捕获元数据，不当作第二次命中。非空timeline与未适配Ars属性粒子仍明确拒绝；网页实体/GUI/特效与完整光照未实现，不能称为1:1画面。

女仆/MineColonies兼容根因已确认：TLM `Class.getDeclaredMethod` 枚举TownHall签名时解析 `ClientLevel/LocalPlayer`，DedicatedServer拒绝客户端类。新增 `TlmMinecoloniesBurningCompat` 在common setup通过TLM原生公开API，对minecolonies namespace的86种方块设置cannotCache，绕过额外反射缓存；不强行设置burning分类、不更改原始危险判断或日志等级。启动实值为86/0 missing API/0 preexisting values；真实女仆继续在城镇旁跟随、农耕及拾取死亡掉落，当前日志未再出现该ClientLevel错误。JVM独立夹具复现旧反射失败，并验证公开opt-out不加载客户端类且burning值仍未知；未额外证明完整避火/所有寻路场景。

本轮Java21研究桥SHA-256为 `8578a55b244f459ef35e27d239eac4167f2ae8bc5c230ed50b4ef1aed109feb5`，状态表仍 `039bd785956b452e7788a8a3a351477536fedf082b6724aceac0a64c580b5712`。87项Node回归、6项构建端口回归、JVM兼容夹具通过。首次Python模块方式执行因tools导入路径失败，改用该测试文件实际入口后6项通过，失败记录保留。

私有新证据：`mod-life-loop-20261004.json`、`server-before-life-loop-20261004.log`、`world-before-life-loop-20261004.zip`、`bridge-before-life-loop-20261004.jar`、`mod-life-loop-preview-20261004.png`；本轮协议失败捕获文件未产生。原食物动作在 `mod-play-native-20261004.json`，后续记录使用独立新文件保留前者。浏览器实机显示2589区域方块、2541绘制方块、17项明确模型/材质缺口、0未收到区块。临时研究连接与预览不构成正式daemon上线；基岩新服接入、旧 `/mycli` 全量迁移、原生碰撞和长期AI生活仍未验收。
# 原生配方、加工闭环与磨石画面（2026-10-05）

本轮已发布到常驻新服：停止前确认 873 对行动意图/结果全部成对、没有在途动作或未完成模型任务；仅归档本轮维护标记。原监督进程仍持有 Java28976→网关28977→MawExplorer及同连接网页28984，健康28985。`world-life`、Agent状态及旧桥冷备份206文件。新桥 SHA-256：`21af20f96767b3806b0f441d5f5406b757852060a681ba227d0e861ea6f33338`，锁清单与运行文件一致。私人 v6 原资源39127文件校验通过；仅桥源哈希改变，贴图/模型字节、注册表与客户端源不变。11项资源优先级冲突及完整渲染/光照/Java参考动画相位仍未验收，完整性和画面一致性标志不混用。

新增有限 Create 配方定义、`block_verify` 与严格加工后置核验，参数见 [MINEFLAYER-MOD-OPERATIONS.md](MINEFLAYER-MOD-OPERATIONS.md)。真实定义、本人魔力/物品组件、原材料投入、生产与拾取分别核对。权限拒绝无变化不再算右键成功；纯查询超时不重投交互，写入后未知结果仍保留暂停门。前端使用原始 `create:block/millstone/block` 外壳与 `create:block/millstone/inner` 齿轮、原UV/PNG；只有齿轮按真实 Speed 转，0和未知严格区别。客户端渲染时钟按本连接生命周期建立，背景/断流/旧原生时间会停动态层；压力颜色、声音、加工粒子与匹配Java客户端绝对相位保持未支持。

独立供料契约 QA 使用研究副本28978、网关28979、同一非OP生存玩家 `MawProcessQA` 与网页28986，未调用LLM或在常驻MawExplorer世界赐物/传送。夹具坐标：砧板 `(518,80,-3)`，锅 `(521,80,1)`，磨石 `(520,82,-3)`，手摇柄 `(520,81,-3)`、漏斗 `(520,83,-3)`。玩家物资由操作员提供，只证明本人连接操作接口可用，不是自主采集或自主生产的成果。

| 流程 | 服务端与本人库存证据 |
| --- | --- |
| 切菜 | 放牛肉1、铁刀切割；板清空时 pickup=false；普通步行拾取后原生碎牛肉净增2，验证器 pickup=true，完整SNBT匹配 |
| 烹饪 | 真实热源、米1、碗4；锅菜单 dataValues 96/100→完成、碗余3、米饭输出1；实际取入库存米饭1，food原组件保留滋养600tick |
| 磨粉 | 漏斗投入小麦1；未驱动时 output核验失败；普通手摇处理、缓冲面粉1；空手取回后面粉净增1、验证器 pickup=true |

本次未出现概率额外面粉或种子，符合锁定配方；完整定义实包审计确认必得面粉1、额外面粉2的逐项25%概率与种子25%。定义查询不会滚随机结果。包内 `executionAvailable=false` 等仍表示未宣称六类全部机器/流体操作可用，不能用单个小麦夹具验收全部Create。

失败记录保留在仓库外：旧殖民地权限拒绝、未加载区域导致夹具未生成和溺水、海水场地/步行越界、验证首次读取撞两tick限流、补大平台覆盖锅热源、启动前身体尚未就绪、诊断脚本错误用Mineflayer窗口替代原生menu ID关闭。修正已加载干燥夹具、有界步行、首读间隔、热源与脚本启动/原生关菜单后完成实测；已取入的米饭没有重新取一次。预先运行wire审计时尚无Create响应的失败也保留，最终4/4通过。脚本错误不能当作服务端拒绝/玩家断线。原生模组碰撞、复杂寻路与长时间无人协助生活仍须独立验证。

验证：后端全部Agent/握手224/224、前端完整433/433、类型检查、Java21全部桥编译、构建端口回归6/6、源API与实包配方审计4/4通过，无跳过。隔离服在完成后由拥有它的监督进程正常存档关闭。常驻三角色就绪、原UUID在线，维护门已归档；模型提供方仍有请求拒绝并退避，未推断Coding Plan总额度用尽，未改模型或使用本地回退。旧两个25565监听、基岩19132和QwenPaw8088的原进程保持，未改路由器/防火墙/公网入口。

私有证据：`research/processing-qa-20261005/result.json`、各attempt失败与console回执、`native-processing-cooking-20261005.png`、`native-processing-millstone-20261005.png`、测试日志与 `native-processing-export-20261005.json`。世界存档、第三方JAR、原始包、完整运行组件及模型凭据不入Git。新服基岩接入、完整旧/mycli玩法、未知实体/物品专用渲染器、流体机器操作与长期自主社会生活仍未验收。
