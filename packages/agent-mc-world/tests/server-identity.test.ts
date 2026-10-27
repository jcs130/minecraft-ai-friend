import { describe, expect, it } from 'vitest';
import { AGENT_IDENTITY_CHANNEL, advertiseAgentIdentity } from '../core/server-identity.ts';

describe('optional server Agent identity', () => {
  it('registers before declaring the current controller and real reconnect capability', () => {
    const writes: { name: string; params: any }[] = [];
    expect(advertiseAgentIdentity({ write: (name, params) => writes.push({ name, params }) }, true)).toBe(true);
    expect(writes.map(x => x.name)).toEqual(['custom_payload', 'custom_payload']);
    expect(writes[0].params.channel).toBe('minecraft:register');
    expect(writes[0].params.data.toString()).toBe(AGENT_IDENTITY_CHANNEL);
    expect(writes[1].params.channel).toBe(AGENT_IDENTITY_CHANNEL);
    expect(JSON.parse(writes[1].params.data)).toEqual({ op: 'identity', protocol: 1, control: 'agent', reconnect: true });
    expect(writes[1].params.data.toString()).not.toMatch(/password|token|key|username|uuid/i);
  });
  it('does not claim reconnect capability for a closing controller', () => {
    let frame: any;
    advertiseAgentIdentity({ write: (_, p) => { frame = p; } }, false);
    expect(JSON.parse(frame.data).reconnect).toBe(false);
  });
  it('does not fail a connection when the optional transport is unavailable', () => {
    expect(advertiseAgentIdentity({ write: () => { throw new Error('closed'); } }, true)).toBe(false);
  });
});
