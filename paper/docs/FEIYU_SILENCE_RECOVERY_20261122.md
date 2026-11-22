# 肥鱼静默恢复 runbook（2026-11-22）

> 面向授权操作者。本文件由只读诊断 + 隔离 dry-run 产出，**不含任何已执行的生产写入**。
> 所有生产写入（审计 closure、替换桥接 JAR）必须在授权操作者批准 + 备份 + 重启窗口内执行。
> 铁律：**不重放、不伪造成功**；按原请求编号结算；凭据/聊天/模型环境/存档留在原受控部署环境。

## 1. 根因（已只读确认）

肥鱼（maid `af86ae0c-c524-467b-a28c-8da5af88d45e`，owner `822d173a-7181-3b9b-be60-804f29b24ecc` / ag_CorMy）
自 **2026-11-22 15:27:51+08** 起静默。不是 LLM/TTS/SVC 传输故障，而是**未结算施法冻结**：

- 最后一次正常发言：journal rowid 1927，`hs_81847ec920a74186823ad082`，15:26:04+08，`deliveredPlayers=3`、voice 正常。
- 冻结源：journal rowid 1930（最后一行，此后无新行），`hs_530c5bd47eaa42649ca1f653`，`cast astral_convergence`，
  `status=unknown / terminal=false`，observation 仅 `{"reason":"execution_uncertain_query_original_request"}`。
- 机制：`npc.py:_actor_loop`(1521–1536) 只要 `journal.unresolved` 非空就进只对账分支，反复查询该 cast；
  legacy 回执无 `observation.state` → `legacy_cast_outcome` 返回 None → 永远 unknown → 永久卡死，零决策零发言。
- 路径：肥鱼**非 external**，派生服务 ID `8b462b7a-4630-3d75-9bd3-bea6cb818580` 无 resident-cli 台账（全服仅 2 个台账目录，均非肥鱼）。
  异常出自 `NativeMaidBodyActions.java:235` 外层 catch（吞异常、reason-only、不记日志）；legacy `magic.cast` 扣法力先于效果，
  法力表内存态重启即丢 → **事后不可证明**。16:52/16:55 重启无效（账本持久 sqlite，未结算 cast 跨重启仍在）。
- `npc-20261122-165503.log` 的 4 条 `ConnectionResetError [WinError 10054]` 是 Windows asyncio proactor 连接关闭噪声，**非病因**。

## 2. 证据清单（只读，附入维护记录）

| 项 | 值 |
|---|---|
| 生产桥接回执路径 | `E:\MC\server\plugins\QiandengjiMaidBridge\native-body-receipts\af86ae0c-c524-467b-a28c-8da5af88d45e\hs_530c5bd47eaa42649ca1f653.json` |
| 原始回执 sha256（回退锚点） | `9c40eb1a60e7a3a71d8b2714d7c729d85b0326d0f2c17f859349223263b968a8` |
| 原始 observedAt | `2026-11-22T07:27:51.826345700Z`（15:27:51+08） |
| 原始 observation | `{"reason":"execution_uncertain_query_original_request"}`（无 state/effectsApplied） |
| harness 账本 | `E:\MC\private\unified-npcs-20261117\npc\feiyu\actions.sqlite3` dispatch rowid 1930 |
| 健康（21:07+08） | running/connected=true，lifecycle=ready，error=null，unknownRequests=1，route={}，intents=[]，actions=0，events 持续增长 |
| 服务端日志 | 16:52 重启后 `latest.log` 肥鱼 `QD_PUBLIC_MAID`=0、`af86ae0c` 零提及 |
| 台账缺失 | resident-cli 下无肥鱼派生服务 ID 目录 → legacy 无台账，不可证明 |

## 3. A 线 · 审计 closure（立即解冻肥鱼，操作者侧生产写入）

