# 跨水导航指引提案（幸存者侧）· 未执行

状态：**提案（未执行）**。`world/survival/` 不在固定验收计划 `team-guild-admin-python` 的 coverage 内，
本文件只把候选改动内容与证据留档，供计划管理者裁量是否扩展 coverage 后再由工程侧实现并隔离测试。
工单：case-52f0d5bb65c49ef1cb2a（桐人救援结果与能力改进反馈）。
撰写：operations:mc-god，2026-09-15（源码亲读基线：world/survival/numen_gateway.py 全688行、
world/survival/game_skills.py 全文、world/survival/mcp_server.py 全文、world/survival/ADVENTURE.md 全文）。

## 1. 根因（工程侧已核实）

- `numen_gateway.py` 的 `goto` 被强制 `walk_only=True`，单跳水平 ≤24 格（`walk_target_too_far`），
  且必须具备 `walk_only_strict_arrival_v2` 模式。步行导航没有跨水能力——这是设计而非缺陷。
- 千灯村与营地之间的河道宽 >70 格（goddess-inspect-20260915-rivercase-1 观测），阻断全部西行
  walk_only 导航；2026-09-15 桐人被困河道东岸 (-582.8, 64, 847.3)，最终由管理员传送救援。
- `game_skills.py` 的 `preflight_game_action` 允许 `tp`（空间传送）：每次沿 8 个固定方向之一位移
  0–30 格，起点与终点须在工作区内且不在城镇保护区（margin 4）内；featured 技能消耗 20 法力。
  桐人 lv17、法力 287/332，跨 70+ 格水面约需 3 跳（60 法力）——**跨水能力在网关层已存在但未被使用**。
- `ADVENTURE.md`（模型可见的自主生活指南）通篇没有水体/河道通过策略，也没有把 tp 描述为
  导航位移手段——被困时的决策缺口是知识缺口，不是权限缺口。

## 2. 候选改动（待 coverage 扩展后实现）

目标文件 `world/survival/ADVENTURE.md`，"各种生活目标的证据"一节导航段落后追加一段：

> 宽水面是步行导航的硬边界：`move` 是 walk_only，不能渡水，河道、湖面与海面都不存在
> "分段步行绕过"。被水体挡住时，先 `look` 估水面宽度：超过约 20 格的连续水面不要反复
> 发起步行 goto；改为评估 `game_cast` 的 `tp` 分跳（每次沿固定方向 ≤30 格，起终点须在
> 城镇保护区外与工作区内，每次 20 法力），先算好法力与跳数再行动；中途落点在水面时
> 该跳不可用，沿岸边寻找窄处/浅滩或改用 `place_block` 搭桥的代价要一起估。跨水成功
> 的唯一证据是各跳之后的真实位置回执，不是施法受理。

配套（可选）：`mcp_server.py` 中 `move` 工具 docstring 追加"不能渡水；宽水面见 ADVENTURE 跨水段"。

## 3. 边界与依赖

- 该改动只补充模型知识，不放宽任何网关校验；tp 的方向/落点/保护区/工作区检查全部保留。
- tp 中途落点是否可用水面未实测（本次救援回执只覆盖东岸 7 格位移）；指引如实写"该跳不可用"。
- 需要的裁量：把 `world/survival/**`（至少 ADVENTURE.md 与 mcp_server.py）纳入固定验收计划
  coverage，或将本提案转交拥有宿主检出写权限者执行。工程侧在 coverage 打开后可出隔离测试候选。
- 运营侧配套（已在本轮交付，dc2032b 之后的增量）：`world_content_reachability` 现对已观测
  跨水走廊给出警示与 tp 分跳算术，策划侧不再把跨河任务当普通步行中继推荐。
