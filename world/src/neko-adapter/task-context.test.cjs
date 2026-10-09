'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { attachTaskContext } = require('./task-context.cjs')
test('persistent intent and verified progress survive history clearing and refresh on each decision', async () => {
  const seen = [], prompter = { profile: { conversing: 'base $MEMORY' },
    async promptConvo (history) { seen.push(this.profile.conversing); return history.length } }
  let context = 'Build a windmill. Verified: false.'
  attachTaskContext(prompter, () => context)
  assert.equal(await prompter.promptConvo(['old history']), 1)
  context = 'Build a windmill. Verified: bearing placed.'
  assert.equal(await prompter.promptConvo([]), 0)
  assert.match(seen[0], /Verified: false/); assert.match(seen[1], /bearing placed/)
  assert.equal(prompter.profile.conversing, 'base $MEMORY')
})
test('bad/oversized task context is never sent and failure restores the original profile', async () => {
  const p = { profile: { conversing: 'base' }, async promptConvo () { throw Error('provider failure') } }
  let context = 'x'.repeat(24577)
  attachTaskContext(p, () => context)
  await assert.rejects(p.promptConvo([]), /CONTEXT_INVALID/)
  context = 'valid'; await assert.rejects(p.promptConvo([]), /provider failure/)
  assert.equal(p.profile.conversing, 'base')
})

test('memory summarization receives fresh verified context and restores its own template on failure', async () => {
  const seen = [], p = { profile: { conversing: 'convo', saving_memory: 'memory $INVENTORY' },
    async promptConvo () {}, async promptMemSaving (fail) { seen.push(this.profile.saving_memory); if (fail) throw Error('provider failure'); return 'summary' } }
  let context = 'Verified: millstone crafted, not placed.'
  attachTaskContext(p, () => context)
  assert.equal(await p.promptMemSaving(false), 'summary')
  context = 'Verified: millstone placed, native speed zero.'
  await assert.rejects(p.promptMemSaving(true), /provider failure/)
  assert.match(seen[0], /millstone crafted, not placed/)
  assert.match(seen[1], /millstone placed, native speed zero/)
  assert.match(seen[1], /missing observations do not mean empty inventory/)
  assert.equal(p.profile.saving_memory, 'memory $INVENTORY')
  assert.equal(p.profile.conversing, 'convo')
})
