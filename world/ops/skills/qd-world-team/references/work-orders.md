# 从观察到可复测工单

先查 `team_cases(owner="mine")` 或需要时的 `owner="all"`，再用 `team_case(case_id)` 读取详情与最新 `version`。快照过期、角色暂未观测到、执行失败是不同情况；引用快照的时间与字段，不从缺失直接推断死亡或服务崩溃。

真实新反馈调用：

`team_report(request_id, dedupe_key, title, category, observed, expected, evidence)`

`category` 为 `bug/gameplay/content/operations/improvement`。同一问题复用 `dedupe_key`；`request_id` 标识这份内容完全相同的报告，建议使用 8–64 位英文、数字和连字符。重复相同 request 会返回已有结果；同键不同内容会冲突。新的观察用新 request_id、原 dedupe_key，不制造一组重复问题。首次报告生成署名 Markdown 文档和工单，后续更新保留在事件记录中，阅读时以 `team_case` 的事件为准。

证据应含实际的时间、任务或动作编号、文件/回执路径、观察与预期差异。复现步骤写具体触发与条件，例如“原任务中导航报告失败、身体位置三次未变化”，不要写“可能 AI 不够智能”代替事实。不要复制密钥、供应商配置或整段私有对话；用必要的短片段、编号和哈希定位。

更新调用：

`team_update(request_id, case_id, expected_version, status, note, evidence, assign_to=None)`

状态含 `open/working/blocked/needs_review/resolved/duplicate`。拿到 `case_changed` 后重读详情，理解别人的更新，再使用新版本提交自己的新动作；不能反复递增猜版本。`assign_to` 与 `resolved/duplicate` 仅女神、司灯可用。提交工程修复时记录 commit、测试 job 和源哈希；活动记录 contentId、发布回执与实际看板编号。`resolved` 是团队报告状态，不会自动部署代码、生成实体或发奖。

遇到未知提交、未知游戏动作或测试仍在途，记录原编号并在下一次适用任务中查询。工单交接本身不会启动对方模型，不额外编写轮询进程。真人玩家或角色实际体验后的复测结果，应附原工单，避免把工具 HTTP 成功当成游戏效果成功。
