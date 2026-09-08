# 当前世界生成与探索内容审计

审计对象：`D:\Projects\QiandengJi`，Minecraft 1.21.1 / NeoForge 21.1.248，2026-09-07。仅检查文件、JAR 内数据和字节码；未生成新区块、未加载历史 NPC 区域、未改模组或原始 C 盘世界。完整 ID、配置快照与 JAR SHA256 见 [worldgen-audit.json](D:/Projects/QiandengJi/reports/worldgen-audit.json)。

**当前已有 10 个新增群系、457 个模组结构定义和村庄酒馆注入，探索内容并非空壳；没有接入的主要是另一套历史世界的地形包，以及中式村落风格分区计划。** 结构定义数包含变体和可选联动，不等于当前地图已有 457 个地点，也不保证每项都会自然生成。

## 主世界与 10 个新增群系

实际 [level.dat](D:/Projects/QiandengJi/server/mc/shadow/level.dat) 的主世界是 `minecraft:noise`，噪声设置 `minecraft:overworld`，群系源 `minecraft:multi_noise`、preset `minecraft:overworld`；不是平坦或固定群系。Spawn 4.0.7 的 Mixin 会向该原版入口加入群系，因此不能仅凭 preset 名字判断为纯原版群系。

下表全部来自现役 `spawn-4.0.7-1.21.1.jar` 的 `data/spawn/worldgen/biome/*.json`，并核对了实际生成字节码和 structure/structure_set。

| 群系 ID | 生成入口 |
|---|---|
| `spawn:ant_gardens` | 常规主世界气候分布：近内陆，温度索引 3、湿度索引 2、侵蚀索引 3 |
| `spawn:rocky_shore` | 常规海岸替换：较暖且较湿的海滩条件 |
| `spawn:deep_warm_ocean` | 常规最暖温区的深海条件 |
| `spawn:seagrass_meadow` | 常规沿岸气候带，温度 0.24–0.35、大陆性 -0.355–-0.17 |
| `spawn:cold_island` | `cold_island` 结构，在 deep_cold_ocean 中生成并设置岛屿群系 |
| `spawn:dodo_island` | `dodo_island` 结构，受 `#spawn:dodo_island_generates` 限制 |
| `spawn:sandy_island` | `sandy_island` 结构，在 deep_lukewarm_ocean 中生成 |
| `spawn:tide_pool` | `tide_pool` 结构，在 deep_cold_ocean 中生成 |
| `spawn:tropical_island` | `tropical_island` 结构，在 Spawn deep_warm_ocean 中生成 |
| `spawn:volcanic_island` | `volcanic_island` 结构，在 Spawn deep_warm_ocean 中生成 |

前 4 个入口由 `com/ninni/spawn/mixin/OverworldBiomeBuilderMixin.class` 证实；后 6 个由各结构的 `island_biome` 字段，以及 `BaseIslandPiece.generateIsland → setIslandBiome → setIslandBiomeForChunk` 证实。后 6 个并非普通噪声分布群系，但会随对应岛屿结构自然生成，不能当作 6 个遗留空定义。

维度仍保留原版下界、末地，以及两个功能维度：女仆法术 `the_retreat` 使用固定 cherry_grove；铁魔法 `pocket_dimension` 使用 the_void 空平坦生成器。后两者不能算成两套丰富的探索世界。当前没有 Terralith、Tectonic、Nullscape 的地形/群系替换。

离线读取了 18 个区域的 128 个已保存区块：其中 120 个尚未到群系生成阶段，默认 plains palette 不代表真实地形；仅 5 个是 full 状态。因此这份抽样不用于计算群系占比，也不能证明新增群系已被玩家探访。没有发送 locate、teleport 或区块加载命令。

## 实际已有的探索结构

统计范围为当前 69 个服务端顶层 JAR；另检查 107 个嵌套 JAR，没有额外群系、结构或维度定义。NeoForge 的 `c:` 群系标签也纳入解析，避免把公共标签误判为缺失。

