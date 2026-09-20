# 公会反馈与现役配置修复（2026-09-20）

本轮承接 PawApp 实地观测中发现的重复拒绝问题。用户明确要求直接修复、实际部署，并将已验证代码提交到 `main`。沿用现有 QwenPaw、NPC 服务和桐人控制器，不另起模型循环。

## 现场原因与改动

公会接待员绑定的历史位置约为 `(-529.63, 67, 902.76)`，实际实体已移动到约 `(-570.45, 71, 886.30)`。桐人反复到旧位置后申请同一任务；部署后的只读公会查询确认当前距离 `44.828`，原领取门槛为 `8`。历史位置不能充当实时导航目标。

- 公会查询在同一次观察中返回接待员实时坐标、位置是否有效、同维度状态、距离与原门槛；历史位置继续明确标记为历史。
- `claim_refused` 回执附加有界的 `claimContext`。桐人的精简动作反馈保留对应 `quest_id`、实时位置和接近情况，供当前/下一轮重规划。观察失败时保留原拒绝和未知位置，不伪造坐标或重投领取。
- 保护区拒绝本身正确：当前生产保护半径为 `160`，不能按模板中的旧值解释现场。预检反馈补充实际校验点、边界和“没有派发”的状态，说明移动站位不会改变保护区内目标的授权。保护范围与动作准入不变。
- 两个旧导航测试断言已对齐现有 `observed_from_body` / `observed_ended` 语义，并增加原生失败优先于“身体已到达”的回归。未知终态不改成成功。

9 个角色的学习 Cron 仅缺少现行模板同一段 `learning_policy_draft` 说明，已通过原生 API 精确更新两处文本（`text` 与 `request.input` 内对应文本）。桐人原来已正确，无需重复写入。角色 profile、模型、执行期限、并发、计划和原启用状态保持，10 个角色的 Cron 校验通过。

桐人的 `qd-learned-stagnation-redirect` 与 `qd-learned-review-loop-detection` 属于旧阶段，已不在当前学习索引却仍启用。通过官方 `POST /api/skills/batch-disable` 仅禁用这两项；官方同时更新 manifest 的版本时间戳。54 个技能及学习文件逐项哈希保持，当前索引不变。校验器允许保留明确 `enabled: false` 的历史孤立绑定；当前索引内的条目仍必须通过绑定状态、revision、草稿哈希和技能内容检查，启用的孤立条目仍被拒绝。该检查由新的健康检查进程读取，无须重启 QwenPaw。

本轮还收回生产中已有而开发分支遗漏的 standing-task 守卫与学习预算分类。后者按生产原字节纳入主干，不改变运行时模块；原 3600 秒分类仍然阻止新工作，不释放未决任务。前者保留现役 900 秒观察策略，并补上所有权读取失败时不停止任务、空闲后清除旧观察、正确处理零时钟三个边界。没有重新实现一套任务所有权服务。

## 部署与证据

本轮维护标识为 `guild-feedback-20260920`。先保存原生配置、暂停新任务并排空在途动作，确认无未知身体动作、租约关闭后，按逐文件 SHA256 与原字节备份部署。旧维护脚本没有重跑，旧记忆归档没有重做。

原 NPC 服务重启一次，原 survivor 分两批源码部署重启两次；Minecraft、游戏 QwenPaw 与宿主 QwenPaw 未重启。北京时间 15:36:08 完成恢复：10 个 profile 和 16 条 Cron 与本轮文本修复后的维护快照全等，原工程班次关闭状态保持。NPC admission 与身体控制均已恢复，不留下维护暂停。

本机证据位于被 Git 忽略的 `runtime/guild-feedback-20260920/`：

- `source-plan.json`、`source-before/`、`deployed.json`：本次 7 个初始部署文件与重启记录。
- `final-source-plan.json`、`final-source-before/`、`final-deployed.json`：现役代码整合、校验器及测试的第二批精确部署；预算模块记录为字节不变。
- `learning-crons-receipt.json` 及单角色回执：原生配置文本的精确变更。
- `old-epoch-skill-bindings/receipt.json`：两条旧技能绑定禁用、原文件保留与配置比较。
- `live-guild-query.json`：运行服务返回的新公会观察。
- `candidate-embodied-smoke.json`、`candidate-final-embodied-smoke.json`：初始 60/60 与纳入 standing-task 后的最终 77/77 固定 Linux 专项检查。
- `regressions.log`：网关、世界动作、原生交互与状态读取 111/111 回归。
- `postdeploy-native-verification.json`：恢复后 10 个角色、16 条 Cron、NPC admission 与身体控制的只读核对。

