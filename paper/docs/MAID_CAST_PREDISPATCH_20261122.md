# 女仆施法 pre-dispatch 结算修复与未结算动作处置（2026-11-22）

对应交接文档第 8 节接力点 3。基线日期 2026-11-22，Asia/Shanghai。本文所有生产数据均为**只读**核对，未对正式服做任何写入或部署。修复以最小增量候选交付，实机 round-trip 与上线属发布侧（见第 8 节）。

## 1. 范围与结论

正式托管的两名居民各冻结在**一笔**原因-only 的未知施法回执上，宿主进入"只对账、不动作"分支：

| 居民 | 身体 UUID | 决策模型 | 原请求 | 法术 | 路径 | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| 结衣 | `00bd198f-c24a-4c0a-a7d4-ce854c68cd71` | qwen3.7-plus | `hs_3c26f42981094a1cbe308e20` | radiant_pulse（辉光脉冲） | external resident（有 RPG 服务账本） | 桥接 `not_found` 终态结算修复，**可证无副作用**，查询即自动结算 rejected |
| 肥鱼 | `af86ae0c-c524-467b-a28c-8da5af88d45e` | deepseek-v4.1-flash | `hs_530c5bd47eaa42649ca1f653` | astral_convergence | legacy companion（**无**服务账本） | 结果**不可证**，用 `LegacyCastAuditQa` 做可审计 closure（failed/unproven），不重放、不声称无副作用；**closure 已隔离 dry-run 端到端验证**；另加 legacy 预防修复防复发（§5A） |

交接文档当时只点了结衣的 1 笔；本次实查发现肥鱼同样冻结 1 笔，两者需分别处置。肥鱼另有 4 笔更早的 legacy 施法回执（11-18/11-19）虽 body 状态为 `unknown`，但已被宿主 `legacy_cast_outcome` 按 `observation.state` 对账为终态，**不在**未结算集合内，属正常历史残留，无需处理。

> **2026-11-22 续修（本会话）**：肥鱼静默根因已只读坐实为上述未结算 legacy 施法冻结（详见 `FEIYU_SILENCE_RECOVERY_20261122.md`）。按用户"两者都要"决定，本轮在 Yui external 修复之外**追加 legacy 预防代码修复**（§5A），并产出**合并候选 0.1.66-cast-recovery**（§7），与肥鱼审计 closure 共用一次发布窗口。肥鱼 closure 的就绪操作手册见 `FEIYU_SILENCE_RECOVERY_20261122.md`。

核心原则：写操作沿用原 `request_id` 对账；**不重放、不伪造成功**。external 路径能用服务账本证明"从未派发"时才自动结算；legacy 路径无法证明副作用时只做带审计注记的人工 closure，绝不声称 `effectsApplied=false`。

## 2. 只读生产取证

宿主状态目录 `E:\MC\private\unified-npcs-20261117\npc`，正式服 `E:\MC\server`。

**健康报告 `npc/health.json`**（宿主进程自 `2026-11-22T08:55:06Z`≈16:55+08 起）：

- 结衣：`running:true, connected:true, lifecycle:ready, unknownRequests:1`，counters `actions:0, completed:0, unknown:0`，`last_action_at:null`，`events:34`。
- 肥鱼：`running:true, connected:true, lifecycle:ready, unknownRequests:1`，counters `actions:0`，`last_action_at:null`，`events:28`。

两者都在收事件但零动作——典型的未结算冻结。桐人（numen 身体 `8ae995f9`）`running:false, lifecycle:destroyed, unknownRequests:0`，属接力点 1，不在本文范围。

**宿主动作账本 `npc/<role>/actions.sqlite3` 的 `dispatch` 表**（`journal.unresolved()` 口径）：

- 结衣：733 行，未结算 1 行 = `hs_3c26…` cast radiant_pulse，receipt `unknown`。
- 肥鱼：1930 行，未结算 1 行 = `hs_530c…` cast astral_convergence，receipt `unknown`。

