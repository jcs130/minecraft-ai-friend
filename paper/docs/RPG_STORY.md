# 千灯纪：灯火归途

状态：**2026-10-18 已正式上线**。正式服为 Paper 1.21.1 / AgentFriend 0.4.47.4。墓穴入口路牌、行路簿和完整 CLI 下楼指引均已生效。

## 玩家从哪里开始

用 `/mycli world story menu` 打开旅途手记，或用 `/mycli world story status` 查看本人下一步。新手在千灯新村找营地书记映灯；老玩家保留原登记、技能、实习与委托，不必重练。游戏欢迎信息、`/mycli intro`、`/mycli status` 和 `/mycli progress story 1` 提供短入口。

剧情有三章：

1. **借一盏灯**：认识映灯、登记冒险者、自愿报名原入门实习、认识基础技能目录。
2. **自己的第一道光**：选择喜欢的路线、实际施展一次已学技能、自选完成一张公会委托，再向司灯沐辰报告。
3. **林道的黑旗**：可选的营地讨伐支章，先侦察天然掠夺者营地，再战斗、返程结算，最后回顾风身边交谈。

“剧情章节完成”“原入门实习毕业”“专项实练完成”“公会委托完成”分别记录；互相不会冒充。选战斗、制造、探索、后勤、工程或生活，只改变旅途偏好，不替你选职业、接任务或替换正在做的委托。

## 人物与居民支线

这些是原版村民实体和原版箱式对话菜单，不要求 Agent 或玩家安装客户端模组。人物位置已在已有地面核验，不通过填地或拆房硬放。右键交谈，或者走到 **8 格内** 使用 `talk`。资料可以远程查看，实际交谈需要本人到场。

| 人物 | 地点（主世界） | 内容 |
| --- | --- | --- |
| 营地书记·映灯 `yingdeng` | -1115.5, 64, -615.5 | 新手、公共补给、储物、规则 |
| 巡路人·顾风 `gufeng` | -1105.5, 64, -599.5 | 巡夜、弓术、天然营地、墓穴路线 |
| 工匠·砚铁 `yantie` | -1090.5, 66, -621.5 | 工具、装备与制造 |
| 司灯·沐辰 `muchen` | -541.5, 67, -435.5 | 基础技能、实习与返程报告 |
| 画师·纸鸢 `zhiyuan` | -615.5, 67, -377.5 | 自动摄影、展示照片、旅行故事 |
| 采矿人·石砚 `shiyan` | -659.5, 68, -487.5 | 公共矿坑、保护边界、补充物资 |

首批共 **37 个话题、9 条支线链**，串联原有真实委托：近战巡夜、弓术、工具、装备、探索、照明补给、口粮后勤、农田循环、生活摄影。人物菜单先展示详情，再由玩家明确接取；仍使用原公会任务槽和验收账本。对话只给本人及实际附身 Eye 显示气泡，不向公屏广播剧情或机器回执。

储物提示会区分：

- 公会公共箱：`/mycli guild shared`，按需取装备、工具与口粮；门内私人储物仍有原物权。
- 随身大背包：`/minepacks:backpack open`，54 格，存取后等待同步并关闭重开核对。
- 个人奖励箱：`/mycli arena stash pages`，10 页共 540 格，奖励和自动成片在这里。远程实际开箱需先学习 `travel` 并耗 2 魔力；试炼场实体箱旁可免费操作。未学时先 `skills info travel`，不要重复领奖或拍照。

## 天然掠夺者营地

首批只启用实地勘察过的 **黑旗林营·火堆下的密令** `illager_camp`，不用任意地图中心代替真实入口。

路线：主世界 **(-1080,68,-1117)** 西侧靠近 → **(-1077,67,-1117)** 外哨集结 → 沿北侧空地绕过木栏 → **(-1069,67,-1116)** 营火阵地。原木栏中间是封闭装饰，不是入口，不要挖。

1. `tasks info tm_field_camp_report` 查看，决定后 `guild accept tm_field_camp_report`。
2. 本人在天然营地走查至少两个四格分区、16 格新路线、5 秒有效行进；仅到坐标或传送不算。先 `guild claim` 交侦察阶段。
3. 带盾、护甲、武器、箭和食物，到外哨 `/mycli dungeon start illager_camp`；队友在 10 秒内 `/mycli dungeon join illager_camp`。普通难度即可。
4. 两段战斗：外哨两名弩哨；营火阵地一名近卫和一名执斧头目。真实原版怪物、真实攻击；全程参战可登记，沿用原组队倒地/扶起机制。
5. 清场后回外哨形成结算凭据，`/mycli dungeon claim illager_camp` 入箱，再 `/mycli guild claim` 完成委托。最后回顾风 8 格内交谈。

活动显示为“野外据点讨伐”。`/mycli arena` 仍是试炼塔；`/mycli dungeon` 聚合天然遗迹与野外据点，保留原命令。原三处地下城定义及冷启动续接兼容。

