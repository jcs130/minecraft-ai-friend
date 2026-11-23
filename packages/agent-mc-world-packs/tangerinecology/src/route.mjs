/**
 * 橘乡 join route: NanoLimbo (MaxAuth /login) → lobby → `/main` → survival backend.
 * The phase is read from the server's own command tree (root literals); no world action is
 * inferred from a title or a chat line. Sending `/main` is bounded per connection.
 */
export const ROUTE_PHASES = Object.freeze(['unknown', 'limbo', 'lobby', 'main']);

/** Classify a backend from its root command literals. */
export function classifyTangerinePhase(rootLiterals) {
  const roots = new Set(Array.isArray(rootLiterals) ? rootLiterals : []);
  if (!roots.size) return 'unknown';
  // SVC (`voicechat`) and HuskHomes exist only on the survival backend.
  if (roots.has('voicechat') || roots.has('huskhomes:tpa')) return 'main';
  if (roots.has('main')) return 'lobby';
  if (roots.has('login') || roots.has('maxauth')) return 'limbo';
  return 'unknown';
}

/**
 * @param {object} io
 * @param {() => string[] | null} io.rootLiterals current command-tree roots (null when unknown)
 * @param {() => boolean} io.loggedIn authoritative login readiness (core server-login confirmed)
 * @param {(command: string) => void} io.send sends one chat command on this connection
 * @param {() => number} [io.now]
 * @param {(row: object) => void} [io.onEvent]
 */
export function createTangerineRoute(io, { autoMain = true, maxMainAttempts = 3, retryAfterMs = 20_000, settleMs = 2_000 } = {}) {
  const now = io.now ?? (() => Date.now());
  let attempts = 0, lastSentAt = 0, lobbySince = 0, phase = 'unknown', stopped = false, gaveUp = null;
  const emit = (row) => { try { io.onEvent?.({ at: now(), ...row }); } catch {} };
  const tick = () => {
    if (stopped) return phase;
    const next = classifyTangerinePhase(io.rootLiterals() ?? []);
    if (next !== phase) { emit({ event: 'phase', from: phase, to: next }); phase = next; lobbySince = next === 'lobby' ? now() : 0; }
    if (phase !== 'lobby' || !autoMain || gaveUp || !io.loggedIn()) return phase;
    const t = now();
    if (t - lobbySince < settleMs) return phase;
    if (lastSentAt && t - lastSentAt < retryAfterMs) return phase;
    if (attempts >= maxMainAttempts) { gaveUp = 'MAIN_ROUTE_ATTEMPTS_EXHAUSTED'; emit({ event: 'gave-up', reason: gaveUp, attempts }); return phase; }
    attempts++; lastSentAt = t;
    try { io.send('/main'); emit({ event: 'main-sent', attempt: attempts }); }
    catch (error) { emit({ event: 'main-send-failed', error: String(error?.message ?? error) }); }
    return phase;
  };
  return {
    tick,
    phase: () => phase,
    /** SVC belongs to the survival backend; hold the native client until then. */
    voiceAllowed: () => !stopped && phase === 'main',
    snapshot: () => ({ phase, autoMain, mainAttempts: attempts, gaveUp, lastMainSentAt: lastSentAt ? new Date(lastSentAt).toISOString() : null }),
    stop: () => { stopped = true; },
  };
}
