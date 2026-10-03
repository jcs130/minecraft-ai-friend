# 千灯纪：Paper 跨端服务器

这是当前家服的源码基线，目标是让真人、基岩玩家和 Mineflayer Agent 在同一个世界游玩，并用真实 Java 客户端采集 Agent 第一人称直播画面。此前 1.21.1 / NeoForge 实现保留在仓库历史和 `world/`，本目录是之后 Paper 版本迭代的入口。

## 当前运行基线（2026-10-03）

- Minecraft **1.20.6**，Paper **build 151**，Temurin **Java 21**。生产服运行在 `E:\MC\server`，由 `ops/manage-server.ps1` 启停、监控与备份；Cortico 连接现有服务器，不托管其 JVM。
- Java 后端只监听 `127.0.0.1:25565`；局域网 Agent 网关在转发前拒绝 OP 名称。Geyser + Floodgate 向基岩开放 UDP 19132；ViaVersion / ViaBackwards 转译其 Java 协议。当前配置**不允许把离线模式 Java 后端直接暴露公网**。
- 女神 `Goddess` 是被服务端强制为旁观者的 OP，`goddess-bridge.mjs` 把游戏内私聊送到宿主 QwenPaw `mc_godness`。`CortiLan` 是 Agent 玩家，`CortiEye` 是直播观察者。SpectatorPlus + 自研 CortiEyeMirror 把原版 HUD、聊天/私聊、成就及技能信息同步到真实 Java 观战客户端。
- 20 个启用的服务端插件、9 套原版结构/群系数据包；版本与 SHA256 见 [installed-content.lock.json](manifests/installed-content.lock.json)。第三方 JAR/ZIP 由上游取得并校验，本仓库只保存清单。插件和数据包使用原版方块、实体与菜单，Java 普通客户端、基岩和 Mineflayer 无需安装内容模组。观战客户端另需匹配的 Fabric/SpectatorPlus。
- 自研 **AgentFriend 0.3.76** 当前运行：`/mycli` 文字接口、技能罗盘与命格书、共享 AuraSkills 魔力、公共/私人传送、十五层试炼、第七层驿站、首领战和个人奖励箱。每层清怪后 10 秒全队自动下楼并补满生命；每位玩家获得独立随机战利品，含附魔装备与稀有保底。冒险者公会看板提供多类委托，涵盖组队、战斗、领箱和六处自然遗迹调查；新开放掠夺者营地、失落古镇、地下堡垒。手柄玩家由技能罗盘进入传送罗盘，再点“遗迹远征”；Agent 可用 `/mycli guild travel <遗迹ID>` 从外围步行探索。调查任务的完成条件是抵达遗迹中心附近，原生怪物与宝箱仍由世界数据包提供。`/mycli spells list` 分页列出 18 项主动法术，`/mycli spells explain <ID>` 给 Agent 逐项说明效果、目标、魔力、冷却、失败条件与成长；技能罗盘左上角「法术图鉴」供手柄玩家先阅读再施放，`/mycli focus list` 直接列出可绑定法杖技能，无需打开图形菜单。Paper 反透视隐藏密封矿石，探矿术提供 Java 施法者独享矿块轮廓及基岩墙面光框；灵纹法杖可绑定常用技能一按即放，并新增跃空、限时飞行、守护傀儡、探敌。成功施法会显示原版咏唱大字、技能名、粒子和音效；归乡术显示“空间之力，护你归途”，冷却失败不会误报。村庄可正常放置和清理树叶、草木及玩家新建方块，原有房屋方块由一次性结构快照保护，村民不会被误伤。造物术缺项可申请女神审核。公会声望从青铜升到钻石；奖励进入个人箱子。村庄东北侧有原版冒险者公会大厅，右键任务牌可打开看板，罗盘或 `/mycli guild hall` 可传送；门口的接待员提供任务、购买、装备回收和原版绿宝石交易，大厅东南侧四组 54 格公共双箱供所有玩家自由存取。Agent 用 `/mycli guild trader|shared` 获取入口和共享箱坐标，再用普通箱子操作。详见 [公会接待与共享箱](docs/GUILD_SERVICES.md)。从村庄北侧小路还可沿云杉栈道、桥墩与石砖阶梯步行到试炼场入口，无需传送。已加载的成年村民都有职业与原版交易菜单，价格上限为 16 绿宝石或 24 件交付物；控制台 `/mycli admin villagers` 可核查。历史 0.3.2 源码保存在 `plugins/AgentFriend/released/0.3.2/`。自研 **CortiEyeMirror 0.1.7** 同时运行，附身观战画面同步技能标题、粒子和音效。

