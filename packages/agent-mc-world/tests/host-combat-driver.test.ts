import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostCombatDriver, type HostCombatPort, validateHostCombat } from '../src/decisions/combat-driver.ts';
import { MINECRAFT_DEFAULTS as MYMC_DEFAULTS } from '../core/config.ts';
import type { HostCombatConfig as MymcConfigSection } from '../src/decisions/combat-driver.ts';
import type { CombatDecisionFrame } from '../src/decisions/combat-decision.ts';

const frame = (): CombatDecisionFrame => ({ battlefield: { sampledAtMs: Date.now(), connectionGeneration: 1, dimension: 'overworld',
  self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 0 }, food: 20,
    position: [0, 64, 0], scoreboardTeam: null },
  action: { fighting: true, emergency: false, taskId: null, step: null, targetEntityId: 2, sinceHitMs: 1000, canStep: false },
  actors: [], omitted: 0, server: null }, tacticRevision: 1, mana: 20, skills: [],
  candidates: [{ id: 'test', kind: 'cast', spell: 'spark', intent: 'Hit a verified target', manaCost: 4, ruleId: 'test' }], omittedCandidates: 0 });
const response = () => new Response(JSON.stringify({ answers: { tactic: { type: 'choice', choice: 'option_0',
  confidence: .99, probabilities: { keep: .01, option_0: .99 } } } }));
const drivers: HostCombatDriver[] = [];
afterEach(() => { drivers.splice(0).forEach(d => d.stop()); vi.useRealTimers(); vi.unstubAllEnvs(); });
function rig(enabled = true, fetchImpl: typeof fetch = vi.fn(async () => response()), decisions?: HostCombatPort['decisions']) {
  let current: CombatDecisionFrame | null = frame();
  const cfg: MymcConfigSection = { ...structuredClone(MYMC_DEFAULTS), hostDecisions: { combat: { enabled, mode: 'act' as const,
    endpoint: 'http://explicit.invalid/v1/systemone', model: 'jev-test', timeoutMs: 100 } } };
  const call = vi.fn(async (args: Record<string, unknown>) => ({ text: 'opaque localized text, not parsed',
    meta: { protocol: 'agent-mc-tactics/v1', ...(args.battlefield ? { frame: current } : { receipt: { accepted: true } }) } }));
  const report = vi.fn();
  const driver = new HostCombatDriver(() => cfg, { call, report, decisions }, fetchImpl); drivers.push(driver);
  return { driver, cfg, call, report, fetchImpl, setFrame: (f: CombatDecisionFrame | null) => { current = f; } };
}
describe('explicit host decision service through neutral game tool metadata', () => {
  it.each([undefined, 'ChoiceOverride'])('inherits the host or references a saved override %s without direct HTTP', async decisionProvider => {
    const request = vi.fn(async () => JSON.parse(await response().text()));
    const r = rig(true, vi.fn(), { request });
    r.cfg.hostDecisions!.combat = { enabled: true, mode: 'act', decisionProvider };
    expect(() => validateHostCombat(r.cfg)).not.toThrow(); r.driver.start();
    await vi.waitFor(() => expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(true));
    expect(request.mock.calls[0][1]).toMatchObject({ provider: decisionProvider });
    expect(r.fetchImpl).not.toHaveBeenCalled();
  });
  it('an explicit host choice ignores a retained legacy URL and never uses it on host failure', async () => {
    const request = vi.fn(async () => { throw new Error('host-unavailable'); });
    const r = rig(true, vi.fn(), { request }); r.cfg.hostDecisions!.combat!.connection = 'host';
    r.cfg.hostDecisions!.combat!.apiKeyEnv = 'unused legacy value'; r.driver.start();
    await vi.waitFor(() => expect(r.report.mock.calls.some(([event]) => event === 'fallback')).toBe(true));
    expect(r.fetchImpl).not.toHaveBeenCalled();
    expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(false);
  });
  it('discards an in-flight host result after the override changes', async () => {
    let finish!: (result: any) => void;
    const request = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
    const r = rig(true, vi.fn(), { request });
    r.cfg.hostDecisions!.combat!.connection = 'host'; r.cfg.hostDecisions!.combat!.decisionProvider = 'One'; r.driver.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    r.cfg.hostDecisions!.combat!.decisionProvider = 'Two'; finish(JSON.parse(await response().text()));
    await vi.waitFor(() => expect(r.driver.inspect()).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'configuration-changed' })])));
    expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(false);
  });
  it('does not sample or contact any endpoint when disabled', async () => {
    const r = rig(false); r.driver.start(); await Promise.resolve();
    expect(r.call).not.toHaveBeenCalled(); expect(r.fetchImpl).not.toHaveBeenCalled();
  });
  it('uses the configured model and independently rechecks fresh facts before sending a choice', async () => {
    const r = rig(); r.driver.start();
    await vi.waitFor(() => expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(true));
    expect(r.call.mock.calls.filter(([args]) => args.battlefield).length).toBeGreaterThanOrEqual(2);
    const init = (r.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(init.body).model).toBe('jev-test');
    expect(r.driver.inspect()).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'sent' })]));
  });
  it.each(['timeout', 'invalid', 'transport'])('retains game-rule fallback on %s without contacting other endpoints', async failure => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => {
      if (failure === 'transport') throw new Error('offline');
      if (failure === 'timeout') return new Promise<Response>(() => {});
      return new Response('{}');
    });
    const r = rig(true, fetchImpl); r.driver.start(); await vi.advanceTimersByTimeAsync(110);
    expect(r.report.mock.calls.some(([event]) => event === 'fallback')).toBe(true);
    expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://explicit.invalid/v1/systemone');
  });
  it('cancels in-flight work and refuses late results after stop', async () => {
    vi.useFakeTimers(); let finish!: (r: Response) => void;
    const r = rig(true, vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    r.driver.start(); await vi.advanceTimersByTimeAsync(1); r.driver.stop(); finish(response());
    await vi.advanceTimersByTimeAsync(10000);
    expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(false);
    expect(r.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('discards decisions after the game connection changes', async () => {
    let finish!: (r: Response) => void;
    const r = rig(true, vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    r.driver.start(); await vi.waitFor(() => expect(r.fetchImpl).toHaveBeenCalledOnce());
    const next = frame(); next.battlefield.connectionGeneration = 2; r.setFrame(next); finish(response());
    await vi.waitFor(() => expect(r.driver.inspect()).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'scene-changed' })])));
    expect(r.call.mock.calls.some(([args]) => !!args.choice)).toBe(false);
  });
});
