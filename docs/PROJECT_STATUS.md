# 当前项目状态

更新日期：2026-10-26。本文是发布快照，不是实时健康探针。

**本人外观候选尚未部署：**AgentAppearance0.3.4新增游戏内本人选装；官网0.8.24／Skill1.3.2补齐Agent身份上传皮肤/YSM，旧只读凭据保持。28+8项JVM、13项独立真实联机和5项正常冷重启读回通过；门户297通过/2条件跳过。正式仍AgentAppearance0.3.3、官网0.8.23／Skill1.3.1，Paper保持原进程。详见[本人外观](../paper/docs/AGENT_APPEARANCE.md)。

| 组件 | 正式／源版本 | 说明 |
| --- | --- | --- |
| 游戏核心 | Paper 1.21.1 build 133 / JDK21 | 玩法本批已正常停启；后续模型缓存修复只重连观察源 |
| 正式玩法 | AgentFriend 0.4.47.16 | 探索冒险优先、农耕活动撤下、一级个人试炼箱和持久档案已部署；[记录](../paper/docs/PUBLIC_WORLD_TRAIL.md) |
| 完整玩法源码 | AgentFriend 0.4.48 候选 | 档案最小回补已上线；完整源仍含未发布的格挡／CLI等改动，不是正式JAR的逐字重建 |
| 观战 | CortiEyeMirror 0.1.17 / WorldObserver插件0.1.0 / worker0.1.3 | 无额外账号；新身体身份缓存修复已部署，原Eye规则保持 |
| 网站 | 正式0.8.23 / `a6b4656b`；观战场景 `ba56f73d`、样式 `87b8e7e6` | 一次性体验邀请和后续本人证明认领已上线；原账号、下载、公开观战与作品保持 |
| 桐人原生频道 | QwenPaw 2.2.2 / 插件0.3.1 / `11eda1c4` | 原身体、8项游戏工具和心跳恢复；有效上下文64000，按委托进展退避，长期任务效果待验 |
| MC 核心 | [主干开发版本](../packages/agent-mc-world/package.json)；Skill包基线 `79b30f98` / rc.90 | 官网Skill1.3.1固定已验证的rc.90无画面包；旧下载保留，不会自动升级客户端 |
| 登录代理 | LoginGuard 0.1.5 | 网站账号与游戏账号桥需自己配置；共享 Key 不提供给外部 Agent |
| FOM | 尚未正式开放 | 官网仅“敬请期待”；不拿 Paper 状态代替模组服数据 |

网站正式0.8.23新增[体验邀请](../paper/docs/TRIAL_INVITATIONS.md)，保留完整分包、OSS、账号和内容，并已匹配共享前端 `ba56f73d`、家庭源与发布器；游戏配套0.4.47.16最小JAR，包含持久日记和罗盘个人箱一级入口。已执行正常维护、E/F冷备份和原玩家文件保持核验，不直接上完整0.4.48。[公开足迹、验证与回退](../paper/docs/PUBLIC_WORLD_TRAIL.md)。

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
