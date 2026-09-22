# 桐人决策框架流程（2026-09-22 全量研读正本）

> 依据：`world/survival/README.md` / `AGENT.md` / `KERNEL.md` + 源码 + 实况状态文件。
> 这是描述性文档：**以运行实例与测试为准，文档不授权**。

## 0. 常驻节律
控制器每 **15s** 观察身体、每 **60s** 刷新周边；paused 时心跳照跑但不动手。
暂停自愈集（`recover_runtime_pause`）：9 种基础设施暂停 + **孤儿 operator_drain**
（drain 完成超 `SURVIVOR_DRAIN_ORPHAN_SECONDS`＝默认 4h 自动解除 ✓ 新 drain 重置计时 ✓
`operator_pause` 手动暂停永不自动解）。身体恢复（`body_restored`）也自动复绕。

## 1. 唤醒（什么时候想）
- **事件**：新目标 / 世界事件 / 生命·饥饿·库存变化 / 明显位移 / 动作回执
- **复盘信号**：`request_review` 入 `reviews.sqlite3`（持久防重，忙时保留）
- **到期**：持续模式 180–3600s（默认 1800s）复盘节律
- 平静期 `observing`（无事件也在下个复盘继续）；单任务模式 `idle`
- 醒因入 `wakeReason`（实况见过：`requested_review`、`world_or_goal_changed`）

## 2. 感知装配（想之前先看）
`world_perception` 持久缓存（聊天/私信/周边/世界摘要）；增量输入 `updates` 替换、
`removed` 删除、`events` 只给新证据；`observations` 逐项标新鲜度。
按需 `sense()` 目录 / `look` / `inspect_block` / `status(brief|full)`。
**未重发不保证新鲜，未知不等于不存在。**

## 3. 路由（用哪个脑子想）—— adaptive_router 四级（双系统）
| 级 | 语义 | 成本 |
|---|---|---|
| L0 SKIP | 熟悉情境，缓存策略直接用 | 零模型 |
| L1 FAST | 小偏差快查 | Jev 快脑（jev-1.13.0） |
| L2 THINK | 常规决策 | 模型回合 |
| 硬覆盖 | STAGNATION/PLAN | 停滞改道命中强制升 |

Jev：候选 2–8 / 2s 超时 / **置信 ≥0.75 才自决**，否则升级给模型；失败回退 Qwen。
实况：`skillRouteLast={confidence:0.74 → policy_escalated → slow}`。
**模型不思考常是"该省"，不是"坏了"。**

## 4. 回合（一次思考的生命周期）
`life-session`（一次对话一次生命）+ 行为级会话（`contextProtocol=2`）。
`turn_id` 租约：**≤6 串行动作 或 1 个已晋升程序**（互斥）。
`bodyAccess` 三态：独占租约 / `queued`（动作返 `motor_queued` 入 8 槽邮箱，不占身体）/
`read_only`（交流轮：可感知可管承诺，不可动身体、不可解人工暂停）。
结束：`remember`（目标/教训/下一步）+ `finish_turn`。
**铁律：`accepted`/`motor_queued`/`skill_queued`/`done` 都不证明目标达成。**

## 5. 执行（手怎么动）
`motor_mailbox`（8 槽有界持久命令，"认知只授权提案，从不授权身体"）→
`motor_loop`（**单一身体执行器，独立于模型任务**；命令持久、观测合并、认领绝不重放）。
过期或目标改变 → 快循环作废；在跑脚本 Jev 可请求中断。
原生后台任务（goto 等）+ 回执三态结算（terminal / 404 即终态 / 超窗不可观测）。

## 6. 回执与证据（怎么知道成没成）
每动作唯一 `actionId` + 前后状态；goto 对齐原生 `taskId`+epoch。
`execution_evidence` 只读诊断，**绝不反过来当动作/重试/晋升策略**；
动作完成、世界增量、目标成功三者分离。未知不重放；`action_outcome_unknown` → 保护性暂停。

## 7. 度量与进化诱因（怎么变好）
- `coherence` 四件套 → `/public/survival-metrics.json`：闭环率（窗 400）/ ≥3 连重复占比 /
  决策间隔 / 停滞目标数与最老年龄。5 分钟节流；**指标刷新 ≠ 大脑在跑**。
- 三兄弟问不同问题：`environment_penalty` 读**世界**（掉血/被拒/无产出）·
  `stagnation_detector` 读**意图**（目标 ≥600s 不动 ∧ 环境同窗有信号 → 四步 pivot + 强制升 PLAN）·
  `pattern_detector` **猜**重复（≥3 连 → 晶化 hint 落 `crystallization-ledger.jsonl`）。
- 晶化闭环：复盘指令要求**显式二选一**——`skill_draft` 起草，或一行写下为何不落地理由进 lesson。
- **学习班次**：越过 `EVOLUTION_CANDIDATE_CYCLES` 的班轮本身就是学习班（读 learning_status →
  挑有证据项 → draft+validate，或明写"本周期无可固化"）；身体危险时生存压倒一切。
  机制改动走 `learning_policy_draft` 提议 → **天神批准 → 操作员落地**。

## 8. 目标与承诺（想要什么）
`goal_agenda`：版本化承诺入 review 库；`queue/replace/revise/cancel/finish/after_goal_id`；
`request_id`＝消息ID+操作后缀（幂等）；**`completed_reported` 只是报告，不是验收**。
长期账本 `memory/goals.md`（`MEMORY.md` 留短索引）；原生 `/goal` 仅会话内、不跨重启。
`mission` 宪章（settings.json）：自主定有理由有完成条件的长期计划；**补给维护与阶段目标分开**。

## 9. 恢复与连续（怎么活下来）
一次生命一次对话：死亡 → `life_cycle` 写"学到了什么" → 轮换新命（`deaths/` 留档）。
`body_reconnect`：**先读活体名册**（"感知失败≠身体消失"）→ 只对存档 UUID 严格 restore →
未知挂起待只读接回；claimed 后永不重发。
技术程序（draft→test→promote→start）经 QuickJS 沙箱：只提案不执行，无 fs/网络/进程。
Jev 可从 `catalog.json` 选"已晋升+前提满足"的程序**独立推进目标，不等模型回合**。

## 附：一次完整决策的现场样例（2026-09-22 14:38 实况）
```
resume → wakeReason=world_or_goal_changed → status=thinking
→ Jev 判策 confidence<0.75 → policy_escalated → 交模型
→ motor_dispatch(requestId=…) 入邮箱 → 快循环执行
→ motor_interrupt_choice(jev-1.13.0, choice=continue)
→ 回执结算 → episodes 落账 → coherence 刷新（5min 节流）
```
