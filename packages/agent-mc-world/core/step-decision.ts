/** Decision support, not a new task state machine or an automatic retry policy. */
export interface StepDecision {
  status: 'completed' | 'partial' | 'blocked' | 'noop' | 'skipped' | 'cancelled' | 'unknown';
  reason: string | null;
  completed: number | null;
  remaining: number | null;
  unit: 'steps' | 'items' | 'cells' | null;
  retryable: boolean;
  retry_after: number | null;
  continue_when: string | null;
  next_safe_read: { tool: string; arguments: Record<string,unknown> } | null;
}
export function stepDecision(outcome: 'ok'|'noop'|'partial'|'fail'|'skip'|'cut', code?: string,
  progress?: { done: number; total: number }, details?: Partial<StepDecision>): StepDecision {
  const uncertain = ['container-window-changed','container-window-rollback','inventory-click-sync','use-hand-changed',
    'execution-context-changed','fishing-loot-unconfirmed','fishing-reel-unconfirmed','food-consumption-unconfirmed'].includes(code ?? '');
  const conditions: Record<string,string> = {
    'target-not-ready': 'Observe the specified target again after its readiness changes; do not repeat unchanged input.',
    'container-full': 'Free compatible destination slots or explicitly select a different container.',
    'pathfinder-no-path': 'Inspect geometry and select a reachable route; permissions and collision remain unchanged.',
    'protection-denied': 'Use an authorized target; do not retry or bypass the protection.',
    'food-consumption-unconfirmed': 'Read current inventory, hand and nutrition after synchronization; do not replay an unconfirmed consumption.',
  };
  return { status: uncertain ? 'unknown' : outcome === 'ok' ? 'completed' : outcome === 'fail' ? 'blocked'
    : outcome === 'skip' ? 'skipped' : outcome === 'cut' ? 'cancelled' : outcome,
    reason: code ?? null, completed: progress?.done ?? (outcome === 'ok' ? 1 : null),
    remaining: progress ? Math.max(0,progress.total-progress.done) : outcome === 'ok' ? 0 : null,
    unit: progress ? null : outcome === 'ok' ? 'steps' : null,
    retryable: false, retry_after: null, continue_when: code ? conditions[code] ?? null : null,
    next_safe_read: { tool: code === 'food-consumption-unconfirmed' ? 'mc_bag' : 'mc_queue', arguments: {} }, ...details };
}
