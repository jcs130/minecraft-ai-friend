# 天神工程候选恢复（2026-09-14）

本次修复的是天神的独立候选工作区及固定测试计划。准备和实跑完成后，主任务审查并执行了迁移；归档日志为 `phase=complete`。候选业务验收仍为失败，没有把候选代码发布到世界服务。

## 阻断的实际出处

`tools/prepare_world_engineering.py` 初次准备时，从批准基线 `600ffa3993235fae3130e20912496b2d21a1e9a9` 的 Git blob 计算固定测试 SHA256。`world/ops/engineering_workspace.py` 每次完整快照后先检查这些字节，再检查所有差异是否属于所选计划。主项目后来更新测试，不会自动改变独立候选的批准基线。

最新候选的 `tests/test_world_team.py` 增加一个测试类，`tests/test_world_content.py` 增加两个方法和一个测试类，确实改变了受管文件；不是应该把配置哈希更新到主项目的问题。`test_world_team_schedule.py` 的旧不匹配已经消失，本次字节与批准值相同，不能按旧回执继续描述它。

另有两项独立阻断：旧候选提交 `5de7f8af30f382ea271280bf11f46ea4fd54bd52` 带入 846 个无内容差异的 `100644 → 100755` 变化，导致固定路径范围校验失败；原测试镜像 `sha256:1caee098f813d59973e30a4533699b594a73c3fdcfcddb192ebf385ad004eb29` 已不在当前 Docker 引擎中。

## 有界迁移

`tools/prepare_engineering_recovery.py` 只处理固定 D 项目、工程角色、候选目录和预定测试命令。三个阶段分别是 `--prepare`、`--test <目录>`、`--apply <目录>`，前两者只写新的 runtime 目录。

- 原全部 Git 历史、本地 heads 和 tags 都保留；仅 `codex/ops-world-improvements` 前进一个子提交。该提交只将基线与旧 HEAD 内容完全相同的伪模式变化恢复为基线模式，原真正可执行文件不变。`core.fileMode=false` 和 `core.autocrlf=false` 持久化到新候选。
- 原候选的所有工作树字节、删除和未跟踪文件都保存。两份受管测试只允许新增类和新增 `test_` 方法；已有断言、方法、类约定或模块设置发生实质变化会拒绝自动迁移。新增测试拆到 `test_world_team_candidate_regressions.py` 与 `test_world_content_candidate_regressions.py`；原批准文件恢复为原基线字节。包含装饰器及原 fixture。
- 固定计划改为 `team-guild-admin-python`，覆盖当前 team、guild 及 `world_admin_consumer.py` 的混合候选变化。业务路径逐文件列举，仅 docs/tests 沿用原目录范围；不开放整个 world、任意命令或镜像。固定命令为 `python -m unittest discover -s tests -p test_world_*.py -v`。
- 选择当前确实存在的固定镜像 `sha256:45dc7f061c09489b7d36d5b1499b830a3b14176835c0bc9afaa233d60df2299f`。独立 Docker 测试无网络、只读候选、非 root、无 capabilities、带资源上限，不挂生产状态或密钥。
- apply 再核验原候选字节、原配置、分支/全部 refs、准备候选、测试快照和批准哈希。天神角色所有原生 Cron 必须暂停，角色必须 idle 且 running_task_count=0；取得原工程 workspace.lock 后再核验一次。不会自动取消任务或恢复 Cron。
- apply 将完整原仓库归档到 `server/engineering/migrations/<id>/original-repo`，同时保存原配置、提案、实际测试输出和回执。原历史请求/测试/部署回执不移动、不覆盖。出现中断保留迁移日志，禁止盲目重试。

迁移和业务验收分开。只接受固定测试实际执行完毕、退出码明确为 0 或 1 的回执；启动异常、超时或收据不匹配不能迁移。退出码 1 在迁移日志中仍是 `candidateAcceptance=failed`。原工程 test/commit/deploy 的通过要求完全不改，迁移不能成为发布依据。

## 已执行证据

最终准备目录为 `runtime/engineering-recovery-20260913T234404-13f10a6e/`，早期准备目录完整保留。

