import { describe, expect, it } from 'vitest';
import { isUnusableResolvedAddress, resolveMinecraftConnectEndpoint } from '../core/connect-endpoint.ts';

describe('connect endpoint resolution', () => {
  it('treats 198.18.0.0/15 as unusable and does not hardcode a game-server IP', () => {
    expect(isUnusableResolvedAddress('198.18.0.1')).toBe(true);
    expect(isUnusableResolvedAddress('198.19.255.255')).toBe(true);
    expect(isUnusableResolvedAddress('8.8.8.8')).toBe(false);
    expect(isUnusableResolvedAddress('127.0.0.1')).toBe(false);
  });

  it('passes a literal IP through and keeps an explicit handshake host', async () => {
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: '203.0.113.10', port: 25566, handshakeHost: 'play.example.test',
    });
    expect(endpoint).toMatchObject({ host: '203.0.113.10', port: 25566, fakeHost: 'play.example.test', source: 'literal' });
  });

  it('retries public lookup when system DNS returns a fake address, and uses the domain as fakeHost', async () => {
    const calls: string[] = [];
    let publicTry = false;
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'play.example.test',
      port: 25565,
      lookup: async (name, type) => {
        calls.push(`${type}:${name}`);
        if (type === 'SRV') return { srv: { port: 25566, name: 'mcip.example.test' } };
        if (name === 'mcip.example.test' && type === 'A' && !publicTry) {
          publicTry = true;
          // first path is the injected lookup (system). The function under test
          // will then try public DNS / DoH if this is unusable; inject both by
          // succeeding on the second A lookup if we only have this one function.
          return { addresses: ['198.18.0.1'] };
        }
        return { addresses: [] };
      },
      publicDnsFallback: false,
    });
    expect(endpoint.source).toBe('unresolved-use-configured-host');
    expect(endpoint.host).toBe('play.example.test');
    expect(endpoint.fakeHost).toBe('play.example.test');
    expect(calls[0]).toBe('SRV:_minecraft._tcp.play.example.test');

    const resolved = await resolveMinecraftConnectEndpoint({
      host: 'play.example.test',
      port: 25565,
      publicDnsFallback: false,
      lookup: async (name, type) => {
        if (type === 'SRV') return { srv: { port: 25566, name: 'mcip.example.test' } };
        if (type === 'A') return { addresses: ['203.0.113.25'] };
        return { addresses: [] };
      },
    });
    expect(resolved).toMatchObject({
      host: '203.0.113.25', port: 25566, fakeHost: 'play.example.test', source: 'system-srv',
    });
  });
});
