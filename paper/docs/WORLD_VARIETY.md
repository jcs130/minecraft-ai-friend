# 千灯纪：大型建筑、居民生活与野外遭遇

## 发布状态

2026-10-16 候选。正式 Paper 的安装、维护重启仍须服主确认，且真人退出、活动副本结束。
当前正式 AgentFriend 0.4.42 与 Eye 0.1.16 保持；不夹带另一个考试改造候选，不修改 Agent 客户端或 FOM。

## 内容清单

不是客户端材质包合集：这里安装的是服务器建筑数据包及生活插件，建筑使用原版方块、原版物品和实体。
包含中式宫殿与园林、城堡、浮空村庄、海上建筑、海底遗迹、矿井、末地城堡和掠夺者设施。

| 资源 | 固定版本 | 接入方式 |
| --- | --- | --- |
| [More Chinese Structures](https://modrinth.com/project/more-chinese-structures) | 1.1.1 | 原生数据包 |
| [Chinese Village](https://modrinth.com/project/chinese-village) | 1.21.1 | 原生数据包 |
| [ZhengSZ's Wonderland](https://modrinth.com/project/zhengsz-wonderland) | 1.0.0 | 原生数据包 |
| [Age Of Empires IV Minecraft Edition](https://modrinth.com/project/aoe4mc) | 0.0.14 | 原生数据包 |
| [Japanese Castle - Structure ✅](https://modrinth.com/project/japanese-castle) | 1.0 | 原生数据包 |
| [Castles & Castles](https://modrinth.com/project/castles-castles) | 1.0 | 原生数据包 |
| [Grim kingdoms: Lost structures & ruins](https://modrinth.com/project/grim-kingdoms-lost-structures-ruins) | 2.0.3 | 原生数据包 |
| [Caleari Castle](https://modrinth.com/project/caleari-castle) | 1.0 | 原生数据包 |
| [ATi Structures - Vanilla Edition](https://modrinth.com/project/ati-structures-vanilla-edition) | 1.4.7 | 原生数据包 |
| [Towns and Towers](https://modrinth.com/project/towns-and-towers) | 1.21.1-datapack | 原生数据包 |
| [ChoiceTheorem's Overhauled Village](https://modrinth.com/project/ct-overhaul-village) | 3.4.5 | 原版数据兼容转换 |
| [Luki's Grand Capitals](https://modrinth.com/project/lukis-grand-capitals) | 1.1.3 | 原生数据包 |
| [AdoraBuild: Structures](https://modrinth.com/project/adorabuild-structures) | 2.11.0 | 原版数据兼容转换 |
| [[RETIRED] Dungeons and Taverns End Castle Standalone](https://modrinth.com/project/dungeons-and-taverns-end-castle-standalone) | v1.1 | 原生数据包 |
| [Hopo Better Ruined Portals](https://modrinth.com/project/hopo-better-ruined-portals) | 1.4.4b-datapack | 原生数据包 |
| [Hopo Better Underwater Ruins](https://modrinth.com/project/hopo-better-underwater-ruins) | 1.2.1b-datapack | 原生数据包 |
| [MVS - Moog's Voyager Structures](https://modrinth.com/project/moogs-voyager-structures) | 4.2.6 | 原版数据兼容转换 |
| [When Dungeons Arise](https://modrinth.com/project/when-dungeons-arise) | 2.1.68 | 原生数据包 |
| [When Dungeons Arise: Seven Seas](https://modrinth.com/project/when-dungeons-arise-seven-seas) | 1.0.4 | 原生数据包 |
| [Sky Villages](https://modrinth.com/project/sky-villages) | 1.0.6 | 原生数据包 |
| [叠山 peakscape](https://modrinth.com/project/peakscape) | 0.1.1 | 原生数据包 |
| [MSS - Moog's Soaring Structures](https://modrinth.com/project/mss-moogs-soaring-structures) | 1.1.4-1.21-fabric | 原版数据兼容转换 |
| [MES - Moog's End Structures](https://modrinth.com/project/mes-moogs-end-structures) | 1.4.6-1.21 | 原版数据兼容转换 |
| [MMV - Moog's Missing Villages](https://modrinth.com/project/mmv-moogs-missing-villages) | 1.0.0-1.21-fabric | 原生数据包 |
| [MTR - Moog's Temples Reimagined](https://modrinth.com/project/mtr-moogs-temples-reimagined) | 1.1.3 | 原版数据兼容转换 |
| [Hopo Better Mineshaft](https://modrinth.com/project/hopo-better-mineshaft) | 1.3.0b-datapack | 原生数据包 |

完整下载地址、作者版本、许可、SHA256/SHA512、转换和排除规则见
[packs.lock.json](../content/world-variety/packs.lock.json)。第三方 ZIP/JAR 只在私有运行目录保存，不上传仓库。

另安装 VillagerLife 1.0.0（固定兼容补丁）、Sentinel 2.9.1 build 525、OlEncounters 1.7.0、CommandAPI 12.1.0，
以及本项目 WorldVariety 0.1.0。用 FAWE 2.16.1 替换 WorldEdit 7.3.9，不同时加载两个 WorldEdit 实现。
官方输入摘要见 [plugins.lock.json](../content/world-variety/plugins.lock.json)。Sentinel 新版虽然能启动，实际创建 NPC 会引用 1.21.1 没有的实体类型，故使用实测通过的历史构建。

## 进入游戏后如何体验

- **建筑探索**：继续向没有生成过区块的地方探索。安装不会在原村庄、现有道路或玩家领地上覆盖建筑，也不删除旧区块。新包中的空岛、城堡本身可有怪物、战利品和刷怪笼，危险程度按原作品设计。
- **普通居民**：空手普通右键仍然交易；空手潜行右键聊天，收到问候后说“你好”“有什么消息”“床在哪里”“最近怎么样”，说“再见”结束。`/mycli world npcs` 查看附近最多三位可交谈居民及坐标。原来的固定 NPC 和问答服务保留。
- **巡守**：营地和主村庄各增加一位原版铁傀儡巡守，攻击怪物，忽略玩家与 NPC。按 UUID 登记，重启不重复生成。原有铁傀儡不替换。
- **野外遭遇**：`/mycli world events status` 查看；到现场 `/mycli world events join` 参加，`leave` 退出。参战不会自动传送。清完两波敌人后，空手右键营地箱领取个人战利品，不能重复领取；结束恢复原现场。
- **手柄/基岩**：旅途指南的“村庄新生活”居民、活动按钮也能查看新内容。保留原来按钮和命令的行为，不要求 Agent 记一套新的主入口。

野外遭遇、试炼塔、固定地下城是三个独立玩法；遭遇领奖不会消费地下城领奖凭据，也不会直接完成公会任务。
结构化 `MC_WORLD` 只发给执行命令的 Agent 本体，中文提示也为私人回复；活动公告限定现场附近，不发送全服 JSON。

## 转换与兼容边界

目标 Paper 1.21.1 / pack format 48，保留原有九个数据包；新装 26 个包和一个共享生成配置。
665 个结构定义中，659 个有自然生成入口，6 个原作品未列入默认生成表的定义保留供手动配置，清单在每包的 `manualOnlyStructures`。
不能把“注册表能加载”当作“能自然生成”：CTOV 的 Java 注入已改为原生村庄生成表与哨站表，改名后的两种 Luki 建筑也补上生成表。
构建检查会拒绝任何没有生成入口、又没有明确声明的结构。

所有建筑几何、楼梯方向、箱子、可用战利品和原生实体保留；自定义模组的部分坡度/地形筛选由原版 jigsaw 配置近似。
Caleari 城堡使用完整几何及 3 种配色 × 6 种墙样式，避免把 1128 种处理器全部加载。
末地城堡单独改名，避免覆盖现有 Dungeons and Taverns 同名函数；NBT 中的战利品名称也一起改名。
CTOV 的普通原版方块替换保留楼梯、原木等合法方块状态。

Moog Nether、较新 Moog Mineshaft/Ocean 中不能用原版表达的地形搜索、动态处理器等没有强行伪装安装；使用 Hopo 矿井、水下遗迹和 Seven Seas 等替代。
不向 Paper 放入 Java 模组类，也不要求 Mineflayer、手机或 Xbox 安装 Forge/NeoForge 模组。
基岩通过现有 Geyser/Floodgate 收到原版建筑、怪物、交易和箱子，原装备资源包仍沿原通道下发。
本次实测为协议客户端，手机/Xbox 像素效果及远端 Web 实机没有替代验收。

## 性能与权限

- 新增独立结构表的总生成密度上限约 6 次/km²，尚未扣除群系、地形不匹配；不包括原九个包和共享村庄表，实际数量通常更少。
- CTOV 等村庄共用一个生成网格，保留原 Vanilla/Better Villages 类型；新包的原版群系标签采用追加，保留 Terralith 原风格标签。
- 没有新增噪声、地形或维度定义覆盖。原主村庄的精确建筑保护、可用农田、道路、地下岩基层和领地名单保留。
- 新建筑接入现有原生结构保护；可开门、爬梯、操作箱子、收割允许的作物，不能拆遗迹建筑。Hopo 破损传送门保留修复玩法，不笼统保护整个 Hopo 命名空间。
- 每 50 分钟至多尝试一场自动遭遇；主世界须有生存角色在线，TPS 不低于 18，没有活动遭遇才尝试。只选已经生成的区块，失败记录冷却，不反复搜索。
- 临时营地远离 WorldGuard 领地至少 48 格；只开小规模两波战斗，关闭连锁活动、建筑落地动画、地形破坏和全服广播。单个恢复快照限 64000 格。
- FAWE 工作队列限 2 线程。居民日程间隔 200 tick、最多 96 人；固定/无 AI/乘坐村民不接管，不新增模型请求。
- 居民不能通过聊天免费改名，代取物资和代工关闭，避免绕过归属；巡守不攻击玩家。
- 大建筑的新区块生成和原生 `/locate` 本身有计算成本；隔离服一次同步强载 81 个新区块曾触发 10–15 秒卡顿诊断。正式发布不做同步批量强载或全图预生成；长期 16 Agent 同时拓荒尚未压测，不承诺该负载下恒定 TPS。

## 构建与验证

1. 从装有 `minecraft-data`、`prismarine-block` 的工作目录导出 1.21.1 方块状态：

```text
node paper/ops/export-world-variety-block-states.mjs <依赖package.json绝对路径> <新状态JSON路径>
python paper/ops/fetch-world-variety.py --downloads <仓库外目录> --output <仓库外新目录> --block-states <状态JSON>
```

2. 用 Java 21 和 Paper libraries 构建 [VillagerLife 补丁](../ops/villagerlife-compat/README.md)，再用
`build-world-variety-plugin.py` 构建本项目插件。官方插件下载也由上一步按摘要验证。
3. `python -m unittest discover -s paper/ops/tests -p test_world_variety_packs.py -v` 验证转换和生成入口。
4. `world-variety-deploy.ps1 -FixtureRoot <E:/MC/ops/repairs下新的测试目录>` 验证部署拒绝路径、摘要、停止门禁与回退。
5. 隔离服使用 `WorldVarietyQA.java` 做原生蓝图、波次、领奖、恢复及保护检查。该夹具只允许 25914 与隔离目录，JAR 不得部署正式服。

阶段实测结果和文件摘要见 [候选清单](../manifests/world-variety-candidate-20261016.json)。
已有 26 套代表建筑原生生成及存档方块核验、两项最终结构模式补测、10 项普通 Mineflayer 交互、10 项遭遇生命周期和 6 项 Bedrock UDP 检查。
自动选址既验证过成功，也验证过在已生成区块不足或冷却区域过多时返回无合适地点；这不应被伪报成活动已经生成。
测试期间只使用服务器夹具伤害验证波次/归属，不宣称自主 Agent 已经完成所有战斗。
早期接口错误、夹具快照/交互/传送错误和误写的成功文本均保留原始失败回执，不覆盖为成功。
最终正式插件组合（不含 QA 插件）冷启动通过；实际定时器完成选址尝试并保存 50 分钟冷却，巡守 UUID 不重复。
新 CTOV 已通过自然定位与保护查询，挖掘后的服务端方块保留；独立挖掘对照夹具未完成，不计为完整通过。

## 运维与回退

配置在 `paper/content/world-variety` 和插件默认配置；每日运营修改方案 YAML，房管依次执行
`/olencounters reload`（基础配置）及 `/worldvariety reload`（方案及接入配置）。JAR 或数据包替换走完整维护重启，不执行 Bukkit `/reload`。
停发新遭遇可把 `automatic-encounters.enabled` 设为 false 后 `/worldvariety reload`；已有场次仍按本场规则结束。
居民闲聊文本可改中文 en_US.yml 后使用作者的配置重读命令；日程和交易规则不能随意绕过权限。

正式安装前原维护任务完整停止服务、完成 E/F 双盘冷备份，CAS 校验目标前像，再安装候选。
只替换固定 WorldEdit JAR、添加 26+1 包、5 个新插件和 FAWE、指定配置与蓝图；不复制隔离世界、NPC UUID、玩家背包、权限数据库或活动账本。
恢复包包含逐文件前像与安装日志。新版本若异常，先安全结束临时活动、停止服务，然后按安装日志恢复配置/JAR、移除本批包并恢复旧 WorldEdit。
已生成的原版建筑可以留在世界；移除数据包不会自动移除它们。不得为退包而在线覆盖整个世界或回滚玩家进度。
首次上线会创建两位带本插件所有权标记的新巡守；回退只移除这两个登记 UUID，不能删除其他 NPC 或原铁傀儡。
