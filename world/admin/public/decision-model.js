// Pure projection of the bounded, redacted /api/survivor-trace response.
// This module never fetches private model messages or invents unrecorded choices.
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const text = (value, limit = 500) => typeof value === 'string' ? value.slice(0, limit) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const time = value => number(value) ?? (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);
const probability = value => number(value) !== null && value >= 0 && value <= 1 ? value : null;
const sources = new Set(['llm', 'jev', 'decider', 'policy_unknown', 'unknown']);
const sourceOf = (value, fallback = 'unknown') => sources.has(value) ? value : fallback;
const sourceNames = {llm: 'LLM', jev: 'Jev', decider: 'Decider（历史）', policy_unknown: '策略模型（来源待确认）', unknown: '来源待确认'};
const statuses = {completed: '已完成', failed: '失败', rejected: '被拒绝', accepted: '已接受', pending: '待执行', in_flight: '执行中', unknown: '状态未知', observed_ended: '观察到结束', active: '进行中'};
const duration = value => number(value) !== null && value >= 0 ? value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s` : '耗时未记录';
const percent = value => probability(value) === null ? '概率未记录' : `${Math.round(value * 100)}%`;
const MAX_ACTIONS = 6;
const MAX_CANDIDATES = 6;

// A compact deterministic key; unlike a list index it survives refreshes and reordering.
function key(parts) {
  let hash = 2166136261;
  const input = JSON.stringify(parts);
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(36);
}

function sorted(items) {
  return items.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.id.localeCompare(b.id));
}

export function listDecisionRecords(trace) {
  const turns = array(trace?.turns).filter(object).map(record => {
    const source = sourceOf(record.decisionSource);
    const at = time(record.startedAt) ?? time(record.finishedAt) ?? time(record.summary?.at);
    return {id: `llm:${text(record.turnId, 100) || key([record.taskId, at])}`, kind: 'llm', source,
      label: `${sourceNames[source]} · ${text(record.summary?.goal || record.input?.mission, 100) || text(record.turnId, 80) || '决策轮次'}`, at, record};
  });
  const policies = array(trace?.policyDecisions).filter(object).map(record => {
    const source = sourceOf(record.source, 'policy_unknown');
    const at = time(record.at) ?? time(record.observedAt);
    // Exclude changing receipt/outcome fields so the selection stays stable as receipts arrive.
    const identity = [source, record.model, at, record.observedAt, record.skill, record.version, record.practiceRunId, record.choice];
    return {id: `policy:${key(identity)}`, kind: 'policy', source,
      label: `${sourceNames[source]} · ${text(record.skill, 60) || '策略选择'} · ${text(record.choice, 60) || '选择未记录'}`, at, record};
  });
  const unique = items => [...new Map(items.map(item => [item.id, item])).values()];
  return sorted([...sorted(unique(turns)).slice(0, 20), ...sorted(unique(policies)).slice(0, 12)]);
}

function graphFor(item) {
  return {id: item.id, kind: item.kind, source: item.source, title: '', subtitle: '', at: item.at,
    nodes: [], edges: [], steps: [], notice: '', empty: false};
}

function addNode(graph, id, kind, title, subtitle, detail, status, extra = {}) {
  const node = {id, kind, title, subtitle, detail, status, source: graph.source, ...extra};
  graph.nodes.push(node);
  return node;
}

function addEdge(graph, from, to, evidence = 'recorded', options = {}) {
  graph.edges.push({id: `${from}:${to}`, from, to, evidence, ...options});
}

function orderedActions(actions) {
  return array(actions).filter(object).map((record, index) => ({record, index}))
    .sort((a, b) => (time(a.record.startedAt) ?? Infinity) - (time(b.record.startedAt) ?? Infinity) || a.index - b.index)
    .map(item => item.record);
}

function actionStatus(action) {
  // A completed label without completion confirmation must not become verified success.
  if (action.status === 'completed' && action.completionConfirmed !== true) return 'unknown';
  return Object.hasOwn(statuses, action.status) ? action.status : 'unknown';
}

function appendActions(graph, actions, previous, firstLabel) {
  actions.forEach((action, index) => {
    const status = actionStatus(action), id = `action-${index}`;
    const confirmedDuration = action.completionConfirmed === true || action.status === 'rejected' ? action.durationMs : null;
    addNode(graph, id, 'action', text(action.tool, 80) || '工具调用', `${statuses[status]} · ${duration(confirmedDuration)}`,
      `动作 ${text(action.actionId, 100) || '标识未记录'}；${action.completionConfirmed === true ? '回执已确认终态' : '未确认执行完成'}。`, status,
      {record: action, source: sourceOf(action.decisionSource, graph.source)});
    addEdge(graph, previous, id, 'recorded', index === 0 && firstLabel ? {label: firstLabel} : {});
    graph.steps.push(id);
    previous = id;
  });
  return previous;
}

function feedback(graph, actions, previous, turn = null) {
  const completed = actions.filter(action => actionStatus(action) === 'completed').length;
  const failed = actions.filter(action => ['failed', 'rejected'].includes(actionStatus(action))).length;
  const pending = actions.length - completed - failed;
  const terminal = turn && time(turn.finishedAt) !== null;
  const recorded = actions.length > 0 || terminal;
  const status = failed ? 'failed' : pending ? 'pending' : completed ? 'completed' : terminal && Object.hasOwn(statuses, turn.status) ? turn.status : 'unknown';
  const title = actions.length ? '执行回执' : terminal ? '任务结果' : '等待动作回执';
  const subtitle = actions.length ? `${completed} 已完成 · ${failed} 失败 / 拒绝 · ${pending} 待确认` : terminal ? statuses[turn.status] || '结果未知' : '尚无关联记录';
  addNode(graph, 'feedback', 'feedback', title, subtitle,
    actions.length ? '只汇总本图展示的真实回执；已接受或已派发不等于执行成功。' : terminal ? '这是模型任务的结束状态，不证明游戏动作成功。' : '等待回执，不推断执行结果。', status,
    {record: actions.length ? {actions} : turn || undefined});
  addEdge(graph, previous, 'feedback', recorded ? 'recorded' : 'mechanism', recorded ? {} : {label: '等待回执', tone: 'muted'});
  if (recorded) graph.steps.push('feedback');
  return {recorded, previous: 'feedback'};
}

function llmGraph(item) {
  const graph = graphFor(item), turn = item.record;
  graph.title = `${sourceNames[item.source]} 决策链`;
  graph.subtitle = `${text(turn.turnId, 100) || '决策轮次'} · ${statuses[turn.status] || '状态未知'} · ${duration(turn.durationMs)}`;
  const input = object(turn.input), observed = Boolean(input?.body || text(input?.mission) || number(input?.bytes) !== null || number(input?.eventCount) !== null);
  addNode(graph, 'observation', 'observation', '观察与输入', observed ? '已保存输入记录' : '输入快照未保留',
    observed ? text(input.mission, 1600) || '本轮保存了身体或上下文元数据。' : '历史记录未保留完整输入，不能还原完整提示词。', observed ? 'recorded' : 'unknown', {record: input || undefined});
  addNode(graph, 'llm', 'llm', item.source === 'llm' ? 'LLM 规划' : '决策任务', text(turn.summary?.goal || input?.mission, 180) || '目标摘要未记录',
    '展示已保存的目标与工具记录；未记录的备选方案、内部推理不补画。', turn.status || 'unknown', {record: turn});
  addEdge(graph, 'observation', 'llm', observed ? 'recorded' : 'mechanism', observed ? {} : {label: '输入内容未保留', tone: 'muted'});
  if (observed) graph.steps.push('observation');
  graph.steps.push('llm');
  const allActions = orderedActions(turn.actions), actions = allActions.slice(-MAX_ACTIONS);
  const last = appendActions(graph, actions, 'llm', allActions.length > MAX_ACTIONS ? `最近 ${MAX_ACTIONS} 条已记录动作` : undefined);
  const result = feedback(graph, actions, last, turn);
  let loopFrom = result.previous;
  const summary = object(turn.summary);
  if (summary && [summary.goal, summary.lesson, summary.nextFocus].some(value => text(value))) {
    addNode(graph, 'reflection', 'reflection', summary.lesson ? '复盘与记忆' : '已保存摘要',
      text(summary.lesson || summary.nextFocus || summary.goal, 180),
      [text(summary.lesson, 2400), summary.nextFocus ? `下一步：${text(summary.nextFocus, 1200)}` : ''].filter(Boolean).join('\n') || text(summary.goal, 1600),
      'recorded', {record: summary});
    addEdge(graph, result.recorded ? 'feedback' : last, 'reflection');
    graph.steps.push('reflection');
    loopFrom = 'reflection';
  }
  addEdge(graph, loopFrom, 'observation', 'mechanism', {label: '下一轮观察 · 循环机制', tone: 'muted'});
  graph.notice = `实线对应已保存记录，虚线表示循环机制。LLM 未选方案未记录。${allActions.length > MAX_ACTIONS ? `本图采样最近 ${MAX_ACTIONS} / ${allActions.length} 条动作。` : '工具记录可能不完整。'}`;
  return graph;
}

function policyGraph(item) {
  const graph = graphFor(item), policy = item.record;
  graph.title = `${sourceNames[item.source]} 候选分支`;
  graph.subtitle = `${text(policy.model, 100) || '模型未记录'} · ${text(policy.skill, 100) || '技能未记录'} · ${duration(policy.latencyMs)}`;
  const observed = time(policy.observedAt) !== null;
  addNode(graph, 'observation', 'observation', '状态观察', observed ? '选择绑定已记录的观察时刻' : '观察时刻未记录',
    '策略选择使用状态快照；此页面只接收已脱敏的摘要，不展示原始提示词。', observed ? 'recorded' : 'unknown', {record: {observedAt: time(policy.observedAt)}});
  addNode(graph, 'policy', 'policy', sourceNames[item.source], text(policy.skill, 100) || '策略选择',
    `模型：${text(policy.model, 100) || '未知'}；请求 ${duration(policy.latencyMs)}；控制器接收 ${duration(policy.handoffMs)}。`, 'recorded', {record: policy});
  addEdge(graph, 'observation', 'policy', observed ? 'recorded' : 'mechanism', observed ? {} : {tone: 'muted'});
  if (observed) graph.steps.push('observation');
  graph.steps.push('policy');
  const allCandidates = array(policy.candidates).filter(object);
  const selectedIndex = allCandidates.findIndex(candidate => typeof policy.choice === 'string' && candidate.id === policy.choice);
  const candidates = allCandidates.slice(0, MAX_CANDIDATES);
  if (selectedIndex >= MAX_CANDIDATES) candidates[MAX_CANDIDATES - 1] = allCandidates[selectedIndex];
  let selectedId = null;
  candidates.forEach((candidate, index) => {
    const selected = candidate === allCandidates[selectedIndex], id = `candidate-${index}`;
    const chance = probability(candidate.probability);
    addNode(graph, id, 'candidate', text(candidate.description, 100) || text(candidate.id, 80) || '未命名候选', percent(chance),
      `${selected ? '模型选中此候选' : '候选存在，未选择'}。${candidate.action ? `候选工具：${text(candidate.action.tool, 80) || '未记录'}，候选不代表执行。` : candidate.action === null ? '此候选交回慢系统。' : '候选动作未记录。'}`,
      selected ? 'selected' : 'unselected', {record: candidate, probability: chance, selected});
    addEdge(graph, 'policy', id, 'recorded', {label: percent(chance), disabled: !selected, tone: selected ? item.source : 'muted'});
    if (selected) {selectedId = id; graph.steps.push(id);}
  });
  const fallback = policy.outcome === 'fallback';
  const dispatched = !fallback && policy.outcome === 'dispatch_recorded' && policy.association === 'exact_policy_binding' && Boolean(text(policy.dispatchTurnId, 100));
  const reasonLabels = {low_confidence: '置信度不足', selected_handoff: '选择交回慢系统', policy_escalated: '策略回退', policy_unavailable: '策略不可用', policy_observation_stale: '观察已过期'};
  const reason = reasonLabels[policy.reason] || text(policy.reason || policy.code, 180) || (dispatched ? '派发记录已精确关联' : '尚未关联派发记录');
  addNode(graph, 'gate', 'gate', '置信度检查', probability(policy.confidence) === null ? '置信度未记录' : `置信度 ${percent(policy.confidence)}`,
    `${reason}。置信度和候选概率是不同指标。`, fallback ? 'blocked' : dispatched ? 'passed' : 'unknown',
    {record: {confidence: probability(policy.confidence), selectedProbability: probability(policy.selectedProbability), reason: policy.reason, code: policy.code}});
  addEdge(graph, selectedId || 'policy', 'gate', fallback || dispatched ? 'recorded' : 'mechanism', selectedId ? {} : {label: '候选选择未保留'});
  if (fallback || dispatched) graph.steps.push('gate');
  let loopFrom = 'gate';
  if (fallback) {
    addNode(graph, 'fallback', 'fallback', '交回慢系统', reason,
      '本次未派发候选动作；后续 LLM 轮次未绑定，不连到具体 LLM 任务。', 'fallback',
      {record: {reason: policy.reason, code: policy.code, llmFollowupTurnId: null}});
    addEdge(graph, 'gate', 'fallback', 'recorded', {label: '停止此候选动作', tone: 'warning'});
    graph.steps.push('fallback');
    loopFrom = 'fallback';
  } else if (dispatched) {
    const allActions = orderedActions(policy.actions).filter(action => action.turnId === policy.dispatchTurnId);
    const actions = allActions.slice(-MAX_ACTIONS);
    let last = 'gate';
    if (actions.length) last = appendActions(graph, actions, last, '精确关联的动作回执');
    else {
      addNode(graph, 'action-0', 'action', '工具派发', '派发已记录 · 等待回执',
        '仅确认派发事件存在，不能判定动作已执行或成功。', 'dispatched', {record: {turnId: policy.dispatchTurnId, at: time(policy.dispatchAt)}});
      addEdge(graph, 'gate', 'action-0', 'recorded', {label: '派发事件'});
      graph.steps.push('action-0');
      last = 'action-0';
    }
    loopFrom = feedback(graph, actions, last).previous;
    if (allActions.length > MAX_ACTIONS) graph.notice += `本图采样最近 ${MAX_ACTIONS} / ${allActions.length} 条动作。`;
  }
  addEdge(graph, loopFrom, 'observation', 'mechanism', {label: '重新观察 · 循环机制', tone: 'muted'});
  graph.notice += '实线展示记录，灰色候选未选择；虚线表示循环机制，不代表循环已经执行。';
  if (allCandidates.length > MAX_CANDIDATES) graph.notice += `展示 ${MAX_CANDIDATES} / ${allCandidates.length} 个候选，保留已选分支。`;
  if (selectedIndex < 0) graph.notice += '未保留匹配的已选候选。';
  if (fallback) graph.notice += '回退后的具体 LLM 轮次未关联。';
  else if (!dispatched) graph.notice += '仅有选择记录，不能认定已派发或执行。';
  return graph;
}

export function buildDecisionGraph(trace, recordId) {
  const records = listDecisionRecords(trace);
  // Missing requested IDs do not silently switch to a different historical decision.
  const selected = recordId ? records.find(record => record.id === recordId) : records[0];
  if (!selected) return {id: recordId || null, kind: null, source: 'unknown', title: recordId ? '此记录已不在保留范围内' : '等待决策记录',
    subtitle: '', at: null, nodes: [], edges: [], steps: [], notice: recordId ? '请重新选择已保留的记录；不会自动替换成另一条决策。' : '目前没有可展示的决策记录。', empty: true};
  return selected.kind === 'policy' ? policyGraph(selected) : llmGraph(selected);
}

export function buildEvolutionGraph(rsi) {
  const graph = {id: 'rsi', kind: 'rsi', source: 'rsi', title: 'RSI 自我进化机制',
    subtitle: 'L1 具身反馈 → L2 技能沉淀 → L3 工程演化', at: time(rsi?.generatedAt),
    nodes: [], edges: [], steps: [], empty: false, notice: ''};
  const count = value => number(value) !== null && value >= 0 ? value : null;
  const countLabel = value => count(value) === null ? '未知' : String(value);
  const sources = object(rsi?.sources) || {};
  const l1 = object(rsi?.l1) || {}, l2 = object(rsi?.l2) || {}, l3 = object(rsi?.l3) || {};
  const behaviors = array(l1.behaviors).filter(object).slice(0, 30);
  const sampled = behaviors.filter(behavior => count(behavior.sampled) !== null);
  addNode(graph, 'life', 'observation', '具身行动', sampled.length ? `${sampled.length} 类行为有样本记录` : '行动统计未知',
    sampled.length ? behaviors.map(behavior => `${text(behavior.category, 80) || '未分类'}：样本 ${countLabel(behavior.sampled)}；成功 ${countLabel(behavior.succeeded)}`).join('\n')
      : '没有可核实的行动统计，不以零次代替未知。', sampled.length ? 'recorded' : 'unknown', {layer: 'l1', record: {behaviors}});

  const generation = object(l1.generation) || {};
  const memoryEpoch = text(generation.memoryEpoch, 100);
  addNode(graph, 'experience', 'reflection', '经验与复盘', memoryEpoch ? `记忆代际 ${memoryEpoch}` : '记忆代际未知',
    '代际标识描述当前记忆批次；不代表已积累多少经验，也不证明能力提升。', memoryEpoch ? 'recorded' : 'unknown', {layer: 'l1', record: generation});

  const knowledge = array(l2.knowledge).filter(object).slice(0, 12);
  addNode(graph, 'knowledge', 'knowledge', '知识沉淀', sources.knowledge === true ? `${knowledge.length} 份${l2.knowledgePartial === true ? '近期' : ''}文件索引` : '知识索引未知',
    '只展示知识文件索引；文件数不等于有效知识量或知识质量。', sources.knowledge === true ? 'recorded' : 'unknown', {layer: 'l2', record: {knowledge, partial: l2.knowledgePartial === true}});

  const localSkills = array(l2.localSkills).filter(object).slice(0, 40);
  const sharedSkills = array(l2.sharedSkills).filter(object).slice(0, 60);
  const drafts = array(l2.drafts).filter(value => typeof value === 'string').slice(0, 40);
  const enabled = localSkills.filter(skill => skill.enabled === true).length;
  const verified = localSkills.filter(skill => skill.behaviorVerified === true).length;
  const independent = array(l2.feedback).filter(item => object(item) && item.independentlyVerified === true);
  addNode(graph, 'skill', 'skill', '技能沉淀', sources.learning === true ? `${enabled} / ${localSkills.length} 本地技能启用 · ${drafts.length} 草稿` : '本地技能状态未知',
    `共享技能索引：${sources.shared === true ? sharedSkills.length : '未知'}。草稿、已启用与已验证分别统计，不能互相替代。`, sources.learning === true ? 'recorded' : 'unknown',
    {layer: 'l2', record: {localSkills, sharedSkills, drafts}});
  addNode(graph, 'test', 'test', '技能验证', sources.learning === true ? `${verified} 项带行为验证标记` : '技能验证未知',
    sources.learning === true ? `保留反馈中 ${independent.length} 条标记为独立核实；这些标记只证明对应记录范围，不证明跨任务能力增益。` : '没有技能验证数据；不从启用状态推断已通过行为测试。',
    sources.learning === true ? 'recorded' : 'unknown', {layer: 'l2', record: {verified, independentlyVerifiedFeedback: independent}});

  const cases = object(l3.cases) || {}, counts = object(cases.counts);
  const caseItems = array(cases.items).filter(object).slice(0, 24);
  const caseCounts = counts ? Object.entries(counts).filter(([, value]) => count(value) !== null) : [];
  const caseTotal = caseCounts.length ? caseCounts.reduce((sum, [, value]) => sum + value, 0) : counts ? 0 : null;
  addNode(graph, 'issue', 'issue', '改进提案', cases.available === true ? caseTotal !== null ? `${caseTotal} 条改进工单` : `保留 ${caseItems.length} 条工单` : '工单来源未知',
    '工单状态描述处理进度；resolved 或 closed 不等于改进收益已经验收。', cases.available === true ? 'recorded' : 'unknown',
    {layer: 'l3', record: {counts, items: caseItems}});
  addNode(graph, 'engineering', 'engineering', '工程候选', l3.enabled === true ? '工程自动化已启用' : l3.enabled === false ? '工程自动化已关闭' : '工程配置未知',
    `基线提交：${text(l3.baseCommit, 100) || '未知'}。候选、测试、发布与收益验收是不同状态。`, sources.engineering === true ? 'recorded' : 'unknown',
    {layer: 'l3', record: {enabled: typeof l3.enabled === 'boolean' ? l3.enabled : null, baseCommit: text(l3.baseCommit, 100) || null, branch: text(l3.branch, 100) || null, plans: array(l3.plans).slice(0, 30)}});

  const receipts = array(l3.receipts).filter(object).slice(0, 18);
  const successfulReceipts = receipts.filter(receipt => receipt.ok === true).length;
  const failedReceipts = receipts.filter(receipt => receipt.ok === false).length;
  const unknownReceipts = receipts.length - successfulReceipts - failedReceipts;
  addNode(graph, 'validation', 'validation', '验证与收益', sources.receipts === true ? `${successfulReceipts} / ${receipts.length} 回执 ok · 收益未知` : '回执与收益验收未知',
    `${sources.receipts === true ? `${successfulReceipts} 条明确 ok，${failedReceipts} 条明确失败，${unknownReceipts} 条结果未知。` : '工程回执来源不可用。'}测试或工程回执 ok 不等于自主能力提升。当前数据没有完整的跨任务对照、代际收益与回退验收，提升程度保持未知。`, 'unknown',
    {layer: 'l3', record: {receipts, verifiedImprovement: null}});

  for (const [from, to, label] of [
    ['life', 'experience', '行动形成反馈'], ['experience', 'knowledge', '复盘沉淀'],
    ['knowledge', 'skill', '提炼候选技能'], ['skill', 'test', '行为验证'],
    ['test', 'life', '经验证后复用'], ['experience', 'issue', '提出改进'],
    ['issue', 'engineering', '形成工程候选'], ['engineering', 'validation', '测试与验收'],
    ['validation', 'life', '验收后再进入新循环'],
  ]) addEdge(graph, from, to, 'mechanism', {label, tone: 'muted'});
  graph.notice = '全部连线均为机制示意，不代表这些记录之间已建立因果链；机制动画不计作真实运行。文件数、技能启用数和已关闭工单都不能证明 RSI 提升，增益仍待独立验收。';
  return graph;
}
