import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const source = readFileSync(new URL('../src/mc-god.ts', import.meta.url), 'utf8')
const { transform } = createRequire(new URL('../package.json', import.meta.url))('esbuild')
// Evaluate the real, dependency-free gate without starting the world service.
const gate = source.match(/export function legacyGodModelJobs\([^]*?\n\}/)?.[0]
assert.ok(gate)
const compiled = await transform(gate, { loader: 'ts', format: 'esm' })
const { legacyGodModelJobs } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'))

test('legacy automatic model jobs default off and require separate explicit opt-in', () => {
  assert.deepEqual(legacyGodModelJobs({}), { review: false, dailyReport: false })
  assert.deepEqual(legacyGodModelJobs({ WORLD_GOD_REVIEW_ENABLED: '1' }), { review: true, dailyReport: false })
  assert.deepEqual(legacyGodModelJobs({ WORLD_GOD_DAILY_REPORT_ENABLED: '1' }), { review: false, dailyReport: true })
  for (const value of ['0', 'true', 'false', '', ' 1'])
    assert.deepEqual(legacyGodModelJobs({ WORLD_GOD_REVIEW_ENABLED: value, WORLD_GOD_DAILY_REPORT_ENABLED: value }),
      { review: false, dailyReport: false })
})

test('both model entrypoints and review timer are gated; non-model death observation still runs', () => {
  assert.match(source, /async function maybeRunDailyReport\([^]*?\): Promise<void> \{\s*if \(!automaticModelJobs\.dailyReport\) return/)
  assert.match(source, /async function runReview\(\): Promise<void> \{\s*if \(!automaticModelJobs\.review\) return/)
  assert.match(source, /function scheduleReview\(\) \{\s*if \(disposed \|\| !automaticModelJobs\.review\) return/)
  assert.match(source, /function scheduleDeathPoll\(\) \{\s*if \(disposed\) return/)
  assert.match(source, /agentProvider: describeModelProvider\(modelProvider\),\s*automaticModelJobs,/)
})
