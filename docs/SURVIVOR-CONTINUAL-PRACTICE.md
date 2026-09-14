# 自主生存的持续实践与修订

2026-09-14 实施。借鉴 [Prime Agent 研究](PRIME-AGENT-REFERENCE.md) 中经验可修订、长期任务保留结果的思路，接入既有游戏 Docker QwenPaw + Numen。未部署另一套 Prime daemon；没有新增角色、模型路由或常驻进程。

## 角色如何使用

桐人仍在原生活 session 观察世界、选择小目标、编写程序。`skill_catalog` 只带最近三次实践摘要，`skill_read(name, version)` 按需读取该版本的目标、开始/结束状态、末八步及修订依据。具体教程在 QwenPaw 已启用的 `qd-survivor-practice` 技能下按需读取，不把程序和整份轨迹塞进每次提示。

原六个学习入口保持不变：

| 入口 | 新增行为 |
|---|---|
| `skill_draft` | 可选 `refinement`，引用同名技能的真实 `run_ids`，记录改进假设和预期；先校验来源，再保存新版本。 |
| `skill_test` / `skill_promote` | 沿用真实隔离 JS 测试和晋升机制，新版本必须重新测试。 |
| `skill_start` | 可选 `objective`，固定此次库存净增量或指定动作完成次数；仍须当前未使用身体动作的租约。 |
| `skill_catalog` / `skill_read` | 查询具体版本的实践结果与失败证据，再决定保留、修订或回退。 |

先 `remember(finish_turn=false)` 保存意图，再 `skill_start`；排队成功会关闭该轮租约，应直接最终答复。既有控制器执行程序，随后正常生活轮拿到结果。不能在 start 后再次 remember，也不能先 finish_turn 结束再 start。

长期目标、个人笔记、ReMe、Dream、原10分钟复盘仍用现有 QwenPaw 机制。本功能不会另开反思模型、强制每轮生成技能或自动代替角色选择游戏路线。共享学习说明同时修正为已安装的官方技能创建脚本流程，保留各角色自身人设与模型。

## 什么算证据

`practice.sqlite3` 位于原 `/state/survival`，由现有 survivor 服务管理。运行 ID 绑定技能名称、源码版本及请求 turn；开始观察绑定身体 UUID、维度和程序内核。每步先保存原 turn，再派发动作，回执按原 action/turn/tool/args 归属，不能把当前工作的结果算到另一版本。

首次终态观察冻结。结束时按最多128个原步骤重读回执，弥补临时读取失败；补采失败时暂缓下一生活模型，恢复后只读取原回执，不重放动作。晚到结果仍归原运行；确定动作之后的 `after.ok=false` 作为未知快照保留，库存目标需要独立有效结束观察。过去已经完成的旧任务不会补造实践记录。

这些字段分开呈现：

- `programReportedDone`：程序自己返回 done。
- `ownConfirmedActions` / `evidenceComplete`：原动作的确定回执及完整性。
- `objectiveObserved`：固定目标是否在此次观察中满足；未设置目标时为 null。
- `masteryVerified`：本阶段固定为 false。一次库存增加不是跨场景能力证明，也不自动证明因果关系。

导航仍核对原 task/epoch，进食仍核对原生食物回执。accepted、unknown、观察到空闲或仅记录预期不会成为成功。修订的 `expected_outcome` 永远只是角色报告的预期，不能反向变成验收结论。JavaScript 程序也不能凭空创造新的 `/mycli` 法术；新增游戏机制仍交给天神实现代码。

## 部署与验证

原 survivor 自然排空后，备份1,067个状态文件；SQLite 使用 backup API，普通文件逐项核对。只更换 survivor 为 `qiandengji-survivor:2.2.0-autonomy19`，通过 `world/survival/Dockerfile.update` 在已核验的 autonomy18 镜像上显式复制源码。QwenPaw 主服务仍为2.2.1，镜像标签中的2.2.0表示 survivor 原兼容运行基座，并非降级游戏 QwenPaw。旧镜像与备份保留。Minecraft、NPC、QwenPaw 和宿主8088没有因此重启。

桐人身体 `d4ac9523-4962-43ed-98c5-19b49e104048`、原生活 session 和聊天保留。程序内核 `skill_library.py` 未改，不使以前已晋升版本的测试凭据失效。技能说明使用 QwenPaw 原生文件 API、ETag、重新扫描和读回验证部署，不能只改仓库就声称控制台已更新。

34项独立实践测试、237项相关回归通过。独立测试在禁网、只读代码挂载的临时 survivor 容器中执行，游戏与模型端点为 fake；它验证恢复、目标固定、动作归属与原循环衔接，不冒充生产游戏成果。报告记载实际执行的测试 ID、对应行为和当时源码 SHA，健康检查不接受单独替换哈希的旧报告。

`/healthz` 只公开聚合计数、版本与安装源码 SHA，不返回私人目标或凭据；`/mcp` 仍需原内部鉴权。新 `survival_practice` 探针已接入 `health_mon.py` 清单及 panel smoke，由原 Docker restart 策略守护。独立新探针通过不等于全项目历史验收报告全部有效；旧面板总体仍存在历史证据漂移和库存采集校验问题。

部署与原生配置证据保存在忽略目录 `runtime/survival-practice-20260914/`，独立行为报告为 `reports/survival-practice-smoke.json`。实际生产实践的结果应以该次运行 ID、版本及回执另行记录，不能由服务健康推断。
