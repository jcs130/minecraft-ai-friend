# 女神定时阅读公屏与私聊纠错

2026-10-28已热更新到现役QwenPaw `mc_godness`。原六个日常任务保持，另增原生 `qiandengji-public-chat-review`，每五分钟（02/07/12…分）执行，静默、独立任务会话、单并发、180秒超时。没有另建模型循环或游戏身体，没有重启Paper；原模型、凭据、权限和记忆保持。

女神按需核实玩法，不承担一个固定脚本教练：先看完整新增消息和前文，跳过玩笑、个人喜好、未证实的说法、已有正确回复或自行纠正的内容。必要时读取已发布规则或现有只读现场工具；证据不足就不发。核实后只向原发言者原版私聊，最多140字，给正确用法和一个可执行下一步。不替玩家选职、换任务、取物品，不催所有人做同一件事。

## 数据与性能

- [输入与传输](../ops/goddess_chat_review.py)每轮最多读取最新256KiB日志，仅识别实际公屏行，回看10分钟，最多24条新消息及12条已读上下文；超过预算明确报告缺口，不声称全覆盖。在线身份查询只对本轮选中的不同玩家执行，不逐行查询或扫描整个世界。
- 不采集私聊、登录命令、MC_AUTH或意外贴出的常见凭据；公屏内容是环境数据，不能成为运维授权。普通游戏问答的原有MCP只读策略保持。
- 本机SQLite只保存公屏游标、批次、去重与发送审计；公屏保留一天、发送ID保留七天，不复制玩家库存或世界数据库。日志轮换、同文件截断重长、末尾半行和Windows文件关闭均有测试。
- 每人任何提醒至少间隔10分钟，同主题30分钟；全局每五分钟和每批最多两条。当前收件人UUID与Goddess原UUID必须匹配。离线或同名换身份就不发。
- 发送前持久化ID；超时/进程中断不自动重发。原版`execute as`把反馈交给女神客户端，RCON空文本不代表成功。使用固定内部命令存储`qiandengji:goddess_chat`的独立事件键读回原版命令返回值，确认后清理；不改玩家、任务、计分板或其他存储。`server_confirmed`表示原版命令成功，仍不表示对方已读；无法核实保持`unknown`。

## 原生工具与当前事实

在[原MCP](../ops/goddess-mcp.py)增加三个工具：`review_public_chat`认领新批次，`whisper_chat_guidance`绑定批次/原发言ID并记录证据，`finish_public_chat_review`结束阅读。既有十九个工具不变。操作方法见[运营技能引用](../integrations/goddess/skills/world-evolution/references/chat-review.md)。普通游戏桥身份没有新工具权限。

[任务定义](../integrations/goddess/chat-review-job.json)与[计划生成器](../integrations/goddess/profile.py)复用原巡检的真实原生身份和投递目标，正常静默、不反复发简报，不改变其他任务。暂停/恢复用该任务的原生管理入口，不直接覆盖jobs.json。健康检查读原生任务state/history与本机inbox状态；原agent-status不完整计入cron执行，不能单凭idle判断定时任务未运行。

女神的[当前入口](../integrations/goddess/GODDESS_WORLD_CURRENT.md)与[规则](GODDESS_CURRENT_RULES.md)已校准AF.25/桥0.2.4/qd29，基础七技能免选职和学习，避免旧“技能全退役、Vortex未启用”说明误导。AF.26/桥0.2.5仍是未部署候选；本次没有夹带上线。原生拍卖的丢物风险尚未修复完成，不引导玩家尝试交易。

## 验证与发布边界

59项离线检查通过：聊天输入/隐私、去重、轮换、并发批次、UUID改变、限频、发送超时和进程死亡、原版命令回执的空文本/0/1与仅查回执恢复，以及旧MCP、运营台账和原生任务兼容。运行：

```text
python -X utf8 paper/ops/goddess_chat_review.test.py
python -X utf8 paper/integrations/goddess/test_profile.py
python -X utf8 paper/ops/goddess_mcp_test.py
python -X utf8 paper/ops/goddess-land-tools.test.py
python -X utf8 paper/ops/goddess-evolution.test.py
```

后两类MCP测试使用现有`mcp>=1,<2`环境；纯收件箱/任务计划/台账不需外部服务。测试从不连接正式服务器。

20:30–20:43四轮原生运行完成（一次手动、三次定时），真实读取并结束13条新公屏，未向玩家发送纠错：这些是分箭、凑床材料与约打怪，已有同伴解释，不能为了验收制造骚扰。只给女神本人做了原版私聊运输自检；独立读回原版结果1并清理临时键。不能把这当成已经对真人/Agent纠正成功或长期判断质量已验证；需要后续自然样本。

运行文件和原生任务的E/F前像、源摘要及验收已保存，49个游戏JAR保持。首次元数据更新未重连旧stdio进程；显式原生连接停启后的瞬时inactive曾触发检查失败并回退，后按就绪状态核验恢复。最终工具22个启用、原驱动策略与端点保持。不要重放已消费安装脚本或盲目反复toggle；仅修改工具列表可能只更新目录，不刷新进程中的代码。

回退仅暂停新增任务、恢复本次工具和提示前像、原生重连该MCP并等就绪；保留新产生的日记/公屏审计，不覆盖整个工作区、玩家存档或其他六任务。实际版本与验证范围见[清单](../manifests/goddess-chat-review-20261028.json)。
