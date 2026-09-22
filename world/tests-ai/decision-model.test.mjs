import test from 'node:test';
import assert from 'node:assert/strict';
import {listDecisionRecords, buildDecisionGraph, buildEvolutionGraph} from '../admin/public/decision-model.js';

const turn = {
  turnId: 'turn-1', decisionSource: 'llm', taskId: 'task-1', status: 'completed', startedAt: 1000, finishedAt: 5000, durationMs: 4000,
  input: {body: {hp: 20, hunger: 5}, mission: '寻找食物', bytes: 2400},
  summary: {goal: '寻找食物', lesson: '苹果恢复了饥饿值', nextFocus: '补充木材', at: 5000},
  actions: [{actionId: 'action-1', turnId: 'turn-1', tool: 'eat', decisionSource: 'llm', status: 'completed', completionConfirmed: true, startedAt: 2000, observedAt: 2300, durationMs: 300}],
};
const policy = {
  source: 'jev', model: 'jev-1.13.0', at: 6000, observedAt: 5500, skill: 'prepare_for_task', version: 'v1', practiceRunId: 'practice-1',
  choice: 'craft', confidence: 0.13, selectedProbability: 0.57, latencyMs: 613.38, handoffMs: 1643.93,
  candidates: [
    {id: 'craft', description: '合成木板', probability: 0.57, selected: true, action: {tool: 'craft', args: {item_id: 'minecraft:oak_planks'}}},
    {id: 'handoff', description: '交回慢系统', probability: 0.43, selected: false, action: null},
  ],
  outcome: 'fallback', reason: 'low_confidence', association: 'no_dispatch_link', dispatchTurnId: null, llmFollowupTurnId: null, actions: [],
};
const buildPolicy = record => buildDecisionGraph({policyDecisions: [record]});
const node = (graph, id) => graph.nodes.find(item => item.id === id);

test('Jev fallback replays the selected branch and gate without pretending to execute or binding an LLM', () => {
  const graph = buildDecisionGraph({turns: [turn], policyDecisions: [{...policy, actions: turn.actions, llmFollowupTurnId: 'turn-1'}]});
  assert.equal(graph.source, 'jev');
  assert.deepEqual(graph.steps, ['observation', 'policy', 'candidate-0', 'gate', 'fallback']);
  assert.equal(node(graph, 'candidate-0').probability, 0.57);
  assert.equal(node(graph, 'gate').record.confidence, 0.13);
  assert.match(node(graph, 'fallback').subtitle, /置信度不足/);
  assert.match(node(graph, 'fallback').detail, /后续 LLM 轮次未绑定/);
  assert.equal(node(graph, 'fallback').record.llmFollowupTurnId, null);
  assert.equal(graph.nodes.some(item => ['action', 'llm'].includes(item.kind)), false);
  assert.equal(graph.edges.find(item => item.to === 'candidate-1').disabled, true);
  assert.equal(graph.edges.find(item => item.from === 'fallback').evidence, 'mechanism');
});

test('stable policy IDs survive new history, reversed order and late arriving action receipts', () => {
  const first = listDecisionRecords({turns: [turn], policyDecisions: [policy]});
  const selectedId = first.find(item => item.kind === 'policy').id;
  const changed = {...policy, outcome: 'dispatch_recorded', actions: turn.actions, association: 'exact_policy_binding', dispatchTurnId: 'skill-1'};
  const next = {turns: [{...turn, turnId: 'new-turn', startedAt: 9000}, turn], policyDecisions: [{...policy, at: 8500, observedAt: 8200}, changed]};
  assert.equal(listDecisionRecords(next).find(item => item.record === changed).id, selectedId);
  assert.equal(buildDecisionGraph(next, selectedId).at, 6000);
  assert.equal(buildDecisionGraph(next, selectedId).record, undefined);
  assert.equal(listDecisionRecords({policyDecisions: [policy, policy]}).length, 1);
});

