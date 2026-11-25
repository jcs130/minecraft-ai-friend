# 任务系统治理需求（Task System Governance）

> 状态：代码实施中，构建/专项回归与部署验收分别记录；不以文档合并代表上线 · 提出人：扛枪（"需要好好治理一下这个任务系统太乱了"，2026-11-25）· 起草：史提西亚（运营线）
> 关联：[MYCLI_AGENT_CLI.md](MYCLI_AGENT_CLI.md) · [DYNAMIC_BOARD.md](DYNAMIC_BOARD.md) · PR #435（第一层文案修复）
> **架构方向已定**：收敛为两条主线——公会委托等级 / 个人职业技能等级，详见 [TASK_SYSTEM_TWO_TRACK_CONSOLIDATION.md](TASK_SYSTEM_TWO_TRACK_CONSOLIDATION.md)（扛枪 2026-11-25 指示）。本文件保留问题清单与分层治理路径作为背景。
> 运营侧不动代码不重启；本文件为分层需求，交开发线评估排期。

## 1. 背景：一次卡壳暴露的结构问题

2026-11-25，ag_CorMy 在自家宅基地完成 `shelter_basic`「小屋安居」的全部六项结构证明（地面/墙/屋顶/外窗/通行门/床），但 `exam submit` 持续返回 `practice_incomplete`，`exam info` 只显示 `reason=prepare_skill` 且无可执行说明。她在公屏求助后由运营线读源码才定位：该考试是 `contract_record` 型，需先 `/mycli guild claim` 交付关联的 `builder_home` 委托——**提示文案把她指向了不存在的"技能准备"步骤**。

这不是孤例。按命令契约盘点，当前"要完成的事"分散在六类委托、考试、副本、剧情四个体系里，入口与状态查询各不相同。

## 2. 实证问题清单

| # | 问题 | 实证 | 严重度 |
| --- | --- | --- | --- |
| 1 | 考试-委托跨系统嵌套，状态不同步 | `shelter_basic` 要求交付 `builder_home`；两边各记一份状态，任一边未对上即 `practice_incomplete` | 高 |
| 2 | 提示文案语义错误 | `contract_record` 型考试初始 `reason=prepare_skill`（PR #435 已修） | 高 |
| 3 | 完成动作语义重载 | `guild claim` / `dungeon claim` / `exam submit` 三种"完成"，互不提示 | 中 |
| 4 | 状态查询分散 | 查"我在干嘛"需 `tasks status` + `guild exam status` + `dungeon status` + `arena status` + `life status` | 中 |
| 5 | 委托六轨并行无总览 | 静态底仓 37 项 / 动态看板 / 生活公会 7 类 / 市场单 / 探索契约 / 近郊分段 | 中 |
| 6 | 术语不一致 | arena / dungeon / task / contract / exam 五词指"要完成的事" | 低 |

## 3. 分层需求

### 第一层：文案与提示（PR #435，已提）

- `contract_record` 型考试初始 reason 改 `awaiting_contract`
- shelter 类考试 `next()` 给出完整下一步（建屋 → `guild claim` 关联委托 → `exam submit`）
- `practice_incomplete` 回复对委托型考试指明具体下一步

### 第二层：统一任务中心（本次请求的核心）

**3.1 `/mycli journal`（或 `tasks overview`）** —— 一条命令汇总本人全部进行中事项：委托（六轨）、考试 run、副本进度、剧情章节。每项输出：类型、标题、进度、**准确的下一步命令**。机器可读沿用 `MC_CLI_*` 约定，一页不超过七项、支持翻页。

**3.2 关联委托交付自动 ready** —— `contract_record` 型考试的关联委托 claim 成功瞬间，考试自动 `ready` 并私聊提示"考试已 ready，可 submit"，消除跨系统手动对账。

**3.3 提交入口收敛** —— 任务中心里每项的"完成"由系统给出准确命令（`guild claim` / `dungeon claim` / `exam submit` 按类型分流），玩家不必记忆三套语义。

### 第三层：架构演进（长期，与开发线共创）

**3.4 考试-委托 proof 共享** —— shelter 类考试直接复用 `builder_home` 的 shelter proof 判定，不再要求玩家手动 claim 委托；单一事实源。

**3.5 委托轨道收编** —— 六轨在任务中心按类型分组；统一术语表（arena=试炼塔练习、dungeon=遗迹副本、contract=契约委托、exam=认证考试），对外统一叫法。

**3.6 状态机统一** —— 委托/考试/副本共享 `active → ready → complete` 状态机与通知管道（扩展现有 `MC_BOARD_TODAY` 类私聊通道）。

## 4. 验收标准

- 第一层：`contract_record` 型考试开考后 status 显示"交付关联委托"而非 `prepare_skill`；可米案例复测全程无需人工指引
- 第二层：`/mycli journal` 一条命令列出本人所有进行中事项及下一步；关联委托 claim 后考试自动 ready
- 运营指标：公屏"卡住了/怎么办"类任务求助周环比下降；女神侧读源码答疑次数下降

## 5. 本轮代码落实与边界

- `/mycli journal [all|guild|skills] [页码] [--json]` 汇总本人公会与技能事项，每页最多7项；`tasks overview` 为兼容别名。原生任务、生活委托、玩家委托、遗迹/试炼、考试与剧情分别读取自己的事实源，不通过派发命令拼查询。
- `journal submit <itemId>` 只把本人当前可提交事项分流到原有验收；不猜任务ID，不跳过原生条件，不把异步排队当作完成。旧终态映射为 `active / ready / complete`，保留原场次和来源状态。
- 小屋实操不再生成或依赖第二张 `builder_home`：开始本场窗口、本人实际施工、一次 `exam submit`。生活委托与实操读取同一带演员/时间的施工事实，七项结构及本人施工比例保留；提交时重验当前结构。
- 结果型实操的正常传送、跨维度、退出与重启不清进度；旧中断可显式 `guild exam resume` 续原场次与原截止。连续飞行/跃击只恢复已验证航点，传送段不算距离或升高量。
- 公会晋级只有配置中的声望阈值，不再另要求晋级分；旧段位、证书、积分历史不回写降级或双计。生活新合法交付将奖励、声望、五类技艺与回执在同次持久化中提交，旧奖励不补发。
- 旧未花技能点按服主明确选择 **1:1** 迁入原UUID的Vortex学习点。原余额、已花点和技能历史不清零；冻结源与意图先落盘，原生信用和迁移回执同快照提交后再确认源回执。查询不触发迁移，离线/未选职业保留待迁移状态。
- 构建、真实回归、联机输入、主干合并、生产发布分别验收。未部署的剑士SDK候选仅在真实原生能力存在时启用，不能用编译占位SDK夹带升级。

## 6. 运营线已做 / 待做

- 已做：PR #435（第一层）；治理提案全文（千灯纪工作区 `docs/proposal-task-system-governance-20261125.md`）
- 待做：术语表写入 `agent-guide.yml`（配置层，热加载）
- 不做：不改状态机、不迁移数据、不动静态底仓
