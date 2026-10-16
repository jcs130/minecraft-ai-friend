# agent-mc/v1

默认公开入口 `agent-mc-world` / `agent-mc-world/client`。协议类型在 `agent-mc-world/contracts`；MCP 工具为 `mc_protocol`，参数必须包含 `protocol: "agent-mc/v1"`。

## 调用与回合

1. 显式 connect。工具发现不连接服务器。
2. 宿主开始一次实际决策时调用 `beginTurn(id)` / `mc_protocol {action:"begin_turn",id}`。
3. SDK 调用 `call(name,args,{requestId,turnId,signal})`；MCP 在 `_meta["agent-mc/v1"]` 传 `requestId` 和 `turnId`。请求 id 应跨重试保持一致。
4. 返回 `control`：protocol、requestId、turnId、barrierAfter、endTurnRequested、turnEnded。最后一项始终为 false。
5. 遇到 barrierAfter，宿主读完本次回执后显式 acknowledgeBarrier(requestId) / ack_barrier；遇到 endTurnRequested，宿主完成回执处理后显式 endTurn(turnId) / end_turn。
6. 只有显式 endTurn 才调用引擎回合结束接口。并发调用未结束时不能结束回合；RPC 返回不会替宿主结束一次推理。为兼容简单客户端，无显式回合的调用可以执行，但永远不推测决策边界。

MCP ListTools 的 `_meta["agent-mc/v1"]` 公开 tags、barrierAfter、endsTurn、interruptible。CallTool 的 structuredContent 保留 execution、events、control、endsTurn、failed 与制品引用；content 同时保留可读文本和真实图片。

脚本宿主可在 SDK 构造选项启用 `autoAcknowledgeBarriers:true`，仅在当前调用结算后自动确认。默认保持显式确认。`mc_stop` 和 `disconnect()` 可越过屏障用于停止。SDK 的确认入口为 `acknowledgeBarrier(requestId)`，不在游戏 `tools()` 中；MCP `tools/list` 包含 `mc_protocol`，以 `action:"ack_barrier", id:requestId` 确认。详见 [客户端兼容修订](client-fixes-20261013.md)。

## 受理、终态和取消

execution 包含 kind、跨引擎生命周期唯一的 id、phase、terminal、goalCompleted、evidence。phase 可为 accepted、running、suspended、validated、completed、partial、blocked、cancelled、superseded、rejected。accepted/running/suspended 不终结；validated 只表示校验结束。goalCompleted 恒为 false，宿主自行作出目标判断。

原生数字编号保存在回执文本或 evidence.localId，用于已有 mc_script/runId、队列查询。`mc_protocol {action:"task",kind,id}` / SDK task(kind,id) 查询本次 runtime 已收到的执行状态；历史运行通过 archive 查询，不能把旧终态冒充当前实体状态。

SDK AbortSignal、MCP 请求取消以及 cancel(requestId) 撤销仍在等待的 RPC；事件等待也接受取消信号。已返回的任务受理请求不再是 pending RPC，停止该任务使用既有队列停止或 mc_script {stop:true}。disconnect 停止整个游戏执行环境，并撤销等待、定时器和身体任务。旧连接迟到的事件保留原文且标为 archive-only/staleEpoch，不更新当前任务状态。

去重按请求 id 和参数签名执行：同 id 返回原结果，不同参数拒绝；磁盘账本中仍是 pending 的请求被视为结果未知，必须检查归档证据。重启不能把结果未知的动作自动重发。

## 事件、当前事实与原文

events() / mc_events 返回 protocol、run、cursor、gap 和分页信息。EventEnvelope 保留 source、origin、原文、trigger、contextDelivery、execution、blobs。trigger 的 preempt/interrupt/flush/debounce/piggyback 是交给宿主的调度提示，不在核心启动模型循环。archive-only 不自动投入当前上下文。

currentFacts() / facts 返回按 key 唯一的 parts，每项带 text、revision、original。每次采样替换同 key 的旧事实，消失的 key 同时删除。original 是可查询的内容寻址制品句柄，不能只留下截断摘要。

prepareContext() / prepare_context 返回稳定 prefix 和动态 tail。宿主将 tail 放在历史与工具信息之后、请求末尾，按 key 替换前次尾部；不要把时钟、库存或目标状态插入稳定前缀。预算同时计算 prefix、history、完整工具描述与 schema、facts 和 reservedOutputTokens。超预算省略整个事实项并返回 omittedKeys，原文仍可查。基础部分已超限时明确报错。

SDK 可提供宿主 tokenizer；默认采用保守 UTF-8 字节计数，不声称是任何特定模型的精确 tokenizer。MCP 预算包含本 MCP 服务全部工具描述。宿主需为自身角色包装、其他工具和系统消息继续预留预算。

archive_runs / journal.archiveRuns() 列出保留的运行。archive / journal.archive(query) 按 run、cursor、type、keyword 分页读原始事件，包含最近缓存已淘汰及 archive-only 的数据。mc_artifact/get 和制品 resource 读取完整内容。

## 宿主目标修订

mc_goal {revise:{slot,expectedRevision,text,plan,reason}} 只在宿主明确调用时替换当前工作计划，目标身份不变；返回带前后原文、版本和原因的 goal-revision，并投递同内容的事件。旧版本修订被拒绝，新计划的证据清空后重新核验。原计划证据在归档回执中保留。跨场次目标与长期记忆仍由宿主保存和恢复。

只修改 plan 时也必须提供要保留的 text。缺少或超长的 text/reason 会按字段说明错误，原目标和版本保留。

verify 检查当前条件，最近已通过的机械步骤会继续现读；库存减少或离开区域可能使登记条件进度退回，这不能否定此前采集、消耗、交付或抵达已经发生。需要记录历史动作与净变化时，在计划中用 judgment 指明证据来源，再以 milestone 登记原回执与时间。核心保留宿主判断，不将它冒充独立验证；新证据否定前提时由宿主 reopen/revise。条件选择错误不能靠重做旧阶段来掩盖。
# Client-visible action readback

Terminal task step evidence may include `observedEffect` (`agent-mc-observed-effect/v1`): bounded before/after client position, target block state, synchronized inventory and window state, plus independent change flags. Missing reads stay null/unknown. Read-only sampling, chat, look and waiting do not produce physical effect readbacks.

`unchanged` describes only the listed client-visible domains; it cannot exclude hidden server effects or determine task/goal success. Execution status remains independent and `goalVerified` is always false. A host can use repeated unchanged evidence to ask its Agent to inspect the real skill contract, choose another method or declare a not-already-satisfied native `expect` postcondition. This adds no model loop or automatic action to the core. Complete evidence is retained in task archives and travels through the public SDK/MCP execution receipt.
