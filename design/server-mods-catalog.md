# 服务端能力增强组件·选型实录

> 2026-08-20 天神亲笔。铁律：**纯服务端 only + bot 验收**（客户端零 mod 依赖）。
> 服务器：NeoForge **21.1.73**（1.21.1），`deepseek-harness/scratch-plugin/mc-server-neoforge`。
> 本文件取代已佚的旧 catalog，为此话题的唯一正典。

## 在役（12 jar，2026-08-20 13:14 全绿，Done 1.667s，Goddess+Kirito 双使在线）

| 组件 | 版本 | NeoForge 门槛 | 用途 | 落地日 |
|---|---|---|---|---|
| settlements | 1.0.0-beta.1 | — | 聚落生成（自研） | 08-19 |
| GriefLogger | 1.2.6-1.21.1 | `[3,)` | **史官之目**：方块审计回溯（谁破坏/放置/开箱），SQLite database.db | 08-20 |
| architectury-api | 13.0.11 | — | GriefLogger 依赖 | 08-20 |
| supermartijn642-configlib | 1.1.8-mc1.21 | — | GriefLogger 依赖 | 08-20 |
| Chunky | NeoForge-1.4.23 | — | **全图之足**：预生成（已用于迁入点 [1750,-850] r24） | 08-20 |
| Clumps | 19.0.0.1 | `[4,)` | 经验球合并（XP 农场防实体爆炸） | 08-20 |
| ModernFix | 5.27.20+mc1.21.1 | `[21.0.111-beta,)` | 加载提速 + 内存优化 | 08-20 |
| spark | 1.10.124 | `[20,)` | 性能剖析（卡顿归因） | 08-20 |
| Lithium | 0.15.4+mc1.21.1 | mc `[1.21,1.21.1]` | **性能主力**：实体/方块 tick 优化（radium 的官方上位，二选一勿同装） | 08-20 二批 |
| Alternate Current | 1.9.0 | neo `[21.0.0-beta,)` | 红石更新算法（更省更稳） | 08-20 二批 |
| Noisium | 2.3.0+mc1.21-1.21.1 | neo `>=21.1.22` | 世界生成噪声优化 | 08-20 二批 |
| In Control! | 1.21-10.2.7 | neo `[21.0,)` | **刷怪法则引擎**：spawn/loot/xp/事件规则 JSON 化 | 08-20 二批 |

## In Control 首役：聚落禁怪（2026-08-20 生效）

- `config/incontrol/areas.json`：两圣域 box——`hearth`（聚落 [1600,-896] ±100）、`newtown`（迁入文明区 [1750,-850] ±80），y 全高。
- `config/incontrol/spawn.json`：`{area, hostile:true, result:"deny"}` ×2——只拦**自然刷怪**；被动生物与神迹 `/summon` 不受影响。
- 语法正典：mcjty.eu/docs/mods/control-mods/control-mods-20（+`-table` 条件总表）。`area` 是**单字符串**条件（非列表）。
- **reload 坑**：RCON 直发 `incontrol reload` 报 "A player is required"——须 `execute as Goddess run incontrol reload`。
- 启动时若 `config/incontrol/` 目录不存在会报 "Error writing areas.json!"（无害）；建目录放好文件后 reload 即净读。

## 勘误：第四定律（2026-08-20 破而后立）

- **旧说**（Guard Villagers 事故推断）：mods.toml 依赖 `side="BOTH"` = 客户端 mod = 踢 vanilla bot。**此判据废**。
- **实证**：在役的 Chunky/Clumps/ModernFix/spark/settlements 乃至二批四件**全标 BOTH**，而双 vanilla bot 畅通无阻——`side` 是 NeoForge 模板默认值，不说明任何问题。
- **新判据**：mod 若**注册新注册表项**（实体/方块/物品/创意标签）或开网络通道，vanilla 客户端在 registry 同步时被踢（Guard Villagers 注册了守卫实体，故踢）。纯逻辑/内存/生成优化 mod（Lithium/AC/Noisium 类）零注册 → 天然 vanilla-safe。
- **验收铁律不变**：装 → 重启 → 看 `Done` 时间 + `list` 双使在线。实证高于一切静态判读。
- versionRange 门槛（knot 教训）依然有效：装前读 `META-INF/neoforge.mods.toml` 的 versionRange。

## 落选与教训

- **Guard Villagers 2.4.10（08-20 撤）**：注册守卫实体 → registry 同步踢 vanilla bot。撤 jar 1.1s 恢复。归类为「注册表型 mod」，与性能型区别对待。
- **knot 9.1.0 + yaml-config + GriefLogger 1.2.10**：knot 门槛 `[21.1.219,)` > 我方 21.1.73 → 启动即崩。降 GriefLogger 到 1.2.6 过。
- **ferrite-core 7.0.3**：neoforge 门槛 `[21.1.218,)` > 73 → 弃（ModernFix 已覆盖其场景）。**若他日升 NeoForge 平台版本可复取**。
- **radium**：lithium 官方出 neoforge 版后无存在必要（同算法二选一）。
- **villageroptimizer / async-locator**：无 1.21.1 构建或不支持。
- **threadtweak / c2me / vmp**：Fabric 专属，与 NeoForge 无缘。
- **村民自主行为不自外求**：Guard Villagers 类实体 AI mod 皆注册表型；千灯界走自研 routine_loop（mc_npc.py，零 LLM 零 mod，2026-08-20 上线）。

## 候补席（已验存在、按需启用的能力）

- **BlueMap 5.7-neoforge**（5.3MB）：3D 舆图 web 服务，可接 web-panel。**顾虑**：渲染吃 CPU（与 27B LLM 争粮），且已有自研 2D 舆图 :9090。需要时再启。
- **KubeJS 2101.7.2**：服务端脚本引擎（事件/合成/刷怪），但自研 RCON+datapot 管线已覆盖，暂不引入复杂度。
- **LuckPerms v5.4.140**：权限组。当前玩家少且全 op，无用武之地。
- **Open Parties and Claims 0.30.1**：圈地保护。千灯界土地归神律，暂不需要。
- **ServerCore 1.5.19**：与 Lithium 功能重叠，克制不叠。
- **Terralith / Towns & Towers（datapack）**：世界生成增强。**仅新世界**可用（旧图新区块生效），留作迁界备选。

## 运维备忘（2026-08-20 二批增补）

- 启动：`start-neoforge.bat`（一次性启动，**无守护**）。RCON：`python D:\ops\rcon.py "<cmd>"`。
- **JVM 已调**：`user_jvm_args.txt` 上 Aikar 式 G1 全套（Xmx4G/Xms2G 不变 + G1NewSizePercent=30 等 17 flags，`.bak-0820b` 备份在侧）。
- **server.properties 已调**：`sync-chunk-writes=false`（SSD 上省 IO 大项）。view/sim 皆 8 已属克制。
- **旧界截胡事故（08-20）**：服崩溃后端口被旧 vanilla 服抢占——stop 后**秒级重启**抢回 25565。
- 大 jar（>10MB）从 Modrinth CDN 下载常断：用 Range 断点续传（`D:\ops\resume_gl.py` 法）。
- 二批调研脚本存档：`D:\ops\probe_mods2.py`（候选扫描）、`D:\ops\fetch_batch2.py`（下载+门槛验）、`D:\ops\modstaging\`（jar 暂存）。
