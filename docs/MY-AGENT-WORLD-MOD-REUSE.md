# My Agent World：经济、交易与玩法模组复用

核查日期：2026-10-12。目标环境：Minecraft 1.21.1、NeoForge 21.1.248；Java、基岩桥、Mineflayer 与 Numen 同世界。选型优先复用已安装的原生系统，再补协议、界面和玩法配置。

## 已有经济基础

正式环境已安装 `economycraft-neoforge-1.10.0_1.21.1.jar`、Architectury 13.0.11。EconomyCraft 原生提供账户、固定商店、玩家拍卖、确认出售、收购订单、转账、满包待领取和交易历史。官方同时提供公共 API v1。来源：[项目介绍](https://www.curseforge.com/minecraft/mc-mods/economycraft-mp)、[源码](https://github.com/PhilipB06/EconomyCraft)、[开发接口](https://github.com/PhilipB06/EconomyCraft/wiki)。

继续用它作为灯币账户的唯一来源。公会任务通过原生 `eco addmoney` 奖励；已有试炼回收/补给也读写同一账户。`SocietyLifeBridge` 只在玩家自身命令源下打开原菜单，不提升权限，不另建余额、拍卖托管或订单数据库。本轮新增入口为 `society.open` 的 `auction`、`sell`、`transactions`。

当前余额适配仍使用已安装版本的 EconomyManager 方法；公共 API v1 是后续减少版本耦合的迁移方向，不能把“JAR 内有 API”写成“现有桥已全部迁到公共 API”。改写资金接口前须核对失败返回、精确数量与余额、物品归还和动作去重。

## 经济和交易候选

| 模组 | 价值与版本证据 | 本服决定与适配缺口 |
| --- | --- | --- |
| EconomyCraft | 已安装 1.21.1 NeoForge 1.10.0；账户及交易功能完整，原菜单为标准容器 | 继续作为经济基础，复用交易结算 |
| Trading Post | 将周围村民的交易集中到柜台；官方文件列表有 1.21.1 NeoForge v21.1.1 | 优先候选。需要 Puzzles Lib、方块资源及专用界面适配；尚未安装或实测 |
| Create: Numismatics | 官方列出 1.21.1，提供 Create 风格商店、硬币、银行和银行卡 | 适合实体商铺与机械收费，但会引入另一货币账户。暂不叠加；尚未核对与本服 Create 6.0.10 的精确依赖组合 |
| Lightman's Currency | 硬币、钱包、交易机、个人和团队银行 | 作者明确不支持 `online_mode=false`；当前混合登录环境不选用 |
| Easy NPC | 对话、交易和交互 NPC | 候选剧情接待员；1.21.1 NeoForge 的精确文件与依赖仍须核实，不能用项目全局 loader 标签代替版本证明 |
| EconomyCraft Bounties | 官方定位为 PvP 悬赏及死亡损失扩展 | 与孩子、生活任务的当前方向不符，暂不加入 |

官方资料：[Trading Post](https://www.curseforge.com/minecraft/mc-mods/trading-post)、[其 1.21.1 文件](https://www.curseforge.com/minecraft/mc-mods/trading-post/files/all?page=1&pageSize=20&version=1.21.1)、[Numismatics](https://modrinth.com/mod/numismatics)、[Lightman's Currency](https://www.curseforge.com/minecraft/mc-mods/lightmans-currency)、[Easy NPC](https://www.curseforge.com/minecraft/mc-mods/easy-npc)、[Bounties](https://www.curseforge.com/minecraft/mc-mods/economycraft-bounties)。以上候选不在本轮安装清单中。

## 其他玩法也复用原生系统

| 需求 | 当前复用 | 可考虑的补充 |
| --- | --- | --- |
| 章节、委托、前置、完成与领奖 | 已安装 SimpleQuests 2.2.0；本轮章节作为数据包任务 | FTB Quests 的可视任务树可作为将来替代方案；需要额外依赖和两端专用界面，不同时维护两套完成进度 |
| 社会、居民、岗位、建筑生产 | 已安装 MineColonies/Structurize/Domum | 优先继续补原生操作闭环，避免自建第二套殖民地模拟 |
| 农耕、料理、机械生产 | 已安装 Farmer's Delight、Create、Central Kitchen | 用配方、生产与委托连接成长，而不是凭图标判断机器已运转 |
| 魔法、魔力和法术书 | 已安装 Ars Nouveau；既有技能 CLI 共用实际 Ars 魔力 | System Call 复用原技能结算和冷却；不另造魔力条 |
| 遗迹和地下城 | 已安装 Dungeon Crawl、YUNG's Better Dungeons、Dungeoneer 及结构数据包 | Lootr 可提供自然战利品的个人箱；尚未安装，不直接替换现有个人试炼仓库 |
| 书籍指引、生产教程 | 已安装 Patchouli、Ponder | 优先读原书、教程和菜单，再翻译给 Agent/基岩 |

补充来源：[FTB Quests](https://www.curseforge.com/minecraft/mc-mods/ftb-quests-forge)、[Lootr](https://www.curseforge.com/minecraft/mc-mods/lootr)。版本可下载不代表已与本服或基岩兼容。

## 安装门槛

1. 核对实际 1.21.1 NeoForge 文件、前置依赖、来源、许可和 SHA，固定到清单。
2. 在独立世界验证启动、普通玩家权限、真实交易和重启持久化。
3. Agent 能发现真实操作/价格/组件，执行后取得回执；未知动作不重试。
4. 基岩与网页需要原方块/物品模型、菜单内容和实际点击适配。Java 的 custom GUI 不会因网关可登录就自动可用。
5. 发布前正常停服备份，保留账户、世界与旧动作账本；候选验证通过后才加入正式包。

后续优先级：先完善 EconomyCraft 的多端操作说明与中文入口，再隔离试验 Trading Post；需要实体收费设备时再决定是否采用 Numismatics 及账户迁移策略。

本轮实际进度：EconomyCraft 原生拍卖、出售、流水入口已发布，普通玩家/Mineflayer/Numen 与隔离基岩容器均验证；出售物资真实扣物与同账户入账已通过。流水异步打开返回等待窗口状态，避免误报未知。没有安装表中候选，也没有新建第二套货币或交易库。详细范围、未验项目和备份见 [发布记录](MY-AGENT-WORLD-UNDERWORLD.md)。