没有杀怪或返程不能凭对话发奖。讨伐每日每地点奖励一次；公会这张委托为一次性。原自然宝箱、原建筑不替换；活动怪物由既有副本引擎按场次创建和清理。活动期间的拆建限制沿用该引擎。

## CLI 契约

```text
/mycli world story --help
/mycli world story status [--json]
/mycli world story list [chapter|npc|side] [--page N] [--json]
/mycli world story info <ID> [--json]
/mycli world story start [章节ID] [--json]
/mycli world story choose <combat|crafting|exploration|supply|engineering|life> [--json]
/mycli world story talk <人物ID> [话题ID] [--json]
/mycli world story track on|off [--json]
/mycli world story cancel [--json]
/mycli world story menu [人物ID]
```

`status/list/info` 只读，不报名、不选路线、不加载目的地区块、不生成敌人、不发物。默认只给短状态；列表沿用有界 `MC_PAGE` 分页，章节详情过长自动续页。Agent / `--json` 收到私有 `MC_STORY`，带本人 UUID、会话、顺序、观测时间、真实缺项和下一命令。普通玩家对白只显示中文与下一步。女神原 `read_player_world` 同时返回独立的 `story` 与 `currentContract`，读取不会推进剧情；记录不可读时明确标记 unavailable，不能假称完成。

`start/choose/talk/track/cancel` 是明确动作。开始同一在办章节不会覆盖原接受时间；取消剧情不取消公会委托，也不退技能点。原章节定义在接受时冻结，历史保留接受版本、定义和完成时间。提前聊天不会代替后续返程报告。故事自身不额外打印奖励，全部来自原任务结算。命令发出、pending、超时均不代表完成；结果未知先查状态，不盲目重放。

## 运营与扩展

- 内容：`plugins/AgentFriend/rpg-story.yml`；进度：`rpg-story-ledger.yml`；人物实体索引：`rpg-story-npcs.yml`。
- 先校验 YAML，再用原 `mycli admin worldlife reload` 更新内容。稳定保留章节、阶段与人物 ID；在办章节仍按接受快照验收。活动章节仍需要的 NPC 不能直接删掉。
- 人物只在启动、明确重载、相关区块加载时检查已有实体；查询不刷 NPC，不全世界扫描，不自动复制已登记但暂不可见的 UUID。实体被管理员搬走/删除时先查原 UUID 和区块，再决定修复。
- 阶段类型和人物动作使用白名单；配置不能执行任意控制台命令。每两秒只检查在线玩家真实账本，进度改变才保存，不调用语言模型。
- 新委托继续写 `route-contracts.yml`，战斗据点写 `dungeons.yml`，不另建重复的任务或奖励系统。`spawn-points` 必须来自实地可走空地，不能只凭空气/方块中心判断可达。

## 构建与验证

主源码还包含独立、未发布的档案馆 0.4.48。此次 **不能直接发布根 `build.ps1` 的完整产物**。使用 `plugins/AgentFriend/scripts/build-rpg-release.py`：提供只读的 Paper 目录、确切 0.4.47.3 基础 JAR、JDK21 和新的输出目录。它只编译 RPG 所需十组类，临时剔除未来档案馆目录/分发分支；基础摘要、未涉及条目和输出均核验，绝不自行安装。

```text
python scripts/build-rpg-release.py --server <Paper目录> --base-jar <0.4.47.3.jar> --java-bin <JDK21/bin> --out <新输出目录>
```

规则测试：`test-rpg-story.ps1 -JavaBin <JDK21/bin>`，26 项。联机测试：`paper/ops/tests/rpg-story.integration.mjs ag_StoryQF18`，需要现有的专用隔离世界、`.rpg-campaign-stage` 标记、loopback 25910/25911 和环境变量 `MC_STAGE_PAPER`、`MC_TEST_REPORT_DIR`、`MF_REQUIRE_FROM`（Mineflayer 所在 package.json）、`MC_TEST_YAML_REQUIRE_FROM`（js-yaml 所在 package.json）。使用新的专用 QA 名，拒绝覆盖旧进度。它验证原版实体/菜单、真实登记/技能目录、隐私、只读查询、中文玩家对白和储物条件。

营地另在隔离世界完成真实行走与原版攻击、断线续接、冷启动保留凭据、两次结算去重和实物数量核对；测试装备仅用于几何/结算验证，不代表玩法难度或自主 Agent 能力已通过。Java/Mineflayer 已实测；基岩使用可翻译的原版实体和箱式菜单，本轮未以手机/Xbox 真机或远端 Web 画面验收。

正式发布需要本次 Paper 重启授权、提前通知、原维护流程 E/F 完整冷备份。回退先正常停服，恢复旧 JAR 和本次七份配置前像；保留新的故事账本、原任务、奖励和玩家物品，不回退世界。详见发布清单。

发布记录：经本次授权完成原流程双盘冷备份 `20261018-085743`。正式状态/保存检查 41 项、原登录入口的实体/菜单检查 16 项通过；候选规则与隔离联机结果见发布清单。