另外，学习预算 19/19、学习流程 22/22 固定 Linux 检查通过；角色技能契约在本机 QwenPaw 2.2.1 环境下 16/16 通过。旧测试夹具已隔离共享账本与时钟，并补齐扫描器 fixture 字段，不把碰巧访问生产 `/state` 或使用真实时钟的结果当有效回归。

15:37:47，恢复后的完整生产 QwenPaw 健康检查通过（101 次只读请求、63.912 秒），验证 10 角色、100 个技能绑定、10 条学习 Cron 和原生工具策略；未发现额外自动任务。回执为 `old-epoch-skill-bindings/health-after-resume.json`。最终生产实际源码也通过 77/77 具身与 34/34 实践 smoke，分别绑定 23 和 15 份源文件哈希。

15:42:58，既有完整 panel smoke 执行结束：survivor、embodied_agent、survival_practice、PawApp、game_qwenpaw、model_routing 通过。与上轮 PawApp 观测对照，未出现新增失败的顶层探针，Qwen 和路由项由失败转为通过。其余旧失败仍保留。最终报告、哈希核验与面板结果在 `final-production-smoke-20260920T073621Z/`。

## 恢复后的实际行为

15:40:06，原生每 10 分钟复盘 Cron 正常投递 `review-1088`，没有人工触发模型或身体动作。随后两个真实原生任务完成：

| 任务 | 实际工具调用 | 结果边界 |
| --- | --- | --- |
| `task-241e2c3a26e7` | `team_context`、`remember` | 复盘与记忆更新，无新动作回执 |
| `task-364b30e35af1` | `status(detail=brief)`、`world_perception`、`team_context`、`remember` | 原行动 session 的观察与记忆更新，无导航/领取调用 |

第二轮行动上下文为增量、3,822 字节；这只是 controller 输入投影大小，不是完整模型 token 开销。两轮所有上述工具均正常返回，无 `protected_area` 前置拒绝，未知身体动作仍为零。

公开最终回复仍把聚合的“NPC unhealthy”当成领取失败原因，并把旧位置称为柜台；新运行数据表明接待员在线、当前公会查询可用，仅禾叔身份探针未通过。模型本轮没有重新查询公会，不能把它叙述中的“仍被拒绝”当作新执行证据。本轮只证明修复代码与只读现场接口工作，尚未实证模型采用新 `claimContext`、领取成功或 RSI 改进。原生工具元数据保存在 `post-resume-native-tools-1789890172302131800.json`，没有导出思考正文。

随后核对当前 L2，发现已启用的 `qd-learned-guild-claim-precision` 将“必须先右键柜台”写成领取前置条件，且把此前失败当成证明。服务端 `mc_guild.claim` 没有右键前置；这条技能的 `behaviorVerified` 仍为 false，所谓成功案例只是预期文本，其上一版也含相同错误，不能盲目 rollback 再启用。该规则也没有直接规定“NPC unhealthy 就停工”，因此不能把本轮等待全归因于它。

15:49:25–15:49:29，在角色空闲且当前 revision 未变时，复用 `LearningTools.lock`、官方 `SkillService.disable_skill`、原索引保存和官方 reload，将这条规则停用并标记待复核。补入一次真实 `unverified` 反馈，记录源码中的 8 格规则和 44.828 格现场观测；没有伪造两次失败来凑自动停用阈值，也没有回滚到同样错误的旧版本。manifest 与当前索引均为 disabled，failures、previous、全部技能/草稿文件保持。分步证据在 `guild-skill-review/native-maintenance-receipt.jsonl`。这属于维护侧纠正已证伪的学习规则，不冒充 Agent 自主完成了 RSI。

已知范围：NPC 健康仍报告禾叔在已加载的原登记区块中不可见，尚无可靠证据区分移入未加载区块与实体丢失，因此没有凭空生成替身来消除告警。学习预算缺失/非法开始时间的额外加固也未部署；本轮保持现役长驻模块字节，不伪称修改磁盘即可更新 QwenPaw 的 import 缓存。全项目旧健康项需按各自证据处理，不能以本轮局部检查通过代替。

PawApp 界面与官方 SDK 接入沿用 [PAWAPPS-OBSERVATION.md](PAWAPPS-OBSERVATION.md) 的部署成果；本轮不修改该页面的 8 个源文件或重写旧视觉证据。动作确认、目标完成和 RSI 改进仍是不同结论，不能仅凭字段齐全、模型回合结束或测试通过宣称智能提升。