test('list caps each source category after newest-first ordering and preserves explicit provenance', () => {
  const trace = {turns: Array.from({length: 30}, (_, i) => ({...turn, turnId: `t-${i}`, startedAt: i})),
    policyDecisions: Array.from({length: 20}, (_, i) => ({...policy, at: i + 40, observedAt: i + 39}))};
  const rows = listDecisionRecords(trace);
  assert.equal(rows.filter(item => item.kind === 'llm').length, 20);
  assert.equal(rows.filter(item => item.kind === 'policy').length, 12);
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].at >= row.at));
  assert.match(buildPolicy({...policy, source: 'decider', model: 'decider-dev'}).title, /Decider（历史）/);
  assert.equal(buildPolicy({...policy, source: undefined}).source, 'policy_unknown');
  const unknown = buildDecisionGraph({turns: [{...turn, decisionSource: null}]});
  assert.equal(unknown.source, 'unknown');
  assert.equal(node(unknown, 'action-0').source, 'llm');
  assert.match(unknown.title, /来源待确认/);
});

test('unknown durations and probabilities remain unknown rather than becoming zero or inferred elapsed time', () => {
  const graph = buildPolicy({...policy, latencyMs: null, handoffMs: undefined, confidence: NaN,
    candidates: [{...policy.candidates[0], probability: null}]});
  assert.match(graph.subtitle, /耗时未记录/);
  assert.match(node(graph, 'policy').detail, /请求 耗时未记录；控制器接收 耗时未记录/);
  assert.equal(node(graph, 'candidate-0').probability, null);
  assert.equal(node(graph, 'candidate-0').subtitle, '概率未记录');
  assert.equal(node(graph, 'gate').subtitle, '置信度未记录');
  const turnGraph = buildDecisionGraph({turns: [{...turn, durationMs: null, actions: [{...turn.actions[0], status: 'accepted', completionConfirmed: false, durationMs: 9000}]}]});
  assert.match(node(turnGraph, 'action-0').subtitle, /已接受 · 耗时未记录/);
  assert.equal(node(turnGraph, 'feedback').status, 'pending');
});

test('exact dispatch alone is a dispatch event and does not become successful execution', () => {
  const graph = buildPolicy({...policy, outcome: 'dispatch_recorded', reason: null, confidence: 0.92, association: 'exact_policy_binding', dispatchTurnId: 'skill-1'});
  assert.equal(node(graph, 'action-0').status, 'dispatched');
  assert.match(node(graph, 'action-0').subtitle, /等待回执/);
  assert.equal(node(graph, 'feedback').status, 'unknown');
  assert.ok(graph.steps.includes('action-0'));
  assert.ok(!graph.steps.includes('feedback'));
  assert.equal(graph.edges.find(item => item.to === 'feedback').evidence, 'mechanism');
  assert.ok(!graph.nodes.some(item => item.status === 'completed'));
});

test('only receipt identity linked to the exact dispatch contributes to actions and feedback', () => {
  const matching = {...turn.actions[0], turnId: 'skill-1', decisionSource: 'jev'};
  const graph = buildPolicy({...policy, outcome: 'dispatch_recorded', reason: null, association: 'exact_policy_binding', dispatchTurnId: 'skill-1', actions: [turn.actions[0], matching]});
  assert.equal(graph.nodes.filter(item => item.kind === 'action').length, 1);
  assert.equal(node(graph, 'action-0').record, matching);
  assert.equal(node(graph, 'action-0').source, 'jev');
  assert.equal(node(graph, 'feedback').status, 'completed');
  assert.ok(graph.steps.includes('feedback'));
  const ambiguous = buildPolicy({...policy, outcome: 'dispatch_recorded', association: 'ambiguous', dispatchTurnId: 'skill-1', actions: [matching]});
  assert.equal(ambiguous.nodes.some(item => item.kind === 'action'), false);
  assert.match(ambiguous.notice, /不能认定已派发或执行/);
});