**身体回执 `plugins/QiandengjiMaidBridge/native-body-receipts/<maid>/<request>.json`**：两笔事故回执 observation 均只有 `{"reason":"execution_uncertain_query_original_request"}`，无 `state`/`spellId`/`effectsApplied`。结衣 observedAt `2026-11-22T06:28:49.916Z`（14:28:49+08），肥鱼 `2026-11-22T07:27:51.826Z`（15:27:51+08）。

**RPG 服务账本 `plugins/AgentFriend/resident-cli/<actor>/<serviceRequestId>.json`**：

- 存在 actor 目录 `00bd198f`（结衣）与 `8ae995f9`（桐人）；**肥鱼 `af86ae0c` 无目录**——独立佐证肥鱼走 legacy、无服务账本。
- 结衣事故请求派生服务 ID = `UUID.nameUUIDFromBytes("unified-cast:00bd198f…:hs_3c26…")` = `87bc1552-42f3-3ba2-b408-140a111e8063`，**该文件不存在**，无 `.reconciliation.json` 侧车 → `ResidentCli.query` 返回 `{"status":"not_found"}`。
- 结衣 101 条服务回执全部终态（99 completed、2 blocked、0 非终态）；`active.json` 指向 `81c7d712-40cc-4772-88a3-88153759d518`，该行是 **completed** 的 `cast radiant_pulse`。故 active 闸门（`ResidentCli.run` 第 211 行）不会拦截——事故施法是在 `run()` 持久化（第 221 行）**之前**抛异常，而非被闸门挡住。

**事故日志 `F:\MC-backups\scheduled\20261122-165046\server\logs\latest.log`**：14:28 与 15:27 前后只有 Numen/RCON 噪声，**没有任何施法异常堆栈**——`NativeMaidBodyActions` 外层 catch（235-236 行）写 unknown 时不记日志，是可观测性缺口。结衣自 14:30:12 起反复出现 `[AgentFriend] Resident notice unavailable for 00bd198f`（14:43/15:00/15:16/15:30/16:23/16:44），与冻结后宿主持续投递通知失败一致。

**肥鱼法术配置 `plugins/VortexRPG/spells.yml`**：astral_convergence 冷却 7000ms，治疗玩家 base 5.0+spirit×0.8，nearby_player 范围 10 / nearby_monster 范围 12 上限 3。肥鱼更早的 `hs_75fe…`（astral_convergence）observation 为 `state:rpg_cast_hit, effectsApplied:true, healedTargetIds:[822d173a…]`——曾真实治疗其 owner `ag_CorMy`（822d173a），证明该法术对她有效且 legacy 路径正常时产出可证 observation。

## 3. 根因

施法派发链（external）：`NativeMaidBodyActions.cast`（220 行）→ `plugin.nativeCast` → `ResidentBodyAccess.cast`（派生原服务 ID，不另造重试 ID）→ ResidentRpg → ResidentVortex → `ResidentCli.run`。`run()` 在**同一游戏主线程**上先持久化 accepted 行（221 行）、写 active 闸门（223 行），**之后**才派发 `qdrpg`（234 行）。任何在持久化之前抛出的异常（身体不可用 215、效果契约缺失 218、RPG 层异常等）都不会留下服务行；持久化失败（174 行 catch）或闸门写失败（224 行）会把行置 unknown 并在派发前 return。

**不变量**：只要派生服务 ID 查询为 `not_found`（无内存行、无文件），该请求就**从未到达派发步骤**，因此本请求没有法术/魔力副作用。这是 external 路径可自动结算的依据。

冻结机制：`nativeCast` 抛异常 → 外层 catch 写 body 回执 `unknown`（reason-only）→ 宿主 `journal.unresolved()` 非空 → `_actor_loop` 停在只对账分支。查询回执时，旧代码对 `not_found` 没有终态映射，回执永久 unknown，宿主永久冻结。

legacy 路径（肥鱼）不同：`NativeMaidCompanionSupport.castSpell` → `NativeMaidMagicSupport.cast` 在**顶部先扣魔力、设冷却**，再施加伤害/治疗；异常发生在扣魔力之后时，可能留下已消耗魔力与部分效果且**无任何记录**。`manaByMaid` 是内存表，16:55 重启后丢失。异常点被外层 catch 吞掉、无堆栈。因此 legacy 事故结果**不可证**：既不能声称成功，也不能声称"无副作用"。

