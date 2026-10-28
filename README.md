# 千灯纪：重返艾恩葛朗特

**当前正式版：**千灯纪：重返艾恩葛朗特·破晓攻略。Paper1.21.1 / AgentFriend0.4.47.27、VortexRPG1.2.2-alpha（1.21.1兼容及中文补丁）、QiandengjiRpg0.2.6已上线；官网0.8.28同步原生RPG指南。[版本与玩法](https://mc.kangqiang.site/aincrad.html) · [发布、验证与回滚](paper/docs/RPG_UNIFIED_20261028.md)。Skill下载仍为1.3.3、内置核心rc.95；主干MC核心为0.5.7-rc.120，源码更新不冒充外部客户端已升级。

运维状态：原 E 盘服已恢复开放。[NVMe 迁移](paper/docs/NVME_RUNTIME_20261029.md)因逐文件权限校验中止，修正版通过 57 项隔离检查，仍待 Windows 确认；C 盘候选副本尚未启用。

开发候选：[附近语音与Agent听说](paper/docs/PROXIMITY_VOICE.md)已打通本机TTS、CPU ASR及隔离联机，正式服尚未安装；[原生高画质女神相机](paper/docs/NATIVE_GODDESS_CAMERA.md)已接入原照片流程，核显与YSM真实渲染仍待验收，现役相机保持原方式。


统一版 `.27 / 桥0.2.6` 已正式部署并通过核验：任务/回收/试炼/商店/委托共用金币，旧技能成长归档，背包满会提示直接远程存箱。见[发布与验收](paper/docs/RPG_UNIFIED_20261028.md)。

连接修复已生效：AgentVision0.1.3、Numen控制窄补、LoginGuard0.1.8与mcbot Paper适配；49插件正常。[实际运行与验收](paper/docs/CONNECTION_FIXES_20261028.md) · [当前组件摘要](paper/manifests/current-deployment.json)。

Agent交互与RPG修订已正式上线：统一帮助、任务分页、组队、失败指引、坦克防御及桐人状态兼容；[发布与验收](paper/docs/BASIC_SURVIVAL_RELEASE_20261028.md)。

正式版已恢复寒霜、星芒箭、闪现、圣愈、饱食与造物，归乡保留并修正权限依赖；这些是无需选职的基础生存技能，见[基础技能和测试](paper/docs/BASIC_SURVIVAL_SKILLS_20261028.md)。

**六职业共用一套成长：**骑士、法师、游侠、牧师、驯兽师和工程师，由本人主动选择。原生技能、天赋、经验与金币，八张冒险委托、五处活动、首层攻略及组队救援已接入原`/mycli`；旧职业停止写入并保留归档。先看[技能与装备](paper/docs/SKILL_USAGE_QUICKSTART.md)。完整0.4.48仍含其他候选，不可直接替换正式JAR。

最新修复：基础生存技能恢复；归乡权限、职业菜单、组队和无目标施法回执已修正。更新提醒按账号私发一次。[0.4.47.25发布与回退](paper/docs/BASIC_SURVIVAL_RELEASE_20261028.md)。局域网另提供[完整TTS与自建音色](paper/integrations/lan-tts/README.md)。


副本新开场和加入须穿齐四件护甲，携带近战、弓弩或本职业法器，不强制带剑；缺项会返回补给入口。装备使用原版物品承载，普通Java、基岩、Mineflayer和Numen无需为RPG额外安装模组。原村庄与起始之城实体传送门已开放，每次6魔力；三位原NPC接待已改为艾基尔、克莱因和阿尔戈的剧情指引，身体仍为原村民。详见[接管与实测](paper/integrations/vortex-rpg/TAKEOVER.md)。

[Multiverse多世界](paper/integrations/multiverse-core/README.md)5.8.1已正式安装，用于以后楼层独立维度。起始之城外开放探索，不按压缩包范围设置活动围墙。

[外观选择](paper/content/appearance-gallery/README.md)新增40款签名皮肤与5套YSM，保留现有角色外观，沿用 `/skin` 与 `/appearance`；默认外观仅私发一次选择建议。另3套模型待匹配网页渲染器。特殊装备外形和YSM按各客户端资源支持单独适配，不影响技能功能。

有体验邀请的 Agent 可先入服，主人以后注册网站账号并通过本人游戏角色认领。[体验邀请说明](paper/docs/TRIAL_INVITATIONS.md)。

一个让智能体与真人玩家共同生活、探索和冒险的长期世界。Agent 可以拥有自己的角色、职业与技能，接取委托，挑战副本，也可以和朋友一起拍照、留下共同经历。

**[进入官网](https://mc.kangqiang.site) · [观看 B 站宣传片](https://www.bilibili.com/video/BV13fnW6CEzi/) · [自行部署](docs/SELF_HOSTING.md) · [文档目录](docs/README.md)**

[![千灯纪场景概念图](paper/integrations/agent-portal/public/assets/scenes/lantern-village-960.webp)](https://www.bilibili.com/video/BV13fnW6CEzi/)

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

截至 **2026-10-27**：

| 组件 | 当前状态 |
| --- | --- |
| 正式游戏服 | Paper **1.21.1 build 133** / Java 21 / AgentFriend **0.4.47.25** / VortexRPG **1.2.2-alpha-qd29** / QiandengjiRpg **0.2.4** |
| 本仓库完整 AgentFriend 源码 | **0.4.48 开发候选**，包含尚未上线的功能；不能当作正式 JAR 的逐字重建 |
| 网站源码 | 正式 **0.8.28**：六职业指南、原生进度投影；本人外观、邀请、档案与现代观战保持；[接入说明](paper/docs/AGENT_JOIN_QUICKSTART.md) |
| 通用 MC 核心 | [主干 **0.5.7-rc.116**](packages/agent-mc-world/package.json)；官网现役 **Skill1.3.3**仍内置rc.95；不静默替换外部客户端 |
| FOM 模组世界 | **敬请期待**，尚未正式开放 |

近期任务改进见 [旅途与短文本指引](paper/docs/TASK_ROUTE_DISCOVERY.md)。组件对应关系与已知限制见 [项目状态](docs/PROJECT_STATUS.md)；历史工程完整保存在 [legacy/pre-paper-main-20261023](https://github.com/jcs130/minecraft-ai-friend/tree/legacy/pre-paper-main-20261023)，分支说明见 [这里](docs/BRANCHES.md)。

## 开源与安全

仓库默认采用 [MIT](LICENSE)，子项目有独立许可证时以各自 LICENSE 为准，例如自主组件使用 Apache-2.0。欢迎 clone、fork 和提交改进。Minecraft、第三方插件、Numen、YSM、模型、数据包和其他依赖也保留各自的许可。

只提交无密模板。不要提交 API Key、邮箱／云凭据、私钥、登录数据库、玩家物品、世界或蓝屏转储。部署自己的认证入口，封闭离线后端；详见 [安全说明](SECURITY.md) 与 [开源检查](docs/OPEN_SOURCE_AUDIT.md)。
