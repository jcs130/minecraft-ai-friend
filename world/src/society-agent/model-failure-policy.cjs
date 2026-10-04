'use strict'

// QwenPaw's historical MODEL_QUOTA_EXCEEDED also covers ordinary HTTP 429.
// Project only controlled evidence; never persist provider messages or dumps.
const REASONS = new Set(['rate_limit_usage', 'rate_limit_concurrency', 'rate_limit_unknown', 'quota_hour', 'quota_week', 'quota_month', 'quota_unspecified', 'authentication', 'model_configuration', 'upstream_transient'])
const PROVIDER_CODES = new Set(['throttling', 'rate_limit_exceeded', 'insufficient_quota', 'invalid_api_key', 'authentication_error', 'model_not_found'])
const NATIVE_CODES = new Set(['MODEL_EXECUTION_ERROR', 'MODEL_TIMEOUT', 'UNAUTHORIZED_MODEL_ACCESS', 'MODEL_QUOTA_EXCEEDED', 'MODEL_CONTEXT_LENGTH_EXCEEDED', 'UNKNOWN_AGENT_ERROR', 'EXTERNAL_SERVICE_ERROR', 'MODEL_NOT_FOUND', 'RATE_LIMIT_EXCEEDED', 'AUTHENTICATION_ERROR', 'INVALID_API_KEY', 'INVALID_CONFIG', 'timeout'])
const CLIENT_CODES = new Set(['NATIVE_TASK_FAILURE', 'NATIVE_TASK_FAILED', 'NATIVE_TASK_TIMEOUT', 'NATIVE_TASK_CANCELLED', 'SUBMISSION_REJECTED', 'SUBMISSION_UNKNOWN', 'POLL_UNKNOWN', 'POLL_TIMEOUT', 'POLL_HTTP_ERROR', 'NATIVE_TASK_NOT_FOUND', 'NATIVE_RESULT_MISMATCH', 'UNKNOWN_NATIVE_STATUS', 'SESSION_BUSY', 'TASK_RECEIPT_NOT_DURABLE', 'EMPTY_FINAL_TEXT', 'NATIVE_FRAMEWORK_FAILURE', 'FINAL_TEXT_TOO_LARGE', 'INVALID_NATIVE_OUTPUT'])
const RATE_BASE_MS = 60000
const RATE_MAX_MS = 900000

function reasonFromMessage (message) {
  const text = typeof message === 'string' ? message.slice(0, 16384).toLowerCase() : ''
  if (text.includes('hour allocated quota exceeded')) return 'quota_hour'
  if (text.includes('week allocated quota exceeded')) return 'quota_week'
  if (text.includes('month allocated quota exceeded')) return 'quota_month'
  if (text.includes('concurrency allocated quota exceeded')) return 'rate_limit_concurrency'
  if (text.includes('usage allocated quota exceeded')) return 'rate_limit_usage'
  return null
}

function projectNativeModelError (error) {
  if (!error || typeof error !== 'object') return null
  const details = error.errorDetails && typeof error.errorDetails === 'object' ? error.errorDetails : error.details && typeof error.details === 'object' ? error.details : null
  const bodyError = details?.body?.error || details?.response?.error || details?.error
  const status = details?.httpStatus ?? details?.status_code ?? details?.statusCode ?? error.status_code ?? error.statusCode
  const httpStatus = Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null
  const code = bodyError?.code ?? details?.providerCode ?? details?.code
  const providerCode = PROVIDER_CODES.has(code) ? code : null
  const explicitReason = REASONS.has(details?.reasonCode) ? details.reasonCode : reasonFromMessage(bodyError?.message ?? details?.message)
  let reasonCode = explicitReason || reasonFromMessage(error.message)
  if (httpStatus === 401 || httpStatus === 403) reasonCode = 'authentication'
  else if (providerCode === 'invalid_api_key' || providerCode === 'authentication_error') reasonCode = 'authentication'
  else if (providerCode === 'model_not_found') reasonCode = 'model_configuration'
  else if (providerCode === 'insufficient_quota' && !reasonCode) reasonCode = 'quota_unspecified'
  else if (!reasonCode && (httpStatus === 429 || providerCode === 'throttling' || providerCode === 'rate_limit_exceeded')) reasonCode = 'rate_limit_unknown'
  else if (!reasonCode && httpStatus >= 500) reasonCode = 'upstream_transient'
  const projected = { ...(httpStatus !== null ? { httpStatus } : {}), ...(providerCode ? { providerCode } : {}), ...(reasonCode ? { reasonCode } : {}) }
  return Object.keys(projected).length ? projected : null
}

function modelDecisionError (decision) {
  const code = decision?.error?.nativeCode || decision?.error?.code || 'NATIVE_TASK_FAILURE'
  const safeCode = NATIVE_CODES.has(code) || CLIENT_CODES.has(code) ? code : 'NATIVE_TASK_FAILURE'
  const status = ['failed', 'unknown', 'timeout'].includes(decision?.status) ? decision.status : 'unknown'
  return Object.assign(new Error(`MODEL_TASK_${status.toUpperCase()}: ${safeCode}`), { nativeTaskStatus: status, nativeError: decision?.error || null })
}

