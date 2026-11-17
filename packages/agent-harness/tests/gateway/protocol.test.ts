import { describe, expect, it } from 'vitest';
import { AgentRegistry, GatewayError, hashToken, loadAgentConfigs, parseRequest, requestIdOf, TokenBucket } from '../../src/index.ts';

const msg = (o: Record<string, unknown>) => JSON.stringify({ v: 1, id: 'r1', ...o });
const code = (raw: string) => { try { parseRequest(raw); return 'ok'; } catch (e) { return (e as GatewayError).code; } };

describe('gateway protocol validation', () => {
  it('accepts well-formed requests and normalises payloads', () => {
    const r = parseRequest(msg({ type: 'submit_intent', agent: 'neko', payload: { goal: '钓鱼', priority: 'high',
      constraints: { steps: [{ tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }], deadlineMs: 60000 } } }));
    expect(r).toMatchObject({ v: 1, id: 'r1', type: 'submit_intent', agent: 'neko', payload: { goal: '钓鱼', priority: 'high' } });
    expect(parseRequest(msg({ type: 'ping' })).payload).toEqual({ nonce: undefined });
    expect(parseRequest(msg({ type: 'subscribe', payload: { minSeverity: 2, kinds: ['death', 'death'], after: 5 } })).payload)
      .toMatchObject({ minSeverity: 2, kinds: ['death'], after: 5 });
  });

  it('rejects malformed envelopes with precise codes', () => {
    expect(code('not json')).toBe('bad_request');
    expect(code('[]')).toBe('bad_request');
    expect(code(JSON.stringify({ id: 'x', type: 'ping' }))).toBe('bad_request');            // missing v
    expect(code(JSON.stringify({ v: 2, id: 'x', type: 'ping' }))).toBe('unsupported_version');
    expect(code(msg({ type: 'teleport' }))).toBe('unknown_type');
    expect(code(JSON.stringify({ v: 1, id: 'bad id!', type: 'ping' }))).toBe('bad_request');
    expect(code(msg({ type: 'ping', extra: 1 }))).toBe('bad_request');
    expect(code(msg({ type: 'ping', payload: [] }))).toBe('bad_request');
    expect(code(msg({ type: 'submit_intent', payload: {} }))).toBe('bad_request');
    expect(code(msg({ type: 'submit_intent', payload: { goal: 'x', priority: 101 } }))).toBe('bad_request');
    expect(code(msg({ type: 'submit_intent', payload: { goal: 'x', owner: 'admin' } }))).toBe('bad_request');   // owner is never client-set
    expect(code(msg({ type: 'submit_intent', payload: { goal: 'x', constraints: { steps: [] } } }))).toBe('bad_request');
    expect(code(msg({ type: 'submit_intent', payload: { goal: 'x', constraints: { steps: [{ tool: 'mc_do', args: [] }] } } }))).toBe('bad_request');
    expect(code(msg({ type: 'update_intent', payload: { intentId: 'int_1' } }))).toBe('bad_request');
    expect(code(msg({ type: 'control', payload: { action: 'cancel' } }))).toBe('bad_request');
    expect(code(msg({ type: 'control', payload: { action: 'explode', intentId: 'a' } }))).toBe('bad_request');
    expect(code(msg({ type: 'get_summary', payload: { maxTokens: 5000 } }))).toBe('bad_request');
    expect(code(msg({ type: 'pull_events', payload: { kinds: ['nope'] } }))).toBe('bad_request');
    expect(requestIdOf(msg({ type: 'teleport' }))).toBe('r1');
    expect(requestIdOf('garbage')).toBeUndefined();
  });

  it('agent registry: env-name or sha256 tokens only, constant-time digest match, no plaintext config', () => {
    const t1 = 'tok-neko-0123456789abcdef', t2 = 'tok-dsh-0123456789abcdef';
    const reg = new AgentRegistry([{ id: 'neko', tokenEnv: 'NEKO_TOKEN' }, { id: 'dsh', tokenSha256: hashToken(t2), admin: true }], { env: { NEKO_TOKEN: t1 } });
    expect(reg.authenticate(t1)?.id).toBe('neko');
    expect(reg.authenticate(t2)).toMatchObject({ id: 'dsh', admin: true, maxPriority: 100 });
    expect(reg.authenticate('wrong-token-xxxxxxxxxx')).toBeNull();
    expect(reg.authenticate(undefined)).toBeNull();
    expect(reg.anonymous).toBeNull();
    const err = (() => { try { new AgentRegistry([{ id: 'a', tokenEnv: 'SHORT' }], { env: { SHORT: 'secret-short' } }); } catch (e) { return String(e); } })();
    expect(err).toMatch(/SHORT is unset or shorter/);
    expect(err).not.toContain('secret-short');
    expect(() => loadAgentConfigs({ AGENT_HARNESS_GATEWAY_AGENTS: JSON.stringify({ agents: [{ id: 'a', token: 'plain' }] }) })).toThrow(/plaintext/);
    expect(new AgentRegistry([], { allowAnonymous: true }).authenticate(null)).toMatchObject({ id: 'anonymous', admin: false });
  });

  it('token bucket refills over time', () => {
    let t = 0; const b = new TokenBucket(60, 2, () => t);
    expect(b.take().ok).toBe(true); expect(b.take().ok).toBe(true);
    const r = b.take(); expect(r.ok).toBe(false); expect((r as { retryAfterMs: number }).retryAfterMs).toBe(1000);
    t = 1000; expect(b.take().ok).toBe(true);
  });
});
