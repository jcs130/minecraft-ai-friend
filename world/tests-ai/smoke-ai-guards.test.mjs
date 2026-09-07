import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { QA_BODY, featherReceipt, commandPresent, readReplyTail, validateTarget, wheelTitle } from '../../tools/smoke_ai.mjs'

const isolated = { SMOKE_EXECUTE: 'qiandengji', SMOKE_PROJECT: 'qiandengji' }
test('integration target rejects production hosts, public ports and missing execution scope', () => {
  assert.equal(validateTarget(isolated).host, 'mc')
  assert.throws(() => validateTarget({}))
  for (const host of ['shadow-mc', 'localhost', '127.0.0.1', 'host.docker.internal']) {
    assert.throws(() => validateTarget({ ...isolated, MC_HOST: host }))
    assert.throws(() => validateTarget({ ...isolated, MC_RCON_HOST: host }))
  }
  assert.throws(() => validateTarget({ ...isolated, MC_PORT: '25565' }))
  assert.throws(() => validateTarget({ ...isolated, MC_RCON_PORT: '25577' }))
  assert.throws(() => validateTarget({ ...isolated, MC_DATA_DIR: '/mcdata' }))
  assert.throws(() => validateTarget({ ...isolated, SMOKE_TIMEOUT_MS: 'Infinity' }))
})

test('wheel title supports both legacy JSON and the 1.21 NBT component', () => {
  assert.ok(wheelTitle('{"text":"轮盘"}').includes('轮盘'))
  assert.ok(wheelTitle({ type: 'compound', value: { text: { type: 'string', value: '§3轮盘 §b魔 100' } } }).includes('轮盘'))
  assert.equal(wheelTitle(null).includes('轮盘'), false)
})

test('successful receipt requires the QA speaker, a fresh timestamp and consumed spell mana', () => {
  const success = { speaker: QA_BODY, kind: 'chant', ts: 100, reply: '羽落已生效（消耗魔力 8），剩余魔力 92/100。' }
  const noise = [
    { ...success, speaker: 'UnrelatedPlayer' }, { ...success, ts: 99 },
    { ...success, kind: 'prayer' }, { ...success, reply: '已上达咏唱通道' },
    { ...success, reply: '你咏唱羽落，但魔力不足' },
  ]
  assert.equal(featherReceipt(noise, 100), null)
  assert.deepEqual(featherReceipt([...noise, success], 100), success)
  assert.equal(commandPresent('Unknown or incomplete command: skillchest', 'skillchest'), false)
  assert.equal(commandPresent('/skillchest wheel <player> [page]', 'skillchest'), true)
})

test('bounded reply reader tolerates absent files, corrupt lines and unfinished writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qiandeng-receipts-test-'))
  try {
    const path = join(dir, 'replies.jsonl')
    assert.deepEqual(await readReplyTail(path), [])
    const receipt = { speaker: QA_BODY, kind: 'chant', ts: 101, reply: '✦ 鉴定：Lv.1' }
    await writeFile(path, '坏行'.repeat(1000) + '\nnot-json\n' + JSON.stringify(receipt) + '\n{"unfinished":')
    assert.deepEqual(await readReplyTail(path, 512), [receipt])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
