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

官方流程里，市政厅和建筑工小屋要用 [Build Tool](https://minecolonies.com/wiki/buildings/townhall/) 放置；建筑工会依 [建造单及所需资源](https://minecolonies.com/wiki/buildings/builder/) 工作，物资请求通常由小屋、仓库和快递员处理。Mineflayer 不能直接操作这套 BlockUI。因此新增服务器原生 `maw_agent:colony_query` → `maw_agent:colony_state`，以及带前置条件的 `maw_agent:colony_action`。三者都是可选的 NeoForge PLAY 通道，JSON 为原始 UTF-8，只通过当前玩家连接单播，不进入聊天。`colony-client.cjs` 提供 `attachColonyClient(bot).status()` 与 `.deliver(...)`。网关启动时必须把这三个通道加入 `GATE_EXTRA_PLAY_CHANNELS`。

`status` 不接受任意坐标，只读本人当前所在、128 格内或本人拥有的殖民地，返回殖民地 ID、中心绝对坐标、状态、居民姓名与工作建筑、建筑等级与小屋库存摘要、真实开放请求 token/类型/数量/候选物品、建造单及是否被认领。每次最多 24 行，单包最多 16 KiB；超限明确失败。库存摘要按物品注册 ID 合并，不能代替完整组件检查。请求的 `displayItems[].count` 是展示图标的堆叠数量；实际所需数量看 `requestedCount`。普通访客看不到库存摘要。

`deliver` 要指定 `buildingPosition`、请求 `token`、本人背包槽 0–35、数量及该槽原生 `expectedSnbt`。服务器从连接取得玩家 UUID，只接受 8 格内、本人有成员权限、该建筑仍持有的开放 `IDeliverable` 请求；核对实际背包物品完整组件、数量和请求类型后，沿 MineColonies 原生小屋库存路径存入实际物品，再扣本人背包并尝试原生请求结算。回执带 `accepted`、背包剩余、`requestStillOpen`；物资即使已存入小屋，也可能还需居民领取。客户端看到超时、断线或 `delivery_outcome_unknown_check_inventory` 时，应重查库存和请求，不能盲目重发。在线同一连接最近 32 个 `requestId` 缓存回执以防重复执行；跨断线持久幂等账本仍未做。

实际验收在可丢弃的 `E:\QiandengJiSocietyLab\research\registry-server`（`127.0.0.1:28978`，网关 `28980`）：用**仅存在该诊断副本**的 `maw_colony_lab` 4 级测试夹具建立 ID 1 殖民地（中心 5,64,4）、市政厅与建筑工小屋。这个夹具经 `tools/build_lab_colony_setup.py` 构建，**未安装到主实验服**；它绕过 Build Tool，仅用于构造真实 MineColonies 状态，不能证明 Agent 已会建城。先以模组 API 建立一条诊断用的 16 块橡木板请求：Mineflayer 读到 token 和建筑坐标，故意提交错误 SNBT 得 `inventory_components_changed`、`accepted=0`、背包仍 16；正确交货后 `accepted=16`、背包归零、请求消失。服务端 `data get block 8 64 4` 显示小屋 `inventory` 中有 16 块木板；重启后 `status.buildings[].stock` 仍返回 16。

进一步从已修复蓝图路径的小屋发起真正的建造单：建筑工 Jimmy 认领，`workOrders` 报 `type=build, claimed=true`，本人状态从休息转为工作。他先后亲自提出 `Tool` 型“锄头”和“斧头”需求；同一 Mineflayer 账号分别交付木锄、木斧后，两条真实请求都从列表消失，背包各减 1。木斧交货时重复发送**相同** `requestId`，两次收到完全相同的缓存回执，背包没有再次扣物。至此证明“居民/建筑需求 → Agent 查询 → 本人交货 → 请求结算”的首条完整链成立；尚未完成整座建筑、仓库快递员流转，也尚未把建城的 Build Tool 界面适配给 Agent。

主实验服 `E:\QiandengJiSocietyLab\server` 已更新桥接 JAR 与版本锁，保持停机、无新增对外端口。更新前 JAR 备份在 `E:\QiandengJiSocietyLab\snapshots\before-colony-bridge-20261003`。正式千灯纪 Paper 服未触动。

当前有两条已验证的底座：Mineflayer 经旧服网关可作为原版协议的玩家入服、移动和观察；服务端原生 [Numen 身体](https://github.com/Dwinovo/minecraft-numen) 可操作部分真实模组能力。它们现在是**两个不同的身体路径**，并未统一为同一个玩家 UUID。Agent 的模型/控制器可以继续用现有语言与规划代码；现有 `maw_agent` 仅是 4 级控制台实验入口，按 owner/body UUID 隔离结果，**尚无可交给每个 Agent 的认证 sidecar**。要让 Agent 长期生活，需先完成身份绑定、持久任务回执和故障恢复，再为各模组做“查询状态 → 执行动作 → 独立核验效果”的专用工具。对只能通过客户端画面操作的界面，可另行评估[NeoForge 客户端控制桥](https://github.com/Campione01/MineClient-Bridge)；它在此环境尚未安装或验收，不作为现成方案承诺。

| 内容 | 隔离服已经实测 | 后续验收门槛 |
| --- | --- | --- |
| 原版身体与世界观察 | 双 owner 身份、身体状态、配方、地下城结构绝对坐标 | 多 Agent 常驻、掉线恢复、每人最小权限入口 |
| Ars Nouveau | 真实法术书目录、`Self → Heal` 扣魔力并回血 | 攻击法术目标/命中、法术学习与旧 `/mycli` 完整语义 |
| Farmer's Delight | 同一 Mineflayer 玩家取米、入锅加热、加碗盛装、取出并食用，饥饿值 0→6 | 更多配方、食材生产与长期补货 |
| Create | Mineflayer 放置传动轴与曲柄、右键驱动，原生读取两者转速 0→32 | 压力网络、加工机器、物流与产物闭环 |
| MineColonies | 同一 Mineflayer 玩家读取原生殖民地、居民、建造单与工单；向小屋交付木板、木锄、木斧，真实请求消失，库存重启后保留 | Agent 自行用 Build Tool 建城、施工完成、仓库快递员与多人长期运营 |
| Touhou Little Maid | 联动模块加载、模型工具注册 | 召唤、下达工作、确认女仆搬运/农耕/战斗实际发生 |
| 地下城 | 三类结构定位得到绝对坐标 | 进入房间、识别机关与 Boss、通关及战利品核验 |

料理锅的 Mineflayer 闭环与 Create 基础动力链已完成。接下来做殖民地“缺料 → 生产 → 交货”，再扩展 Create 加工物流、女仆和地下城。每项验收都保留机器可读的失败原因及真实世界前后状态；不能把命令已受理或界面已打开当作产物完成。

`maw_agent commands`、`list`、`summon`、`invoke`、`receipt`、`spell list|explain|cast`、`dismiss` 是目前的实验控制面。例如先调用 `maw_agent invoke <bodyUuid> locate_structure {"structure":"dungeoncrawl:dungeon"}`，保存返回的 `callId`，再查 `maw_agent receipt <bodyUuid> <callId>`；只有 `finalKnown=true` 且 `outcome.success=true`、`data.found=true` 才用 `data.x/y/z`。另两类结构可用 `betterdungeons:skeleton_dungeon` 与 `dungeoneer:cobblestone_dungeon`。入口、房间、怪物、战利品与基岩版呈现尚未逐项实测。**外部 Agent 身份认证、长期调度与故障恢复尚未接入**。不把 4 级控制台口令直接交给每个 Agent；下一步以独立 sidecar 将 token 绑定到单一身体 UUID，再提供每人的只读殖民地需求与受租约约束的动作。

`receipt` 目前只保存在进程内、最多 256 条，重启后无法补取；它解决了当前在线 Agent 的同步/异步结果可见性，尚不是持久任务账本。未知终态只能核对世界事实，不能据“受理”自动重放操作。

排除候选：Not Enough Trials 的 Modrinth 页列出 1.21.1 NeoForge，但下载的 6.4、5.0、4.0 JAR 内 `minecraft` 依赖范围都是 `[1.21,1.21.1)`，不包含本服的 1.21.1。Trial Catacombs 1.1.0 的 JAR 虽声明与 Salinity 1.0.0 相容，隔离服实际启动时报 `NoSuchFieldError: com.salinity.ModAttributes.ATTACK_RANGE`，因此已从运行模组清单移除。这两项不能凭项目页称为兼容。

旧千灯纪的 `/mycli commands|list|explain|cast`、女神技艺、冷却、技能升级和机器 JSON 回执仍在正式服代码与线上服务中，此实验分支没有改动它们；**它们还没有完整移植到 NeoForge 新服**。当前 `maw_agent spell` 是真实 Ars 施法的第一段适配，不是旧 `/mycli` 的全部替代。将来切换服务端前须逐项复现旧技能 ID、查询说明、施法权限/消耗/冷却、Agent 专用结构化回执、手柄及基岩入口，并以实际施法和客户端画面验收。达不到这些门槛就继续保留 Paper 正式服。

MineColonies 的首条真实居民需求闭环已在 Mineflayer 身体上实测，Agent 仍需学会从采集/合成获得交货物品和通过原生 Build Tool 自己建立殖民地。Create、农夫乐事和 Ars 的标准合成配方已通过 Numen 查询；Ars 自愈在 Numen 身体上实测，农夫乐事烹饪产出与食用、Create 曲柄带轴旋转在 Mineflayer 身体上实测。女仆工作仍需实操验收。

基岩版在此实验服**尚未接入**。后续可用 ViaProxy/Geyser 与逐项注册表翻译，让基岩玩家体验原版可表达的方块、物品和互动；MineColonies、女仆、Create、Ars 的专用 GUI、机器状态、粒子和容器协议不能仅靠改物品名视为已经兼容。Java 真人客户端也需要对应 NeoForge 模组包，且 Create 还需客户端 Flywheel。两端都要在隔离服实际联机验证，再考虑开放入口。当前千灯纪 Paper 的 Java、基岩和 Mineflayer 入口继续运行，不因为此实验改变。
