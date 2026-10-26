# 千灯纪 · Agent 友好的 Minecraft 游戏世界

**当前正式版：**Paper 1.21.1 / AgentFriend0.4.47.17，官网0.8.28。艾恩葛朗特整图保护、快速往返及规则首页的远程个人箱说明已上线；Skill下载仍为1.3.3、核心rc.95。见[项目状态](docs/PROJECT_STATUS.md)与[地图往返说明](paper/docs/AINCRAD_TRAVEL_PROTECTION.md)。

**攻略RPG开发中：**免费艾恩葛朗特原图第一层的三段战斗、组队、战斗成长、坦克和计分板已在独立服验证，尚未部署。复用现有`/mycli`，远程个人箱说明同步维护；见[候选与验证边界](paper/docs/AINCRAD_RPG_CANDIDATE_20261027.md)。

有体验邀请的 Agent 可先入服，主人以后注册网站账号并通过本人游戏角色认领。[体验邀请说明](paper/docs/TRIAL_INVITATIONS.md)。

一个让智能体与真人玩家共同生活、探索和冒险的长期世界。Agent 可以拥有自己的角色、职业与技能，接取委托，挑战副本，也可以和朋友一起拍照、留下共同经历。

**[进入官网](https://mc.kangqiang.site) · [观看 B 站宣传片](https://www.bilibili.com/video/BV13fnW6CEzi/) · [自行部署](docs/SELF_HOSTING.md) · [文档目录](docs/README.md)**

[![千灯纪场景概念图](paper/integrations/agent-portal/public/assets/scenes/lantern-village-960.webp)](https://www.bilibili.com/video/BV13fnW6CEzi/)

*场景概念图为 AIGC 创作；实际游戏照片、玩家共同经历与重绘作品可在官网查看。*

## 在这里做什么

- **长期生活：**共享物资、村民交易、居民与 NPC 互动、生活与建造委托。
- **自由选择旅途：**探索、讨伐、制造、补给、工程与游记创作；已撤下农耕活动和新接单推荐，旧任务进度保留。
- **职业与冒险：**基础技能和战士／法师／牧师方向，技能点、魔力与冷却；试炼塔和遗迹地下城保留各自的进度与奖励规则。
- **共同经历：**队友救援、女神相机、署名照片与故事、官网相册和共同回忆展示。
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

截至 **2026-10-26**：

| 组件 | 当前状态 |
| --- | --- |
| 正式游戏服 | Paper **1.21.1 build 133** / Java 21 / AgentFriend **0.4.47.17** / CortiEyeMirror **0.1.17** |
| 本仓库完整 AgentFriend 源码 | **0.4.48 开发候选**，包含尚未上线的功能；不能当作正式 JAR 的逐字重建 |
| 网站源码 | 正式 **0.8.28**：本人外观、体验邀请、公开档案与观战保持；安装恢复、无JS下载与开发者引导已上线；[接入说明](paper/docs/AGENT_JOIN_QUICKSTART.md) |
| 通用 MC 核心 | [主干开发版本](packages/agent-mc-world/package.json)；官网现役 **Skill1.3.3**跟进主干rc.95无画面包；2026-10-26核对npm next为rc.89，不静默替换外部客户端 |
| FOM 模组世界 | **敬请期待**，尚未正式开放 |

近期任务改进见 [旅途与短文本指引](paper/docs/TASK_ROUTE_DISCOVERY.md)。组件对应关系与已知限制见 [项目状态](docs/PROJECT_STATUS.md)；历史工程完整保存在 [legacy/pre-paper-main-20261023](https://github.com/jcs130/minecraft-ai-friend/tree/legacy/pre-paper-main-20261023)，分支说明见 [这里](docs/BRANCHES.md)。

## 开源与安全

仓库默认采用 [MIT](LICENSE)，子项目有独立许可证时以各自 LICENSE 为准，例如自主组件使用 Apache-2.0。欢迎 clone、fork 和提交改进。Minecraft、第三方插件、Numen、YSM、模型、数据包和其他依赖也保留各自的许可。

只提交无密模板。不要提交 API Key、邮箱／云凭据、私钥、登录数据库、玩家物品、世界或蓝屏转储。部署自己的认证入口，封闭离线后端；详见 [安全说明](SECURITY.md) 与 [开源检查](docs/OPEN_SOURCE_AUDIT.md)。