| 项目 | 实际结果 |
| --- | --- |
| 原 HEAD | `5de7f8af30f382ea271280bf11f46ea4fd54bd52` |
| 新模式修复子提交 | `30f04f5540d86f3dfbc8d819c7ce75f7ecb2ba1a` |
| 仅模式修复路径 | 846 |
| 原分支 | 两个均保留；非目标分支引用不变 |
| 快照 SHA256 | `2de645a0662be8cddf3563d65e7c48243a8b48c5823c7dc2ab47c1a5bab5ddcc` |
| 迁移工具专项测试 | 9 项通过，包含真实 Git 次分支及 annotated tag 保留 |
| 固定镜像候选实跑 | 120 次测试执行：118 通过、1 failure、1 error |
| 正式候选业务验收 | `failed`，不能提交或部署 |

120 次执行包含继承原 ContentTests fixture 时重复执行的 17 项原测试，不能当作 120 项不同的新功能。四份批准测试全部通过。实际输出和机器回执分别在目录内 `test-output.txt`、`test-result.json`，提案与完整文件清单在 `proposal.json`。

两项失败来自保留的新 SiteLedgerTests：

1. `test_propose_permissions_and_venue_validation` 的 fresh setUp 只建立队列，没有创建 `site-one`，第一次合法 `propose` 却期待 `already_proposed`。实现已有重放分支，不能据此认定它没有幂等能力。后续应显式创建一次，再以相同请求和载荷验证重放。
2. `test_step_ordering_replay_and_freeze_rules` 在场地已经 scouted 后再次调用 approve。实现用 `ValueError('site_not_approvable')` 拒绝，新增测试把结果当字典索引。后续需核对该接口约定并在新测试文件中保留拒绝断言；不能修改批准文件或删掉失败覆盖。

没有为使检查变绿而改上述候选代码或断言。这些具体失败应通过原运营事项交给天神继续修复，再由正常工程工具生成新快照、完整隔离验收。

## 主任务执行与后续

原 `qd-team-engineer` 已由主任务暂停，最后一轮自然完成；主任务随后也暂停 `qd-learning-mc-god`。实际 apply 日志记录两个任务均停用，天神 idle、running_task_count=0。脚本没有替管理员修改调度。

```powershell
$env:PYTHONUTF8='1'
.\run-python.bat tools\prepare_engineering_recovery.py --apply runtime\engineering-recovery-20260913T234404-13f10a6e
```

以上命令已经由主任务执行，不应重复执行；runtime 的 repo 已移入原候选位置。`server/engineering/migrations/20260913T234404-13f10a6e/apply.json` 确认 applied=true、historyRewritten=false、approvedChecksChanged=false、candidateAcceptance=failed、businessCodeDeployed=false，原仓库和实际失败回执均已归档。

未来若原候选、配置、分支或准备内容已有新改动，重新 prepare/test 并审查新提案，不能改旧清单绕过校验。迁移后主任务已经通过原生 API 原样恢复此前启用的工程/学习 Cron。07:55 工程班次自然启动，在原 session 中读取新的候选回归文件；这证明入口恢复，尚不代表候选测试通过。不新建宿主循环，不替它将未通过的业务候选上线。

## 原生班次与正式执行入口修复

迁移后，`qd-team-engineer` 于 07:55 按原 Cron 自然启动，沿用 `world-team-operations-mc-god:cron:qd-team-engineer` 会话及当时选择的 `zhipu-cn-codingplan/glm-5.3`。它真实读取了新的固定计划和分拆测试文件，并于 07:59:08 成功排队 `mc-god-20260914-boss-chest-team-guild-admin-test1`，不再被固定测试字节或路径范围拒绝。正式快照为 `25becfac9cfab09766af4578b65f193fd9d3390d2654ac724084c824e3f9b477`；此哈希由正式快照格式计算，不能与前面的迁移清单哈希直接比较。

本轮于 08:00:10 自然完成，原生 Cron 状态 success。它只查询一次 queued，随后把 jobId 写回工单和记忆，未等待循环，也未提交候选。两项 SiteLedger 新测试的错误前置与异常断言仍未修改；Cron 成功不代表业务测试通过。

