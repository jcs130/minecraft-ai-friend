# 千灯纪：重返艾恩葛朗特

**Youer 上游已核对：**官网常规构建仍为正式服使用的920；10月29日的官方测试包已隔离验证，冷区块异步加载及非持久化NPC保存问题仍可复现，Paper对照正常。现有修补内核保留，升级和上游报告状态见[核对记录](paper/docs/YOUER_UPSTREAM_20261103.md)；两份issue草稿已备好，受上游仓库写权限限制尚未提交。

**传送修复候选已验证：**AF0.4.47.50-rpg 统一个人地点和旧遗迹的冷区块读取及结果回执，Youer重启后45项、普通Paper44项联调通过，当前等待Windows维护确认；正式仍为AF.49。现役命令检索已能对拼写、中文意图和错误cast入口返回准确用法；共享SDK拒绝终态已实测。见[传送与命令联机记录](paper/docs/TRAVEL_CLI_20261103.md)。

**11月3日修复已上线：**固定NPC重复生成、临时商人错误持久化及多参数命令纠错已修复，现役AF0.4.47.49-rpg。游戏后台已独立启动；核显相机恢复29–30帧和40项模型。原账号、成长及物品保持。远端宿主错误回执消费及遗迹冷区块传送仍单独跟进，见[发布及边界](paper/docs/NPC_CLI_LIFECYCLE_20261103.md)、[后台修复](paper/docs/INDEPENDENT_SERVER_LIFETIME_20261103.md)和[相机修复](paper/docs/NATIVE_CAMERA_ADAPTER_20261103.md)。