function classifyModelFailure (error) {
  const native = error?.nativeError || {}
  const code = native.nativeCode || native.code || error?.code || ''
  const evidence = native.errorDetails || {}
  const httpStatus = evidence.httpStatus ?? native.httpStatus
  const reason = REASONS.has(evidence.reasonCode) ? evidence.reasonCode : null
  // Unknown accepted tasks retain their journal/task ID. They never become a
  // rate retry merely because a later read mentions throttling.
  if (['unknown', 'timeout'].includes(error?.nativeTaskStatus) || (!error?.nativeTaskStatus && /UNKNOWN|UNCERTAIN|INTENT_PENDING|TASK_NOT_FOUND/i.test(error?.message || ''))) return { action: 'pause_unknown', reasonCode: 'unknown_model_task', pauseReason: 'unknown_model_task' }
  if (httpStatus === 401 || httpStatus === 403 || reason === 'authentication' || /AUTHENTICATION|INVALID_API_KEY|UNAUTHORIZED_MODEL_ACCESS/.test(code) || /AUTHENTICATION|INVALID_API_KEY|UNAUTHORIZED_MODEL_ACCESS/.test(error?.message || '')) return { action: 'pause_model', reasonCode: 'authentication', pauseReason: 'model_authentication_or_configuration' }
  if (['quota_hour', 'quota_week', 'quota_month'].includes(reason)) return { action: 'pause_model', reasonCode: reason, pauseReason: 'model_quota_window' }
  if (reason === 'quota_unspecified') return { action: 'pause_model', reasonCode: reason, pauseReason: 'model_quota_requires_review' }
  if (reason === 'model_configuration' || /MODEL_NOT_FOUND|INVALID_CONFIG/.test(code) || /MODEL_NOT_FOUND|INVALID_CONFIG/.test(error?.message || '') || (code === 'SUBMISSION_REJECTED' && [400, 404].includes(httpStatus))) return { action: 'pause_model', reasonCode: 'model_configuration', pauseReason: 'model_authentication_or_configuration' }
  if (httpStatus === 429 || ['rate_limit_usage', 'rate_limit_concurrency', 'rate_limit_unknown'].includes(reason) || /MODEL_QUOTA_EXCEEDED|RATE_LIMIT_EXCEEDED/.test(code) || /MODEL_QUOTA_EXCEEDED/.test(error?.message || '')) return { action: 'rate_backoff', reasonCode: reason || 'rate_limit_unknown' }
  return { action: 'decision_backoff', reasonCode: reason || 'known_decision_failure' }
}

function restoreModelBackoff (value, now = Date.now()) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || value.kind !== 'rate_limit' || !Number.isSafeInteger(value.failures) || value.failures < 1 || value.failures > 1000000 || !Number.isSafeInteger(value.scheduledAt) || value.scheduledAt < 0 || !Number.isSafeInteger(value.nextAttemptAt) || value.nextAttemptAt !== value.scheduledAt + value.delayMs || value.nextAttemptAt > now + RATE_MAX_MS || !Number.isSafeInteger(value.delayMs) || value.delayMs < RATE_BASE_MS || value.delayMs > RATE_MAX_MS || !['rate_limit_usage', 'rate_limit_concurrency', 'rate_limit_unknown'].includes(value.reasonCode)) throw new Error('MODEL_BACKOFF_STATE_INVALID')
  return { kind: 'rate_limit', failures: value.failures, scheduledAt: value.scheduledAt, nextAttemptAt: value.nextAttemptAt, delayMs: value.delayMs, reasonCode: value.reasonCode }
}

function nextModelBackoff (previous, policy, now = Date.now()) {
  if (policy?.action !== 'rate_backoff' || !Number.isSafeInteger(now) || now < 0) throw new Error('MODEL_BACKOFF_ARGUMENT_INVALID')
  const failures = Math.min((restoreModelBackoff(previous, now)?.failures || 0) + 1, 1000000)
  const delayMs = Math.min(RATE_BASE_MS * 2 ** Math.min(failures - 1, 4), RATE_MAX_MS)
  return { kind: 'rate_limit', failures, scheduledAt: now, nextAttemptAt: now + delayMs, delayMs, reasonCode: ['rate_limit_usage', 'rate_limit_concurrency'].includes(policy.reasonCode) ? policy.reasonCode : 'rate_limit_unknown' }
}

function modelBackoffRemaining (value, now = Date.now()) {
  return value ? Math.max(0, restoreModelBackoff(value, now).nextAttemptAt - now) : 0
}

module.exports = { projectNativeModelError, modelDecisionError, classifyModelFailure, restoreModelBackoff, nextModelBackoff, modelBackoffRemaining, RATE_BASE_MS, RATE_MAX_MS, NATIVE_CODES }
