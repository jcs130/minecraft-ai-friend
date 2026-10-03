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

`maw_agent commands`、`list`、`summon`、`invoke`、`receipt`、`spell list|explain|cast`、`dismiss` 是目前的实验控制面。例如先调用 `maw_agent invoke <bodyUuid> locate_structure {"structure":"dungeoncrawl:dungeon"}`，保存返回的 `callId`，再查 `maw_agent receipt <bodyUuid> <callId>`；只有 `finalKnown=true` 且 `outcome.success=true`、`data.found=true` 才用 `data.x/y/z`。另两类结构可用 `betterdungeons:skeleton_dungeon` 与 `dungeoneer:cobblestone_dungeon`。入口、房间、怪物、战利品与基岩版呈现尚未逐项实测。**外部 Agent 身份认证、长期调度与故障恢复尚未接入**。不把 4 级控制台口令直接交给每个 Agent；下一步以独立 sidecar 将 token 绑定到单一身体 UUID，再提供每人的只读殖民地需求与受租约约束的动作。

`receipt` 目前只保存在进程内、最多 256 条，重启后无法补取；它解决了当前在线 Agent 的同步/异步结果可见性，尚不是持久任务账本。未知终态只能核对世界事实，不能据“受理”自动重放操作。

排除候选：Not Enough Trials 的 Modrinth 页列出 1.21.1 NeoForge，但下载的 6.4、5.0、4.0 JAR 内 `minecraft` 依赖范围都是 `[1.21,1.21.1)`，不包含本服的 1.21.1。Trial Catacombs 1.1.0 的 JAR 虽声明与 Salinity 1.0.0 相容，隔离服实际启动时报 `NoSuchFieldError: com.salinity.ModAttributes.ATTACK_RANGE`，因此已从运行模组清单移除。这两项不能凭项目页称为兼容。

旧千灯纪的 `/mycli commands|list|explain|cast`、女神技艺、冷却、技能升级和机器 JSON 回执仍在正式服代码与线上服务中，此实验分支没有改动它们；**它们还没有完整移植到 NeoForge 新服**。当前 `maw_agent spell` 是真实 Ars 施法的第一段适配，不是旧 `/mycli` 的全部替代。将来切换服务端前须逐项复现旧技能 ID、查询说明、施法权限/消耗/冷却、Agent 专用结构化回执、手柄及基岩入口，并以实际施法和客户端画面验收。达不到这些门槛就继续保留 Paper 正式服。

MineColonies 自带居民职业、建筑与资源请求；这为社会循环提供世界事实，但目前只验过启动、配方和研究加载，尚未建立第一座殖民地或验证建筑工单、居民工作与 Numen 交互。Create、农夫乐事和 Ars 的标准合成配方已通过 Numen 查询；旋转动力、料理设备、实际施法及女仆工作还需逐个实操验收。下一条核心闭环是“居民缺材料 → Agent 查询 → 真实交货 → 请求消失”，之后再让 Agent 生产材料、烹饪和施法。

基岩版在此实验服**尚未接入**。后续可用 ViaProxy/Geyser 与逐项注册表翻译，让基岩玩家体验原版可表达的方块、物品和互动；MineColonies、女仆、Create、Ars 的专用 GUI、机器状态、粒子和容器协议不能仅靠改物品名视为已经兼容。Java 真人客户端也需要对应 NeoForge 模组包，且 Create 还需客户端 Flywheel。两端都要在隔离服实际联机验证，再考虑开放入口。当前千灯纪 Paper 的 Java、基岩和 Mineflayer 入口继续运行，不因为此实验改变。
