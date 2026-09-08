# QwenPaw 技能学习验收

`python tools/smoke_agent_learning.py` 默认不触发模型、市场请求、世界动作或定时任务。它检查游戏与运营全部已注册角色的原生 Skills、启用的学习 MCP 和每周 cron，并运行真实 MCP initialize/list/learning_status。QwenPaw 2.2 没有公开的任意 MCP call API，因此调用部分使用官方 ClientSession 启动同一固定 driver 的短生命周期 stdio 连接，完成后关闭；正常运行仍由 QwenPaw 管理 driver。

报告写入 `reports/agent-learning-smoke.json`。六项标签分别记录原生技能、MCP 协议、周任务、无新证据跳过、角色隔离和当前源码哈希。无证据跳过与路径隔离使用真实代码和临时状态，不能据此声称模型已经自主学会技能，也不等于检验其他官方文件工具的权限。

`python tools/smoke_agent_learning.py --exercise qiandengji-ops` 才会请求一次运营 mc-herald 已有的 `qd-learning-mc-herald` 周任务。它保留原有任务内容、日程及用户启用选择；停用时拒绝，不创建临时任务、不伪造待学习证据。实际运行经过 QwenPaw CronExecutor 的项目预算检查，沿用共享 4 次/24 小时与 30 分钟冷却。一个任务可能包含多次模型推理，报告记录真实 mc-herald 用量增量。

单次提交在 `runtime/agent-learning-smoke/exercise.json` 持久预留。响应丢失或脚本重启后只收集结果，不再次提交；不要删除预留来绕过这个保护。原生 `started:true` 只代表请求受理。成功学习还必须有新 trace 中真实 draft/validate/activate 工具调用，或者官方 materialize_skill 调用及新生成的 source=agent 技能；同时核对当前启用的技能文件、归属与预算记录；代码块里写工具名不算调用。没有产生新技能时，报告明确 `skillProduced:false`，实验结果不会标成功。Markdown 流程仍是待持续验证的技能，不能宣称游戏行为已通过实测。

默认模式可重复运行，报告区分实时 API/MCP、临时夹具与可选模型实验。模型用量是该角色在实验时间段内的实际增量；若有人同时通过控制台调用同一角色，不能把全部增量都归因于这一次实验。