## 4. 修复（external 路径，最小增量）

源码入口 `paper/integrations/touhou-maids/hybrid-src/local/tlmcompat/hybrid/`。

**`MaidBodyControl.castPreDispatchEvidence(maid, request, bodyStatus, serviceReceipt)`**（新增静态 helper）：fail-closed，仅当 `serviceReceipt.status=="not_found"` 且 `bodyStatus∈{accepted,unknown}` 时返回证据 `{reason:"native_failure_before_service_dispatch", effectsApplied:false, serviceRequestId:<派生原 ID>, serviceReceipt:<深拷贝>}`；其余一律返回 null。`running` 不结算——曾观察到服务行的 running 回执若行消失，不可在此证明，保留人工审计。派生 ID 与 `ResidentBodyAccess.cast` 完全一致，不造新重试 ID。

**`NativeMaidBodyActions.receipt()`**（388-392 行新增）：external cast 且 body 状态 accepted/running/unknown 时，查服务回执；终态服务（completed/blocked/rejected/cancelled/failed）与 pending（accepted/pending/running）沿用既有映射；对 `not_found` 调 helper，非 null 则 `control.finish(id,request,"rejected",evidence)`，并在该请求是 `resumeGuards` 栅栏且控制租约有效时 `resumeGuard(body)` 释放栅栏，返回终态。`running+not_found` 经 helper 返回 null 后落到 396-398 行，保持 unknown（fail-closed）。

线程/竞态：身体端口经 `Bukkit.getScheduler().runTask` 在主线程串行处理（`NativeMaidBodyPort` 158 行），`run()`/`query()` 均要求主线程，结算与栅栏释放无跨线程竞态。`tick()`（403 行）每 10 tick 对 `resumeGuards` 重查原请求；重启后内存栅栏清空，则由宿主对账循环查询原请求触发结算。两条路径都只结算原请求，不派发新法术。

版本边界：改动前已把 main 源码对生产 classpath 编译，`MaidBodyControl`/`NativeMaidBodyActions` 的 .class 字节与正式部署 jar 内条目**逐字节一致**，证明候选 =  deployed + 本次评审增量。

修复**不做**的事：不重放法术；不改保护/碰撞/权限；**本 external 增量**不动 legacy 路径（legacy 预防修复是独立增量，见 §5A）；不改 `mc_maids` schema 或既有终态/pending 映射。

## 5. 肥鱼 legacy 处置：可审计 closure

工具 `paper/integrations/touhou-maids/tests/LegacyCastAuditQa.java`，编译真实 `MaidBodyControl`，无游戏/网络/生产文件依赖（fixture 自测）。

`settle(control, maid, request, note, evidence)`：读原回执，要求 `action==cast && status==unknown`，审计注记 8–300 字符且无 ISO 控制字符；observation 写 `{reason:"legacy_cast_exception_outcome_unproven", outcomeUnproven:true, effectsVerified:false, auditNote, auditedAt, evidence}`，`control.finish(...,"failed")`。**刻意不写 `effectsApplied`**——legacy 路径无法证明副作用缺席。终态 failed、`goalCompleted:false`、`retryAllowed:false`，重复原请求返回终态、不重开法术，重启保留。

操作者模式（评审维护窗口内，对原身体回执目录）：

```sh
java local.tlmcompat.hybrid.LegacyCastAuditQa --settle <receiptDir> <maidId> <ownerId> <requestId> <auditNoteFile>
```

前置：操作者须先确认该女仆**不是** external resident（external 走桥接回执查询自动结算），并把证据清单附入维护记录。肥鱼 `hs_530c…` 的审计注记应记录：combat heal 中断、魔力表随 16:55 重启丢失、异常点无堆栈、结果不可证；证据清单含 owner 当时在线、无服务账本、法术配置有效。closure 后宿主 `journal.unresolved()` 清空，肥鱼恢复动作。