test('LLM chain preserves recorded order and draws the feedback loop only as a mechanism', () => {
  const graph = buildDecisionGraph({turns: [turn]});
  assert.deepEqual(graph.steps, ['observation', 'llm', 'action-0', 'feedback', 'reflection']);
  assert.equal(graph.nodes.some(item => item.kind === 'candidate'), false);
  assert.equal(node(graph, 'action-0').record.tool, 'eat');
  assert.equal(graph.edges.find(item => item.from === 'reflection' && item.to === 'observation').evidence, 'mechanism');
  assert.equal(new Set(graph.steps).size, graph.steps.length);
  assert.match(graph.notice, /LLM 未选方案未记录/);
});

test('missing historical LLM input and pending feedback are visible placeholders outside the replay', () => {
  const graph = buildDecisionGraph({turns: [{...turn, input: {}, actions: [], summary: null, status: 'active', finishedAt: null, durationMs: null}]});
  assert.deepEqual(graph.steps, ['llm']);
  assert.equal(node(graph, 'observation').status, 'unknown');
  assert.equal(node(graph, 'feedback').status, 'unknown');
  assert.equal(graph.edges.find(item => item.from === 'observation').evidence, 'mechanism');
});

test('action sampling is bounded, chronological and explicitly disclosed without inferring completion', () => {
  const graph = buildDecisionGraph({turns: [{...turn, actions: Array.from({length: 10}, (_, i) => ({...turn.actions[0], actionId: `a-${9 - i}`, startedAt: 1000 + 9 - i, completionConfirmed: false}))}]});
  const actions = graph.nodes.filter(item => item.kind === 'action');
  assert.equal(actions.length, 6);
  assert.deepEqual(actions.map(item => item.record.actionId), ['a-4', 'a-5', 'a-6', 'a-7', 'a-8', 'a-9']);
  assert.ok(actions.every(item => item.status === 'unknown'));
  assert.equal(node(graph, 'feedback').status, 'pending');
  assert.match(graph.notice, /采样最近 6 \/ 10 条动作/);
});

test('candidate clipping retains selected outlier without normalizing or fabricating candidate probabilities', () => {
  const candidates = Array.from({length: 12}, (_, i) => ({id: `c-${i}`, description: `候选 ${i}`, probability: i === 11 ? 0.2 : 0.04, selected: i === 11, action: {tool: `tool-${i}`}}));
  const graph = buildPolicy({...policy, choice: 'c-11', candidates});
  const shown = graph.nodes.filter(item => item.kind === 'candidate');
  assert.equal(shown.length, 6);
  assert.equal(shown.find(item => item.selected).record.id, 'c-11');
  assert.equal(shown.find(item => item.selected).probability, 0.2);
  assert.ok(graph.steps.includes('candidate-5'));
  assert.ok(!graph.steps.includes('candidate-0'));
  assert.match(graph.notice, /展示 6 \/ 12 个候选/);
  const missing = buildPolicy({...policy, choice: 'missing', candidates});
  assert.equal(missing.nodes.some(item => item.selected), false);
  assert.ok(!missing.steps.some(id => id.startsWith('candidate-')));
  assert.match(missing.notice, /未保留匹配的已选候选/);
});

test('selection-only records never replay a gate pass or execute a candidate', () => {
  const graph = buildPolicy({...policy, outcome: 'selection_only', reason: null, confidence: 0.95, actions: turn.actions});
  assert.equal(node(graph, 'gate').status, 'unknown');
  assert.deepEqual(graph.steps, ['observation', 'policy', 'candidate-0']);
  assert.equal(graph.nodes.some(item => item.kind === 'action' || item.kind === 'fallback'), false);
  assert.match(graph.notice, /仅有选择记录/);
});

test('empty input and expired selection have explicit empty states rather than fabricated or silently switched records', () => {
  for (const trace of [undefined, null, {}, {turns: [null, false], policyDecisions: 'wrong'}]) {
    const graph = buildDecisionGraph(trace);
    assert.equal(graph.empty, true);
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.steps, []);
    assert.ok(graph.notice.length > 0);
  }
  const missing = buildDecisionGraph({turns: [turn]}, 'llm:expired');
  assert.equal(missing.empty, true);
  assert.equal(missing.id, 'llm:expired');
  assert.match(missing.notice, /不会自动替换/);
});

