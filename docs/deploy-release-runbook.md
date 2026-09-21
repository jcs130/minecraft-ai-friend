# 发布/部署回执通道 · Runbook 与设计提案

状态：**提案（未执行）**。本文档本身已随分支提交入库；本文描述的任何宿主/容器步骤均未执行，方案B仍是未启用候选。
工单：case-3834fa1201946bc290c6（deploy-release-receipt-channel-missing）。
当前发布对象（基线锚）：分支 codex/ops-world-improvements 上的 850baca55c34eb7d53a346705404883c043a5817（HEAD 回执 = mc-god-20260915-guild-withdraw-test3 passed 203 tests（快照 b9c0ff9a…，engineering_commit 850baca 对该快照全字节复核通过）；deploy-baseline-850baca-1 request=mc-god-20260916-deploy-baseline-850baca-1 随本移锚件排队，passed 回执收讫前宿主不得部署本锚）。本地未推送队列 16 笔（本移锚件落库后 17 笔）：85ec3be→108f82e→da70e4e→c70fa29f→65e567b→dc2032b→1659453→850baca 八笔触生产运行时；f48e2ef8→afad352→c1fce7b→e41f401→d4dd33ea→ed580972→4eda664→75d40ef 为 docs/tests-only 旧后缀链（已并入新锚、运行时字节等价），本移锚件起为锚后新后缀链，均不进生产运行时、无需追加重启容器。
**docs/tests-only 后缀规则（2026-09-15 08:47 CST 固化）**：锚之后的提交若只触 docs/ 与 tests/ 路径，其运行时字节与锚等价（tests/、docs/ 不在生产 bind mount 内，§1 事实基线），宿主可直接检出分支 HEAD，无需等本文档改锚；宿主自验命令 `git log --name-only --pretty=format: 850baca..HEAD | sort -u`，输出（空行忽略）应全部以 docs/ 或 tests/ 开头，HEAD==锚时空输出即通过。据此本文档**停止随 docs-only 提交逐笔滚动同步**（消除「滞后 1 笔稳态」的无限同步链）；一旦后缀链出现 docs//tests/ 以外路径（world/、compose.yml 等），必须先更新本锚、排队并通过 deploy-baseline 全计划测试后，宿主方可部署新锚。
撰写：operations:mc-god，2026-09-14（源码亲读基线：head=85ec3be 工作树）；2026-09-15 03:56 CST 更新发布对象至分支 HEAD 与 6 笔队列（原「首次适用对象 85ec3be」表述废止，reset 到中途节点=部署旧代码）；2026-09-15 07:27 CST 更新发布对象至 d4dd33ea 与 11 笔队列（f48e2ef8=本 runbook 03:56 同步件；afad352/c1fce7b/e41f401/d4dd33ea=Step1 生存轨迹数据集管线四件，case-638934f646fe2ffeebfe，经 owner 静态审阅与 game:mc-god 过程级验收 seq362）；2026-09-15 08:06 CST 更新发布对象至 ed580972 与 12 笔队列（ed580972=07:27 同步件的落库件，仅触 docs/deploy-release-runbook.md；deploy-baseline-ed580972-1 passed 174 tests 收讫，case-3834fa1201946bc290c6 v30）；2026-09-15 08:47 CST 更新发布对象（基线锚）至 4eda664（deploy-baseline-4eda664-1 passed 收讫，case-3834fa1201946bc290c6 v33）并固化 docs/tests-only 后缀规则——锚后仅触 docs//tests/ 的提交与锚运行时等价，宿主检出 HEAD 前以 git log --name-only 自验，本文档停止逐笔滚动同步，消除滞后 1 笔稳态与无限同步链；2026-09-15 10:01 CST 移锚至 1659453（锚后首笔运行时提交 1659453=playersRoster 交叉核对通道，case-08e101df69170a7ece6d；roster-view-test1 passed 179 tests 与 deploy-baseline-1659453-1 passed 双回执收讫，case-3834fa1201946bc290c6 v35），旧后缀链 f48e2ef8…75d40ef 并入新锚、后缀链重置，队列 15 笔（本移锚件后 16 笔）；2026-09-16 11:09 CST 移锚至 850baca（锚后运行时提交 850baca=公会合同下架通道+水域渡河提示+下架后公会板展示批，case-c8e4c10713f6f5dc4c5d，guild-withdraw-test3 passed 203 tests 已收讫；deploy-baseline-850baca-1 request=mc-god-20260916-deploy-baseline-850baca-1 随本移锚件排队，passed 回执收讫前宿主不得部署本锚），旧锚 1659453 并入、后缀链重置，队列 16 笔（本移锚件后 17 笔）。