唯一能立即恢复肥鱼发言的办法：把 `hs_530c` 桥接回执**审计结算为 failed**（`outcomeUnproven=true`、
`effectsVerified=false`、**绝不声称 effectsApplied**、不重放）。终态后 harness 对账清空 `journal.unresolved`，
`_actor_loop` 进入决策分支 → 肥鱼恢复说话。结衣的 0.1.65 `not_found` 修复对肥鱼**不适用**（无台账可证明）。

### 3.1 隔离 dry-run 已验证（本文件随附）

脚本 `D:\codex\2026-11-22\new-chat\work\feiyu-closure-dryrun-20261122\dryrun.py` 只读复制生产回执到隔离目录并结算副本：
- 结算后 12 项形状核验全过：`status=failed / terminal=true / goalCompleted=false / retryAllowed=false`，
  observation `outcomeUnproven=true / effectsVerified=false / 无 effectsApplied / reason=legacy_cast_exception_outcome_unproven / auditNote 逐字 / auditedAt`，原 requestId/operationId/arguments 不变。
- harness `reply_status(settled)=failed`、`legacy_cast_outcome(settled)=None`、`ActionJournal.unresolved` 结算后清空 `[]`。
- 生产回执 sha256 全程未变（只读确认）。
- dry-run 结算副本 sha256 `de4ccf5332248133bd2511c0725246cb37fb02be1fb0503b7fcd24782194580e`
  （含本次 auditedAt 时间戳；**生产实跑时间戳不同，哈希会不同**，以实跑输出为准）。

### 3.2 生产执行命令（窗口内、服务端已关停）

工具是测试类 `LegacyCastAuditQa`（不在生产 JAR 内），需用部署 JDK + Gson 现编译 `MaidBodyControl` + 工具，再对生产回执目录运行。
审计注记文件须 **8–300 字符、UTF-8、无换行/ISO 控制符**（工具会拒绝控制符）。

```sh
JDK="E:/MC/jdk/jdk-21.0.12.1+1"
GSON="E:/MC/server/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar"
SRC="D:/codex/2026-11-22/new-chat/work/maid-cast-predispatch-20261122/paper/integrations/touhou-maids"
WORK="<窗口工作目录>"            # 编译输出与注记文件放这里，勿放生产
RECEIPT_DIR="E:/MC/server/plugins/QiandengjiMaidBridge/native-body-receipts"
MAID="af86ae0c-c524-467b-a28c-8da5af88d45e"
OWNER="822d173a-7181-3b9b-be60-804f29b24ecc"
REQ="hs_530c5bd47eaa42649ca1f653"

# 1) 编译真实生产结算工具（仅 Gson 依赖）
"$JDK/bin/javac" --release 21 -encoding UTF-8 -cp "$GSON" -d "$WORK/classes" \
  "$SRC/hybrid-src/local/tlmcompat/hybrid/MaidBodyControl.java" \
  "$SRC/tests/LegacyCastAuditQa.java"

# 2) 审计注记（单行、无换行；按实际取证措辞，8–300 字符）
#    例：肥鱼 astral_convergence 施法于 2026-11-22 15:27:51+08 异常中断；legacy 无台账、扣法力先于效果、
#        异常被吞且法力表重启丢失，结果不可证明。按原编号审计结算为失败，不重放、不声称效果。
printf '%s' "<审计注记>" > "$WORK/audit-note.txt"   # 注意：不要追加换行

# 3) 结算（原子写入生产回执；记录输出 sha256 入维护记录）
"$JDK/bin/java" -cp "$WORK/classes;$GSON" local.tlmcompat.hybrid.LegacyCastAuditQa \
  --settle "$RECEIPT_DIR" "$MAID" "$OWNER" "$REQ" "$WORK/audit-note.txt"
```

预期输出：`settled hs_530c… status=failed terminal=true sha256=<实跑哈希>`。

### 3.3 前置校验（执行前必须人工确认）

- 肥鱼**非 external resident**（external 走桥接回执查询对账，不用此工具）：确认 resident-cli 无其派生服务 ID 目录。
- 回执当前 `action=cast && status=unknown`（工具内置守卫，否则拒绝）。
- 原始回执 sha256 == `9c40eb1a…`（与备份一致，未被他人改动）。
- 服务端**已正常关停**（避免与宿主对账/桥接写入竞态；`MaidBodyControl.write` 虽原子移动，窗口内停机最稳）。