08:00:28 正式隔离执行回执返回 failed/exitCode=1。实际没有进入 unittest：`world/admin/engineering-runner.mjs` 只设置 Docker `Cmd`，继承了固定 Qwen 镜像的 `ENTRYPOINT ["python","-u","/survival/game_service.py"]`，启动脚本在读取不存在的 `/run/secrets/survivor-mcp` 时退出。迁移预验收显式覆盖了 entrypoint，因此能执行 120 次测试；正式执行器此前缺少同等接线。

旧失败完整保存在 `server/engineering/receipts/mc-god-20260914-boss-chest-team-guild-admin-test1.json`。容器 `c47fce765193f92375603ccf51292e977b220195e527a2e6364c38d3204b5e07` 已由原执行器清理。异常发生在 `environment()`，早于 cron_guard 和 Qwen 入口导入，且隔离容器无网络、无生产状态或凭据挂载；没有执行游戏业务动作。不能为启动测试给它挂入生产 secret，也不能把该失败改写成通过。

修复将 Docker API 配置明确设为 `Entrypoint=[plan.argv[0]]`、`Cmd=plan.argv[1:]`，只使用批准计划的执行向量，不经 shell。单元素计划也显式携带空参数列表，不继承服务镜像入口；Python/Node 参数中的空格、通配符和 shell 元字符保持字面值。镜像、批准哈希、资源限制、无网络和只读挂载等隔离设置不变。

`node --test world/tests-ai/engineering-runner.test.mjs` 的 9 项回归全部通过，涵盖固定执行向量、单元素命令、字面参数、真实 create 请求体、失败/超时清理和未知请求不重放；`git diff --check` 通过。主任务已在 control health `active=null`、工程 runner `busy=false/error=null`、工程 Cron 临时暂停的窗口，仅重启 control 加载只读挂载的修复。此处记录到加载完成为止，正式 runner 的新请求重试与真实业务测试结果仍待主任务验证；不得重复投递或删除旧失败回执。

## 正式重试与最终状态

随后维护者在原班次自然结束、工程 Cron 临时暂停期间，仅修正新增候选 `test_world_content_candidate_regressions.py`：显式首次创建再验证相同请求重放、相同 ID、无新增文件、文件字节不变和世界动作 0；已 scouted 再批准则断言精确 `ValueError('site_not_approvable')` 并确认记录未改变。没有删除覆盖或修改四份批准测试。原新增测试字节备份于 `runtime/companion-repair-20260914/candidate-regressions-before-20260914T0803/`，修改后 SHA-256 为 `b1aa408cf642a6c4eefdbebbbd9229483c0bd5cb4f73d9242df6a4a8e4a9c775`。

主任务调用原 `EngineeringWorkspace.status(capture_source=True)` 与 `test(...)`，生成新鲜源快照 `798fa1db8e827f2ab1a611cc9634c7edef4a605c2314011963db123055289452`，使用新请求 `maintenance-20260914-runner-entrypoint-01` 进入正式 control 队列。08:08:58 回执真实 `passed / exitCode=0 / containerRemoved=true`，日志 `Ran 120 tests in 2.419s / OK`。测试仍在固定镜像、无网络、非 root、只读源码且无生产凭据的容器内运行。旧失败回执完整保留。

正式环境入口和候选两项测试错误已修复。这次候选测试修正与重试由维护者完成，不是天神自主修复成果；07:55 的原生任务读取/排队才属于天神本人。业务候选没有自动部署，也没有替天神提交。工程原 Cron 已按备份原样恢复，下一班次 08:15，原学习 Cron 继续启用；后续提交仍须当前源码与通过快照一致。

维护者已在原角色 idle 时，将以上修复事实、精确 job/源哈希和下一核对点追加到原 `MEMORY.md`，保留旧阻塞记录并注明它属于旧状态，未替换人格或伪造角色经历。追加前原字节及写后哈希分别保存在 `runtime/companion-repair-20260914/engineer-memory-before-handoff.md` 与 `engineer-handoff.json`，没有额外模型调用。
