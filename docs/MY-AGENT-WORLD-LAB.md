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

| 内容 | 隔离服已经实测 | 后续验收门槛 |
| --- | --- | --- |
| 原版身体与世界观察 | 双 owner 身份、身体状态、配方、地下城结构绝对坐标 | 多 Agent 常驻、掉线恢复、每人最小权限入口 |
| Ars Nouveau | 真实法术书目录、`Self → Heal` 扣魔力并回血 | 攻击法术目标/命中、法术学习与旧 `/mycli` 完整语义 |
| Farmer's Delight | 同一 Mineflayer 玩家取米、入锅加热、加碗盛装、取出并食用，饥饿值 0→6 | 更多配方、食材生产与长期补货 |
| Create | Mineflayer 放置传动轴与曲柄、右键驱动，原生读取两者转速 0→32 | 压力网络、加工机器、物流与产物闭环 |
| MineColonies | 同一 Mineflayer 玩家建立市政厅和建筑工小屋、发起施工单、读取居民工单与工作状态、按材料清单补仓；原生工人完成 1 级建筑工小屋，冷启动后完工、居民和库存保留 | 自主采集/合成、完整 Build Tool 与其他建筑类型、仓库快递员、护卫与多人长期运营 |
| Touhou Little Maid | 联动模块加载、模型工具注册 | 召唤、下达工作、确认女仆搬运/农耕/战斗实际发生 |
| 地下城 | 三类结构定位得到绝对坐标 | 进入房间、识别机关与 Boss、通关及战利品核验 |

料理锅的 Mineflayer 闭环与 Create 基础动力链已完成。接下来做殖民地“缺料 → 生产 → 交货”，再扩展 Create 加工物流、女仆和地下城。每项验收都保留机器可读的失败原因及真实世界前后状态；不能把命令已受理或界面已打开当作产物完成。

`maw_agent commands`、`list`、`summon`、`invoke`、`receipt`、`spell list|explain|cast`、`dismiss` 是目前的实验控制面。例如先调用 `maw_agent invoke <bodyUuid> locate_structure {"structure":"dungeoncrawl:dungeon"}`，保存返回的 `callId`，再查 `maw_agent receipt <bodyUuid> <callId>`；只有 `finalKnown=true` 且 `outcome.success=true`、`data.found=true` 才用 `data.x/y/z`。另两类结构可用 `betterdungeons:skeleton_dungeon` 与 `dungeoneer:cobblestone_dungeon`。入口、房间、怪物、战利品与基岩版呈现尚未逐项实测。**外部 Agent 身份认证、长期调度与故障恢复尚未接入**。不把 4 级控制台口令直接交给每个 Agent；下一步以独立 sidecar 将 token 绑定到单一身体 UUID，再提供每人的只读殖民地需求与受租约约束的动作。

`receipt` 目前只保存在进程内、最多 256 条，重启后无法补取；它解决了当前在线 Agent 的同步/异步结果可见性，尚不是持久任务账本。未知终态只能核对世界事实，不能据“受理”自动重放操作。

排除候选：Not Enough Trials 的 Modrinth 页列出 1.21.1 NeoForge，但下载的 6.4、5.0、4.0 JAR 内 `minecraft` 依赖范围都是 `[1.21,1.21.1)`，不包含本服的 1.21.1。Trial Catacombs 1.1.0 的 JAR 虽声明与 Salinity 1.0.0 相容，隔离服实际启动时报 `NoSuchFieldError: com.salinity.ModAttributes.ATTACK_RANGE`，因此已从运行模组清单移除。这两项不能凭项目页称为兼容。

旧千灯纪的 `/mycli commands|list|explain|cast`、女神技艺、冷却、技能升级和机器 JSON 回执仍在正式服代码与线上服务中，此实验分支没有改动它们；**它们还没有完整移植到 NeoForge 新服**。当前 `maw_agent spell` 是真实 Ars 施法的第一段适配，不是旧 `/mycli` 的全部替代。将来切换服务端前须逐项复现旧技能 ID、查询说明、施法权限/消耗/冷却、Agent 专用结构化回执、手柄及基岩入口，并以实际施法和客户端画面验收。达不到这些门槛就继续保留 Paper 正式服。

MineColonies 的首条真实居民需求闭环已在 Mineflayer 身体上实测，Agent 仍需学会从采集/合成获得交货物品；受限接口已能让本人建立初期两座建筑，尚未覆盖完整 Build Tool。Create、农夫乐事和 Ars 的标准合成配方已通过 Numen 查询；Ars 自愈在 Numen 身体上实测，农夫乐事烹饪产出与食用、Create 曲柄带轴旋转在 Mineflayer 身体上实测。女仆工作仍需实操验收。

基岩版在此实验服**尚未接入**。后续可用 ViaProxy/Geyser 与逐项注册表翻译，让基岩玩家体验原版可表达的方块、物品和互动；MineColonies、女仆、Create、Ars 的专用 GUI、机器状态、粒子和容器协议不能仅靠改物品名视为已经兼容。Java 真人客户端也需要对应 NeoForge 模组包，且 Create 还需客户端 Flywheel。两端都要在隔离服实际联机验证，再考虑开放入口。当前千灯纪 Paper 的 Java、基岩和 Mineflayer 入口继续运行，不因为此实验改变。
