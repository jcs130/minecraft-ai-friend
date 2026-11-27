import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadMinecraftClientConfig } from '../src/client/config-file.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { queryMinecraftKnowledge } from '../core/knowledge.ts';
import { describe, expect, it } from 'vitest';
import {
  applyServerProfile, describeServerProfiles, insideProtectedCircle, installServerChatPolicy,
  selectedServerId, validateServerProfile, type MinecraftServerProfile,
} from '../core/server-profiles.ts';
import { MINECRAFT_CONFIG_GROUP } from '../core/config.ts';

const base = {
  host: 'legacy.example.test', port: 25565, version: 'auto', username: 'ag_old', loginConfigFile: '',
  miningLimits: { hardStopOnWarning: false, warningKeywords: ['外挂'] },
  servers: {
    a: { host: 'a.example.test', port: 1234, version: '1.21.11', username: 'ag_a', connectAddresses: ['203.0.113.5'],
      safety: { publicChat: true, warningKeywords: ['请停止'] } },
    b: { host: 'b.example.test', version: '26.2', username: 'ag_b', selectable: false },
    c: { host: 'c.example.test', username: 'corti', account: { avoidNames: ['Corti'] } },
  } as Record<string, MinecraftServerProfile>,
};

describe('server profiles', () => {
  it('leaves a section without profiles untouched', () => {
    const plain = { host: 'x', port: 1 };
    expect(applyServerProfile(plain, {})).toBe(plain);
  });

  it('keeps guides and escape commands within the selected profile', async () => {
    const guide = {
      profile: 'survival', title: 'Survival guide', revision: '8',
      entries: [{ id: 'market', title: '市场', summary: '菜单与交易', text: 'Open /cd for the shop.', reference: 'page 8' }],
    };
    const cfg = { ...base, server: 'survival', escapeCommand: '/legacy exit',
      knowledge: { server: { ...guide, profile: 'legacy' }, minedojo: { indexFile: '' } },
      servers: {
        survival: { host: 'survival.example.test', guide },
        adventure: { host: 'adventure.example.test', escapeCommand: '/adventure exit',
          guide: { ...guide, profile: 'adventure', entries: [{ ...guide.entries[0], id: 'gates' }] } },
        vanilla: { host: 'vanilla.example.test' },
      },
    };
    const survival = applyServerProfile(cfg, {});
    const adventure = applyServerProfile(survival, { AGENT_MC_SERVER: 'adventure' });
    const vanilla = applyServerProfile(adventure, { AGENT_MC_SERVER: 'vanilla' });
    expect([survival.escapeCommand, adventure.escapeCommand, vanilla.escapeCommand]).toEqual(['', '/adventure exit', '']);
    expect(vanilla.knowledge).toEqual({ minedojo: cfg.knowledge.minedojo });
    expect(cfg.knowledge.server.profile).toBe('legacy');
    for (const [profile, id] of [[survival, 'market'], [adventure, 'gates']] as const) {
      const data = await queryMinecraftKnowledge({ source: 'server', action: 'search', query: '交易' }, profile.version, profile.knowledge, undefined, profile.activeServer);
      expect(data).toMatchObject({ profile: profile.activeServer, entries: [{ id, reference: 'page 8' }], currentWorldVerified: false });
      expect(JSON.stringify(data)).not.toContain('Open /cd');
    }
    const get = { source: 'server', id: 'market' };
    await expect(queryMinecraftKnowledge(get, survival.version, survival.knowledge, undefined, survival.activeServer)).resolves
      .toMatchObject({ entry: { id: 'market', text: 'Open /cd for the shop.' } });
    await expect(queryMinecraftKnowledge(get, adventure.version, adventure.knowledge, undefined, adventure.activeServer)).rejects.toThrow('not found');
    await expect(queryMinecraftKnowledge(get, survival.version, survival.knowledge, undefined, vanilla.activeServer)).resolves.toMatchObject({ status: 'unavailable' });
    await expect(queryMinecraftKnowledge({ ...get, profile: 'adventure' }, survival.version, survival.knowledge, undefined, survival.activeServer)).rejects.toThrow('Invalid');
    expect(validateServerProfile('adventure', { host: 'test.invalid', guide })).toEqual([expect.stringContaining('different server profile')]);
  });

  it('overlays the selected profile and merges warning rules', () => {
    const cfg = applyServerProfile({ ...base, server: 'a' }, {});
    expect(cfg).toMatchObject({ host: 'a.example.test', port: 1234, version: '1.21.11', username: 'ag_a', activeServer: 'a' });
    expect(cfg.connectAddresses).toEqual(['203.0.113.5']);
    expect(cfg.serverSafety?.publicChat).toBe(true);
    expect(cfg.miningLimits).toEqual({ hardStopOnWarning: true, warningKeywords: ['外挂', '请停止'] });
    expect(base.host).toBe('legacy.example.test');
  });

  it('never inherits another server\'s pinned address, SNI host, port or version', () => {
    const section = { ...base, fakeHost: 'legacy.example.test', connectAddresses: ['198.51.100.7'], port: 42539, version: '1.21.11',
      dohResolvers: ['https://doh.example.test/resolve'], viewerAssetsDir: '/assets' };
    const two = applyServerProfile({ ...section, servers: { ...section.servers, c2: { host: 'c2.example.test' } } }, { AGENT_MC_SERVER: 'c2' }) as Record<string, unknown>;
    expect(two).toMatchObject({ host: 'c2.example.test', port: 25565, version: 'auto', username: 'ag_old', viewerAssetsDir: '/assets' });
    expect(two.dohResolvers).toEqual(['https://doh.example.test/resolve']);
    expect('fakeHost' in two).toBe(false);
    expect('connectAddresses' in two).toBe(false);
  });

  it('AGENT_MC_SERVER wins over the file, unknown / config-only / invalid profiles refuse', () => {
    expect(selectedServerId({ ...base, server: 'b' }, { AGENT_MC_SERVER: 'a' })).toBe('a');
    expect(() => applyServerProfile({ ...base, server: 'zz' }, {})).toThrow(/Unknown Minecraft server profile "zz"/);
    expect(() => applyServerProfile({ ...base, server: 'b' }, {})).toThrow(/config-only/);
    expect(() => applyServerProfile({ ...base, server: 'c' }, {})).toThrow(/reserved/);
  });

  it('rejects explicit selection without a registry and validates inherited account rules', () => {
    expect(() => applyServerProfile({ host: 'legacy', server: 'missing', servers: {} }, {})).toThrow('Unknown Minecraft server profile');
    expect(() => applyServerProfile({ host: 'legacy' }, { AGENT_MC_SERVER: 'missing' })).toThrow('Unknown Minecraft server profile');
    const servers = { selected: { host: 'fixture.invalid', account: { usernamePrefix: 'ag_', avoidNames: ['ag_admin'] } } };
    expect(() => applyServerProfile({ server: 'selected', username: 'Player', servers }, {})).toThrow('username must start');
    expect(() => applyServerProfile({ server: 'selected', username: 'ag_admin', servers }, {})).toThrow('reserved');
    expect(describeServerProfiles({ username: 'ag_admin', servers }, {})[0].errors).toContainEqual(expect.stringContaining('reserved'));
  });

  it('loads named SDK profiles before readiness validation and resolves their private paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc-server-profile-')), file = join(directory, 'config.json');
    try {
      const world = { server: 'selected', loginConfirmation: 'mc-auth-success', servers: {
        selected: { host: 'fixture.invalid', port: 25577, version: '1.21.11', username: 'ag_fixture',
          loginConfigFile: './private/login.json', viewerAssetsDir: './private/viewer' },
        strict: { host: 'strict.invalid', version: '1.21.1', username: 'ag_fixture', loginConfirmation: 'mc-auth-success' },
      } };
      writeFileSync(file, JSON.stringify({ dataDir: './data', world }));
      const loaded = loadMinecraftClientConfig(file);
      expect(loaded.cfg).toMatchObject({ host: 'fixture.invalid', port: 25577, activeServer: 'selected', loginConfirmation: 'plugin',
        loginConfigFile: resolve(directory, 'private/login.json'), viewerAssetsDir: resolve(directory, 'private/viewer') });
      expect(applyServerProfile(loaded.cfg, { AGENT_MC_SERVER: 'strict' }).loginConfirmation).toBe('mc-auth-success');
      expect(world.servers.selected.loginConfigFile).toBe('./private/login.json');
      writeFileSync(file, JSON.stringify({ dataDir: './data', world: { ...world, server: 'unknown' } }));
      expect(() => loadMinecraftClientConfig(file)).toThrow('Unknown Minecraft server profile');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('accepts programmatic SDK selection before a disconnected fixture is started', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc-profile-sdk-'));
    let starts = 0;
    const fixture = { id: 'minecraft', tools: () => [], envPromptVars: () => null,
      start: async () => { starts++; }, stop: async () => {} };
    const runtime = new MinecraftAgentClient({ dataDir: directory, log: nullLogger(), cfg: {
      ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), server: 'tig', servers: {
        tig: { host: 'fixture.invalid', username: 'ag_fixture', version: '1.21.11' },
      },
    } }, fixture);
    try {
      await runtime.connect();
      expect(starts).toBe(1);
      expect(runtime.status().phase).toBe('started');
    } finally { await runtime.disconnect(); rmSync(directory, { recursive: true, force: true }); }
  });

  it('rejects inline secrets and bad account names', () => {
    expect(validateServerProfile('x', { host: 'h', password: 'nope' } as unknown as MinecraftServerProfile)).toEqual([expect.stringMatching(/"password" is not allowed/)]);
    expect(validateServerProfile('x', { host: 'h', username: 'ag_this_name_is_long' })[0]).toMatch(/longer than 16/);
    expect(validateServerProfile('x', { host: 'h', username: 'bob', account: { usernamePrefix: 'ag_' } })[0]).toMatch(/start with ag_/);
    expect(validateServerProfile('x', { host: '' })[0]).toMatch(/host is required/);
  });

  it('lists profiles without secrets', () => {
    const list = describeServerProfiles({ ...base, server: 'a' }, {});
    expect(list.map((p) => [p.id, p.active, p.selectable])).toEqual([['a', true, true], ['b', false, false], ['c', false, true]]);
    expect(JSON.stringify(list)).not.toMatch(/loginConfig|credential/);
  });

  it('the shipped example validates and the config group offers the switch', () => {
    const example = JSON.parse(readFileSync(new URL('../examples/minecraft-servers.json', import.meta.url), 'utf8'));
    for (const p of describeServerProfiles(example.world, {})) expect(p.errors).toEqual([]);
    expect(applyServerProfile(example.world, {}).host).toBe('survival.example.test');
    expect(MINECRAFT_CONFIG_GROUP.schema.properties['worlds.minecraft.server']).toMatchObject({ type: 'string', 'x-hot': false });
  });

  it('protected circles honour the optional world key', () => {
    const rules = { protectedCircles: [{ name: 'spawn', x: 160, z: 1, r: 40 }, { name: 'nether hub', x: 0, z: 0, r: 10, world: 'minecraft:the_nether' }] };
    expect(insideProtectedCircle(rules, 170, 10)).toBe('spawn');
    expect(insideProtectedCircle(rules, 300, 0)).toBeNull();
    expect(insideProtectedCircle(rules, 1, 1, 'minecraft:world')).toBeNull();
    expect(insideProtectedCircle(rules, 1, 1, 'minecraft:the_nether')).toBe('nether hub');
  });
});