### 3.4 回退

closure 只改一个回执文件。回退＝用备份的原始回执（sha256 `9c40eb1a…`）原子覆盖回
`…/af86ae0c…/hs_530c….json`。肥鱼回到冻结态（可再次审计），无其它副作用。**绝不以重放施法回退。**

## 4. B 线 · legacy 预防代码修复（防复发，候选已构建）

让 legacy 施法异常不再变成"无痕迹永久冻结"。**不改变施法机制副作用顺序**，只加记账 + 证据 + 日志：

- `NativeMaidMagicSupport`：`Mana.castCommitted` 记账字段；`cast` 开头重置、扣法力后置 true；包级访问器 `castCommitted(Attempt)`。
  **不改 cast 抛异常契约**，guard tick 自主施法不受影响。
- `NativeMaidCompanionSupport.castSpell`：仅把 `magic.cast` 包进 try/catch，异常时记日志 + 按 committed 区分：
  - 扣法力**前**抛 → 可证明无效果 → `state=rpg_cast_failed_before_mana`、`effectsApplied=false`、`manaDeducted=false`。
  - 扣法力**后**抛 → 不可证明 → `state=rpg_cast_exception_after_mana`、`effectsUnproven=true`、`manaDeducted=true`，**绝不声称无效果**。
- `LegacyCastFailure`（新自包含类，仅 Gson）：纯决策 `evidence(...)` + `status(...)`，被上面两调用点委托。
- `HybridMaidPlugin.nativeCast` legacy 分支：`effectsUnproven` → `status=unknown`（保持未结算可审计），否则照旧 completed/rejected。
- `NativeMaidBodyActions` 外层 catch：补 `plugin.getLogger().warning(...)`，不再静默吞异常。

效果：可证明 pre-mana 失败在桥接层即终态 rejected → harness failed → **自动解冻**；不可证明 post-mana 失败保持 unknown
但**带证据 + 日志**（可审计、可告警），仍按设计待审计 closure（不伪造）。

### 4.1 回归（全绿）

- Java 隔离（`run-native-body.py`，测真实生产代码）：MaidBodyControl 58 + CastPreDispatch 34 + LegacyCastAuditQa 12 +
  **LegacyCastFailureTest 25（新）** + MaidPlayerProfiles。
- harness：`test_native_maid.py` 80（含新增 pre_mana 结算解冻 / post_mana 保持 unknown 可审计 / 新状态不被凭空对账 共 4）。
  全套件 644 通过 / 3 跳过 / 1 失败（`test_bodies.py::test_maid_commands_validated_by_the_real_maid_port`，
  已在纯净 origin/main 确认预先存在，与本次无关；`test_bodies.py`、`body/maid.py` 源码均未改）。

### 4.2 候选产物（合并 Yui + legacy，共用一次重启）

| 候选 | 路径 | sha256 | 说明 |
|---|---|---|---|
| **0.1.66-cast-recovery（推荐）** | `E:\MC\staging\maid-cast-recovery-20261122-build\qiandengji-maid-0.1.66-cast-recovery.jar` | `65be03e5c42ebc773cade87e2b5f64f7e732777272b179fb87fb7d0a76a7c2c5` | Yui pre-dispatch + legacy 可观测/可证明，6 类改动 + 新类 LegacyCastFailure |
| 0.1.65-cast-predispatch（回退/分步） | `E:\MC\staging\maid-cast-predispatch-20261122-build\qiandengji-maid-0.1.65-cast-predispatch.jar` | `36c31982c416440600a02807a3dc4ab5e79083c2771974c132c93d01cc31fd02` | 仅 Yui external not_found 修复 |

