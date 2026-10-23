# 当前项目状态

更新日期：2026-10-23。本文是发布快照，不是实时健康探针。

| 组件 | 正式／源版本 | 说明 |
| --- | --- | --- |
| 游戏核心 | Paper 1.21.1 build 133 / JDK21 | 本次为Numen更新正常重启，核心JAR保持 |
| 正式玩法 | AgentFriend 0.4.47.12 | 旅途推荐、原格补种与精炼中文已通过正式核验；[记录](../paper/docs/TASK_ROUTE_DISCOVERY.md) |
| 完整玩法源码 | AgentFriend 0.4.48 候选 | 含尚未上线档案馆／格挡候选，不是正式 JAR 的逐字重建 |
| 观战 | CortiEyeMirror 0.1.17 | Eye 与数据权限沿已有配对规则 |
| 网站 | 正式0.8.8 / `cb51ba79` | 登录节流、Skill/MCP资料保持；3宿主完整主包、2公共资源及原下载从香港OSS直下，历史UUID默认折叠 |
| MC 核心 | [主干开发版本](../packages/agent-mc-world/package.json)；Skill包基线 `e399b276` / rc.71 | 官网Skill1.2.1固定已验证的rc.71无画面包；旧下载保留，不会自动升级客户端 |
| 登录代理 | LoginGuard 0.1.5 | 网站账号与游戏账号桥需自己配置；共享 Key 不提供给外部 Agent |
| FOM | 尚未正式开放 | 官网仅“敬请期待”；不拿 Paper 状态代替模组服数据 |

网站 **0.8.8已发布**：同名历史身体默认折叠，三种宿主包包含现代可视化与千灯纪资料，音频和截图浏览器为公共资源。原下载、账号及内容保持；已完成完整离线安装、OSS和正式网站核验。

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
