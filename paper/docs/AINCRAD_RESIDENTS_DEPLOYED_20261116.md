# 艾因格朗特居民与玩家模型：2026-11-16 正式记录

千灯纪已加载合并的居民扩展 0.3.0 与 AgentFriend 0.4.47.82。第一位居民桐人住在 `minecraft:aincrad`，门口 `(-672, 67, 825)`。他使用今日加入的 `qd_hub_kirito.ysm / skin`，有原生女仆床、工作台、熔炉、木桶和双面门牌；住房领地按他自己的身体 UUID 授权，公共访问规则保留。

桐人是原生车万女仆实体，不占服务器玩家名额。当前职业为游侠，装备铁剑、皮甲和铁靴；基础职业经验与技能使用 `resident_classes_v1`，不能把它说成已完整接通所有玩家 RPG 系统。Qwen Code 经本机 LiteLLM 调用线上 `tokenplan/qwen3.8-flash`，原生 AI 负责持续行走、工作及作息。

## 玩家怎样使用

玩家可以通过 `/maidagent companions` 菜单了解附近伙伴，也可在附近点名交谈。菜单中的招募仍会询问角色意愿；不同角色有自己的偏好和记忆，并非选择模型就自动获得一个 NPC。管理员查看 `/maidagent residents`，按原 UUID 查询状态与动作回执，不重复生成角色。

另外新增 25 款玩家可选外观，加上先行加入的新桐人，本批共 26 款；包括 Saber Alter、初音、荧、雷电将军、流萤、黍、哪吒、狐和兔等。Java 玩家在 YSM 原生界面选择，或从 `/appearance list 1` 开始翻页。完整文件 ID、贴图名、作者及来源见[模型清单](YSM_PLAYER_LIBRARY_20261116.md)。原有 119 个模型文件逐字节保留，不改变玩家已选外观。

## 实际验收

- PR #270 与 #271 已合并，各自六项 CI 通过。居民先经过 74 项 Java、8 项 Python、3 项 Node、29 项原生与 16 项混合服检查；复制地图的 7 项检查覆盖穿门、睡眠和正常重启。
- 正式仅生成一位新桐人，UUID `8ae995f9-5944-48c9-b720-0ab91bdfff09`，没有复制测试实体。家具实际安装与领地身份已回读。
- 正式模型规划已有实际终态：20:24:58 恢复原生日程；20:28:27 自主回家，到达 `(-671, 67, 826)`。20:29:29 的新请求在修正 Qwen 配置后完成休息动作。前两笔为定时规划，后一笔由管理员触发一次新的规划验收。
- 三笔真实动作分别写入本地经历，并获得独立 PowerContext Scope 的 `stored` 回执。没有把协议测试或失败规划记成游戏成果。远端搜索回读与长期采用尚未完成验收。
- 26 个原始模型通过 Java 客户端加载和逐个截图检查，并核对原生公共模型目录，不绕过模型所有权校验；这不是每个特殊动画的完整验收。

## 本轮修复

原网关在模型超时、游戏请求断开后向已关闭连接写入回包，触发 BrokenPipe；Windows 启动脚本又把 stderr 当成终止错误。现在连接断开只结束原回复，不重跑模型、不重放动作；工作进程使用独立 stdout/stderr 和每次启动独立日志名，恢复程序继续检查唯一进程与环回监听。24 项网关回归包含客户端断开及下一次健康查询。

另实测 Qwen Code `1.0.0-preview.1` 的两个配置陷阱：未声明自定义模型的思考能力时，CLI 的关闭思考参数未出现在实际请求中；仅传 CLI 输出预算时，`max_tokens` 也缺失。声明能力并配置完整模型名的 `model.preferences` 后，原始 HTTP 请求包含 `enable_thinking:false` 和 `max_tokens:900`。这是桐人私有配置的修复，共享 LiteLLM 和其他角色未改。

真实二进制的三种请求对照可用 `standalone/tests/qwen-code-wire-stage.py` 重跑；只连接本机模拟 SSE，不调用线上模型或执行游戏动作。配置示例见[Qwen 配置](../integrations/touhou-maids/standalone/examples/qwen-settings.example.json)。依据为该固定版本的[请求转换源码](https://github.com/QwenLM/qwen-code/blob/v1.0.0-preview.1/packages/core/src/provider/transport/impl/chat-completions-factory/request/chatCompletionsStreamReqFactory.ts)与[配置 schema](https://github.com/QwenLM/qwen-code/blob/v1.0.0-preview.1/schemas/settings.schema.json)，而不是假定 CLI 选项已生效。

## 维护与当前边界

居民发布经过维护预告、原 JVM 正常退出及当次 F 盘完整冷备。r3 的配置文本哈希误判触发中止；r4 比较完整 JSON 语义、保留原失败记录后完成恢复，19:54 正常运行。不得重跑已消费的安装、生成居民或装家具入口。后续网关修复及 Qwen 参数调整都未重启游戏，JVM PID 5196 保持。

回退只撤对应代码、模型或经核对的配置；不回灌世界、玩家、背包、认证、NPC 身体与动作/记忆账本。任何未知动作按原 requestId 查询和核对。模型备份、配置前像及维护记录仅在 F 盘保留。

尚未完成：桐人的实际日语音源与耳听；新增加密 YSM 在基岩/网页端的相同外观；全部特殊动画；长期自主生活、多居民社交与完整职业成长的正式压力验收。新模型保持原始加密文件、作者和许可，不能宣称解密转出了基岩模型。亚丝娜、诗乃等暂为角色目录方案，尚未投放。原肥鱼的身份、外观、音色与已有玩家资料保留。

组件、回执与已验范围见[正式清单](../manifests/aincrad-residents-deployed-20261116.json)。
