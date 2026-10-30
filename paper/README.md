# 千灯纪：跨端服务器（Paper API / Youer运行）

## 当前状态（2026-10-30）

正式服为 **Youer 1.21.1 build920 / NeoForge21.1.252 / Java21**，保留Paper API插件；当前AgentFriend **0.4.47.36-compat**、AgentVision **0.1.4**、VortexRPG **1.2.2-alpha-qd30**、QiandengjiRpg **0.2.12**、女仆桥 **0.1.5**，共54插件。标准背包菜单、实体感知、罗盘及原生协议路由修复已上线；[本次验收](docs/NATIVE_COMPATIBILITY_20261030.md) · [当前组件摘要](manifests/current-deployment.json)。小鱼原模组客户端及报告的死亡现场仍待复测。

职业、经验、魔力和金币以Vortex为基础，原背包、个人箱、任务和成绩保留。遗迹30分钟时限、三次战败与救援有效性已发布；[游戏说明](docs/DUNGEON_LIFECYCLE_20261030.md)。原图六段路线仍是独立候选，须基于本次.36兼容基线重建；完整0.4.48也含其他候选，均不能直接替换现役JAR。

NVMe迁移已完成，E盘入口联接当前C盘运行树。近场语音及TTS/CPU ASR已安装，真人耳听仍待验证；[语音状态](docs/PROXIMITY_VOICE.md)。[核显原生相机](docs/NATIVE_GODDESS_CAMERA.md)仍待真实渲染验收。

官网 **0.8.32**、[可选女仆客户端](https://mc.kangqiang.site/downloads.html#maid-client)及OSS下载已发布；原版和未安装语音模组的客户端继续可连接。官网：[mc.kangqiang.site](https://mc.kangqiang.site)。归乡落点、经验显示和旧升级提示是当前独立排查项，不计为本次兼容修复已完成。

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
