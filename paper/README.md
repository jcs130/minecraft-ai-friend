# 千灯纪：Paper 跨端服务器

这是当前家服的源码基线，目标是让真人、基岩玩家和 Mineflayer Agent 在同一个世界游玩，并用真实 Java 客户端采集 Agent 第一人称直播画面。此前 1.21.1 / NeoForge 实现保留在仓库历史和 `world/`，本目录是之后 Paper 版本迭代的入口。

## 当前运行基线（2026-09-29）

- Minecraft **1.20.6**，Paper **build 151**，Temurin **Java 21**。生产服运行在 `E:\MC\server`，由 `ops/manage-server.ps1` 启停、监控与备份；Cortico 连接现有服务器，不托管其 JVM。
- Java 后端只监听 `127.0.0.1:25565`；局域网 Agent 网关在转发前拒绝 OP 名称。Geyser + Floodgate 向基岩开放 UDP 19132；ViaVersion / ViaBackwards 转译其 Java 协议。当前配置**不允许把离线模式 Java 后端直接暴露公网**。
- 女神 `Goddess` 是被服务端强制为旁观者的 OP，`goddess-bridge.mjs` 把游戏内私聊送到宿主 QwenPaw `mc_godness`。`CortiLan` 是 Agent 玩家，`CortiEye` 是直播观察者。SpectatorPlus + 自研 CortiEyeMirror 把原版 HUD、聊天/私聊、成就及技能信息同步到真实 Java 观战客户端。
- 20 个启用的服务端插件、9 套原版结构/群系数据包；版本与 SHA256 见 [installed-content.lock.json](manifests/installed-content.lock.json)。第三方 JAR/ZIP 由上游取得并校验，本仓库只保存清单。插件和数据包使用原版方块、实体与菜单，Java 普通客户端、基岩和 Mineflayer 无需安装内容模组。观战客户端另需匹配的 Fabric/SpectatorPlus。
- 自研 **AgentFriend 0.3.22** 当前运行：`/mycli` 文字接口、技能罗盘与命格书、共享 AuraSkills 魔力、公共/私人传送、六层试炼和个人奖励箱。`/mycli spells` 向 Agent 列出探索法术的英文 ID、魔力与冷却，`/mycli focus list` 直接列出可绑定法杖技能，无需打开图形菜单。Paper 反透视隐藏密封矿石，探矿术提供 Java 施法者独享矿块轮廓及基岩墙面光框；灵纹法杖可绑定常用技能一按即放，并新增跃空、限时飞行、守护傀儡、探敌。成功施法会显示原版咏唱大字、技能名、粒子和音效；归乡术显示“空间之力，护你归途”，冷却失败不会误报。村庄可正常放置和清理树叶、草木及玩家新建方块，原有房屋方块由一次性结构快照保护，村民不会被误伤。造物术缺项可申请女神审核。冒险者公会把六层地下城变成可接取委托，组队讨伐与楼层通关可提升声望，从青铜升到钻石；奖励进入个人箱子。村庄东北侧有原版冒险者公会大厅，右键任务牌可打开看板，罗盘或 `/mycli guild hall` 可传送。从村庄北侧小路还可沿云杉栈道、桥墩与石砖阶梯步行到试炼场入口，无需传送。历史 0.3.2 源码保存在 `plugins/AgentFriend/released/0.3.2/`。自研 **CortiEyeMirror 0.1.7** 同时运行，附身观战画面同步技能标题、粒子和音效。
- 难度简单、死亡保留背包、一人睡觉跳夜。出生村庄安全，室外可采集与攻击友善动物，房屋主体和试炼设施受保护。世界地形、已建建筑、玩家背包、权限数据库及女神会话都是运行数据，**不在 Git 中**。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/AgentFriend/` | 自研玩法插件源码、构建脚本、默认配置、公共传送点与皮肤目录 |
| `plugins/CortiEyeMirror/` | 自研第一人称观战同步插件源码和构建脚本 |
| `ops/` | 服务器管理、Watchdog、双盘备份、女神桥、Agent 网关及健康测试 |
| `probe/` | RCON、Java 状态、基岩 Pong 与局域网 Agent 入口探针 |
| `config/` | 无口令的 Paper 配置示例、MagicSpells、WorldGuard 和公共 warp 配置 |
| `manifests/` | 当前安装版本、文件哈希与部分上游下载记录 |

具体启停、发布和恢复步骤见 [维护与发布](docs/OPERATIONS.md)，跨端服务的关键配置见 [配置说明](config/INTEGRATION.md)。

## 开发与部署

两套自研插件的 `build.ps1` 以本机 `E:\MC\jdk`、现服 Paper/依赖 JAR 为编译输入，使用 Java 21。构建输出 JAR 被 `.gitignore` 排除；请对照 [版本锁](manifests/installed-content.lock.json) 确认生产正在运行的版本，不要把源码候选版本当成已部署版本。`ops/` 脚本也保留当前主机的绝对路径与局域网地址，迁移主机时须逐项改配置、检查权限和入口，不能直接执行在另一台机器上。

更新现服前，先确认没有真人在线，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File E:\MC\ops\manage-server.ps1 Backup`，核对 `.complete`；在隔离副本完成 Java、基岩、Agent 和观战验证后才停服替换 JAR/配置并正常 `Start`。不要用 `/reload` 替代重启。管理脚本每天 04:00 仅在无真人玩家时做完整备份，恢复服务后镜像到独立 F 盘。现服状态用 `Status` 检查；世界数据恢复必须从 E/F 快照进行，Git 分支不是存档备份。

`config/server.properties.example` 刻意使用占位 RCON 密码。Floodgate 私钥、QwenPaw 凭据、玩家名单和数据库应只存于服务器本机。未来改动在本分支提交并推送，保持 `main` 的旧版本历史完整。

## 验证边界

2026-09-29，三个服务账号在线时最近一分钟平均约 3.7 ms/tick；Java 状态、基岩 Pong、局域网 Agent 白名单探针和观战插件加载均通过。0.3.4 更新后，临时局域网 Agent 实际发送缺项申请，女神审核并批准 2 棵樱花树苗，背包读到 2 棵；测试账号随后退出并移除白名单。隔离服另验证重复发放与管理方块被拒。Pong 只验证基岩入口响应，不能代替手机完整玩法测试；真实直播画面也须在客户端确认。跨端纯游戏内语音尚无可靠实现，本版本以游戏文字/私聊为主。
