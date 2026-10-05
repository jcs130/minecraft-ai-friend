'use strict'

const REASONS = Object.freeze({ deadline: 'ACTION_DEADLINE_TIMEOUT', maintenance: 'ACTION_MAINTENANCE_ABORTED',
  shutdown: 'ACTION_SHUTDOWN_ABORTED', context: 'ACTION_CONTEXT_ABORTED' })
const MUTATIONS = new Set(['block_dig', 'block_place', 'use_item', 'use_item_on', 'use_entity', 'window_click',
  'click_container_button', 'enchant_item', 'creative_inventory_action', 'set_creative_slot', 'held_item_slot', 'arm_animation',
  'chat', 'chat_command', 'chat_command_signed'])
const contextReason = error => Object.hasOwn(REASONS, error?.actionInterruptionReason) ? error.actionInterruptionReason : 'context'

class ActionInterruptionError extends Error {
  constructor (reason, phase, cleanupOk, readOnly = false) {
    super(REASONS[reason]); this.name = 'ActionInterruptionError'; this.code = REASONS[reason]
    this.result = { ok: false, code: this.code, outcome: 'unknown', outcomeUnknown: true, outcomeKnown: false,
      effectVerified: false, retryAutomatically: false, interruptionReason: reason, phase, cleanupOk }
    if (readOnly) Object.assign(this.result, { outcome: 'known_aborted', outcomeUnknown: false, outcomeKnown: true,
      readOnly: true, discarded: true, mutationsDispatched: false })
  }
}

// Never use a timed-out mutation's late completion as authority to submit a
// second mutation. The original promise remains observed; its continuation
// must use scope.check()/wait() and the persistent packet fence below.
async function runActionWithDeadline (operation, { timeoutMs = 45000, pollIntervalMs = 100, signal,
  checkContext = () => {}, onAbort = () => {}, onScope = () => {}, readOnly = false } = {}) {
  if (typeof operation !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1000 || typeof readOnly !== 'boolean') throw Error('ACTION_DEADLINE_CONFIG_INVALID')
  // No operation was dispatched yet: this is a real precondition rejection.
  checkContext()
  if (signal?.aborted) throw Error('ACTION_NOT_DISPATCHED_ABORTED')
  let interrupted = null, finished = false, mutationDispatched = false, phase = 'starting', timer, poll, rejectInterrupted
  const controller = new AbortController()
  const interruption = new Promise((_resolve, reject) => { rejectInterrupted = reject })
  const scope = {
    signal: controller.signal,
    mutationDispatched () { scope.check(); mutationDispatched = true },
    mutationObserved () { return mutationDispatched },
    phase (name) { scope.check(); if (!/^[a-z0-9_]{1,64}$/.test(name)) throw Error('ACTION_PHASE_INVALID'); phase = name },
    abort (reason = 'context') {
      if (finished || interrupted) return
      if (!Object.hasOwn(REASONS, reason)) reason = 'context'
      let cleanupOk = true
      // Mark cancelled before stopping the body: synchronous cancellation
      // events and their promise continuations can no longer dispatch work.
      interrupted = new ActionInterruptionError(reason, phase, true, readOnly && !mutationDispatched)
      controller.abort()
      try { onAbort({ reason, phase, code: interrupted.code, outcomeUnknown: interrupted.result.outcomeUnknown }) } catch { cleanupOk = false }
      interrupted.result.cleanupOk = cleanupOk
      rejectInterrupted(interrupted)
    },
    check () {
      if (interrupted) throw interrupted
      try { checkContext() } catch (error) { scope.abort(contextReason(error)); throw interrupted }
    },
    wait (ms) {
      scope.check()
      if (!Number.isFinite(ms) || ms < 0 || ms > 120000) throw Error('ACTION_WAIT_INVALID')
      return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(delay); controller.signal.removeEventListener('abort', abort); reject(interrupted) }
        const delay = setTimeout(() => {
          controller.signal.removeEventListener('abort', abort)
          try { scope.check(); resolve() } catch (error) { reject(error) }
        }, ms)
        controller.signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
  const externalAbort = () => scope.abort('maintenance')
  signal?.addEventListener('abort', externalAbort, { once: true })
  try {
    onScope(scope)
    timer = setTimeout(() => scope.abort('deadline'), timeoutMs)
    poll = setInterval(() => {
      try { checkContext() } catch (error) { scope.abort(contextReason(error)) }
    }, pollIntervalMs)
    const running = Promise.resolve().then(() => { scope.check(); return operation(scope) })
    // Promise.race observes rejection even after the deadline wins. A late
    // successful value is discarded, never reclassified as a verified result.
    const result = await Promise.race([running, interruption])
    scope.check()
    finished = true
    return result
  } catch (error) {
    // A native cancellation can synchronously reject its own promise before
    // Promise.race consumes our interruption. It still has an unknown effect.
    if (!interrupted && mutationDispatched && !error.result) error.result = { ok: false, code: 'action_dispatch_outcome_unknown',
      outcome: 'unknown', outcomeKnown: false, outcomeUnknown: true, effectVerified: false, mutationDispatched: true,
      phase, retryAutomatically: false }
    if (!interrupted && readOnly && !mutationDispatched && !error.result) error.result = { ok: false, code: error.code || error.message,
      outcome: 'known_read_unavailable', outcomeKnown: true, outcomeUnknown: false, readOnly: true, retryAutomatically: false }
    throw interrupted || error
  } finally {
    clearTimeout(timer); clearInterval(poll)
    signal?.removeEventListener('abort', externalAbort)
  }
}

function outboundGameMutation (name, data) {
  // Locked Mineflayer inventory.deactivateItem uses RELEASE_USE_ITEM=5.
  // DROP_ALL=3, DROP_ONE=4 and SWAP_HANDS=6 remain real mutations.
  if (name === 'block_dig' && (data?.status === 1 || data?.status === 5)) return false
  if (MUTATIONS.has(name)) return true
  return (name === 'custom_payload' || name === 'plugin_message') && typeof data?.channel === 'string' &&
    /^maw_agent:[a-z_]+_action$/.test(data.channel)
}

// Mineflayer methods capture bot in closures, so a Proxy around bot does not
// intercept their late native writes. Fence the real client once. After an
// unknown interrupted action the fence stays closed for this worker lifetime;
// keepalive/position/read-only queries and dig cancellation remain possible.
function installActionPacketFence (client, onBlocked = () => {}, onMutation = () => {}) {
  if (!client || typeof client.write !== 'function' || typeof onBlocked !== 'function' || typeof onMutation !== 'function') throw Error('ACTION_FENCE_CONFIG_INVALID')
  const original = client.write
  let blocked = false, count = 0
  client.write = function (name, data) {
    if (blocked && outboundGameMutation(name, data)) {
      count++
      if (count <= 8) { try { onBlocked({ packet: name, count }) } catch {} } // no payload/credentials
      return false
    }
    // Track the attempted dispatch before native write: a transport throw may
    // leave its delivery uncertain. Read-only declarations cannot mask it.
    if (outboundGameMutation(name, data)) onMutation({ packet: name })
    return original.call(this, name, data)
  }
  return { block () { blocked = true }, status () { return { blocked, blockedWrites: count } } }
}

module.exports = { ActionInterruptionError, runActionWithDeadline, outboundGameMutation, installActionPacketFence }
