'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { resolveAgentObjective, DEFAULT_OBJECTIVE } = require('./agent-objective.cjs')
test('operator objective survives dynamic survival subgoals; configured objective overrides saved objective', () => {
  const objective = resolveAgentObjective({ configObjective: '自然生存→真实加工→建设殖民地', savedObjective: '旧目标' })
  let subgoal = '等天亮'; subgoal = '吃饭'
  assert.equal(objective, '自然生存→真实加工→建设殖民地'); assert.equal(subgoal, '吃饭')
  assert.equal(resolveAgentObjective({ savedObjective: objective }), objective)
  assert.equal(resolveAgentObjective(), DEFAULT_OBJECTIVE)
})
test('empty, nonstring and oversized immutable objective fail configuration instead of replacing the mission', () => {
  for (const configObjective of ['', ' ', {}, 'x'.repeat(2001)]) assert.throws(() => resolveAgentObjective({ configObjective }), /OBJECTIVE_INVALID/)
})