**肥鱼 closure 隔离 dry-run 已端到端验证**（`feiyu-closure-dryrun-20261122/dryrun.py`，只读复制生产回执到隔离目录结算副本）：结算后 12 项形状核验全过（failed/terminal、无成功声称、无重放许可、outcomeUnproven、effectsVerified=false、**无 effectsApplied**、注记逐字、原编号/arguments 不变）；harness `reply_status=failed`、`legacy_cast_outcome=None`、`ActionJournal.unresolved` 结算后清空 `[]`；生产回执 sha256 全程未变。原始回执 sha256 `9c40eb1a60e7a3a71d8b2714d7c729d85b0326d0f2c17f859349223263b968a8`（回退锚点）。就绪命令、注记、备份/回退、授权门与复测见 `FEIYU_SILENCE_RECOVERY_20261122.md`。**生产写入仍待授权操作者在窗口内执行。**

## 5A. legacy 预防代码修复（本会话新增，防复发）

上一版把"legacy 外层 catch 记日志 + 失败魔力快照"列为独立 PR 建议；**本会话已实现**，并入合并候选 0.1.66。目标：legacy 施法异常不再变成"无痕迹永久冻结"，且**绝不伪造成功或无副作用**。不改施法机制副作用顺序，只加记账 + 证据 + 日志。源码入口同 §4。

- **`NativeMaidMagicSupport`**：`Mana` 加 `boolean castCommitted` 记账字段；`cast` 开头重置 false、`mana.current -= attempt.cost` 后置 true；包级访问器 `castCommitted(Attempt)`。**不改 cast 抛异常契约**，guard tick 自主施法不受影响。
- **`NativeMaidCompanionSupport.castSpell`**：仅把 `magic.cast` 包进 try/catch（捕 `RuntimeException | LinkageError`），异常时 `plugin.getLogger().warning(...)` 记 maid/spell/manaCommitted/manaBefore/manaAfter/异常类名+消息，再委托 `LegacyCastFailure.evidence` 按 committed 区分：
  - 扣法力**前**抛 → 可证明无效果 → `state=rpg_cast_failed_before_mana`、`effectsApplied=false`、`manaDeducted=false`。
  - 扣法力**后**抛 → 不可证明 → `state=rpg_cast_exception_after_mana`、`effectsUnproven=true`、`manaDeducted=true`，**绝不声称无效果**。
- **`LegacyCastFailure`**（新自包含类，仅 Gson，无游戏依赖）：纯决策 `evidence(spell,committed,manaBefore,manaAfter,failure)` + `status(result)`，被上面两调用点委托，便于隔离测试真实生产代码。
- **`HybridMaidPlugin.nativeCast`** legacy 分支：`result.addProperty("status",LegacyCastFailure.status(result))`——`effectsUnproven` → `unknown`（保持未结算可审计），否则照旧 completed/rejected。
- **`NativeMaidBodyActions`** 外层 catch（235 行）：补 `plugin.getLogger().warning(...)`（maid/request/action/value/异常），不再静默吞异常。

效果：可证明 pre-mana 失败在桥接层即终态 rejected → harness failed → **自动解冻**；不可证明 post-mana 失败保持 unknown 但**带证据 + 日志**（可审计、可告警），仍按设计待审计 closure（不伪造）。harness 源码（`body/maid.py`）**未改**——既有 `legacy_cast_outcome` 已能按 `observation.state` 对账 pre-mana 终态，post-mana unknown 保持未结算正是预期。

## 6. 回归与隔离验证

Java（真实 `MaidBodyControl`，pinned Gson `4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593`，Java 21 `E:\MC\jdk\jdk-21.0.12.1+1`）：

```sh
python paper/integrations/touhou-maids/tests/run-native-body.py --jdk <jdk21> --gson <gson-2.10.1.jar>
# Native body control: 58 checks passed
# Cast pre-dispatch settlement: 34 checks passed
# Legacy cast audited closure: 12 checks passed
# Legacy cast failure classification: 25 checks passed
# Maid player profile binding, live owner and cached projection checks passed
```

