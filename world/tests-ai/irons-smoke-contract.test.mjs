import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeReply, spellItem, QA } from '../../tools/smoke_irons_bridge.mjs'
import { validateTarget } from '../../tools/smoke_ai.mjs'

test('native smoke refuses wrong actor/action and unstructured command success', () => {
  const row = { schema: 1, engine: 'irons_spellbooks', action: 'cast', actor: QA, ok: true, accepted: true, phase: 'casting' }
  const text = value => 'QD_SPELL_JSON ' + JSON.stringify(value)
  assert.equal(nativeReply(text(row), 'cast').accepted, true)
  assert.throws(() => nativeReply('Successfully cast spell', 'cast'))
  assert.throws(() => nativeReply(text({ ...row, actor: 'RealPlayer' }), 'cast'))
  assert.throws(() => nativeReply(text({ ...row, action: 'status' }), 'cast'))
  assert.throws(() => nativeReply(text(row) + '\n' + text(row), 'cast'))
})

test('native smoke fixtures and network scope are restricted before any runtime import', () => {
  assert.throws(() => spellItem('minecraft:command_block', true, false))
  assert.match(spellItem('irons_spellbooks:scroll', false, false), /spellWheel:0b,mustEquip:0b/)
  const env = { SMOKE_EXECUTE: 'qiandengji', SMOKE_PROJECT: 'qiandengji', SMOKE_TIMEOUT_MS: '180000' }
  assert.equal(validateTarget(env).host, 'mc')
  assert.throws(() => validateTarget({ ...env, MC_HOST: 'shadow' }))
  assert.throws(() => validateTarget({ ...env, MC_RCON_PORT: '25577' }))
  assert.throws(() => validateTarget({ ...env, MC_DATA_DIR: 'C:/production' }))
})
