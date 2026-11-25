import { describe, it, expect } from 'vitest';
import { resolveMinecraftConnectCandidates } from '../core/connect-endpoint.ts';

describe('resolveMinecraftConnectCandidates (local TIG adaptation)', () => {
  const fake = async () => ({ addresses: ['198.18.0.1'] });
  it('orders pinned, then de-duplicated DoH answers, skipping fake addresses', async () => {
    const r = await resolveMinecraftConnectCandidates({
      host: 'play.example.test', port: 42539, publicDnsFallback: true, lookup: fake,
      pinnedAddresses: ['203.0.113.5'],
      fallbackLookups: [
        { source: 'public-dns', lookup: fake },
        { source: 'doh-a', lookup: async (_n, t) => (t === 'A' ? { addresses: ['192.0.2.7'] } : { addresses: [] }) },
        { source: 'doh-b', lookup: async (_n, t) => (t === 'A' ? { addresses: ['192.0.2.7', '192.0.2.9'] } : { addresses: [] }) },
      ],
    });
    expect(r.fakeHost).toBe('play.example.test');
    expect(r.candidates.map(c => `${c.host}:${c.port}:${c.source}`)).toEqual([
      '203.0.113.5:42539:pinned', '192.0.2.7:42539:doh-a', '192.0.2.9:42539:doh-b',
    ]);
  });
  it('throws when nothing usable resolves', async () => {
    await expect(resolveMinecraftConnectCandidates({ host: 'x.example.test', port: 1, lookup: fake,
      fallbackLookups: [{ source: 'p', lookup: fake }] })).rejects.toThrow();
  });
});