`CastPreDispatchTest`（34）锁定 helper 全决策矩阵：not_found×{accepted,unknown} 结算、×running 及终态/foreign body 状态不结算；所有非 not_found 服务态、缺失/非字符串/null 服务状态均不结算；证据 reason/effectsApplied=false/派生 ID/深拷贝；经真实 journal 的终态 rejected（无 goal/replay）、读回一致、重复返回终态、改参 REQUEST_CONFLICT、重启保留、interrupted-unknown 服务态保持未结算。`LegacyCastAuditQa`（12）锁定 closure 终态 failed、不声称已验证效果、注记逐字保留、证据随回执、重启保留、重复拒绝二次审计、短注记拒绝且原回执不动、非 cast 拒绝。`LegacyCastFailureTest`（25，本会话新增，测真实生产纯决策类 `LegacyCastFailure`）锁定：committed=false → `rpg_cast_failed_before_mana`/effectsApplied=false/manaDeducted=false/status=rejected；committed=true → `rpg_cast_exception_after_mana`/effectsUnproven=true/manaDeducted=true/status=unknown；零费 committed 仍 unproven；**任何分支都不产出 effectsApplied=true**；异常 message 为 null 也容忍；manaBefore/manaAfter/spellId/异常类名逐字保留。

Python 身体层（隔离 venv，`agent-harness-py[dev,server-npc,native-maid]`）：

```sh
python -m pytest -q packages/agent-harness-py/tests/test_native_maid.py   # 80 passed
```

新增 `test_pre_dispatch_cast_failure_settles_the_original_request_without_replay`：cast 观测空→unknown act；服务端 unknown 时结果保持 unknown；服务端置终态 rejected（observation 含 native_failure_before_service_dispatch/effectsApplied False/serviceRequestId/serviceReceipt not_found）后结果→failed/terminal/!retry_allowed，`journal.unresolved()` 清空，证据保留，`len(server.writes)==1`（无重放），重复查询仍 failed。

本会话另新增 4 项 legacy 回执形状回归（harness 源码 `body/maid.py` 未改，仅加测试）：`test_provable_pre_mana_legacy_cast_failure_settles_without_replay`（pre-mana 终态 rejected 回执 → reply_status failed → `journal.unresolved()` 清空、无重放）；`test_unproven_post_mana_legacy_cast_failure_stays_unknown_and_auditable`（post-mana unknown 回执 → reply_status unknown、`legacy_cast_outcome` None、unresolved 保持 1、无重放，observation `effectsUnproven=True` 直接取自源回执）；`test_new_legacy_failure_states_are_not_invented_from_an_unknown_receipt`（参数化 2：两种新 state 都不被 `legacy_cast_outcome` 凭空对账成终态）。

全套 `python -m pytest -q packages/agent-harness-py/tests packages/agent-memory/graphiti-sidecar/tests paper/integrations/unified-npc`：**662 passed / 3 skipped / 1 failed**（本会话重跑核实；较上一版 658 增 4 项 legacy 回执回归）。唯一失败 `test_maid_commands_validated_by_the_real_maid_port`（`test_bodies.py`）已在**纯净 origin/main worktree** 复现，属既有失败，与本次 diff 无关（本次仅在 `test_native_maid.py` 加测试，不改 `test_bodies.py`、`body/maid.py` 等 Python src/fakes/oracle/maid-port.mjs）。

**验证边界（诚实声明）**：以上为隔离逻辑验证，编译真实 `MaidBodyControl` 与 helper，证明结算决策与持久化契约。`receipt()` 的 Bukkit 依赖胶水按读取核对，复用既有终态栅栏释放模式；其**实机端到端 round-trip + 重启验证**按仓库惯例（见 `tests/RECEIPT_READBACK.md`）属发布侧要求，需在生产匹配隔离服（基线 f2418668 + 完整 resident cast 链 + 绑定 external resident 女仆）执行。现有 staging 服的女仆桥均与生产基线哈希不同，且 QA 绑定女仆未确认为 external resident，故未在本轮做实机 round-trip；列入第 8 节发布窗口。**legacy 预防修复（§5A）同理**：`MagicSupport.castCommitted` 记账与 `castSpell` try/catch 的**运行时**行为由 0.1.66 全量编译 + 发布侧实机 round-trip 验证；隔离回归覆盖的是纯决策（`LegacyCastFailure` 25 项）与回执对账契约（harness 4 项）。肥鱼 closure 的桥接结算→harness 对账清空冻结已在隔离 dry-run 端到端验证（§5），生产实跑后肥鱼真实恢复发言的在线验收仍属发布侧。