| 内容来源 | structure 定义 | structure_set 定义 | 说明 |
|---|---:|---:|---|
| Abridged | 1 | 1 | Lithostitched 委托式桥梁生成 |
| ATi Structures | 55 | 6 | 城堡、地下城、营地、旅馆等 |
| Chinese Flying Island Tower | 1 | 1 | 中式悬空建筑 |
| When Dungeons Arise | 40 | 2 | 大型地牢、营地、探索建筑 |
| Iron's Spellbooks | 9 | 9 | 魔法主题探索结构 |
| Japanese Castle | 1 | 1 | 日式城堡 |
| Japanese Offering Shrines | 2 | 2 | 神社变体 |
| Japanese Temple | 1 | 1 | 日式寺庙 |
| Moog's Voyager Structures | 128 | 113 | 营地、遗迹及小型环境结构 |
| Spawn | 8 | 8 | 6 类岛屿/潮池、蚁丘、海底 octopolis |
| Towns and Towers | 60 | 3 | 村庄、前哨与其他建筑，含可选联动变体 |
| Touhou Little Maid Spell | 12 | 12 | 女仆法术主题地点 |
| Trek | 139 | 21 | 主世界、下界、末地及地下怪物房变体 |
| **合计** | **457** | **180** | 另有 1,059 个模板池、94 个 configured_feature、76 个 placed_feature |

`village_taverns` 另有 5 个 NBT 酒馆模板，通过 [villages.json](D:/Projects/QiandengJi/server/mc/config/village_taverns/villages.json) 注入原版沙漠、热带草原、平原、针叶林、雪原村庄房屋池，每项 weight=10、limit=1。它没有独立 structure JSON，不能因此误判为未接入。

当前范围未发现重复的结构/结构集/群系定义 ID；这不等于不存在空间重叠。多个模组都覆盖平原、村庄和遗迹，只有各自放置约束，并没有历史“每个建筑风格独占一片群系领地”的完整整合层。

## 已启用、可选空项与配置边界

最新落盘 `level.dat` 已启用 `vanilla`、`mod_data`、`file/spellbooks`、`file/qiandeng_fixes`。bundle 与 trade_rebalance 未启用。当前不存在某个遗漏启用的地形数据包目录。

- Cristellib、原版结构、Towns and Towers 的结构开关均未发现 false；`disableAutoConfig=false` 表示未禁用自动配置。Moog 的空覆盖表和 `disabled_structures=[]` 表示采用既有规则，并非生成内容留空。
- Spawn 相关生态配置保持启用；`spawn_egg_tab=false` 只是创造菜单选项。主任务通过 RCON 确认 `doMobSpawning`、`doPatrolSpawning`、`doTraderSpawning` 均为 true；服务端 easy，`generate-structures=true`。
- [InControl spawn.json](D:/Projects/QiandengJi/server/mc/config/incontrol/spawn.json) 仅在名为 village 的指定安全区禁止敌对生物和幻翼，并非全世界禁止怪物。区域定义见 [areas.json](D:/Projects/QiandengJi/server/mc/config/incontrol/areas.json)。
- Towns and Towers 当前 villages spacing=51/separation=12，outposts spacing=48/separation=12/frequency=0.2，other=32/16。Dungeons Arise 的两组间距为 50/45 与 45/40，均为有效非零值；不能把城镇较疏等同于结构关闭。

**确切的可选空项：** 静态解析发现 Towns and Towers 的 17 个 `exclusives/*` 结构群系候选为空；相应标签只列 `required:false` 的 Terralith、Biomes O' Plenty、Regions Unexplored、Wythers 等外部群系。当前没有这些群系，这是可选联动不生效，不是依赖崩溃，也不应为了“全开”盲目覆盖标签。其余该模组 43 个结构定义仍有候选群系。

