import type { ToolOutcome } from '../contracts/index.ts';
import type { CombatExecutionPolicy } from '../../core/combat-decision-types.ts';
/** Adapter-owned model settings, deliberately excluded from the game process configuration. */
export interface HostCombatConfig {
  combatOptions?: Partial<CombatExecutionPolicy>;
  hostDecisions?: { combat?: Partial<CombatDecisionConfig> };
}
import { COMBAT_DECISION_DEFAULTS } from './defaults.ts';
import { CombatDecisionLoop, usesHostDecision, type CombatDecisionOptions, type CombatDecisionConfig, type CombatDecisionFrame } from './combat-decision.ts';

export interface HostCombatPort {
  call(args: Record<string, unknown>, signal: AbortSignal): Promise<string | ToolOutcome>;
  report(event: string, data: Record<string, unknown>): void;
  decisions?: { request: NonNullable<CombatDecisionOptions['request']> };
}

export function hostCombatConfig(cfg: HostCombatConfig): CombatDecisionConfig {
  const c = { ...COMBAT_DECISION_DEFAULTS, ...cfg.combatOptions, ...cfg.hostDecisions?.combat };
  return { ...c, endpoint: c.endpoint ?? '' };
}
export function validateHostCombat(cfg: HostCombatConfig): void {
  const c = hostCombatConfig(cfg);
  if (!c.enabled) return;
  if (c.connection !== undefined && !['auto', 'host', 'endpoint'].includes(c.connection)) throw new Error('Invalid decision connection mode.');
  if (!usesHostDecision(c)) {
    if (!c.endpoint) throw new Error('Direct host combat decisions require an explicit endpoint.');
    const url = new URL(c.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Host combat endpoint must be an HTTP(S) URL without embedded credentials.');
  }
  if (!usesHostDecision(c) && ((c.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.apiKeyEnv)) || (c.model && c.model.length > 120)))
    throw new Error('Invalid host decision model or credential reference.');
  if (!['act', 'shadow'].includes(c.mode) || !Number.isFinite(c.minConfidence) || c.minConfidence < 0 || c.minConfidence > 1
    || (c.selectionMode!==undefined&&!['single','compatible'].includes(c.selectionMode))
    || (c.minMargin !== undefined && (!Number.isFinite(c.minMargin) || c.minMargin < 0 || c.minMargin > 1))
    || [c.timeoutMs, c.minIntervalMs, c.maxAgeMs].some(n => !Number.isFinite(n) || n < 50 || n > 60000))
    throw new Error('Invalid host combat decision limits.');
}

/** Optional Cortico/SDK host service. It never owns a bot and cannot bypass game tool validation. */
export class HostCombatDriver {
  private readonly lifetime = new AbortController();
  private frame: CombatDecisionFrame | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private readonly loop: CombatDecisionLoop;
  constructor(private readonly cfg: () => HostCombatConfig, private readonly port: HostCombatPort,
    fetchImpl?: typeof fetch) {
    this.loop = new CombatDecisionLoop({ config: () => hostCombatConfig(cfg()), sample: () => this.frame,
      refresh: () => this.refresh(), fetchImpl,
      request: port.decisions ? (input, options) => port.decisions!.request(input, options) : undefined,
      apply: async (candidate, frame, decision) => {
        if (this.lifetime.signal.aborted) return false;
        const value = await port.call({ choice: { candidate, decisionId: decision.decisionId, tacticRevision: frame.tacticRevision,
          connectionGeneration: frame.battlefield.connectionGeneration } }, this.lifetime.signal);
        return !this.lifetime.signal.aborted && typeof value !== 'string'
          && (value.meta?.receipt as { accepted?: boolean } | undefined)?.accepted === true;
      },
      // The game loop never stops its rule controller while the host model thinks.
      fallback: () => port.report('fallback', { policy: 'continue-game-rules', goalCompleted: false }),
      report: (event, data) => port.report(event, data),
    });
  }
  private async refresh(): Promise<CombatDecisionFrame | null> {
    if (this.lifetime.signal.aborted) return null;
    const value = await this.port.call({ battlefield: true }, this.lifetime.signal);
    if (this.lifetime.signal.aborted) return null;
    const frame = typeof value !== 'string' && value.meta?.protocol === 'agent-mc-tactics/v1'
      ? value.meta.frame as CombatDecisionFrame | null : null;
    this.frame = frame;
    return frame;
  }
  start(): void {
    if (this.running || this.lifetime.signal.aborted || !hostCombatConfig(this.cfg()).enabled) return;
    validateHostCombat(this.cfg());
    this.running = true;
    this.port.report('started', { mode: hostCombatConfig(this.cfg()).mode, fallback: 'continue-game-rules' });
    void this.poll();
  }
  private async poll(): Promise<void> {
    try {
      const cfg = hostCombatConfig(this.cfg());
      if (!cfg.enabled || this.lifetime.signal.aborted) return;
      await this.refresh();
      if (!this.lifetime.signal.aborted) this.loop.tick();
    } catch {
      if (!this.lifetime.signal.aborted) this.port.report('unavailable', { fallback: 'continue-game-rules' });
    } finally {
      if (!this.lifetime.signal.aborted) {
        this.timer = setTimeout(() => { void this.poll(); }, Math.max(100, hostCombatConfig(this.cfg()).minIntervalMs));
        this.timer.unref?.();
      }
    }
  }
  inspect(id?: number) { return this.loop.inspect(id); }
  stop(): void { this.lifetime.abort(); clearTimeout(this.timer); this.frame = null; this.loop.stop(); }
}