## 7. 候选产物

`paper/integrations/touhou-maids/build-cast-predispatch-bridge.py`，基线钉死 deployed `0.1.64-lifecycle-async`：

```sh
python paper/integrations/touhou-maids/build-cast-predispatch-bridge.py \
  --baseline <deployed qiandengji-maid jar, sha f2418668…> \
  --classpath-file <生产 classpath.txt> --javac <jdk21/bin/javac> --output <新目录>/qiandengji-maid-0.1.65-cast-predispatch.jar
```

脚本断言基线哈希、仅编译 `MaidBodyControl`/`NativeMaidBodyActions`、替换这两个类（含内部类）、改写 plugin.yml version、其余条目逐字节保留并断言。

- 产物：`E:\MC\staging\maid-cast-predispatch-20261122-build\qiandengji-maid-0.1.65-cast-predispatch.jar`
- 候选 SHA256：`36c31982c416440600a02807a3dc4ab5e79083c2771974c132c93d01cc31fd02`
- 基线 SHA256：`f24186685b88b748eb10564a961b906ccc5e07fe935ba5d8488b031d81551bd7`
- 148 条目，变更仅 `local/tlmcompat/hybrid/MaidBodyControl.class`、`local/tlmcompat/hybrid/NativeMaidBodyActions.class`、`plugin.yml`（version→0.1.65-cast-predispatch）；145 条目字节一致；无增删条目。
- 分支 `fix/maid-cast-predispatch-recovery-20261122`，自 origin/main `d5ae31077d6f131482f1d1084e9a41ad0a4acafc`。

### 7A. 合并候选 0.1.66-cast-recovery（本会话新增，推荐发布）

`paper/integrations/touhou-maids/build-combined-cast-bridge.py`，同钉死基线 `f2418668…`，把 Yui external 修复（§4）与 legacy 预防修复（§5A）合并为**一个**候选，共用一次重启：

```sh
python paper/integrations/touhou-maids/build-combined-cast-bridge.py \
  --baseline <deployed qiandengji-maid jar, sha f2418668…> \
  --classpath-file <生产 classpath.txt> --javac <jdk21/bin/javac> \
  --output <新目录>/qiandengji-maid-0.1.66-cast-recovery.jar
```

仅编译 6 个改动类（`MaidBodyControl`/`NativeMaidBodyActions`/`HybridMaidPlugin`/`NativeMaidCompanionSupport`/`NativeMaidMagicSupport`/`LegacyCastFailure`）对真实 Vortex/TLM/NeoForge/Paper 依赖（311 classpath 条目），替换这些类（含变动内部类）、新增 `LegacyCastFailure.class`、改写 plugin.yml version、其余条目逐字节保留并断言。6 类**编译通过**（仅一条预先存在的 deprecation 提示）。

- 产物：`E:\MC\staging\maid-cast-recovery-20261122-build\qiandengji-maid-0.1.66-cast-recovery.jar`
- 候选 SHA256：`65be03e5c42ebc773cade87e2b5f64f7e732777272b179fb87fb7d0a76a7c2c5`
- 基线 SHA256：`f24186685b88b748eb10564a961b906ccc5e07fe935ba5d8488b031d81551bd7`（0.1.64-lifecycle-async）
- 最小 delta 核验：基线 148 条目 → 候选 **149**（仅新增 `local/tlmcompat/hybrid/LegacyCastFailure.class`，无删除）；实际字节变化 **13** 项＝6 目标类（+变动内部类）+ plugin.yml；**129** 无关条目字节保留；`plugin.yml version: 0.1.66-cast-recovery`。
- **`MaidBodyControl` 与 0.1.65 字节一致**（Yui 修复完整保留）；`NativeMaidBodyActions` 因补外层 catch 日志而与 0.1.65 不同（预期）。
- 回退/分步：若只发 Yui 修复，用 §7 的 0.1.65（sha `36c31982…`）；肥鱼 closure 不依赖候选 JAR（`LegacyCastAuditQa` 是独立编译的测试类，对生产回执目录运行）。

