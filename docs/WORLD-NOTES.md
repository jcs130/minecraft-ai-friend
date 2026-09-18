# world-notes：世界级共享笔记（P3）

各角色的记忆是**各自一份**（`<workspace>/learning` 与 `memory/`）；本文件约定的是**跨角色共享**的那一层：
它们在同一片世界里干活，谁踩过的坑、谁验证过的方法、谁放弃了哪条路，都该是公共财产，
而不是锁在各自 workspace 里随人一起忘掉。

设计参照 CORAL 的 `wiki/`（`experiments/`、`synthesis/`、`open-questions/`、`focus/` 与 `lint_wiki`），
按本世界的口径改写。

## 位置与形态

```
server/agents/work/world-notes/        （容器内 /state/work/world-notes/）
├── README.md            本约定
├── focus/               每"条赛道"一份：谁在做什么、打算花多少、什么条件下放弃
├── experiments/         一次尝试的原始记录：试了什么、结果如何（成功/失败都要写）
├── synthesis/           跨若干 experiment 的结论：所以我们现在知道什么
└── open-questions/      还没有答案、值得下一班或另一个角色去查的问题
```

**为什么放在 `/state/work/` 而不是某个 agent 的 workspace**：那里是全体角色共享的父目录
（`governance/`、`operations/` 已是先例）。放在某人的 workspace 里等于又变成私产。

## focus note：五字段（这是本约定最硬的部分）

`focus/<lane>.md` 描述**一条赛道**（一个持续投入的方向），必须带这五个字段——
它们逼作者在动手前把账算清，也逼后来者知道该不该接手：

| 字段 | 含义 |
| --- | --- |
| `Posture` | 姿态：`lead`（我在主导）/ `support`（我在配合）/ `explore`（试探中）/ `idle`（已停手） |
| `Lane` | 赛道名：这条线在做什么（一句话，可被 lint 当去重键） |
| `Budget` | 预算：允许花多少（回合/时间/物品），超了怎么办 |
| `Abandon-if` | 放弃条件：**什么现象出现就认输**——事先写好，避免沉没成本里打转 |
| `Why-EV` | 为什么值得：现在做它的期望收益是什么（不是"看起来有用"） |

**`Abandon-if` 是这一整套里最值钱的字段**：本世界 2026-09-17 的两次停滞（原地 goto 循环、
区块卸载后反复回去）都是"没有事先写下放弃条件"的结果——没有退出条件，重复就变成了默认行为。

## 笔记的写法

- 文件名：`focus/` 用赛道名（`farm-navigation.md`）；`experiments/` 用 `YYYY-MM-DD-<一句话>.md`；
  `open-questions/` 用小写短语。
- 每条笔记开头写一行 `> by <角色> · <日期>`：**谁写的、什么时候**——共享笔记的价值全在可追溯。
- `experiments/` 里**失败也要写**：写下来的是"这条路走不通"，比成功更省后来人的时间。
- 结论升级：若干 experiment 收敛出一个判断，就写进 `synthesis/`，并在 experiment 里链过去。

## 维护（lint）

`tools/world_notes_lint.py` 做三件事，对应计划里的"定期清理/去重"：

1. **字段完整性**：每份 focus note 必须带齐五字段，缺哪个点名。
2. **赛道去重**：两条 focus note 的 `Lane` 相同（归一化后）→ 提示合并，避免两人闷头做同一件事。
3. **过期**：超过 N 天没动过的 focus note 列出来——要么续，要么把 `Posture` 改成 `idle`
   并把结论移进 `synthesis/`，别让它以"进行中"的样子挂着。

## 准入：已开通（2026-09-18，造物主定调「放开吧」）

**各角色的 `read_file`/`write_file` 现已可直接读写本目录**：`native_role_capabilities.rules()` 里
`QD_NATIVE_FILE_SCOPE` 的允许根从"仅本角色 workspace"扩为"本角色 workspace **或** `/state/work/world-notes/`"，
并经 `tools/configure_world_team.py --mode files` 重新下发到全部 10 个角色。

**隔离未被削弱**（这一点是刻意的）：别的角色的 workspace 仍然被拒——
活体实测：共享笔记读/写 = ALLOW ✓、自己 workspace = ALLOW ✓、
`/state/work/workspaces/mc-god/notes.txt` = **DENY** ✓、`/state/work/world-notes/../config.json` = **DENY** ✓。

写笔记的入口有两个：角色自己 `write_file` 到本目录；以及停滞重定向触发时由
`stagnation_detector` 在其 state 里留下的记录（宿主侧可同步过来）。