## 1. 事实基线（全部源码/compose 亲读）

- 生产代码经**宿主 compose 项目目录的只读 bind mount** 进入容器，镜像全部预构建钉定且 `pull_policy: never`
  （mc-world:2.1.38、mc-sidecar:2.1.0、qiandengji-qwenpaw-game:2.2.0-qd1、qiandengji-qwenpaw-ops:2.2.0、qiandengji-survivor:2.2.0-qd15）。
  ⇒ Python/JS 代码上线**不需要重建镜像**：宿主检出更新 + 受影响容器重启即可；compose.yml 变更才需要 `up -d` 重建该服务。
- 85ec3be 触碰的树与消费容器：
  - world/ops（world_content_tools/world_team_mcp/world_team_schedule）→ qwenpaw（游戏 /ops）、qwenpaw-ops（/ops）、npc（/opt/ops）、survivor（/ops）
  - world/sidecar（world_content/world_admin_consumer）→ 同上四者（不同挂载名）+ voice/asr（仅挂载，本提交未改其运行文件）
  - tests/* 不进生产运行时；world/src、world/admin 未触碰 ⇒ world/gate/panel/control 无需动作。
  - 保守重启集：**qwenpaw、qwenpaw-ops、npc、survivor**。
- 工程通道是文件队列：qwenpaw-ops 可写 /engineering/{requests,snapshots,state}；control 容器内
  engineering-runner（world/admin/engineering-runner.mjs）做快照字节校验/钉定 checks/coverage 门，再以无网络、只读根、非 root 的锁死容器跑测试并写 receipts。
- 管理执行服务（world/admin/control-service.mjs）能力边界：仅既有容器 start/stop/restart（/plan→/execute，
  自带 mc save-all、依赖序、健康门、持久 journal 回执）。**无 git、无镜像构建、无部署语义。**
- 精确缺口：仓库挂载全部 `:ro`，**没有任何容器持有宿主检出写权限** ⇒ 工程克隆→生产检出的 git 同步只能由
  宿主侧（造物主/管理员）执行。工程角色读不到远端配置（.git/config 角色守卫拒绝），push 通道是否存在无法从角色侧核证。

## 2. 方案A：一次性人工发布（零新代码，立即可用）

步骤（宿主/管理侧执行，工程侧只收与核验回执）：

1. 宿主：生产检出同步到发布对象（基线锚）850baca55c34eb7d53a346705404883c043a5817（前置=deploy-baseline-850baca-1 passed 回执已收讫）；锚之后的提交若仅触 docs/ 与 tests/（文首后缀规则），可直接检出分支 HEAD，运行时字节与锚等价。
   注意：队列 16 笔均 pushed=false（推送通道缺失即本工单主题），生产检出 `git fetch` 远端**拿不到这些提交**；
   宿主可改从工程工作区本地路径取提交（示例，以宿主实际发布策略为准）：
   `git fetch /state/work/workspaces/qd-engineer/engineering/repo codex/ops-world-improvements && git checkout -B codex/ops-world-improvements FETCH_HEAD`。
   回执：`git rev-parse HEAD`（应=850baca…；按后缀规则检出 HEAD 时回执实际值，并附 `git log --name-only --pretty=format: 850baca..HEAD | sort -u` 自验输出）+ `git status --porcelain`（应为空）。
2. 重启受影响服务（compose.yml 未变，重启即可）：qwenpaw、qwenpaw-ops、npc、survivor。
   优先走 control /plan+/execute（action=restart）：自动处理 qwenpaw→survivor 依赖序、mc 保存、健康门，
   并在 /operations 留下持久回执（operationId、steps）。
   **时序约束**：qwenpaw-ops 重启会中断在办受管任务（case-704a09d 即此类中途回收）——选无活动班次窗口执行；
   其恢复过程同时就是 case-704a 候选的实机自愈观察机会。
3. 生效核验（按各单既有验收点）：
   - case-63f528e：game:mc-god 读 world_content_context → capabilities.boss/chest 应报 steps.ledger=implemented
     （ready=false 为设计，翻 true 需服务端四步桥接）；随后 world_site_propose→approve→record→recover 真实走一次。
   - case-704a09d：观察一次班次中途回收后下一班自愈（orphanReconciled 回执）。
   - 共享提交内其余候选：team_context 的 npcLlmEnabled 汇总措辞、world_admin 链回执正常。
   - 队列后续各笔（108f82e 内容状态同步自愈、da70e4e 纪元追踪、c70fa29f 健康事件追踪、65e567b survivor 控制器证据、dc2032b world_content_reachability 工具、f48e2ef8 本 runbook 同步件、afad352 Step1a 轨迹读取器、c1fce7b Step1b prompt 重建镜像、e41f401 Step1a v2 turn-actions/lease/lint 与 bytes 统计段、d4dd33ea Step1b2 turn-completions 导出契约、ed580972/4eda664 两笔 runbook 发布对象同步件落库、75d40ef 后缀规则固化件、1659453 playersRoster 交叉核对通道（case-08e101df69170a7ece6d，部署后 team_context 应见 playersRoster 块且 registryNotObserved 含 Kirito）、850baca 公会合同下架通道（case-c8e4c10713f6f5dc4c5d：部署后 game:mc-god 读 world_content_context → capabilities.withdraw.ready=true、死发行人在榜合同进入 issuerMissingContracts；对下一次出现的死发行人在榜合同调 world_content_withdraw → 复读该合同 status=withdrawn；2026-09-15:1「收购·铁锭」已随 09-16 日切自然过期，不再作为本项验收对象））：生效核验点以各对应工单事件流为准；每笔均有 passed 隔离测试回执，commit→testJobId 映射可查工程 progress recentCommits（receipts 亲读来源，非推断）。docs/tests-only 后缀链（本移锚件起，现场以 `git log --name-only --pretty=format: 850baca..HEAD` 枚举，后续 docs/tests-only 提交自动并入）只落 tests/ 与 docs/、不进生产运行时，生效核验=宿主 rev-parse 基线核验 + case-638934f646fe2ffeebfe 的真实数据首跑（待部署+宿主只读通道），无容器行为可观察。
4. 各单以“部署回执（git rev-parse + control operationId）+ 各自核验回执”分别关闭；**本地 commit 永远不当作已生效**。

## 3. 方案B：可复用的发布回执通道（工程候选，需先批）

- **B1（零权限扩张）**：发布请求走 `/engineering/publish-requests` 文件队列（管理侧审批字段随请求落盘）；
  control 侧新增发布执行器，职责仅限：校验对应 engineering_commit 回执存在且 commit 一致 → 调既有 /plan+/execute
  重启受影响服务 → 写 publish receipt（执行前后版本、健康、operationId）。git 同步仍由造物主宿主执行并把宿主回执
  登记进 receipt。无新挂载、无新凭据。
- **B2（全自动）**：给受监督执行器受控的检出写权限（专用 publisher 挂仓库子树 rw）以自动 git 同步。
  属权限边界扩张，须造物主裁决；裁决前不实现。
- 前置依赖：world/admin/*.mjs 与 compose.yml、world/ops/qwenpaw_health.py 均不在 team-guild-admin-python
  coverage 内（待扩展，见运营提案 ops-20260914T1224-engineering-coverage-qwenpaw-health）；实现将沿用 runner
  既有风格：字节校验、防重放、失败终态、回执持久。

### B1 实现候选已就绪（未入 git、未启用未部署；主体文件以自忽略 .gitignore 停放在工作树磁盘、git 不可见，control-service.mjs 接线片段存工程角色 drafts/wip-backup-20260914/）

按 game:mc-god seq167 采纳的方向实现：`world/admin/publish-executor.mjs` + `control-service.mjs` opt-in 装配
（`QIANDENG_PUBLISH_ENABLED==='1'` 才启动，默认关闭）+ `tests/test_world_publish_channel.py` 静态契约测试。
通道契约：

- 请求：`/engineering/publish-requests/<publishId>.json`，固定字段 schema/publishId/commit(40hex)/branch/
  commitRequestId/services/requestedBy/approvedBy/approvedAt/note(≤300)/caseRefs(≤16)。services 只允许
  qwenpaw、qwenpaw-ops、npc、survivor（world/ops+world/sidecar 的四个消费容器，保守重启集）。
- 宿主同步证据：同目录 `<publishId>.host-sync.json`（仅宿主可产出），须含 gitRevParse===commit 且
  gitStatusClean===true；缺失时回执停在 `awaiting_host_sync`，不产生任何容器动作。
- 前置校验（任一失败=终态 rejected 回执，无副作用）：请求格式 → `/engineering/state/commit-<commitRequestId>.json`
  存在且 status=committed、commit/branch 与请求一致 → 发布快照 manifest.changed 不含 compose.yml
  （含则 `publish_requires_compose_recreate`，compose 重建走宿主，本通道拒绝而非降级）。
- 执行：先写 durable claim（status=running，含 beforeServices/前后 commit），再经 `http://127.0.0.1:3090`
  回环调既有 `/plan`+`/execute`（action=restart）→ 轮询 `/operations` 至终态。回执含 operationId、
  operation steps、afterServices；complete/failed 为终态。
- 不确定即终态：/execute 已接受后的任何错误或等待超时（`publish_operation_timeout`）→ status=unknown +
  pendingReview；执行器进程重启时 running → unknown（`control_restarted`）。终态回执不重放。
- 边界不变：无新挂载/凭据；执行器对 Docker 只有只读 GET（容器状态快照），一切变更动作走既有 control 通道；
  git 同步与 compose 重建永远留在宿主侧。
- 待办（依 coverage 解封）：world/admin/*.mjs 纳入 team-guild-admin-python 后随整体快照隔离测试；随后可加
  Python 侧请求落盘助手（engineering_workspace.py 同样不在当前 coverage）。

## 4. 通道本身的验收标准

- 请求→回执可审计：发布请求含 commit sha 与审批者；回执含前后版本、健康快照、operationId；失败为终态不重放。
- 角色侧永远只有请求与回执，无 docker/git 直连；宿主步骤由造物主执行并留独立回执。

---

## 5. 号映射与「神社之门」的部署与验证（2026-09-21 补）

> 权威说明在 `docs/BOTGATE-IDMAP.md`（号映射单一事实源）；容器内速查卡在
> `world/src/neoforge-handshake/README.md`（随只读挂载进两个门容器）。本节只管**部署动作与验收**。

### 5.1 生效路径（为什么便宜）

`/app/src` 是宿主 `world/src` 的**只读 bind-mount** ✓ 所以改门代码或换号表**只需**：

```powershell
cd D:\Projects\QiandengJi
docker restart qiandengji-gate-1 qiandengji-gate-public-1
```

不重建镜像、不重启世界、不掉玩家（实测重启后在线名单不变）。

### 5.2 什么时候**必须**重生成号表

- 增删模组、换 NeoForge 版本、改客户端代理链路之后
- 症状：Agent 或基岩端读到错位世界（红床→活塞、obsidian→火、模组物品空白）

```powershell
# 1) 服务端只读导出（不改动世界）
#    RCON:  /botgate dumpids
# 2) 取 dump/botgate-ids/{blocks.tsv,items.tsv} → world/src/neoforge-handshake/idmap-dump/
# 3) 备份 + 生成（必须看到 badRules=0）
cd world\src\neoforge-handshake
copy idmap.json idmap.json.bak-<日期>
node build-idmap.cjs
# 4) 只重启门
docker restart qiandengji-gate-1 qiandengji-gate-public-1
# 5) 验收（两件都必须绿）
node verify-gate.cjs
node audit-idmap.cjs
# 6) 号表入仓（防漂移）
git add world/src/neoforge-handshake && git commit && git push
```

### 5.3 验收标准

| 项 | 判据 |
|---|---|
| 号表载入 | 门日志 `[REMAP] 载入 state=… item=…` + `[REMAP] 反表 state=…` |
| 功能冒烟 | `node verify-gate.cjs` → **11/11 exit 0**（含 4 项**状态保真**） |
| 结构体检 | `node audit-idmap.cjs` → 覆盖率对账一致 ✓ 双向往返恒等 ✓ `direct=0` ✓ |
| 各条通路 | 门日志 `docker logs qiandengji-gate-1 2>&1 | findstr 叩门` 出现该客户端名 ✓ |
| 基岩上游（免手机） | `node verify-gate.cjs 127.0.0.1 25568`（ViaProxy Java 入口）✓ `… 25566`（皮肤代理入口）✓ |
| 天眼 | `http://127.0.0.1:19092/healthz` → `ok:true` 且 `blockStates.mode="gate-translated"` |

⚠ **禁止**用"画面看着对"作为过门证据：号错位是「低段侥幸对、高段全错」，裸连也能画出正常村庄。

### 5.4 回滚

- 号表：`copy idmap.json.bak-<日期> idmap.json` → 重启两道门
- 门代码：`git checkout` 对应提交 → 重启两道门
- 基岩桥 target：`copy start-viaproxy.bat.bak-target25565 start-viaproxy.bat` → `schtasks /end` → **`taskkill /T /F` 掉残留 java**（`/end` 不杀孤儿子进程）→ `schtasks /run`

---

## 6. 宿主侧服务（不在 compose 里的东西）与它的正本

有些服务**必须或暂时**跑在宿主机上，它们的定义原本散落在被 gitignore 排除的目录里（换机即丢）。
2026-09-21 起，**正本收进 `world/host-services/`（入 git）** ✓ 运行副本仍在其原位 ✓ 两边改动要人工同步 ✓

| 服务 | 运行副本位置 | 仓内正本 | 状态 |
|---|---|---|---|
| 基岩桥 ViaProxy + Geyser | `ops/docker/shadow/viaproxy/`（被 `ops/docker/.gitignore` 的 `shadow/` 排除） | `world/host-services/viaproxy-bedrock/` | 在跑 ✓ 已过门（target 25701）✓ 容器化 A/B 待手机验证 |
| 皮肤代理 skin-proxy | `C:\Users\lzl19\.dsh\profiles\web\`（harness/dsh 侧） | `world/host-services/skin-proxy/` | 在跑 ✓ 上游已改 25701 ✓ 实测 11/11 |
| Geyser 容器 A/B 试验 | `server/geyser-ab/`（被 `/server/` 排除） | `world/host-services/geyser-container/` | 试验中（宿主发 UDP 19141） |
| `mc-gateway` 玩家门户 | `D:\Minecraft\minecraft-ai-friend\mc-gateway\`（旧栈 clone） | — | **已退役 2026-09-21**（8011 释放 ✓ 代码与 DB 未删 ✓ 回滚：`schtasks /change /tn mc-gateway-autostart /enable` + `/run`） |

> 宿主进程重启纪律：`schtasks /end` **只结束任务注册的那棵树**，bat 里 spawn 的 java/node 会变孤儿继续用旧参数运行 ✓
> 必须 `/end` → 逐个 `taskkill /T /F`（或 `Stop-Process`）→ 确认端口已空 → 再 `/run` → **以进程命令行实查验收**。