## 8. 发布计划（操作者侧，需批准）

源码已提交≠已合并≠已安装≠已加载≠玩家实际体验，发布记录区分这五态。本次交付到"合并候选产物 + 隔离逻辑验证 + 肥鱼 closure 隔离 dry-run 端到端 + 就绪 runbook + 生产只读取证"；**生产写入与上线未做**，待授权操作者。

1. **发布窗口实机 round-trip**：在生产匹配隔离服装入**合并候选 0.1.66-cast-recovery**（推荐；若分步则 0.1.65），复现 external pre-dispatch 失败→原编号查询结算 rejected→栅栏释放→NPC 恢复；并验 running+not_found 仍 unknown、重复/改参冲突、重启保留。**legacy 预防修复另需实机项**：绑定 legacy 女仆复现扣法力前/后异常，验 pre-mana→终态 rejected 自动解冻、post-mana→unknown 带证据+WARNING 日志（不伪造）、guard tick 自主施法不受影响。肥鱼 `hs_530c…` 用 `LegacyCastAuditQa --settle` 附审计注记与证据清单做 closure（**就绪命令/备份/回退/授权门/复测见 `FEIYU_SILENCE_RECOVERY_20261122.md`**，隔离 dry-run 已端到端验证）。保留隔离实测证据。
2. **预检**：核对在线玩家、试炼、待结算动作、备份空间与候选哈希。可与接力点 2（PR #411 已合并待发布的 Numen API/女仆脑/Python 身体适配产物）**共用一次重启窗口**，但各自记录候选哈希与验证项。
3. **切换**：合适窗口预告→正常关停并等旧进程退出→校验当天冷备（`F:\MC-backups\scheduled`，查 `.complete` 与校验记录）→原子替换产物→启动。
4. **部署后复测**：实际插件版本（应为 **0.1.66-cast-recovery**，分步则 0.1.65-cast-predispatch）、Java/基岩入口、Agent 与语音、看门狗、存档。结衣/肥鱼 `unknownRequests` 应归 0、counters 恢复动作；**肥鱼 `latest.log` 应重现 `QD_PUBLIC_MAID`/`af86ae0c` 发言、route/intents 非空**；结衣服务账本仍全终态、无新派发；肥鱼 closure 回执为 failed/unproven 且无重放。记录回退用的上一份产物（基线 f2418668 jar）与肥鱼原始回执（sha `9c40eb1a…`）。
5. **回退**：代码回退与世界恢复是两种操作。游戏已继续后，恢复旧世界/账本需独立判断；肥鱼 closure 与结衣 rejected 都是原请求终态，回退代码时保留这些新状态。

禁止通过提权、关闭碰撞、改保护规则或重新提交同一副作用制造成功；不重放、不伪造成功。凭据、令牌、账户库、聊天、模型环境与世界存档保留在原受控部署环境。

## 9. 接力点状态

- 接力点 3（本文）：**两路修复**完成——external（结衣）pre-dispatch 终态结算 + legacy（肥鱼）预防修复（§5A）；回归全绿（Java 58+34+12+25+profiles、harness 80、全套 662/3/1 既有失败）；合并候选 **0.1.66-cast-recovery** 已构建+编译+最小 delta 核验；肥鱼静默根因只读坐实、closure **隔离 dry-run 端到端验证**、就绪 runbook `FEIYU_SILENCE_RECOVERY_20261122.md` 已交付。**生产写入未做**：实机 round-trip、肥鱼生产 closure 与上线待授权操作者发布窗口（任务 #7，可与接力点 2 共用重启）。
- 接力点 1（桐人控制器交接，PR #415）：CI 绿、main 未含，待与主干收敛，不在本文范围。
- 接力点 2（PR #411 产物发布）：已合并待安装，可与本次共用重启窗口。
- 接力点 4（村民委托汇总）：独立看板已加载，接工会看板时复用原 ID/领取/验收规则，避免双发奖，不在本文范围。