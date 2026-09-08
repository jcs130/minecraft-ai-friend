# 游戏策划、剧情投稿与实际发布

先读取 `world_content_context()`。只有 `ok=true` 的新鲜上下文可用于新内容：选择实际在线且职业匹配的 `issuers`、当天或次日 `days`、真实合同编号与目标哈希、`items/mobs/destinations`。`receptionReady=false` 说明公会接取入口尚未确认。`proposalFormat` 是当前精确字段合同，以它为准；不要从旧世界坐标或文字设定创造可用场地。

剧情顾问 `operations:mc-priest` 使用 `world_content_submit_story(request_id,title,story,objectives)` 投稿。返回 `story_proposed` 只证明投稿保存；将 contentId 记录在工单，供策划按需用 `world_content_read(content_id)` 读取。投稿不能直接批准成任务。

游戏策划 `game:qd-guild-planner` 使用 `world_content_submit(request_id,content)` 提交可执行候选，当前结构为：

```json
{
  "date": "从context选日期",
  "title": "活动名",
  "story": "依据真实世界状态写缘由，不把设定说成已发生",
  "ending": "预设结局，是否达成另看游戏回执",
  "stages": [
    {"id":"food","kind":"gather","issuer":"从context选key","title":"补给","pitch":"说明本单用途","item":"wheat","count":6,"reward":2}
  ]
}
```

上例是格式示意，不是当前有此发单人的证据。每个阶段共同字段为 `id/kind/title/pitch`，另外的字段严格按种类选择：

| kind | 额外字段 | 当前真实验收 |
| --- | --- | --- |
| `gather` | `issuer,item,count,reward` | 原公会/村民交付实际材料、核对背包与奖励 |
| `hunt` | `issuer,mob,count,reward` | 接取后的实际新增普通怪物击杀 |
| `visit` | `issuer,destination,reward` | 当前仅 `far_horizon`，距离原公会锚点超过300格 |
| `existing` | `questId` | 引用 context 中同日、目标不变、尚可接的既有合同 |

阶段 1–6 个；新 gather 数量3–24，hunt 数量1–5，奖励1–3绿宝石；标题与描述限长看 `proposalFormat`。同一发单人有未完收购单时不能再塞一张，改用既有合同或选择真实空闲发单人。目标、奖励与已接进度不能被新活动覆盖。阶段顺序是故事引导，原公会仍逐单接取验收；没有额外的“剧情通关奖励”。

候选返回 contentId 后通过 `team_report` 或既有工单更新交给女神。只有 `game:mc-god` 可调用 `world_content_publish(request_id,content_id)` 批准。随后用 `world_content_read` 查 `publication`：排队并非发布；未来日期等待日切；`blocked/expired/publication_unconfirmed` 必须说明实际原因。只有 `published` 及当前真实看板、货单回读一致才能报告任务已发布。玩家可在原看板看到标题/引言与 No. 链接，对岚说“活动 N”查看正文；预设结局明确不是完成证据。

当前 `boss/chest` 的 `capabilities.ready=false` 是实际执行缺口：需要现场勘察、原生生成或放置前后回执、Boss专属击杀/箱内战利品归属、清理与未知状态恢复。记录具体 missing 项为工程工单，由女神转交世界工程师。旧自动生成代码固定高度、缺专属结算证明，不能重新打开开关来绕过缺口，更不能把普通劫掠兽击杀或任意钻石交付当成当前首领/宝箱活动成功。

旧 `guild_quest` 接口仍接受调用方明确要求的货单 JSON；这与团队班次的内容包是两个现有入口。收到旧严格 JSON 请求就遵守该协议；团队策划班次使用本页工具提交内容，不能只返回旧货单 JSON 假称活动发布。
