# 聊天接收范围与机器回执

## 规则

| 内容 | 接收范围 |
| --- | --- |
| 保护拒绝、状态、背包、任务与技能查询 | 操作者本人；完整数据保持私有 |
| 观战聊天 | 当前附身对象的中文提示与正常聊天，隐藏机器 JSON 和旧版 `key=value` 回执 |
| NPC 私有答复与对应气泡 | 提问者及其当前附身 Eye |
| 试炼塔与遗迹地下城进度 | 本次参战队伍 |
| 原版管理命令结果 | 执行者本人；控制台审计保留 |
| 维护与版本通知 | 全服简短中文；结构化状态仅写维护日志 |
| 玩家公开发言、正常世界事件与成就 | 维持对应游戏内公开范围 |

不要把另一位玩家的公共发言或世界公告当成本人的动作回执。命令发出不等于完成，查询及最终确认必须使用本人连接的数据。

## 此次修复

截图里的 `MC_PROTECTION` 原本是操作者的私有系统消息，经 Eye 镜像后占满画面，并非其他玩家都收到。AgentFriend 0.4.32 将自动拒绝精简为最多三条中文，包含原因、准确范围和正确下一步；真人默认不显示原始 JSON，Agent 本体及私有 `mcagent:protection` 数据保留。显式详细查询支持 `/mycli protect break|place|container|use <x> <y> <z> --json`，不更改保护权限。

CortiEyeMirror 0.1.15 同时过滤合法 `MC_* {…}` 与旧式 `MC_* field=value` 系统消息的观战副本。固定 Eye、自动命名 Eye 与 live 使用相同规则；原消息仍交付给本体。普通聊天、私聊、引用和无效 JSON 保留，过滤不作用于玩家聊天包。

维护脚本之前确实使用 `tellraw @a` 广播 `MC_MAINTENANCE` JSON，已删除这条广播。公开通知仅包含中文预告或更新摘要，机器字段写入私有维护日志。`messages()` 返回条数发生变化：预告和取消各一条，更新为标题加摘要；维护队列必须按实际条数检查回执，不能沿用旧的两条预告门禁。

已审查自研插件的广播与在线玩家循环、NPC 气泡、试炼塔通知、任务板、村庄警报、ConditionalEvents、Essentials SocialSpy，以及管理命令反馈。正式权限导出确认默认组的 `minecraft.admin.command_feedback=false` 和 `bukkit.broadcast.admin=false` 仍生效，没有启用 SocialSpy 的玩家。保留 `sendCommandFeedback=true` 与 `logAdminCommands=true`，本人反馈和控制台审计可用。

## 验证与边界

已提前通知并通过原维护任务正式部署，完整E/F冷备份为`20261012-211001`。正式服17项认证/背包/真实附身Eye检查和29项状态检查通过；女神已实际只读读取新资料并正确回答接收范围。yubeen稍晚完成登录，维护前四个账号已同UUID恢复在线。

- 隔离 Paper 1.20.6：40 项真实 Java/Mineflayer 4.39 连接检查，包含两个独立角色、真人模拟、固定/命名 Eye 和 live，实际保护拒绝、本人完整数据、其他角色隔离、维护广播、原版管理反馈与正常私聊。
- 基岩经回环 Geyser/Floodgate：8 项协议检查；未替代手机/Xbox画面验收。
- 回执识别 25 断言，维护通知 7 项，现有 Web 聊天 4 项通过。40 KB JSON 只验证纯识别器，不声称已通过实际连接。
- 第一轮隔离管理反馈失败：测试副本缺少正式服已有的两条权限限制。保留失败报告与前后导出，仅同步隔离配置后完整复测通过。
- 正式首轮QA错误要求无保护的`allow_likely`响应也含拒绝专用范围数组，报告保留；改按实际响应结构逐字段并完整比对私有负载后复验通过。未为测试改动服务端语义。
- Web 使用既有聊天折叠与回看功能，本次没有新增 Web 协议；外机运行端仍须自行更新。

复现入口：`paper/plugins/CortiEyeMirror/test-machine-chat.ps1`、`paper/plugins/CortiEyeMirror/protection-chat-stage.mjs`、`paper/ops/tests/protection-chat-bedrock.integration.mjs`、`paper/ops/tests/maintenance-notice.test.mjs`。联机脚本只允许独立回环 256xx 测试环境，不得指向生产服。

生产发布、备份与回退见 [维护规范](OPERATIONS.md) 最新章节。私有证据目录为 E/F `repairs/chat-audience-release-20261012`；正式版本与上线完成状态以该章节和实时服务器查询为准。
