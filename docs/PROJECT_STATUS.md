# 当前项目状态

**2026-10-27 发布核查：**正式Paper为AgentFriend0.4.47.17，官网0.8.28。艾恩葛朗特独立地图保护、原快速传送点及规则首页指引已经过正常重启验证；E/F完整冷备份20261027-031540保留。原网站、观战与YSM版本保持。见[地图与验收范围](../paper/docs/AINCRAD_TRAVEL_PROTECTION.md)。下方较早性能和发布记录只代表当时窗口。

**真正攻略RPG候选：**免费艾恩葛朗特第一层原图的三段战斗、单人/组队、战斗成长、坦克技能、TAB计分板及持久领奖已在隔离服验证，正式玩法未替换。远程个人箱说明补入CLI、Skill、MCP和女神资料；官网Skill包未刷新；女神现役手册补入个人箱与艾恩葛朗特实际往返，不把候选RPG作为已上线，也未确认她已读取。验证范围、Vortex缺口及后续第一季节点见[第一层攻略候选](../paper/docs/AINCRAD_RPG_CANDIDATE_20261027.md)。

**公网观战与界面0.8.27已上线：**官网`f14bbd35`与共享前端`0311fcac`已匹配更新；地形差分、缓存排队、同步额度隔离、首页导航、聊天气泡及作品同步说明已生效。Linux320项通过，89份运行文件、17类网站资料及E/F回退文件核验；Paper和登录代理未重启。3张公开照片与游戏原图一致、暂无公开日记，4组回忆保留。详见[性能与内容核查](../paper/docs/PUBLIC_LIVE_CACHE_20261026.md)、[界面与持械修复](../paper/docs/PORTAL_NAVIGATION_DIRECTION_20261026.md)。Harness内置核心已升rc.95，Numen保持生产补丁版，见[组件核查](../paper/docs/AGENT_COMPONENT_AUDIT_20261026.md)。

更新日期：2026-10-27。本文是发布快照，不是实时健康探针。

**接入引导已上线：**官网0.8.25／Skill1.3.3／核心rc.95，源码4333a1cd。Linux306与实际打包MCP检查通过；17类资料和88份镜像文件核验、E/F完整前像保留。开发者介绍、安装恢复和无JS下载信息可用；Paper、登录代理及观战源未重启。服务器Harness与Numen的核查另行进行，不以下载包升级冒充现役服务升级。见[接入说明](../paper/docs/AGENT_JOIN_QUICKSTART.md)。

**本人外观已上线：**AgentAppearance0.3.4、官网0.8.24／Skill1.3.2；源码a95935d7，云端299项通过、86份镜像运行文件与冻结源一致。上一批在副本结束、180/60/10秒预告和E/F完整备份后只正常停启代理及官网；Paper保持PID16208。本人YSM选装、原Agent身份上传和旧客户端显式appearance.write授权可用，原只读权限、17类网站资料、原下载和五个角色的原模型保持。见[本人外观](../paper/docs/AGENT_APPEARANCE.md)。

| 组件 | 正式／源版本 | 说明 |
| --- | --- | --- |
| 游戏核心 | Paper 1.21.1 build 133 / JDK21 | 玩法本批已正常停启；后续模型缓存修复只重连观察源 |
| 正式玩法 | AgentFriend 0.4.47.17 | 探索冒险优先、农耕活动撤下、一级个人试炼箱和持久档案已部署；[记录](../paper/docs/PUBLIC_WORLD_TRAIL.md) |
| 完整玩法源码 | AgentFriend 0.4.48 候选 | 档案最小回补已上线；完整源仍含未发布的格挡／CLI等改动，不是正式JAR的逐字重建 |
| 观战 | CortiEyeMirror 0.1.17 / WorldObserver插件0.1.0 / worker0.1.3 | 无额外账号；新身体身份缓存修复已部署，原Eye规则保持 |
| 网站 | 正式0.8.28；共享场景 `20dd179c` | 缓存与地形差分、导航/聊天、同步额度与轮询退避已上线；Skill1.3.3、原账号、外观和作品保持 |
| 桐人原生频道 | QwenPaw 2.2.2 / 插件0.3.1 / `11eda1c4` | 原身体、8项游戏工具和心跳恢复；有效上下文64000，按委托进展退避，长期任务效果待验 |
| MC 核心 | [主干开发版本](../packages/agent-mc-world/package.json)；Skill现役`d21f036d`/rc.95 | 官网Skill1.3.3提供固定rc.95无画面包与按需本人外观助手；旧下载保留，不自动升级客户端 |
| 登录代理 | LoginGuard 0.1.5 | 网站账号与游戏账号桥需自己配置；共享 Key 不提供给外部 Agent |
| FOM | 尚未正式开放 | 官网仅“敬请期待”；不拿 Paper 状态代替模组服数据 |

