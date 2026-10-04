'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { projectNativeModelError, modelDecisionError, classifyModelFailure, restoreModelBackoff, nextModelBackoff, modelBackoffRemaining } = require('./model-failure-policy.cjs')

function failed (nativeCode, errorDetails, httpStatus) { return modelDecisionError({ status: 'failed', error: { code: 'NATIVE_TASK_FAILED', nativeCode, errorDetails, httpStatus } }) }

test('original usage throttling projects a controlled reason without private messages', () => {
  const evidence = projectNativeModelError({ code: 'MODEL_QUOTA_EXCEEDED', message: "Quota exceeded: usage allocated quota exceeded. please try again later. [dump: private-file] secret-key", errorDetails: { status_code: 429, body: { error: { code: 'throttling', message: 'usage allocated quota exceeded. please try again later.' } } } })
  assert.deepEqual(evidence, { httpStatus: 429, providerCode: 'throttling', reasonCode: 'rate_limit_usage' })
  assert.ok(!JSON.stringify(evidence).includes('private'))
  assert.ok(!JSON.stringify(evidence).includes('secret'))
  assert.equal(classifyModelFailure(failed('MODEL_QUOTA_EXCEEDED', evidence)).action, 'rate_backoff')
})

test('structured evidence takes precedence over misleading legacy wrapper text', () => {
  assert.deepEqual(projectNativeModelError({ message: 'month allocated quota exceeded', errorDetails: { httpStatus: 429, reasonCode: 'rate_limit_usage' } }), { httpStatus: 429, reasonCode: 'rate_limit_usage' })
  assert.equal(projectNativeModelError({ message: 'usage allocated quota exceeded', errorDetails: { httpStatus: 401 } }).reasonCode, 'authentication')
  assert.equal(projectNativeModelError({ message: 'secret', details: { providerCode: 'secret_key_value' } }), null)
  assert.equal(projectNativeModelError({ errorDetails: { providerCode: 'invalid_api_key', httpStatus: 400 } }).reasonCode, 'authentication')
  assert.equal(projectNativeModelError({ errorDetails: { providerCode: 'model_not_found' } }).reasonCode, 'model_configuration')
})

test('legacy generic 429 label and reasonless HTTP 429 use unknown-rate backoff, never claim total quota', () => {
  assert.deepEqual(classifyModelFailure(failed('MODEL_QUOTA_EXCEEDED')), { action: 'rate_backoff', reasonCode: 'rate_limit_unknown' })
  assert.deepEqual(classifyModelFailure(failed(undefined, undefined, 429)), { action: 'rate_backoff', reasonCode: 'rate_limit_unknown' })
  assert.equal(classifyModelFailure(failed('SUBMISSION_REJECTED', { httpStatus: 429 })).action, 'rate_backoff')
})

test('documented usage/concurrency and hour/week/month quota remain independently classified', () => {
  for (const [prefix, reason] of [['usage', 'rate_limit_usage'], ['concurrency', 'rate_limit_concurrency'], ['hour', 'quota_hour'], ['week', 'quota_week'], ['month', 'quota_month']]) {
    const evidence = projectNativeModelError({ message: prefix + ' allocated quota exceeded' })
    assert.equal(evidence.reasonCode, reason)
    const policy = classifyModelFailure(failed('MODEL_QUOTA_EXCEEDED', evidence))
    assert.equal(policy.action, ['usage', 'concurrency'].includes(prefix) ? 'rate_backoff' : 'pause_model')
    assert.equal(policy.reasonCode, reason)
  }
})

test('AUTH and CONFIG remain persistent pauses; known HTTP 503 is a transient decision failure', () => {
  for (const code of ['AUTHENTICATION_ERROR', 'UNAUTHORIZED_MODEL_ACCESS', 'INVALID_API_KEY', 'MODEL_NOT_FOUND', 'INVALID_CONFIG']) assert.equal(classifyModelFailure(failed(code)).action, 'pause_model')
  for (const status of [400, 401, 403, 404]) assert.equal(classifyModelFailure(failed('SUBMISSION_REJECTED', undefined, status)).action, 'pause_model')
  assert.equal(classifyModelFailure(failed('SUBMISSION_REJECTED', undefined, 503)).action, 'decision_backoff')
})

test('explicit insufficient_quota requires review without inventing an exhausted time window', () => {
  const evidence = projectNativeModelError({ errorDetails: { httpStatus: 429, providerCode: 'insufficient_quota' } })
  assert.equal(evidence.reasonCode, 'quota_unspecified')
  assert.deepEqual(classifyModelFailure(failed('MODEL_QUOTA_EXCEEDED', evidence)), { action: 'pause_model', reasonCode: 'quota_unspecified', pauseReason: 'model_quota_requires_review' })
})

test('unknown native task cannot be converted into a rate retry; terminal generic UNKNOWN_AGENT_ERROR is known failed', () => {
  const unknown = modelDecisionError({ status: 'unknown', error: { nativeCode: 'MODEL_QUOTA_EXCEEDED', errorDetails: { httpStatus: 429 } } })
  assert.equal(classifyModelFailure(unknown).action, 'pause_unknown')
  assert.equal(classifyModelFailure(new Error('INTENT_PENDING')).action, 'pause_unknown')
  assert.equal(classifyModelFailure(failed('UNKNOWN_AGENT_ERROR')).action, 'decision_backoff')
  assert.equal(classifyModelFailure(modelDecisionError({ status: 'timeout', error: { code: 'POLL_TIMEOUT' } })).action, 'pause_unknown')
  assert.equal(classifyModelFailure(failed('NATIVE_TASK_TIMEOUT')).action, 'decision_backoff')
  assert.equal(modelDecisionError({ status: 'failed', error: { nativeCode: 'sk_private_credential' } }).message, 'MODEL_TASK_FAILED: NATIVE_TASK_FAILURE')
})

test('60-second minimum exponential backoff is persisted and caps at 15 minutes', () => {
  let backoff = null
  const delays = []
  const policy = { action: 'rate_backoff', reasonCode: 'rate_limit_usage' }
  for (let n = 0; n < 9; n++) { backoff = nextModelBackoff(backoff, policy, 100000); delays.push(backoff.delayMs) }
  assert.deepEqual(delays, [60000, 120000, 240000, 480000, 900000, 900000, 900000, 900000, 900000])
  assert.equal(backoff.failures, 9)
  const restored = restoreModelBackoff(JSON.parse(JSON.stringify(backoff)))
  assert.deepEqual(restored, backoff)
  assert.equal(modelBackoffRemaining(restored, 100001), 899999)
  assert.equal(modelBackoffRemaining(restored, 1000000), 0)
  assert.equal(nextModelBackoff(null, policy, 100000).delayMs, 60000)
})

test('malformed persisted backoff cannot silently bypass its cooldown', () => {
  const valid = nextModelBackoff(null, { action: 'rate_backoff' }, 100000)
  for (const bad of [{}, { ...valid, delayMs: 1 }, { ...valid, failures: 0 }, { ...valid, nextAttemptAt: 'now' }, { ...valid, nextAttemptAt: 9000000000000 }, { ...valid, reasonCode: 'secret' }]) assert.throws(() => restoreModelBackoff(bad), /MODEL_BACKOFF_STATE_INVALID/)
  assert.throws(() => restoreModelBackoff({ ...valid, scheduledAt: 9999999999999, nextAttemptAt: 9999999999999 + valid.delayMs }, 100000), /MODEL_BACKOFF_STATE_INVALID/)
  assert.equal(restoreModelBackoff(null), null)
})

