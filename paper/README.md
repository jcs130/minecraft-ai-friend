# 千灯纪：Paper 跨端服务器

## 当前状态（2026-10-28）

正式服：**Paper 1.21.1 build 133 / Java 21 / AgentFriend 0.4.47.21 / VortexRPG1.2.2-alpha-qd27 / QiandengjiRpg0.2.0**，官网 **0.8.28**。六职业、唯一成长与魔力、八张冒险任务、天赋、考试和旧副本救援已正式接通；旧职业只读归档。副本准入识别四护甲及近战、弓弩或本职业法器，不强制带剑；[正式发布与回退](docs/NATIVE_RPG_RELEASE_20261027.md)。Multiverse5.8.1、起始之城保护和原村庄往返保持。完整0.4.48仍有其他候选，不可直接替换现役JAR。

新增[mcbot独立适配候选](integrations/mcbot/README.md)，接入原Paper与原世界，不改为Fabric服务端；以及[玩家假上下线修复候选](docs/PLAYER_ROSTER_OCCLUSION_20261028.md)。两项尚未部署，不将隔离验证写成正式生效。

官网：[mc.kangqiang.site](https://mc.kangqiang.site)；宣传片：[B 站](https://www.bilibili.com/video/BV13fnW6CEzi/)。

## 入口

- 玩家与 Agent：完成认证、进入世界后，用 `/mycli help`、`/mycli status` 和 `/mycli tasks list`。
- 公共装备与补给：`/mycli guild shared`；优先附近探索、试炼与遗迹，农耕活动已撤下新接入口。
- 默认任务反馈为精炼中文，需要程序数据时显式使用支持的 `--json`。
- 自己搭建：[独立部署](../docs/SELF_HOSTING.md)，使用 `self-host/selfhost.py`，从新目录下载校验公开依赖并编译。
- 网站：`integrations/agent-portal/` 为已上线版本；配置自己的账号库、桥与 Key，不使用维护者私有配置。
- 通用 Agent 核心：[agent-mc-world](../packages/agent-mc-world/README.md)；可视化是[独立仓库](https://github.com/jcs130/mc-visual-console)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/AgentFriend/` | 技能、职业、任务、试炼、地下城、摄影与保护规则源码 |
| `plugins/CortiEyeMirror/`、`plugins/shared/` | 观战和私有状态同步 |
| `self-host/` | 无家服依赖的编译入口与依赖锁 |
| `integrations/` | 网站、认证、基岩、模型和 Numen 等可选集成 |
| `config/`、`manifests/` | 无密配置模板、来源和各批次版本清单 |
| `ops/`、`probe/` | 运维代码、发布门禁与探针；原主机脚本移植前需改为自己的路径和权限 |
| `docs/` | 玩法与带日期的维护记录 |

## 部署和数据边界

最小沙盒不会生成原服务器的城镇和公会建筑。部分区域／村屋掩码仍依赖原布局，需要自己的场景配置；缺布局会明确报错，不能声称完整 RPG 已复刻。第三方插件、模型和数据包需要分别遵循许可。

默认自部署后端只监听本机、离线身份且关闭 RCON；对外开放前须先设置自己的认证代理并封闭后端。Java 原版无需 Numen，基岩由 Geyser 接入；YSM 和图形能力按实际客户端另配。

正式维护需当次授权、提前提醒、在线身份与活动副本检查、完整恢复备份、正常停启和部署后核验。不能用全服 `/reload` 替代 JAR 更换，也不能整库回写旧玩家数据来回退代码。

运行世界、玩家背包、数据库、邮件／模型／云凭据和诊断转储不在 Git 中。历史状态以记录日期为准，当前版本入口见 [项目状态](../docs/PROJECT_STATUS.md)；旧工程保存在 [归档分支](https://github.com/jcs130/minecraft-ai-friend/tree/legacy/pre-paper-main-20261023)。
