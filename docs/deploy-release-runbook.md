# 发布/部署回执通道 · Runbook 与设计提案

状态：**提案（未执行）**。本文档本身已随分支提交入库；本文描述的任何宿主/容器步骤均未执行，方案B仍是未启用候选。
工单：case-3834fa1201946bc290c6（deploy-release-receipt-channel-missing）。
当前发布对象：分支 codex/ops-world-improvements HEAD = dc2032b0ecd3ce7837c70c9b1d0747cdcc3483df（本地未推送队列 6 笔：85ec3be→108f82e→da70e4e→c70fa29f→65e567b→dc2032b；HEAD 双回执 = mc-god-20260915-reachability-test2 passed 174 tests + mc-god-20260915-deploy-baseline-dc2032b-1 passed）。
撰写：operations:mc-god，2026-09-14（源码亲读基线：head=85ec3be 工作树）；2026-09-15 03:56 CST 更新发布对象至分支 HEAD 与 6 笔队列（原「首次适用对象 85ec3be」表述废止，reset 到中途节点=部署旧代码）。

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

1. 宿主：生产检出同步到发布对象 dc2032b（或按发布策略合并后检出分支 HEAD）。
   注意：队列 6 笔均 pushed=false（推送通道缺失即本工单主题），生产检出 `git fetch` 远端**拿不到这些提交**；
   宿主可改从工程工作区本地路径取提交（示例，以宿主实际发布策略为准）：
   `git fetch /state/work/workspaces/qd-engineer/engineering/repo codex/ops-world-improvements && git checkout -B codex/ops-world-improvements FETCH_HEAD`。
   回执：`git rev-parse HEAD`（应=dc2032b…）+ `git status --porcelain`（应为空）。
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
   - 队列后续各笔（108f82e 内容状态同步自愈、da70e4e 纪元追踪、c70fa29f 健康事件追踪、65e567b survivor 控制器证据、dc2032b world_content_reachability 工具）：生效核验点以各对应工单事件流为准；每笔均有 passed 隔离测试回执，commit→testJobId 映射可查工程 progress recentCommits（receipts 亲读来源，非推断）。
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

### B1 实现候选已就绪（2026-09-14 工作树，未启用未部署）

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
