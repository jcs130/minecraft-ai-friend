# My Agent World：生活、公会与生成内容维护

2026-10-12，NeoForge 1.21.1 / 21.1.248。玩家与外部 Agent 的入口、身份和动作账本保持原样。玩法纯文本见 [新手与生活指南](MY-AGENT-WORLD-RPG-CONTENT.txt)。

## 发布组成

来源和精确校验值见 `manifests/society-rpg-content.lock.json`；运行时 JAR 总集由 `society-lab-1.21.1.lock.json` 管理。新增 Architectury 13.0.11、SimpleQuests 2.2.0、EconomyCraft 1.10.0、Moog’s Paths 1.1.1，及 Towns and Towers 1.21.1、Dungeons and Taverns 4.4.4、Explorify 1.6.5 三个数据包。第三方原始压缩包、JAR、资源和存档只存运行目录，不提交 Git。

这些内容使用已有方块/物品，不引入新物品或方块注册项；Dungeons and Taverns 会增加动态附魔注册项，不能把这表述为“没有任何新注册表”。其可选 Java 资源包自定义附魔纹理尚未逐项转换为基岩，当前显示原版附魔物品与说明。新增 GUI 均是原版箱子菜单，不要求 Java 客户端安装任务或经济界面模组。

Settlement Roads 当前 NeoForge 版本需要 Fabric 兼容层，未引入；Bountiful / FTB Quests / EasyNPC 需要额外界面、物品或实体适配，暂缓。道路选择原生 NeoForge 的 Moog’s Paths，支持 Towns and Towers 部分村庄锚点，但不保证任意两个村庄互通。

## 可维护的数据源

- `config/maw-life-content.json`：22 项委托、七个目录分类（指南加六个生活方向）、五档声望。原生 SimpleQuests 保存每位玩家的接取、完成次数和冷却。
- `tools/build_maw_life_content.py`：确定性生成 `world/society-datapacks/maw_life` 和桥内目录资源；包括原版方块驿站、七名接待员与共享箱。
- `config/maw-economycraft-config.json` / `prices.json`：首次安装用的经济参数。安装器不会覆盖正式服后来改过的设置、价格和账户数据。
- `config/maw-moogs-paths.json`：26 类网络，五类村庄道路启用概率 100%，其余 35%。自然地形、结构距离与生成算法仍决定结果。

重复任务等待 24000 个 gameTime tick，使用跳夜不会消除等待；制作、钓鱼和击杀必须在接取之后由原生事件触发。材料交付扣真实物品，检查法术书只验证持有。声望来自完成次数，不另建可漂移的影子任务账本。市场初始 40 灯币、每日签到 0、每日回收额度 300、税率 3%，默认未定价物品买卖均为 0，避免上游补入廉价顶级装备。

自有数据包修复原结构兼容问题：D&T 隐藏进度引用缺失的 minecraft:root，补一个不可自然完成的隐藏根节点；Dungeoneer 旧模板引用 dungeoneer:hallways，使用 jigsaw pool_aliases 指向原模组实际的 cobblestone_dungeon_hallways，不修改第三方 JAR。T&T 灯塔模板遗漏的管理员池补入指向原有 lighthouse_master 模板的定义。

## Agent 与界面约定

`/mycli guide`、`guild join|list|current|submit`、`status`、`market` 为本人操作，不授 OP、不广播状态。首次认证登录发绑定指南针，手持交互打开；普通丢弃取消并返还，满包退款失败时保留补领标记。

两种身体共用五个原生操作：`society.state`、`society.join`、`society.accept`、`society.submit`、`society.open`。`state` 返回本人 UUID、采样时间、余额、声望、等级、全部任务的原生进度和可接状态。写操作在原有单控制器、持久 action_id 框架内执行；未知结果先对账，不换 ID 重放。Mineflayer SDK 总目录 94，Numen mod_operations 原生目录 72，统一适配器 Numen 目录 77（含一个明确不可用的 body.observe）。运行时仍应先查询 operations。

基岩欢迎指南新增“公会 · 委托 · 声望”和“市场 · 买卖 · 玩家订单”按钮，使用普通玩家自身连接发命令打开原生箱子菜单。桥内直接用 Brigadier dispatcher 执行原生经济命令并保留其权限；避免 performPrefixedCommand 在 /mycli 嵌套上下文排队而误报菜单未打开。所有个人数据按 UUID 分离，原有五个资源包不更换。

## 发布、回滚与运营