Dungeons Arise 的 `mining_system_biomes.json` 自带 `values:[]`，且 `mining_system` 没有 structure_set 引用，是明确不自然放置的遗留定义。总计有 11 个结构定义没有顶层 structure_set 引用，详见 JSON 清单；可能为备用/程序调用，不能全部定性成故障。457 个定义中有 438 个解析到群系候选、18 个为空、1 个委托式结构；这只是生成前置条件检查，未声明实际世界地点已生成。

## 确认未接入的历史内容

来源必须区分：当前导入的是 C 源 `ops/docker/shadow/mc/shadow`；以下 ZIP 位于另一套 [mc-server/world/datapacks](C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/mc-server/world/datapacks)，没有启用于当前 shadow 世界。

| 历史包 | 当前状态 / 补齐边界 |
|---|---|
| Terralith 2.5.8、Tectonic 3.0.25 | 当前未装；不能把旧 ZIP 当作当前存档原有地形直接补回 |
| Nullscape 1.2.14 | 当前未装；末地仍为原版生成器，叠加 Trek 等结构 |
| Structory 1.3.7、Structory Towers 1.0.17 | 当前未装；属于额外探索结构候选，不是当前启动缺失依赖 |
| Dungeons and Taverns 4.4.4 | 当前未装；与现役 When Dungeons Arise 是不同内容包 |
| EpicVillages 1.3.3 | 当前未装；pack_format=15，不能按文件存在认定是本服 1.21.1 的合格包 |
| t_and_t-datapack-1.21.1.zip | 当前已有 Towns and Towers JAR；不要再叠加历史同名数据包 |

旧包可能含版本 overlays；JSON 保存了 pack.mcmeta、SHA256 和顶层定义计数，未仅靠文件名判断完整兼容性。没有下载或安装任何新增包。

历史 [goddess-skill-intervention-design.md](C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/docs/goddess-skill-intervention-design.md:252) 明确规划过中式徽派、毡房、干栏、石窟、园林等分区，且有 [zzz-style-territories](C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/docker/datapacks-src/zzz-style-territories/README.md) 覆写源码。但当前模组/数据命名空间中 `mcs`、`chinesevillage`、`peakscape` 均不存在。这个覆写包依赖它们的模板池，不能单独复制就宣称分区功能恢复。现有中式悬空塔与日式建筑包不能替代整套中式村落依赖。

RoadWeaver、settlements、settlementsfix 被明确列入 [ops-manual.md 的退役列表](C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/docs/ops-manual.md:108)，对应旧 JAR 保留在源目录 mods-disabled。当前 `config/roadweaver` 留存不代表自动铺路正在运行；Macaw's Paths 是建筑方块，也不等于 RoadWeaver 自动道路。历史性能记录已有 RoadWeaver 空闲生成负担，不能按“补遗漏”直接恢复。

## 最小处理与当前完成项

本轮应先修复当前探索链上已证实损坏的资源，保留旧世界生成规则。主任务已通过独立 `qiandeng_fixes` 修复 Spawn 蚁丘掉落、女仆法术暗影刺客掉落，以及 WDA 两个探索进度；当前 [content-fixes-smoke.json](D:/Projects/QiandengJi/reports/content-fixes-smoke.json) 7 项检查通过并记录物品/进度清理。该验证证明掉落表可执行、进度已注册，不冒充自然击杀或实际遗迹探索。

随后应整理现有可探索地点与群系的说明，让玩家知道哪些由普通地形生成、哪些依赖岛屿结构、哪些风格尚缺上游包。若以后继续中式风格分区，先明确恢复目标、补齐对应原作者内容及模板池，再在独立新世界验证分区与现役结构碰撞；不直接套用旧文档里的删世界流程。

广域地形/群系包属于后续独立选型，先在同种子测试世界评估 Spawn 入口、旧新区块边界、村庄密度和性能。本轮没有改种子、维度、地形、结构密度或加载历史 NPC 集聚区域。

只读复核 `prepare_content_fixes.py` 与 `smoke_content.mjs` 未发现重大问题；根任务也已补强断开 RCON 时的“清理未完成”失败报告。本次成功记录已完成清理。
