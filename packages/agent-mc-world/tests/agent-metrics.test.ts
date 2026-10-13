import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentMetrics, serveAgentMetrics } from '../src/client/metrics.ts';

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-metrics-')); directories.push(dir);
  let time = 1_700_000_000_000;
  const metrics = new AgentMetrics('test-run', dir, handle => handle === `log:${'a'.repeat(64)}`, () => time);
  return { dir, metrics, tick: (ms: number) => { time += ms; } };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('host-independent execution observability', () => {
  it('separates concurrent requests, preserves missing usage and measures tool returns only', () => {
    const { metrics, tick } = fixture();
    metrics.report({ kind: 'model', id: 's2-1', phase: 'start', role: 'system2', model: 'test' });
    metrics.report({ kind: 'model', id: 's1-1', phase: 'start', role: 'system1', model: 'fast' });
    metrics.toolStarted('call1', 'mymc_do'); tick(50); metrics.toolEnded('call1', false);
    metrics.report({ kind: 'model', id: 's1-1', phase: 'finish', role: 'system1', model: 'fast', outcome: 'success',
      inputTokens: 100, cachedTokens: 90, elapsedMs: 50 });
    let state = metrics.snapshot('started');
    expect(state.tools).toMatchObject({ calls: 1, returned: 1, errors: 0, elapsedMs: { p50: 50 } });
    expect(state.models[0]).toMatchObject({ active: 0, inputTokens: { total: 100, samples: 1 }, cacheRatio: .9, outputTokens: { total: null } });
    expect(state.models[1]).toMatchObject({ active: 1, completed: 0, inputTokens: { total: null } });
    metrics.report({ kind: 'model', id: 's2-1', phase: 'finish', role: 'system2', model: 'test', outcome: 'failed' });
    expect(() => metrics.report({ kind: 'model', id: 's2-1', phase: 'finish', role: 'system2', model: 'test' })).toThrow('terminal');
    expect(() => metrics.report({ kind: 'model', id: 's1-1', phase: 'start', role: 'system2', model: 'other' })).toThrow('another model');
    state = metrics.snapshot('started');
    expect(state.models[1]).toMatchObject({ failed: 1, completed: 1, elapsedMs: { samples: 0, p50: null } });
    expect(state.learning.environmentVerifiedImprovement).toBeNull();
    tick(601000);
    expect(metrics.snapshot('disconnected').models.every(model => model.calls === 0)).toBe(true);
  });

  it('records attributed version/evidence links without manufacturing verified experience', () => {
    const { metrics, dir } = fixture();
    const method = { kind: 'method', id: 'm1', method: 'place-supported', author: 'AgentA',
      sourceHash: 'b'.repeat(64), artifact: `log:${'a'.repeat(64)}`, stage: 'evaluated', outcome: 'success' };
    metrics.report(method);
    expect(metrics.snapshot('started').learning).toMatchObject({ reportedEvents: 1, source: 'host-reported',
      environmentVerifiedImprovement: null, latest: [expect.objectContaining({ author: 'AgentA', outcome: 'success' })] });
    expect(readFileSync(join(dir, 'traces-test-run.jsonl'), 'utf8')).toContain('host-reported');
    expect(() => metrics.report({ ...method, id: 'm2', receipt: `log:${'c'.repeat(64)}` })).toThrow('unavailable');
    expect(() => metrics.report({ ...method, id: 'm2', prompt: 'must-not-be-stored' })).toThrow('declared fields');
    expect(() => metrics.report({ kind: 'model', id: 'bad', role: 'system2', model: 'test', phase: 'finish', inputTokens: 1, cachedTokens: 2 })).toThrow('exceeds');
    expect(readFileSync(join(dir, 'traces-test-run.jsonl'), 'utf8')).not.toContain('must-not-be-stored');
  });

  it('keeps long running calls visible while expiring terminal measurements by their end time', () => {
    const { metrics, tick } = fixture();
    metrics.toolStarted('slow-call', 'mymc_script');
    metrics.report({ kind: 'model', id: 'slow-model', phase: 'start', role: 'system2', model: 'test' });
    tick(601000);
    expect(metrics.snapshot('started').tools).toMatchObject({ calls: 0, active: 1, returned: 0 });
    expect(metrics.snapshot('started').models[1]).toMatchObject({ calls: 0, active: 1 });
    metrics.toolEnded('slow-call', true);
    expect(metrics.snapshot('started').tools).toMatchObject({ active: 0, returned: 1, elapsedMs: { p50: 601000 } });
  });

  it('serves loopback-only read transport without exposing control operations or permissive CORS', async () => {
    const { metrics } = fixture();
    const monitor = await serveAgentMetrics(0, () => metrics.snapshot('disconnected'));
    try {
      const response = await fetch(monitor.url);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.json()).toMatchObject({ schema: 'agent-harness-metrics-v1', phase: 'disconnected' });
      expect((await fetch(monitor.url, { method: 'POST' })).status).toBe(405);
      expect((await fetch(monitor.url, { headers: { origin: 'http://untrusted.test' } })).status).toBe(403);
      expect((await fetch(monitor.url.replace('/metrics', '/connect'))).status).toBe(404);
    } finally { await monitor.close(); }
  });
});
