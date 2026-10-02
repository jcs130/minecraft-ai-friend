# 千灯纪生活公会（AgentFriend 0.3.72，已发布）

这套玩法以 **Paper 1.20.6 的原版动作** 为准：Java、Geyser 基岩、Mineflayer Agent 和 CortiEye 看到的都是原版小麦、面包、鱼、方块、书与红石灯。没有给客户端增加物品 ID、方块 ID 或必装模组。生活公会与冒险者公会并行；两者的声望、进行中任务、每日领取记录各自独立。

| 公会 | 任务 ID | 真实动作 | 每日奖励 |
| --- | --- | --- | --- |
| 田园 | `farmer_harvest` | 收获 12 株成熟小麦；同一坐标只计一次 | 声望 3、绿宝石 2、骨粉 4 |
| 美食家 | `gourmet_bread` | 亲手合成 3 次面包 | 声望 3、绿宝石 2、蜂蜜 1 |
| 钓客 | `angler_catch` | 用鱼竿钓起 3 条鱼 | 声望 3、绿宝石 2、营火 1 |
| 建筑家 | `builder_home` | 在允许放置处放置 12 个不同坐标的木板、砖、玻璃或灯 | 声望 4、绿宝石 3、花盆 2 |
| 故事 | `author_story` | 用书与笔签署标题非空、正文至少 40 字的游记 | 声望 4、绿宝石 2、书架 1 |
| 机关工匠 | `tinkerer_light` | 亲手放置红石灯，再于 4 格内扳动拉杆把它点亮 | 声望 4、绿宝石 3、红石粉 4 |

每个任务自然日限领一次（`Asia/Shanghai`），同一时间只能办一项生活委托。声望按公会分开保存：0 学徒、6 熟手、20 匠人、50 大师。奖励进入本人现有的个人试炼箱；它满了时沿用安全待领取队列，不在地上掉落物品。接受钓客或故事任务时，缺少鱼竿或书与笔的玩家可领一次入门工具；不因为放弃、重接反复领取。

手柄玩家从技能罗盘的向日葵或冒险者公会看板的向日葵进入 27 格原版菜单，点图标接单、点绿宝石交付。写书使用原版书与笔界面。Agent 使用 `/mycli life board|status|accept <ID>|claim|abandon`；如果其客户端无法编辑书，可用 `/mycli life write <书名>|<正文>` 消耗一本书与笔并得到真实署名成书。`/mycli list life` 和 `/mycli explain life.*` 提供命令发现。状态及进度通过 `mcagent:life` 向本人连接单播原始 UTF-8 JSON，`schemaVersion=1`；聊天提示也只发本人。

生活任务统计的是服务器确认未被取消的原版事件。建筑任务不会把被保护插件拒绝的放置计入；同坐标重复拆建不会刷进度。生活任务的低价值日奖旨在鼓励体验，不能替代地下城高阶装备。当前没有自动生成独立公会建筑，统一从已有公会大厅和技能罗盘进入；后续可以在勘察、备份及建筑保护验证后为各公会修专属场所。

## 模组与插件取舍

- **Create 机械动力**：官方 Create 6 公告列的是 Forge/NeoForge 上的 Minecraft 1.20.1、1.21.1。不能把它的 JAR 直接放进此服的 Paper 1.20.6 `plugins/`。它的新方块和物品也不会自动被 Geyser 或 Mineflayer 正确呈现。当前先用原版红石灯、拉杆、漏斗、活塞、农场机械作工坊任务；如未来要换内核，应另开兼容性验证服，不在现有亲子世界原地切换。
- **Jobs Reborn**：官方项目覆盖 building、fishing、crafting 等职业，Paper 是支持的服务端；还需 CMILib。它的职业经验和经济与现有 AuraSkills/公会声望重叠。本版不加，避免第二套职业数值、双倍发奖和 Agent 不一致的菜单。
- **BreweryX**：提供 Paper 1.20.x 版本及原版容器酿造玩法，可作以后美食家的饮品支线候选。须先在隔离服核对具体 1.20.6 构建、基岩容器交互、儿童可见的饮品内容及 Mineflayer 可操作性，才考虑安装。
- **Slimefun 4**：虽是 Paper 插件且提供机械与大量物品，但既有 1.20.6 启动错误记录，且自定义物品需逐一验证 Geyser 映射和 Agent 识别。暂不接入正式服。

Geyser 官方明确不自动转换 Java 资源包，也不自动生成自定义物品/方块映射；非原版内容还需基岩资源包，部分需要扩展映射。以上是当前跨端约束，不代表所有 Paper 插件都不能用。

来源：[Create 6 官方公告](https://createmod.com/news/create-6-released)、[Jobs Reborn 官方仓库](https://github.com/Zrips/Jobs)、[BreweryX 版本页](https://modrinth.com/plugin/breweryx/versions)、[Slimefun 官方仓库](https://github.com/Slimefun/Slimefun4)、[Slimefun 1.20.6 已确认问题](https://github.com/Slimefun/Slimefun4/issues/4199)、[Geyser 自定义物品文档](https://geysermc.org/wiki/geyser/custom-items/)、[Geyser 自定义方块文档](https://geysermc.org/wiki/geyser/custom-blocks/)。

## 隔离验证与发布验收

独立 Paper 1.20.6 隔离服 `E:\MC\staging\life-guild-20261003` 使用 25567 端口，装载与正式服同版的 AuraSkills、MagicSpells、WorldGuard、WorldEdit、EssentialsX。`probe/life-guild-stage.mjs` 的双 Mineflayer 实测六类看板、真实署名成书、个人奖励箱结算、当日重复拒绝、菜单跳转和两账号插件回执隔离；`probe/life-guild-actions-stage.mjs` 实际放置 12 格建材、收 12 株成熟小麦、拉杆点亮新放的红石灯、合成 3 次面包并逐项领奖；`probe/life-guild-fishing-stage.mjs` 在原版水池实际钓起 3 条鱼并领奖。三个脚本均 PASS。冒险者公会的同期候选还增加了认证等级；`probe/guild-legacy-rank-stage.mjs` 用已有 360 声望、未写认证字段的旧会员核实钻石等级不降级，同时检查公会底部菜单不被 37 张任务卡覆盖；`probe/guild-donation-stage.mjs` 证明交付 16 个小麦时进度动态达到 16/16、领奖扣除小麦并结算声望。最终候选 JAR SHA256 `52FD5E2653AE41AA0C9DEE3DAC35E18CB1490311A2AAE0A31DC49C19F1147CAF` 再次启动隔离服并通过交付、旧会员及双账号生活菜单、书写和私有回执回归。基岩真机菜单/书页与实际观战画面仍需上线后目视验证，隔离服仅证实所用方块、物品和菜单均为原版协议。

1. 在隔离服以普通 Mineflayer 账号检查 `life board/status/accept/claim`、本人的 `mcagent:life`，以及非参与账号收不到回执。
2. 分别实做成熟小麦、面包合成、钓鱼、方块放置、署名书、红石灯通电；确认被保护插件取消的方块事件不加进度，重复坐标不加进度。
3. 核对 Java 原版菜单与基岩手柄菜单；确认各任务每天只结算一次，奖励箱满时待领取队列保留物品。
4. 正式服只有服务账号在线且无试炼时按 `OPERATIONS.md` 完整备份、发布并检查 Java/LAN Agent、Geyser、女神桥、Watchdog、CortiEye；真机操作由玩家上线后复验。