1. 修改定义后生成数据包和桥资源，构建候选桥。检查 quests/分类/奖励命令与 catalog 一致；命令中的玩家选择器使用 @s[type=minecraft:player]，奖励定义保留 loot_table=minecraft:empty。
2. 在独立普通地形服验证加载、实际任务事件、扣物、重放去重、两账号隔离、余额、满包待领取、Numen 原身份恢复和基岩菜单。不能用单元测试替代实机闭环。
3. 正式维护前确认无真实玩家游玩；暂停受管服务并等待各子进程请求退出且 code=0。冷备世界、认证、mods、经济与任务数据、Agent 原账本、服务配置及构建锁。备份校验 ZIP CRC 和每文件 SHA，限制备份目录 ACL。
4. `tools/society_content.py install --world world-life` 只用于停服安装，拒绝覆盖已修改的第三方或自有数据包。后续自有内容升级须先备份旧包，明确替换整包，再运行 verify；不能删玩家区块“刷新”建筑。
5. 同步主构建锁、桥构建记录、基岩扩展契约和分发包；`society_lab.check_runtime` 在主锁包含道路模组后同步检查 RPG 内容。恢复原 supervisor，等待真实健康与端口探测成功；保留 Agent 的暂停标记和原 unknown。
6. 回滚必须使用此次成套冷备恢复数据包、JAR、配置和对应构建锁。已经生成的新建筑/附魔与经济账户不可只回滚一个 JAR；先在副本验证恢复。

不要清空玩家进度、账户、动作账本或现有 world-life。旧 Paper 千灯纪独立维护，本次没有迁移其技能、波次试炼塔和历史公会存档。新驿站、酒馆、道路和遗迹仅在新生成区块出现；自然地下城与旧试炼塔的波次规则不同。

## 验收边界

隔离实测覆盖：两名普通账号任务隔离、实际合成和交付、农夫乐事洋葱、法术书不扣、重复 action_id 不重复领奖、六类原生菜单、NPC 交互与指南针防丢；Numen 本人任务与权限隔离；原生市场买卖、满包待领取、腾位取回及玩家收购订单创建。452 项 Node 测试、17 项 Python 审计、原生参数校验 45 项、基岩表单 57 项通过。

实际手机像素效果、所有自然遗迹逐个通关、全部附魔交易和长期经济平衡仍需后续游玩。Geyser 对 Ars Nouveau 既有 reactive 附魔中的 neoforge:any HolderSet 会记录兼容警告；已定位为原有 Ars 数据，不能冒称本轮新包导致或已经完整修复。未经验证的玩法保持 allGameplayVerified=false。

## 2026-10-12 正式发布记录

已发布并恢复 Java、Agent 网页与基岩桥，主服共 34 个 JAR。桥 SHA256：f12b7c165346f10c6eb4623d34bb3fccc6b3956d1b010f1a9496ea11590d13bd；指南表单 SHA256：b1a91c6b45cac977c0fa59e60a5baf91da56fc032defcd49c054159226614bbc。其他原 29 个 JAR、五个基岩资源包均保持 SHA。

冷备 E:\QiandengJiSocietyLab\backups\rpg-content-20261012，1,287 文件、388,033,658 字节，ZIP CRC 和逐文件 SHA 已校验。安装期间原世界数据逐 SHA 保持；启动后正常保存继续发生，server.properties 的重写仅改变格式/注释、实际所有键值保持。主 supervisor 原 runId 恢复；Numen 原身体身份和权限保留，MawExplorer 仍暂停，原 unknown 和动作账本前缀保留。无新公网端口或付费模型调用。旧 MixAuth 缺失的下载缓存由相同 SHA 的已安装 JAR 补齐。

隔离服正常重启后，两种身体的原 action_id 重放均不再次派发或领奖，任务、余额、声望保存。Numen 状态 12 次读取中位数 31.5 ms、最高 47.0 ms，只是隔离环境短测。道路现场实际读取到上游定义的 coarse_dirt / podzol / rooted_dirt 铺装；原测试误用 dirt_path 的失败证据保留。

真实 Bedrock UDP 客户端分别通过指南打开公会和市场，下载并校验五个原资源包且收到原生物品栏。正式服复测 Mineflayer 94 项目录、84 项远端绑定、本人 22 项任务；认证 MCP 返回 72 项原生操作和五项 society.*，既有离线身体仍保持离线。Native SDK 9 项、Numen/基岩 15 项健康检查通过，正式启动零 ERROR。真实手机像素效果仍未验。

Native SDK 0.3.1 与 World Adapter 0.2.1 分发至各自 v3-rpg-20261012 目录，各 36 个自有文件并安装锁定的 91 个依赖；原 v2 逐 SHA 不变。私有 QA 凭据、日志、冷备和动作回执留在运行目录，不提交 Git。