describe('server chat policy', () => {
  function bot(rules: Parameters<typeof installServerChatPolicy>[1]) {
    const sent: string[] = [];
    let t = 100_000;
    const b = { chat: (m: string) => { sent.push(m); } };
    installServerChatPolicy(b, rules, () => t);
    return { b, sent, advance: (ms: number) => { t += ms; } };
  }

  it('paces public chat, drops duplicates and long lines', () => {
    const { b, sent, advance } = bot({ chat: { minIntervalMs: 2000, perMinute: 3, dedupMs: 60_000, maxChars: 10 } });
    b.chat('晚上好');
    expect(() => b.chat('你好')).toThrow(/^LOCAL_CHAT_PACING/);
    advance(2500); expect(() => b.chat('晚上好')).toThrow(/^LOCAL_CHAT_DEDUP/);
    expect(() => b.chat('这一句话实在是太长太长了啊')).toThrow(/^LOCAL_CHAT_TOO_LONG/);
    b.chat('你好'); advance(2500); b.chat('再见');
    advance(2500); expect(() => b.chat('第四句')).toThrow(/一分钟最多 3 句/);
    advance(60_000); b.chat('第四句');
    expect(sent).toEqual(['晚上好', '你好', '再见', '第四句']);
  });

  it('public chat off, auth always allowed, allowlist and blocklist commands', () => {
    const strict = bot({ publicChat: false, commands: { mode: 'allowlist', allow: ['list', 'signin leaderboard'] } });
    expect(() => strict.b.chat('hi')).toThrow(/^LOCAL_PUBLIC_CHAT_DISABLED/);
    strict.b.chat('/login secret-value');
    strict.b.chat('/list');
    strict.advance(1000); strict.b.chat('/signin  leaderboard');
    strict.advance(1000); expect(() => strict.b.chat('/rtp')).toThrow(/^LOCAL_COMMAND_NOT_ALLOWED/);
    expect(strict.sent).toEqual(['/login secret-value', '/list', '/signin  leaderboard']);

    const open = bot({ commands: { block: ['pay'], minIntervalMs: 1000 }, privateMessages: false });
    open.b.chat('/rtp');
    expect(() => open.b.chat('/home')).toThrow(/^LOCAL_COMMAND_PACING/);
    open.advance(1000); open.b.chat('/essentials:home');
    open.advance(1000); expect(() => open.b.chat('/pay Bob 10')).toThrow(/^LOCAL_COMMAND_BLOCKED/);
    expect(() => open.b.chat('/msg Bob hi')).toThrow(/^LOCAL_PRIVATE_MESSAGE_DISABLED/);
    expect(open.sent).toEqual(['/rtp', '/essentials:home']);
  });

  it('no rules → bot.chat untouched', () => {
    const b = { chat: (_m: string) => {} };
    const orig = b.chat;
    installServerChatPolicy(b, null);
    expect(b.chat).toBe(orig);
  });
});