生活公会提供田园、美食家、钓客、建筑家、故事、机关工匠、商旅七种日常委托，村庄建有[四座不同主题的公会建筑与七位专属职业导师](docs/LIFE_GUILD_BUILDINGS.md)。玩家可从技能罗盘地图前往，右键导师用原版菜单接单、交付和交易；Agent 用 `/mycli life locations|visit` 取得绝对坐标或前往入口。钓鱼、种地、烹饪、建筑、写书和红石机关都按真实原版动作计进度，七条声望分别成长；奖励进入本人试炼箱。具体命令与跨端边界见 [生活公会](docs/LIFE_GUILDS.md)。`/mycli list life` 可发现 Agent 命令。`/mycli life write` 为无法操作原版书写 GUI 的 Agent 提供消耗书与笔生成真实成书的接口。商旅任务要求向两种不同职业的村民真正出售物资；`/mycli village villagers` 给出附近村民的收购报价与绝对坐标。村庄外围掠夺者出现时，在线 Agent 收到紧急私聊与私有 `mcagent:village` 状态，玩家可用 `/mycli village threat` 查敌情；实战支援有每日首次击败奖励。详见 [村民收购与村庄守望](docs/VILLAGE_SUPPORT.md)。

试炼塔前三层保底材料、恢复品、酿药材料和弓箭，第四、五、八、九层保底集齐附魔铁甲，第六、十层推进个人钻石套装。`/mycli status` 与 `/mycli arena status` 分别说明本人是否参赛及全服活动层；Agent 只在 `MC_DUNGEON status participant=true` 时把楼层当作本人进度。成品药水暂不放进奖励箱，原因和完整掉落表见 [试炼塔奖励](docs/ARENA_LOOT.md)。
- 难度简单、死亡保留背包、一人睡觉跳夜。出生村庄安全，室外可采集与攻击友善动物，房屋主体和试炼设施受保护。世界地形、已建建筑、玩家背包、权限数据库及女神会话都是运行数据，**不在 Git 中**。

地下城掉线后为原队伍保留当前进度 10 分钟；重连自动返回当前层，自动下楼倒计时暂停后继续。正常停服重启也能从同一检查点恢复，已有奖励不会重复发放。试炼中死亡时本人会收到聊天与复活标题引导：已通关奖励去地面入口箱领取，或用 `/mycli arena rewards` 直接打开个人箱；未通关楼层不结算，死亡地点没有试炼奖励。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/AgentFriend/` | 自研玩法插件源码、构建脚本、默认配置、公共传送点与皮肤目录 |
| `plugins/CortiEyeMirror/` | 自研第一人称观战同步插件源码和构建脚本 |
| `ops/` | 服务器管理、Watchdog、双盘备份、女神桥、Agent 网关及健康测试 |
| `probe/` | RCON、Java 状态、基岩 Pong 与局域网 Agent 入口探针 |
| `config/` | 无口令的 Paper 配置示例、MagicSpells、WorldGuard 和公共 warp 配置 |
| `manifests/` | 当前安装版本、文件哈希与部分上游下载记录 |

具体启停、发布和恢复步骤见 [维护与发布](docs/OPERATIONS.md)，Agent 团队持续开发技能、公会任务和地下城的工作流程见 [世界运营手册](docs/AI_WORLD_OPERATIONS.md)，跨端服务的关键配置见 [配置说明](config/INTEGRATION.md)。

## 开发与部署

两套自研插件的 `build.ps1` 以本机 `E:\MC\jdk`、现服 Paper/依赖 JAR 为编译输入，使用 Java 21。构建输出 JAR 被 `.gitignore` 排除；请对照 [版本锁](manifests/installed-content.lock.json) 确认生产正在运行的版本，不要把源码候选版本当成已部署版本。`ops/` 脚本也保留当前主机的绝对路径与局域网地址，迁移主机时须逐项改配置、检查权限和入口，不能直接执行在另一台机器上。

更新现服前，先确认没有真人在线，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Backup`，核对 `.complete`；在隔离副本完成 Java、基岩、Agent 和观战验证后才停服替换 JAR/配置并正常 `Start`。不要用 `/reload` 替代重启。管理脚本每天 04:00 仅在无真人玩家时做完整备份，恢复服务后镜像到独立 F 盘。现服状态用 `Status` 检查；世界数据恢复必须从 E/F 快照进行，Git 分支不是存档备份。

`config/server.properties.example` 刻意使用占位 RCON 密码。Floodgate 私钥、QwenPaw 凭据、玩家名单和数据库应只存于服务器本机。未来改动在本分支提交并推送，保持 `main` 的旧版本历史完整。

## 验证边界

2026-09-29，三个服务账号在线时最近一分钟平均约 3.7 ms/tick；Java 状态、基岩 Pong、局域网 Agent 白名单探针和观战插件加载均通过。0.3.4 更新后，临时局域网 Agent 实际发送缺项申请，女神审核并批准 2 棵樱花树苗，背包读到 2 棵；测试账号随后退出并移除白名单。隔离服另验证重复发放与管理方块被拒。Pong 只验证基岩入口响应，不能代替手机完整玩法测试；真实直播画面也须在客户端确认。跨端纯游戏内语音尚无可靠实现，本版本以游戏文字/私聊为主。