test('RSI projects layer evidence separately and never upgrades files, resolved cases or test receipts to capability gains', () => {
  const graph = buildEvolutionGraph({generatedAt: 1234,
    sources: {knowledge: true, learning: true, shared: true, engineering: true, receipts: true},
    l1: {generation: {memoryEpoch: 'epoch-2'}, behaviors: [{category: 'navigation', sampled: 8, succeeded: 5}, {category: 'gathering', sampled: 3, succeeded: null}]},
    l2: {knowledge: [{name: 'notes.md'}], knowledgePartial: true,
      localSkills: [{name: 'a', enabled: true, behaviorVerified: false}, {name: 'b', enabled: false, behaviorVerified: true}],
      sharedSkills: [{name: 'shared'}], drafts: ['draft'], feedback: [{outcome: 'success', independentlyVerified: false}]},
    l3: {enabled: false, baseCommit: 'commit-1', cases: {available: true, counts: {resolved: 7}, items: []},
      receipts: [{name: 'test.json', ok: true}], verifiedImprovement: true},
  });
  assert.equal(graph.id, 'rsi');
  assert.equal(graph.kind, 'rsi');
  assert.equal(graph.at, 1234);
  assert.equal(graph.nodes.length, 8);
  assert.deepEqual(new Set(graph.nodes.map(item => item.layer)), new Set(['l1', 'l2', 'l3']));
  assert.ok(graph.nodes.every(item => item.source === 'rsi'));
  assert.match(node(graph, 'life').detail, /gathering：样本 3；成功 未知/);
  assert.match(node(graph, 'knowledge').subtitle, /1 份近期文件索引/);
  assert.match(node(graph, 'skill').subtitle, /1 \/ 2 本地技能启用 · 1 草稿/);
  assert.match(node(graph, 'test').subtitle, /1 项带行为验证标记/);
  assert.match(node(graph, 'issue').subtitle, /7 条改进工单/);
  assert.match(node(graph, 'engineering').subtitle, /已关闭/);
  assert.equal(node(graph, 'engineering').record.baseCommit, 'commit-1');
  assert.equal(node(graph, 'validation').status, 'unknown');
  assert.equal(node(graph, 'validation').record.verifiedImprovement, null);
  assert.match(node(graph, 'validation').subtitle, /1 \/ 1 回执 ok · 收益未知/);
});

test('RSI has only mechanism edges, no recorded replay and no invented cause between independent data sources', () => {
  const graph = buildEvolutionGraph({available: true, l3: {cases: {available: true, items: [{id: 'resolved', status: 'resolved'}]}}});
  assert.deepEqual(graph.steps, []);
  assert.ok(graph.edges.length > 0);
  assert.ok(graph.edges.every(edge => edge.evidence === 'mechanism'));
  assert.ok(graph.edges.some(edge => edge.from === 'validation' && edge.to === 'life'));
  assert.ok(graph.edges.every(edge => graph.nodes.some(item => item.id === edge.from) && graph.nodes.some(item => item.id === edge.to)));
  assert.match(graph.notice, /不代表这些记录之间已建立因果链/);
  assert.match(node(graph, 'issue').subtitle, /保留 1 条工单/);
  assert.match(node(graph, 'validation').subtitle, /未知/);
});

test('missing RSI sources keep explicit unknown nodes instead of rendering fabricated zero statistics', () => {
  const graph = buildEvolutionGraph();
  assert.equal(graph.empty, false);
  assert.equal(graph.at, null);
  assert.ok(graph.nodes.length <= 9);
  assert.ok(graph.nodes.every(item => item.status === 'unknown'));
  assert.equal(node(graph, 'life').subtitle, '行动统计未知');
  assert.equal(node(graph, 'knowledge').subtitle, '知识索引未知');
  assert.equal(node(graph, 'skill').subtitle, '本地技能状态未知');
  assert.equal(node(graph, 'test').subtitle, '技能验证未知');
  assert.deepEqual(graph.steps, []);
});
