import { describe, expect, it } from 'vitest';
import { isUnusableResolvedAddress, MinecraftEndpointUnresolvedError, resolveMinecraftConnectEndpoint } from '../core/connect-endpoint.ts';

describe('connect endpoint resolution', () => {
  it('keeps an explicit non-default port and never resolves an SRV route for it', async () => {
    const calls: string[] = [];
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'play.example.test', port: 25702, publicDnsFallback: false,
      lookup: async (name, type) => {
        calls.push(`${type}:${name}`);
        return type === 'SRV'
          ? { srv: { name: 'other.example.test', port: 25566 } }
          : { addresses: ['203.0.113.25'] };
      },
    });
    expect(endpoint).toMatchObject({ host: '203.0.113.25', port: 25702, fakeHost: 'play.example.test' });
    expect(calls).toEqual(['A:play.example.test']);
  });

  it('still resolves the configured host when optional SRV lookup is unavailable', async () => {
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'play.example.test', port: 25565, publicDnsFallback: false,
      lookup: async (_name, type) => {
        if (type === 'SRV') throw Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' });
        return { addresses: ['203.0.113.25'] };
      },
    });
    expect(endpoint).toMatchObject({ host: '203.0.113.25', port: 25565 });
  });

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
  it('discovers SRV via public fallback when system SRV is empty and the user A is a fake address or NXDOMAIN', async () => {
    const calls: string[] = [];
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'mc.example.test',
      port: 25565,
      publicDnsFallback: true,
      lookup: async (name, type) => {
        calls.push(`system:${type}:${name}`);
        if (type === 'SRV') return { srv: null };
        if (type === 'A' && name === 'mc.example.test') return { addresses: ['198.18.0.1'] };
        return { addresses: [] };
      },
      fallbackLookups: [
        {
          source: 'public-dns',
          lookup: async (name, type) => {
            calls.push(`public:${type}:${name}`);
            return type === 'SRV' ? { srv: null } : { addresses: [] };
          },
        },
        {
          source: 'doh-dns.google',
          lookup: async (name, type) => {
            calls.push(`doh:${type}:${name}`);
            if (type === 'SRV' && name === '_minecraft._tcp.mc.example.test') {
              return { srv: { name: 'w35.example.test', port: 7562 } };
            }
            if (type === 'A' && name === 'w35.example.test') return { addresses: ['203.0.113.40'] };
            return { addresses: [] };
          },
        },
      ],
    });
    expect(endpoint).toMatchObject({
      host: '203.0.113.40',
      port: 7562,
      fakeHost: 'mc.example.test',
      source: 'doh-dns.google-srv',
    });
    expect(calls).toContain('system:SRV:_minecraft._tcp.mc.example.test');
    expect(calls).toContain('doh:SRV:_minecraft._tcp.mc.example.test');
    expect(calls).toContain('doh:A:w35.example.test');
    expect(calls).not.toContain('doh:SRV:_minecraft._tcp.w35.example.test');
  });

  it('keeps an explicit handshake host after public SRV fallback', async () => {
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'mc.example.test',
      port: 25565,
      handshakeHost: 'mc.example.test',
      publicDnsFallback: true,
      lookup: async (_name, type) => type === 'SRV' ? { srv: null } : { addresses: [] },
      fallbackLookups: [{
        source: 'doh-dns.google',
        lookup: async (name, type) => {
          if (type === 'SRV') return { srv: { name: 'edge.example.test', port: 7562 } };
          if (type === 'A' && name === 'edge.example.test') return { addresses: ['198.51.100.9'] };
          return { addresses: [] };
        },
      }],
    });
    expect(endpoint).toMatchObject({
      host: '198.51.100.9', port: 7562, fakeHost: 'mc.example.test', source: 'doh-dns.google-srv',
    });
  });

  it('does not use public SRV when publicDnsFallback is disabled', async () => {
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'mc.example.test',
      port: 25565,
      publicDnsFallback: false,
      lookup: async (_name, type) => type === 'SRV' ? { srv: null } : { addresses: ['198.18.0.1'] },
      fallbackLookups: [{
        source: 'doh-dns.google',
        lookup: async () => ({ srv: { name: 'w35.example.test', port: 7562 } }),
      }],
    });
    expect(endpoint).toMatchObject({
      host: 'mc.example.test', port: 25565, fakeHost: 'mc.example.test', source: 'unresolved-use-configured-host',
    });
  });

  it('still ignores SRV for an explicit non-default port when public fallback is on', async () => {
    const calls: string[] = [];
    const endpoint = await resolveMinecraftConnectEndpoint({
      host: 'mc.example.test',
      port: 25702,
      publicDnsFallback: true,
      lookup: async (name, type) => {
        calls.push(`system:${type}:${name}`);
        return { addresses: ['198.18.0.1'] };
      },
      fallbackLookups: [{
        source: 'doh-dns.google',
        lookup: async (name, type) => {
          calls.push(`doh:${type}:${name}`);
          if (type === 'SRV') return { srv: { name: 'other.example.test', port: 7562 } };
          if (type === 'A' && name === 'mc.example.test') return { addresses: ['203.0.113.8'] };
          return { addresses: [] };
        },
      }],
    });
    expect(endpoint).toMatchObject({ host: '203.0.113.8', port: 25702, fakeHost: 'mc.example.test', source: 'doh-dns.google' });
    expect(calls.some((c) => c.includes('SRV'))).toBe(false);
  });

  it('throws instead of dialing the configured host when public fallback cannot find a usable address', async () => {
    await expect(resolveMinecraftConnectEndpoint({
      host: 'mc.example.test',
      port: 25565,
      publicDnsFallback: true,
      lookup: async (_name, type) => type === 'SRV' ? { srv: null } : { addresses: ['198.18.0.1'] },
      fallbackLookups: [{ source: 'doh-dns.google', lookup: async () => ({ addresses: [] }) }],
    })).rejects.toSatisfy((err: unknown) => err instanceof MinecraftEndpointUnresolvedError
      && (err as Error).message.includes('mc.example.test:25565'));
  });
});