**官网导航新版已上线：**[PR48](https://github.com/jcs130/minecraft-ai-friend/pull/48) 已合并并发布。首页、歌曲、下载和接入页统一为「世界 / 直播 / 作品 / 加入」，账号操作集中到「我的」；电脑和手机公网验收通过，原账号、14个有效会话、作品与下载保持。本次仅正常切换官网的9个静态文件，游戏、代理和相机未重启。见[发布记录](paper/docs/PORTAL_SIMPLIFY_20261102.md)及[实际部署清单](paper/manifests/portal-simplify-deployed-20261102.json)。

**官网0.8.38已上线：**重复邮箱注册会立即提示登录或找回密码。[可米的8首真实歌曲](https://mc.kangqiang.site/music.html)已公开，歌词、作者、完整音频摘要、拖动播放均已核验；音频直传私有OSS，原角色和旧凭据保留。[注册及播放修复](paper/docs/DUPLICATE_EMAIL_REGISTRATION_20261102.md) · [歌曲接口](paper/docs/MUSIC_WORKS_20261102.md)。

**后台启动修复已上线：**关闭空输入引起的交互终端空转，实际JVM属性、线程和日志已核验；55插件、紧凑RPG信息栏、登录及模型同步继续正常运行，原账号和成长数据保持。见[部署记录](paper/docs/BACKGROUND_CONSOLE_20261102.md)。

**主干部署已完成：**已正常重启发布[紧凑RPG信息栏](paper/docs/COMPACT_RPG_SIDEBAR_20261102.md)：正文4行、隐藏排序数字，保留职业、等级、经验、金币、委托、天赋及徽记。原角色和成长数据保持，模型同步修复继续生效；55插件和原生相机、观战已复核。

**模型同步修复已上线：**通道识别与切服确认0.1.2已加载；原版YSM2.6.5和LoginGuard0.1.10保持，该次模型修复未单独重启游戏。核显相机已收到40项模型目录并真实加载无人机，live游戏端也已握手；完整远端人物画面仍单独验收。见[发布记录](paper/docs/YSM_NATIVE_CAPABILITIES_20261102.md)。

**11月2日修复已上线：**[完整客户端兼容、公会NPC卡死和CLI纠正](paper/docs/FULL_CLIENT_COMPAT_RELEASE_20261102.md)，以及[原生OP女仆指令兼容与PR整合](paper/docs/PROXY_COMMAND_COMPAT_20261102.md)。正常重启后55插件全部启用，19项正式回读通过，核显相机恢复30帧；原生YSM2.6.5、原账号和OP保持，客户端无需新增兼容模组。原公网基岩入口`micro.kangqiang.site:19140`已补齐TCP握手，手机与远程live仍分别等待真实客户端验收。实验PR已合入源码，未自动开启模型或相机诊断循环。

**原图六段攻略候选已验证，尚未上线：** 使用低拱、柱廊、南拱、上层看台和中央斗技场，原路约628格；24名分段敌人、弓手真实射击及首领换剑已在当前Youer与女仆兼容层上通过54项检查。正式服仍为原三段攻略（本次仍保留原三段内容），见[路线、验证和发布边界](paper/docs/AINCRAD_ARCHITECTURE_20261030.md)。本批保持现有核心及其他插件，不把源码准备当成已经部署。

**当前游戏版：**千灯纪：重返艾恩葛朗特·破晓攻略。Youer1.21.1 build920，AF0.4.47.49-rpg、QiandengjiRpg0.2.17、Vortexqd32-cooperation、原生平台0.1.6和WorldObserver0.1.2已上线。**YSM服务端已统一到官方2.6.5**，DeepFish保留原始大肥鱼包，live使用旁观无人机；原生模型同步与无光影核显相机已正式启用，见[本次实查](paper/docs/CLOSEOUT_20261101.md)。**官网0.8.38、Skill1.3.7已发布**，新增[Cortico Lite普通Agent免邀请接入](paper/docs/CORTICO_LITE_PUBLIC_SIGNUP_20261101.md)，保留持久限流、体验池和后续本人认领。照片描述、数字日记、自定义图片和地图画继续使用；公开由本人/管理员选择，大文件直达OSS。Skill/Harness核心仍rc.130；起始之城内可放不可拆，城外可挖可建，副本建筑保护保持。

**已上线的网页与场景保存：**[照片场景存档、原模型状态和下载核对](paper/docs/WEB_SCENE_ARCHIVES_20261101.md)。拍照命令不变，可额外保存收到的地形、群系、光照、实体及原始模型资源；文件私有去重存入 OSS。NEKO0.6.114、Cortico Lite0.1.2、DSH rc.24 已核对原始发行字节，旧兼容链接保留。官网、资料同步、相机桥和匹配观战后台已实际切换；正式玩家照片的全链路交付仍待验，加密原包仍有网页几何缺口。

![千灯纪：灯火初上的起始之城与浮空城，AI场景概念图](paper/integrations/agent-portal/public/season-art/aincrad-dusk-20261030-960.webp)

运维状态：[NVMe迁移](paper/docs/NVME_RUNTIME_20261029.md)已完成，原E盘入口联接到C盘NVMe，原目录保留。本轮E/F完整恢复点已冷刷新最新游戏与认证；两次失败尝试的前像和回执保留，新版游戏端已实际运行，后台收尾不需再停Paper。

[Paper现成插件复用与附近聊天方案](paper/docs/PAPER_PLUGIN_REUSE_20261029.md)：官方EssentialsXChat与世界/队伍标识已正式发布，普通聊天默认同世界48格，!内容为全服喊话；[本轮发布](paper/docs/NEARBY_COMMUNICATION_RELEASE_20261029.md)。优先用已有Vortex、BetonQuest/Citizens、Shopkeepers和MythicMobs，新增交易插件先独立验证。

附近语音：服务端插件已安装并连接现有TTS与CPU ASR，语音模组可选；自启、公网UDP及每日端口续期已验收，真人耳听仍待验证，见[语音状态](paper/docs/PROXIMITY_VOICE.md)。[原生高画质女神相机](paper/docs/NATIVE_GODDESS_CAMERA.md)已完成核显无光影原生实拍；正式入口的接通进度见本次实查，光影模式暂不启用。


职业详情现在按服务器加载配置返回属性、装备、技能效果和成长条件；满包优先指引直接远程存箱，遗迹支持三次战败和存档点、Boss房间排他。旧金币统一规则保持，见[本轮发布](paper/docs/RPG_INTERACTION_20261029.md)。

连接修复已生效：AgentVision0.1.4、标准背包开窗、原生后端协议和罗盘兼容，女仆桥0.1.6已加载；当前完整状态以部署清单为准。[实际运行与验收](paper/docs/NATIVE_COMPATIBILITY_20261030.md) · [当前组件摘要](paper/manifests/current-deployment.json)。

Agent交互与RPG修订已正式上线：统一帮助、任务分页、组队、失败指引、坦克防御及桐人状态兼容；[发布与验收](paper/docs/BASIC_SURVIVAL_RELEASE_20261028.md)。

正式版已恢复寒霜、星芒箭、闪现、圣愈、饱食与造物，归乡保留并修正权限依赖；这些是无需选职的基础生存技能，见[基础技能和测试](paper/docs/BASIC_SURVIVAL_SKILLS_20261028.md)。

**六职业共用一套成长：**骑士、法师、游侠、牧师、驯兽师和工程师，由本人主动选择。原生技能、天赋、经验与金币，八张冒险委托、五处活动、首层攻略及组队救援已接入原`/mycli`；旧职业停止写入并保留归档。先看[技能与装备](paper/docs/SKILL_USAGE_QUICKSTART.md)。完整0.4.48仍含其他候选，不可直接替换正式JAR。

最新修复：基础生存技能恢复；归乡权限、职业菜单、组队和无目标施法回执已修正。更新提醒按账号私发一次。[0.4.47.25发布与回退](paper/docs/BASIC_SURVIVAL_RELEASE_20261028.md)。局域网另提供[完整TTS与自建音色](paper/integrations/lan-tts/README.md)。


副本新开场和加入须穿齐四件护甲，携带近战、弓弩或本职业法器，不强制带剑；缺项会返回补给入口。装备使用原版物品承载，普通Java、基岩、Mineflayer和Numen无需为RPG额外安装模组。原村庄与起始之城实体传送门已开放，每次6魔力；三位原NPC接待已改为艾基尔、克莱因和阿尔戈的剧情指引，身体仍为原村民。详见[接管与实测](paper/integrations/vortex-rpg/TAKEOVER.md)。

[Multiverse多世界](paper/integrations/multiverse-core/README.md)5.8.1已正式安装，用于以后楼层独立维度。起始之城外开放探索，不按压缩包范围设置活动围墙。

[外观选择](paper/content/appearance-gallery/README.md)新增40款签名皮肤与5套YSM，保留现有角色外观，沿用 `/skin` 与 `/appearance`；默认外观仅私发一次选择建议。另3套模型待匹配网页渲染器。特殊装备外形和YSM按各客户端资源支持单独适配，不影响技能功能。

有体验邀请的 Agent 可先入服，主人以后注册网站账号并通过本人游戏角色认领。[体验邀请说明](paper/docs/TRIAL_INVITATIONS.md)。

一个让智能体与真人玩家共同生活、探索和冒险的长期世界。Agent 可以拥有自己的角色、职业与技能，接取委托，挑战副本，也可以和朋友一起拍照、留下共同经历。

**[进入官网](https://mc.kangqiang.site) · [观看 B 站宣传片](https://b23.tv/Ppfd3Ne) · [自行部署](docs/SELF_HOSTING.md) · [文档目录](docs/README.md)**

[![千灯纪场景概念图](paper/integrations/agent-portal/public/assets/scenes/lantern-village-960.webp)](https://b23.tv/Ppfd3Ne)

*场景概念图为 AIGC 创作；实际游戏照片、玩家共同经历与重绘作品可在官网查看。*

## 在这里做什么

- **长期生活：**共享物资、村民交易、居民与 NPC 互动、生活与建造委托。
- **自由选择旅途：**探索、讨伐、制造、补给、工程与游记创作；已撤下农耕活动和新接单推荐，旧任务进度保留。
- **职业与冒险：**十一项基础技及Vortex六职业，原生技能、天赋、经验和金币；试炼塔与遗迹地下城保留各自的进度和奖励规则。
- **共同经历：**队友救援、女神相机、署名照片与故事、官网相册和共同回忆展示。
- **女神指引：**复用QwenPaw原生任务，每五分钟检查新增公屏，仅对核实且尚未解决的玩法误解私聊提示，限频去重；[实现与验收](paper/docs/GODDESS_CHAT_GUIDANCE.md)。
- **多种接入方式：**原版 Java、经 Geyser 接入的基岩玩家、Mineflayer Agent，以及可选的 Numen 服务端 Agent。YSM 等模型能力按客户端与资源包单独适配。
- **观察与直播：**独立 Web 可视化支持实时画面、OBS 覆盖和 Agent 状态；具体能力取决于画面源及所用版本。
  [无账号女神之眼](paper/docs/ACCOUNT_FREE_WORLD_VIEW.md)已匹配官网与现代前端，支持视角切换、小地图、单源云端分发，不占额外玩家名额；[公开足迹、背包、作品与动作优化](paper/docs/PUBLIC_WORLD_TRAIL.md)已上线。

## 带自己的 Agent 加入

1. 在 [官网](https://mc.kangqiang.site) 用用户名、密码注册并登录，邮箱可稍后绑定。
2. 点“生成 Agent 接入链接”交给自己的 Agent；下载 [当前 Skill](https://mc.kangqiang.site/downloads/agent-skill)，运行一条安装命令。详见[接入指南](paper/docs/AGENT_JOIN_QUICKSTART.md)。
3. 完成游戏认证并实际进入世界后，从 `/mycli help`、`/mycli status` 学习玩法。
4. 用 `/mycli tasks list` 选择路线；公共装备与补给入口：`/mycli guild shared`。

任务查询默认给精炼中文。需要程序处理时，在支持的入口主动加 `--json`；登录、危险和最终执行回执仍需准确识别。以真实完成回执确认动作，超时先查询，避免重放消耗性操作。

| 你使用的 Agent | 接入项目 |
| --- | --- |
| 通用 MCP／SDK | [agent-mc-world](packages/agent-mc-world/README.md)：独立 Mineflayer 身体、工具、动作回执与可选查看器 |
| N.E.K.O | [Minecraft Autonomous 插件](https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous) · [N.E.K.O 主项目](https://github.com/Project-N-E-K-O/N.E.K.O) |
| DSH | [dsh-minecraft-agent](https://github.com/jcs130/dsh-minecraft-agent) |
| Cortico | [千灯纪 World](https://github.com/jcs130/cortico-world-qiandengji) · [Cortico 主项目](https://github.com/Pal-AI-Lab/Cortico) |
| Numen／QwenPaw | [Numen Paper 接入](paper/docs/NUMEN_PAPER.md) · [QwenPaw 桥](paper/docs/KIRITO_QWENPAW.md)；模型与 Key 由各自部署者提供 |
| mcbot（Paper服务端适配已安装） | [独立服务端适配](paper/integrations/mcbot/README.md)，复用Numen身体与原世界；客户端要求1.21.11 Fabric，官方界面及真实模型任务仍需联测 |
| 实时可视化 | [mc-visual-console](https://github.com/jcs130/mc-visual-console) |

这些是可选接入方式，不要求安装全部框架。普通 Java 玩家无需安装 Numen；基岩与不同 Java 版本的支持以实际入口和客户端说明为准。

## 自行部署／二次开发

默认 `main` 现在同时包含 **Paper 千灯纪、自部署工具、正式网站源码和最新 MC 核心**：

```sh
git clone https://github.com/jcs130/minecraft-ai-friend.git
cd minecraft-ai-friend
python paper/self-host/selfhost.py doctor
```

接下来按 [独立部署指南](docs/SELF_HOSTING.md) 接受 Minecraft EULA、下载校验公开依赖、编译并启动自己的沙盒。需要 **JDK 21、Python 3.10+**；网站需要 **Node.js 22.13+**，MC 核心按其 README 使用 pnpm。

| 路径 | 内容 |
| --- | --- |
| `paper/plugins/` | AgentFriend RPG 玩法、CortiEyeMirror 观战及共享协议源码 |
| `paper/self-host/` | 固定依赖锁、跨主机构建与网站导出工具 |
| `paper/integrations/agent-portal/` | 已上线0.8.28接入引导，含完整宿主分包、测试、Dockerfile与无密模板 |
| `paper/integrations/world-observer/` | 已上线的无额外账号现代网页观战：独立Paper插件、出站worker、默认关闭配置与测试 |
| `paper/integrations/` | 登录保护、Numen、YSM、基岩与其他可选集成 |
| `packages/agent-mc-world/` | 保留原 main 的最新通用 Agent MC 核心、MCP 与 SDK |
| `packages/agent-mc-autonomy/` | 独立自主调度组件，按自身 README 使用 |
| `docs/`、`paper/docs/` | 部署、架构、玩法和带日期的运营记录 |

**源码可构建不等于家服世界镜像。** 城镇、23 栋原村屋、部分 NPC／区域布局与第三方资源尚需自己的场景配置；账号库、玩家背包、模型 Key 和维护者存档不包含在仓库中。旧根目录 `compose.yml` 是历史 NeoForge 环境，不是 Paper 的一键启动入口。

## 当前版本与开发边界

截至 **2026-10-29**（正式状态以[部署清单](paper/manifests/current-deployment.json)为准）：

| 组件 | 当前状态 |
| --- | --- |
| 正式游戏服 | Youer **1.21.1 build920** / Java 21 / AgentFriend **0.4.47.37-rpg** / VortexRPG **1.2.2-alpha-qd31-growth** / QiandengjiRpg **0.2.13** |
| 本仓库完整 AgentFriend 源码 | **0.4.48 开发候选**，包含尚未上线的功能；不能当作正式 JAR 的逐字重建 |
| 网站 | 正式 **0.8.28**（源码0.8.29照片管理仍候选）：六职业指南、原生进度投影；本人外观、邀请、档案与现代观战保持；[接入说明](paper/docs/AGENT_JOIN_QUICKSTART.md) |
| 通用 MC 核心 | [主干 **0.5.7-rc.130**](packages/agent-mc-world/package.json)，含[原版世界身份与位置记忆隔离](packages/agent-mc-world/docs/world-identity.md)；官网现役 **Skill1.3.3**仍内置rc.95；不静默替换外部客户端 |
| FOM 模组世界 | **敬请期待**，尚未正式开放 |

**未发布与未完成事项：**照片全量管理、Skill/Harness与离线包核心更新、基岩高清YSM、核显原生相机、跨服账号、换职/洗点和拍卖等见[逐项核查](docs/PROJECT_STATUS.md)及[机器清单](paper/manifests/release-readiness-20261029.json)。旧候选清单不是当前发布队列。

近期任务改进见 [旅途与短文本指引](paper/docs/TASK_ROUTE_DISCOVERY.md)。组件对应关系与已知限制见 [项目状态](docs/PROJECT_STATUS.md)；历史工程完整保存在 [legacy/pre-paper-main-20261023](https://github.com/jcs130/minecraft-ai-friend/tree/legacy/pre-paper-main-20261023)，分支说明见 [这里](docs/BRANCHES.md)。

## 开源与安全

仓库默认采用 [MIT](LICENSE)，子项目有独立许可证时以各自 LICENSE 为准，例如自主组件使用 Apache-2.0。欢迎 clone、fork 和提交改进。Minecraft、第三方插件、Numen、YSM、模型、数据包和其他依赖也保留各自的许可。

只提交无密模板。不要提交 API Key、邮箱／云凭据、私钥、登录数据库、玩家物品、世界或蓝屏转储。部署自己的认证入口，封闭离线后端；详见 [安全说明](SECURITY.md) 与 [开源检查](docs/OPEN_SOURCE_AUDIT.md)。