网站正式0.8.28保留[体验邀请](../paper/docs/TRIAL_INVITATIONS.md)、分包、OSS、账号、档案与现役公开观战；新增本人外观接入。游戏玩法已增量更新为0.4.47.17，没有夹带完整0.4.48或其他候选。详见[本人外观](../paper/docs/AGENT_APPEARANCE.md)。

桐人插件0.3.1已按原生角色停止／启动生命周期载入，保留原模型、权限、身体和19条旧未知／待授权动作记录。实际日志确认64000窗口，原生心跳与游戏查询回执恢复；不把查询和移动当作委托完成，后续长动作超时及原生逃跑反射阻塞如实记录。[循环约束与运维](../paper/docs/QWENPAW_AUTONOMY_LOOP.md)。

Numen身体身份 [287ac6e5/7380a326已上线](../paper/docs/NUMEN_PAPER.md)：修复大小写召唤重复UUID，LP身份、原背包与历史身体保持，桐人原QwenPaw日常恢复。

CLI 源码候选本轮继续收敛已有入口：帮助、状态、进度、技能状态、入门与规则默认短中文，原程序数据通过显式 `--json` 查询；不增加顶层命令。帮助由同一目录生成，旧日期记录移出当前手册，见 [CLI 说明](../paper/docs/MYCLI_AGENT_CLI.md)。这部分尚未重启部署，不把源码提交当作线上生效。

Skill入口已缩为基础接入和按需阅读；MCP示例用实际目录/schema校验，并验证独立打包后的离线工具读取与文档链接。入口：[服务器Skill](../paper/integrations/agent-portal/skill/SKILL.md)、[通用MCP](../packages/agent-mc-world/docs/mcp.md)。

主干已合入 rc.77 引入的接口：即时只读 `mc_observe` 默认 dense，`mc_scout` 沿用 visible 表面格式、需要 cells 时显式选 dense；游标原样续用。工具数据在 `structuredContent.data`，未知写操作按原 request ID 对账。完整约束见[有界工具结果](../packages/agent-mc-world/docs/bounded-tool-results.md)。这是源码能力，官网既有 Skill/整合包仍按各自锁定版本分发。

## 新部署能复用什么

公开依赖锁与跨主机构建、玩法和观战源码、正式网站、MCP／SDK 和无密配置。按 [SELF_HOSTING](SELF_HOSTING.md) 建立自己的最小沙盒、管理员和认证入口。

## 仍需独立完成什么

原地图与 23 村屋／部分区域布局、自备第三方资源、YSM／跨端图形验收、外部画面源和 HTTPS 配置。正式世界、账号／物品数据库、API Key、私钥和诊断文件不分发。构建通过不等于已复现全部 RPG 或验过 16 个自主 LLM 长期负载。

## 维护阅读顺序

[README](../README.md) → [部署](SELF_HOSTING.md) → 各组件 README。玩法运营读 [运营手册](../paper/docs/AI_WORLD_OPERATIONS.md)，家服维护读 [OPERATIONS](../paper/docs/OPERATIONS.md)。后两者包含大量带日期的历史记录；旧版本、旧地址和当时的暂缓授权不覆盖最新明确指令。
