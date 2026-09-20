# 桐人：行为 session 与增量上下文

2026-09-20，QwenPaw 2.2.1 / AgentScope 2.0.7.post1 / ReMe 0.4.1.11。

## 问题与实际来源

原控制器把所有行动、复盘和学习接在一个持久生活会话上，每次又发送完整 `life_context`：规划说明、学习流程、能力更新、上轮动作和资源摘要。QwenPaw 已按 `session_id` 恢复历史，这些重复说明因而在历史中不断累积。

本机检查时，桐人模型为 `aliyun-codingplan / qwen3.5-plus`，`thinking_level=off`；没有改动这些选择。当前会话文件仍有 12 个历史 thinking 块、16,265 字符。**落盘存在不等于全部已发给当前模型**，需要看原生 formatter 实际输出。

已读安装版 `agents/react_agent.py`、`agents/context/scroll/manager.py`、`agents/model_factory.py`：Scroll 原来主要在压力较大时折叠已消费的思考；formatter 明确区分是否支持省略，DeepSeek 的原样推理回传、Anthropic 的签名块和 Responses 的原生表示由框架负责。

QwenPaw 接口本就接受新增 input，无需应用重发完整历史；模型供应商请求仍可能包含有效上下文。本次缩减重复内容，不承诺所有供应商都支持网络层只传增量。参见 [官方 API 说明](https://github.com/agentscope-ai/QwenPaw/blob/main/website/public/docs/api-tutorial.en.md)。实际实现以安装的 2.2.1 源码和隔离镜像测试为准。

## 新行为

设置 `contextProtocol: 2` 时：

| 类型 | session 规则 |
|---|---|
| 行动 | 由模型保存的 `memory.goal` 与当前使命确定；同一小目标复用，换目标换 session |
| 复盘 | 单独的 review session |
| 学习 | 单独的 learning session |
| 伙伴对话 | 保留原生活主会话地址，兼容现有收件人绑定、回执和投递 |

除伙伴地址外，每个行为会话最多接续 24 次已完成调度，再带短工作记忆交接到新 session。这是上下文生命周期，不是模型调用次数或迭代额度；没有修改模型并发、生成配置、预算和原生工具权限。

长期人格、文件记忆、ReMe、技能、原生活身份与历史会话继续保留。新 session 只带 goal / nextFocus / lesson 的短交接，不复制前一行为的思考轨迹。死亡后的原生生活身份轮换会让行为缓存进入新一代。

`behavior_context.py` 将唤醒消息投影成：

- 每次保留当前 `turn_id`、行为目标、时间和完整的必要身体摘要，防止旧授权/旧危险状态混入操作。
- `updates` 只替换变化的顶层事实；`removed` 显式删除；`events` 只送新事件或发生变化的动作回执。
- 固定操作解释仅在会话开始给一次简要规则和资料入口；不在每次短操作追加整套学习、规划教程。
- `accepted → completed` 的同一 action ID 是新的证据，仍会投递；相同回执不会反复注入。
- 只有原任务明确成功结束，才推进本地增量基线。提交不确定、模型失败或进程重启不凭空确认送达，也不重投未知副作用。
- 缓存仅存事实 hash、已见事件 hash 和 session 身份，不再复制一份完整提示词。

QwenPaw 的 Scroll 仍负责历史回收。未重复发送不表示事实永远新鲜；按观察时间核验，完整事实仍通过 status / skill_read 等按需读取。

## 思考内容处理

`survival_request_runtime.py` 的版本 2 只作用于已核对角色、工作区、调用来源和当前 turn 的 protocol-2 请求。在实际模型输入准备后：

1. 收集此前回复的 thinking 块，以及 Scroll 已确认被模型消费的当前回复 thinking 块。
2. 通过 QwenPaw 原生 `set_thinking_omit_ids` 交给 formatter 处理。
3. 当前尚未消费的思考保留；不改任何历史 Msg、工具调用、结果或签名。
4. 不支持省略的协议由原生能力检查清除省略集合，不强行删块。

实际 formatter 测试核对了序列化后的 `reasoning_content`，并确认历史块未变。不是仅隐藏 UI 中的“思考”标签。

参考 [Cortico core/loop](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/core/loop.ts) 的处理确认与 generation、[round.ts](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/worlds/minecraft/round.ts) 的同轮同读数去重。本次复用 QwenPaw 会话/formatter，没有引入另一套 Agent 循环或复制第三方实现。

## 可复核结果

从真实持久会话提取最近一条旧唤醒输入，离线投影后比较 JSON UTF-8 大小：

| 输入 | 字节 |
|---|---:|
| 原始唤醒 | 17,674 |
| 新行为 session 首条 | 11,096 |
| 同事实、仅观察时间变化的模拟后续唤醒 | 1,428 |

后续唤醒比原输入减少 91.92%。这是调度 JSON 字节量，**不是供应商 token、缓存命中、费用或游戏性能提升**。后续行是明确标注的模拟，未伪装成第二次线上模型调用。
样本会话文件 SHA-256：`6ea7c7abe14d48af2788aa443148805e90d720e24a4d69b6bf02e64c31f3371c`；本机报告 `runtime/context-benchmark.json` 不公开原文。

验证包括：15 个行为/控制器测试、4 个配置迁移测试、在实际 2.2.1 隔离镜像内通过的 7 个原生适配器测试，以及不挂用户状态、不联网的运行时恢复探针。恢复探针中陈旧的记忆适配器版本常量改为与现有 `life_memory_evidence.VERSION` 对齐，仍执行其原生源码契约检查。

旧 `test_survival_life_session.py` 共 48 个，其中 2 个失败、5 个错误；未修改的 `038e017` 基线复跑相同用例和结果。没有降低这些断言或宣称全套回归通过。

## 启用与恢复

`tools/configure_survivor_context.py --root <生产项目路径>` 默认只预览；`--apply` 要求控制器与原生角色任务空闲、身体动作已结束、运行中的请求适配器确为版本 2。
工具备份原 settings 与 AGENTS，使用原生 workspace ETag 更新会话说明，保留个人补充；设置文件只新增/更新 contextProtocol。它不停止、恢复或重试任务。

上线先经原 `control.py drain` 等当前任务正常完成，再合并代码、重载服务、应用配置。生存健康探针检查配置与心跳协议版本一致；QwenPaw 探针检查适配器版本。
回退可在同样的空闲点把 `contextProtocol` 设回 1，再重启 survivor；原生适配器的省略逻辑只处理 protocol 2，旧历史和缓存文件不用删除。恢复旧 AGENTS 时应核对备份 ETag/内容，不能覆盖后续个人编辑。

本次已通过自然任务边界完成维护，保留本地 `standing_task` 等并发改动；Minecraft 未重启。上线的具体健康和首轮结果见本机 `runtime/context-live-verification.json`。

线上首轮 review 已正常完成，独立 session 的 protocol-2 输入保存在 QwenPaw 原生会话中，增量缓存已确认对应 turn；原生活 session 保留，控制器继续自主调度。生存健康探针返回 `contextProtocol=2`、`ok=true`。
QwenPaw 总健康仍有此前已存在的 `role_learning_profiles.validate_jobs:text_drift`，未把此告警算成本轮通过；未清空或改写学习任务来掩盖它。
