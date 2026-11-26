import { describe, expect, it } from 'vitest';
import { applyServerProfile, mountServerProfile, type MinecraftServerProfile } from '../core/server-profiles.ts';
import { queryMinecraftKnowledge } from '../core/knowledge.ts';
import type { MinecraftKnowledgeConfig } from '../core/reference-index.ts';

const guide = (id: string) => ({ profile: id, title: id, revision: '1', entries: [
  { id: 'travel', title: 'Travel', summary: 'Menu', text: 'Travel for ' + id, reference: 'Page 1' },
] });
const section = {
  knowledge: { server: guide('legacy'), minedojo: { indexFile: 'shared.db' } } as MinecraftKnowledgeConfig,
  escapeCommand: '/legacy',
  servers: {
    alpha: { host: 'alpha.invalid', guide: guide('alpha'), escapeCommand: '/return' },
    beta: { host: 'beta.invalid', guide: guide('beta') }, third: { host: 'third.invalid' },
  } as Record<string, MinecraftServerProfile>,
};
describe('server references on the shared knowledge tool', () => {
  it.each(['alpha', 'beta', 'third'])('isolates a named profile %s while retaining shared sources', async server => {
    const cfg = applyServerProfile({ ...section, server }, {});
    expect(cfg.knowledge.minedojo).toEqual(section.knowledge.minedojo);
    expect(cfg.escapeCommand).toBe(server === 'alpha' ? '/return' : '');
    const query = (args: Record<string, unknown>, scope = cfg.activeServer) =>
      queryMinecraftKnowledge(args, '1.21.1', cfg.knowledge, undefined, scope);
    expect(await query({ source: 'server', action: 'get', id: 'travel' })).toMatchObject(server === 'third'
      ? { status: 'unavailable' } : { currentWorldVerified: false, profile: server, entry: { text: 'Travel for ' + server } });
    expect(await query({ source: 'server' }, 'other')).toMatchObject({ status: 'unavailable' });
    const catalog = await query({ action: 'sources' });
    expect(JSON.stringify(catalog)).not.toContain('legacy');
    expect((catalog.sources as {id:string}[]).some(s => s.id === 'server')).toBe(server !== 'third');
  });
  it('pins a mounted connection while independent host controls stay live', () => {
    const input = { ...section, server:'alpha', uiEnabled:true };
    const mounted = mountServerProfile(input);
    input.server = 'beta';
    input.uiEnabled = false;
    expect(mounted).toMatchObject({ activeServer:'alpha', server:'alpha', escapeCommand:'/return',
      knowledge:{server:{profile:'alpha'}}, uiEnabled:false });
    expect(mounted.servers).toBeUndefined();
    expect(mountServerProfile(mounted)).toBe(mounted);
    expect(mountServerProfile(input).activeServer).toBe('beta');
  });
  it('rejects foreign guide and invalid selector at configuration time', () => {
    expect(() => applyServerProfile({ server: 'beta', servers: { beta: { host:'x', guide: guide('alpha') } } }, {})).toThrow(/guide/);
    expect(() => applyServerProfile({ ...section, server:'toString' }, {})).toThrow(/Unknown/);
  });
});