- 基线（部署中）：`E:\MC\server\plugins\qiandengji-maid-native-0.1.12-conversation.jar`，sha256 `f24186685b88b748eb10564a961b906ccc5e07fe935ba5d8488b031d81551bd7`（0.1.64-lifecycle-async）。
- 0.1.66 最小 delta 核验：基线 148 条目 → 候选 149（仅新增 `LegacyCastFailure.class`，无删除）；实际字节变化 13 项
  ＝6 目标类(+变动内部类)+plugin.yml；129 无关条目字节保留；`plugin.yml version: 0.1.66-cast-recovery`；
  **MaidBodyControl 与 0.1.65 字节一致**（Yui 修复完整保留），NativeMaidBodyActions 因补日志而不同（预期）。
- 构建脚本：`build-combined-cast-bridge.py`（钉死基线 SHA256，仅编译 6 改动类 vs 基线+311 依赖，字节保留其余，断言无关条目一致）。
  6 类对真实 Vortex/TLM/NeoForge/Paper 依赖**编译通过**（仅一条预先存在的 deprecation 提示）。

## 5. 发布窗口顺序（可与 PR #411 共用一次重启）

1. 授权操作者批准 + 在线玩家预告。
2. 正常关停服务端。
3. 冷备：桥接回执目录（记录 `hs_530c` 原始 sha `9c40eb1a…`）、当前桥接 JAR（`f2418668…`）、世界存档、harness 账本、模型/凭据环境不动。
4. **A 线审计 closure**（§3.2，停机态）：结算 `hs_530c` 为 failed，记录实跑 sha256。
5. **原子替换桥接 JAR**：装入 0.1.66 候选（备份旧 JAR 供回退）；如同时发布 PR #411 产物，按其程序一并替换。
6. 启动服务端。
7. 复测：
   - 插件版本 `0.1.66-cast-recovery`；Java + 基岩入口正常。
   - **肥鱼**：health `unknownRequests=0`、route 非空、intents 非空、`actions>0`、`latest.log` 出现 `QD_PUBLIC_MAID`/`af86ae0c` 发言；语音可达。
   - **结衣**：external cast pre-dispatch 失败 → 原编号查询结算 rejected → fence 释放 → 恢复；`running+not_found` 仍 unknown；重复/冲突、重启保留。
   - Agent 协议、看门狗、存档完整性。
8. 回退预案：恢复旧 JAR（`f2418668…`）+ 原始回执（`9c40eb1a…`）；记录回退产物。**不以重放/提权/改保护规则制造成功。**

## 6. 验证边界（诚实声明）

- 已完成：只读根因取证；legacy 纯决策 Java 隔离回归（真实生产代码）；harness 回执形状回归；6 类对真实依赖编译验证；
  候选最小 delta 字节核验；**肥鱼 closure 隔离 dry-run 端到端**（桥接结算 → harness 对账清空冻结，生产只读未变）。
- **未完成（发布侧 #7）**：生产匹配隔离服实机 round-trip（基线 `f2418668` + 完整 resident cast 链 + 绑定 external resident 女仆 + legacy 女仆），
  以及生产实跑 closure 后肥鱼真实恢复发言的在线验收。隔离环境无匹配基线的 staging JAR、QA 女仆未确认 external，故实机验收留待发布窗口。
- `magic.cast` 内 `castCommitted` 记账与 castSpell try/catch 的**运行时**行为由 0.1.66 全量编译 + 发布侧实机 round-trip 验证；
  隔离回归覆盖的是纯决策（LegacyCastFailure）与回执对账契约。

## 7. 约束重申

不重放、不伪造成功；写操作按原 `request_id` 对账，中断后先查原请求；凭据/令牌/账户库/聊天/模型环境/世界存档留在原受控部署环境；
EULA 仅由操作者接受；`AgentFriend/build.ps1` 默认 `-ServerRoot` 指向生产，须显式指向隔离依赖目录；
保护/背包回归须同时测成功与拒绝；区分 server-accepted/executing/partial/goal-complete/unknown；保留其他 Agent 未提交改动/分支/worktree/stash。