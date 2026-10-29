# Paper 多人玩法：现成插件优先

2026-10-29 核对官方文档/源码、正式服加载状态及独立联机结果。今后先检查已有插件的配置与 API；其次验证成熟现成插件；仅补必要的 Agent 查询、权限和真实回执适配。不能把“下载/装上了”写成“玩家已经用起来”。

## 当前选择和缺口

| 需求 | 已有基础及实际状态 | 本轮处理 |
| --- | --- | --- |
| 附近聊天、显式全服喊话 | Essentials 2.22.0 已启用，Chat 模块缺失 | 同版官方 EssentialsXChat 已发布；同世界48格、`!内容` 大喇叭、原版私聊，组合34项联机及正式26项通过 |
| 职业、技能、成长、组队 | Vortex 1.2.2-alpha 固定 qd29，桥0.2.9 已启用 | 继续使用原生管理器；补世界标识和同世界距离，不创建第二套队伍/经验/魔力 |
| NPC 剧情与支线 | BetonQuest 3.2.0、Citizens 2.0.35 b3592、Sentinel 2.9.1 已启用 | 复用对话树、条件与事件、NPC 和护卫；场景配置与 Agent 按需查询优先，不承诺每个 NPC 都已配置完整剧情 |
| Boss 与遭遇 | MythicMobs 5.9.5 已启用 | 复用原怪物模板/技能；挑战脚本与准入调用现有机制，避免重复写 AI 怪物引擎 |
| NPC 商店 | Shopkeepers 2.23.3 已启用 | 先完善现有商店的商品、位置和查询；它的物品交易不自动等于 Vault 金币商店 |
| 玩家直接交易 | 现有托管物资委托可用；Vortex 原生拍卖交付故障仍关闭 | 调研 TradeSystem 双方确认交易，列为独立候选；不增加另一套货币，不谎称拍卖已修复 |
| 玩家摆摊 | 当前未安装 QuickShop-Hikari | 官方支持 Paper、Vault/Essentials 经济与 LuckPerms，适合作为后续隔离候选；尚未验证本服的自定义装备、断线结算和 Agent 操作 |
| 多世界与区域 | Multiverse-Core 5.8.1、WorldGuard 7.0.12 已启用 | 复用实际世界身份和保护；主城外正常探索，不重做世界管理器 |
| 附近语音 | Simple Voice Chat 2.6.27、QiandengVoice 0.1.0 已启用 | SVC 负责近远声音；自有桥只接原有 TTS/ASR。公网 UDP 与真人收听尚未验收，不等于全网语音已通 |

表中版本取自本轮真实加载查询；Vortex 的 qd29 是固定补丁产物标识，原插件内部版本仍为 1.2.2-alpha。

## 聊天方案比较

1. **EssentialsXChat：本轮选用。** 已有同版本核心，新增官方模块约21.8KB；原生支持范围、世界隔离、喊话、无人反馈及权限。实际 Paper 1.21.1 联机已验，安装和格式说明见 [集成说明](../integrations/essentials-chat/README.md)。
2. **Carbon：需要更多频道时再选。** 官方频道配置具有范围、空收件人反馈、快捷前缀及每频道冷却。尚未下载到正式服，不与 EssentialsChat 同时接管普通聊天。
3. **ChatControl：需要更完整频道治理时再选。** 官方提供全服、世界、距离和部分第三方组队频道，以及自动加入、规则与代理集成。其组队支持清单不能推断为已经兼容 Vortex，仍需验证。
4. **HuskChat：不新增采用。** 作者项目页已标停止维护，不能仅因旧教程常见就安装。

格式化插件不解决所有 Agent 上下文问题。Mineflayer 原文与服务器装饰是不同组件，客户端须保留 UUID 并按需读装饰；位置必须包含实际世界实例。2026-10-29 18:59:49–18:59:51 的只读巡查确认，可米/DeepFish 在艾恩葛朗特，Coobot/Yui 在主世界；相近 XYZ 不是同地。没有为验收传送真实角色、变更组队或搬动物品。

另4项原版协议检查确认，两个世界的 `worldState.name` 不同而 `dimension` 类型索引相同，Mineflayer 高层却都记成 `overworld`。核心应优先保留原版字段，不新造世界协议。字段、未实现项及线上代理尚未抓包的边界见[世界/频道契约](../integrations/essentials-chat/WORLD_IDENTITY.md)。

## 接入和验证原则

- 保持现有 `mycli` 少量入口；帮助按需查询原生能力、实际资格、费用、错误原因和下一步。查询不创建队伍/任务、不花费金币。
- GUI 友好不等于 Agent 已能可靠交易。候选需验原版 Java、Mineflayer、Geyser 的不同入口，以及确认后修改物品、满包、断线、重启、重复确认和自定义元数据保留。
- 金币继续由现有 Vault 经济提供者维护。不能为商店、拍卖、回收各建余额；不能把提示“+金币”当成真实入账。
- 不因为找到插件就全装。每类明确一个权威，先复用已装功能；可选替代按单项候选试验，不在生产同时叠加多套聊天、任务、职业或交易系统。
- 源码/配置候选与正式部署分别记载；正常停启、备份和发布后实际回执仍遵守现有运维流程。

## 官方资料

- [Paper：查找与安装插件](https://docs.papermc.io/paper/adding-plugins/)
- [EssentialsX 2.22.0 Release](https://github.com/EssentialsX/Essentials/releases/tag/2.22.0)、[官方聊天配置](https://github.com/EssentialsX/Essentials/blob/2.22.0/Essentials/src/main/resources/config.yml)、[实际分发与世界隔离源码](https://github.com/EssentialsX/Essentials/blob/2.22.0/EssentialsChat/src/main/java/com/earth2me/essentials/chat/processing/AbstractChatHandler.java)
- [Carbon 频道配置](https://github.com/Hexaoxide/Carbon/wiki/Channel-Configuration)
- [ChatControl 频道](https://docs.mineacademy.org/chatcontrol/channels)
- [HuskChat 项目状态](https://william278.net/project/huskchat)
- [TradeSystem 官方仓库](https://github.com/erikzimmermann/TradeSystem)
- [QuickShop-Hikari 安装与前置](https://quickshop-community.github.io/QuickShop-Hikari-Documents/docs/setup/install)
- [Shopkeepers 官方资料](https://github.com/Shopkeepers/Shopkeepers-Wiki/wiki)
- [BetonQuest 官方仓库](https://github.com/BetonQuest/BetonQuest)、[Citizens 官方仓库](https://github.com/CitizensDev/Citizens2)
