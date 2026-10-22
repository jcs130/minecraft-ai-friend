import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import nbt from 'prismarine-nbt';
import { pingMinecraft } from './minecraft-ping.mjs';
import { playerNameValid } from './world-catalog.mjs';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const RESERVED = new Set(['corti', 'corticam', 'player', 'goddess', 'live']);
const norm = value => String(value).toLowerCase();
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const iso = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : null;

export function componentText(value) {
  if (typeof value === 'string') {
    try { return componentText(JSON.parse(value)); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(componentText).join('');
  if (!value || typeof value !== 'object') return '';
  return String(value.text || value.translate || '') + (value.extra || []).map(componentText).join('');
}

export function freshAuthentication(heartbeat, now = Date.now()) {
  const valid = heartbeat?.ready === true && typeof heartbeat.at === 'number' && heartbeat.at <= now + 1000 && now - heartbeat.at <= 5000 && Array.isArray(heartbeat.authorizedNames);
  return { fresh: valid, observedAt: typeof heartbeat?.at === 'number' ? iso(heartbeat.at) : null,
    names: valid ? heartbeat.authorizedNames.filter(name => typeof name === 'string') : [] };
}

export function normalizeInventory(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && typeof item.id === 'string').map(item => {
    const components = item.components || {};
    const custom = components['minecraft:custom_name'] ?? item.tag?.display?.Name;
    const name = custom ? componentText(custom) : null;
    return { slot: Number(item.Slot), id: item.id, count: finite(item.count ?? item.Count), name,
      enchanted: !!(components['minecraft:enchantments'] || item.tag?.Enchantments),
      source: 'minecraft.saved-player-nbt' };
  }).filter(item => Number.isInteger(item.slot) && item.count !== null);
}

export class GameData {
  constructor(config, salt, ping = pingMinecraft) {
    this.config = config; this.salt = salt; this.ping = ping;
    this.cache = new Map(); this.pending = new Map();
  }
  async cached(key, ttl, load) {
    const previous = this.cache.get(key);
    if (previous && Date.now() - previous.at < ttl) return previous.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = Promise.resolve().then(load).then(value => {
      this.cache.set(key, { at: Date.now(), value }); return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending); return pending;
  }
  async document(file, type = 'json') {
    return this.cached('file:' + file, 2500, async () => {
      try {
        const stat = await fs.stat(file);
        if (stat.size > 8 * 1024 * 1024 || !stat.isFile()) throw new Error('Invalid projection');
        const text = await fs.readFile(file, 'utf8');
        return { data: type === 'yaml' ? YAML.parse(text, { maxAliasCount: 30 }) : JSON.parse(text), savedAt: stat.mtime.toISOString() };
      } catch { return { data: null, savedAt: null }; }
    });
  }
  plugin(file) { return this.document(path.join(this.config.serverDir, 'plugins', 'AgentFriend', file), 'yaml'); }
  idFor(uuid, name) { return createHash('sha256').update(this.salt + ':' + (uuid || norm(name))).digest('hex').slice(0, 24); }
  async status() {
    return this.cached('server-ping', 5000, () => this.ping(this.config.gameHost, this.config.gamePort));
  }
  async roster() {
    const [cached, registry, operators, heartbeat, status] = await Promise.all([
      this.document(path.join(this.config.serverDir, 'usercache.json')),
      this.document(this.config.agentRegistry),
      this.document(path.join(this.config.serverDir, 'ops.json')),
      this.document(this.config.authHeartbeat), this.status()
    ]);
    const auth = freshAuthentication(heartbeat.data);
    const users = Array.isArray(cached.data) ? [...cached.data] : [];
    const sampleAt = Date.parse(status.observedAt || '');
    if (auth.fresh && Number.isFinite(sampleAt) && Math.abs(Date.now() - sampleAt) < 5000) for (const row of status.sample || []) {
      // A newly joined player can precede Paper's usercache disk flush. Match
      // the trusted backend's current name/UUID to fresh authorization; never
      // invent an offline UUID or let an old cache silently override a conflict.
      if (playerNameValid(row.name) && UUID.test(row.uuid || '') && auth.names.some(name => norm(name) === norm(row.name))) users.push({ name: row.name, uuid: row.uuid.toLowerCase(), identitySource: 'minecraft.server-list-ping.authorized-uuid' });
    }
    const registered = [...(this.portalIdentities?.() || [])];
    if (this.config.portalIdentitiesFile) {
      const record = await this.document(this.config.portalIdentitiesFile);
      if (Array.isArray(record.data?.identities) && record.data.identities.length <= 256) for (const row of record.data.identities) {
        if (playerNameValid(row.name) && UUID.test(row.uuid || '')) registered.push(row);
      }
    }
    for (const row of registered) users.push({ name: row.name, uuid: row.uuid });
    const userMap = new Map();
    const conflicts = new Set();
    for (const user of users) {
      if (typeof user.name !== 'string' || !UUID.test(user.uuid)) continue;
      const previous = userMap.get(norm(user.name));
      if (previous && previous.uuid.toLowerCase() !== user.uuid.toLowerCase()) conflicts.add(norm(user.name));
      userMap.set(norm(user.name), user);
    }
    const adminNames = new Set((Array.isArray(operators.data) ? operators.data : []).map(row => norm(row.name)));
    const names = new Map((this.config.publicRoster || []).map(name => [norm(name), name]));
    for (const user of users) if (this.config.includeKnownPlayers && playerNameValid(user.name)) names.set(norm(user.name), user.name);
    for (const row of registered) names.set(norm(row.name), row.name);
    const agents = new Set(); const eyeNames = new Set(); const eyesByAgent = new Map();
    for (const pair of registry.data?.pairs || []) {
      if (typeof pair.agent !== 'string') continue;
      names.set(norm(pair.agent), pair.agent); agents.add(norm(pair.agent));
      if (typeof pair.eye === 'string') { names.set(norm(pair.eye), pair.eye); eyeNames.add(norm(pair.eye)); eyesByAgent.set(norm(pair.agent), pair.eye); }
    }
    for (const row of status.sample || []) if (playerNameValid(row.name)) names.set(norm(row.name), row.name);
    for (const name of auth.names) names.set(norm(name), name);
    const authenticated = new Set(auth.names.map(norm));
    const sampled = new Set((status.sample || []).map(row => norm(row.name)));
    const sampledUuids = new Set((status.sample || []).filter(row => UUID.test(row.uuid || '')).map(row => row.uuid.toLowerCase()));
    return [...names.values()].filter(name => playerNameValid(name) && !(this.config.hiddenPlayers || []).some(hidden => norm(hidden) === norm(name))).map(name => {
      const user = userMap.get(norm(name));
      const conflict = conflicts.has(norm(name));
      const uuid = !conflict && user && UUID.test(user.uuid) ? user.uuid.toLowerCase() : null;
      let kind = eyeNames.has(norm(name)) || /eye$/i.test(name) || norm(name) === 'live' ? 'observer' : agents.has(norm(name)) || name.startsWith('ag_') || name === 'feiyu_bot' ? 'agent' : 'player';
      if (adminNames.has(norm(name)) || RESERVED.has(norm(name))) kind = 'admin';
      const sampledByUuid = uuid && sampledUuids.has(uuid);
      const online = sampledByUuid ? true : auth.fresh ? authenticated.has(norm(name)) : sampled.has(norm(name)) ? true : null;
      return { id: this.idFor(uuid, name), name: user?.name || name, playerUuid: uuid, kind, online,
        authenticated: sampledByUuid && !authenticated.has(norm(name)) ? null : auth.fresh ? authenticated.has(norm(name)) : null,
        statusSource: sampledByUuid ? 'minecraft.server-list-ping.uuid' : auth.fresh ? 'LoginGuard.authorizedNames' : 'minecraft.server-list-ping.sample',
        statusObservedAt: sampledByUuid ? status.observedAt : auth.fresh ? auth.observedAt : status.observedAt,
        eye: eyesByAgent.get(norm(name)) || null, isReserved: adminNames.has(norm(name)) || RESERVED.has(norm(name)) || kind === 'observer',
        identityConflict: conflict, identitySource: uuid ? user.identitySource || 'Paper.usercache' : null,
        available: !!uuid, observedAt: new Date().toISOString() };
    }).sort((a, b) => Number(b.online === true) - Number(a.online === true) || a.name.localeCompare(b.name));
  }
  publicAgent(agent) {
    return { id: agent.id, name: agent.name, kind: agent.kind, online: agent.online,
      observedAt: agent.statusObservedAt, available: agent.available };
  }
  async serverSummary() {
    const [status, roster, heartbeat] = await Promise.all([this.status(), this.roster(), this.document(this.config.authHeartbeat)]);
    const auth = freshAuthentication(heartbeat.data);
    return { name: this.config.siteName, online: status.online, version: status.version || null,
      playersOnline: status.playersOnline ?? null, playersMax: status.playersMax ?? null,
      latencyMs: status.latencyMs ?? null, observedAt: status.observedAt,
      rosterCount: roster.length, agentCount: roster.filter(row => row.kind === 'agent').length,
      authHealthy: auth.fresh, source: status.source, unavailableReason: status.unavailableReason || null,
      capabilities: { accountPortal: true, readOnlyProfiles: true, gameAccountCreate: false,
        claimInGame: false, gamePassword: false,
        liveInventory: false, manualControl: false, modernViewer: false, appearance: false,
        rawCredentialIssuance: true, oauthDelegation: false, worldConnector: false } };
  }
  async playerNbt(uuid) {
    return this.cached('nbt:' + uuid, 5000, async () => {
      try {
        const file = path.join(this.config.serverDir, 'world', 'playerdata', uuid + '.dat');
        const stat = await fs.stat(file);
        if (stat.size > 2 * 1024 * 1024) throw new Error('Player NBT too large');
        const { parsed } = await nbt.parse(await fs.readFile(file));
        return { data: nbt.simplify(parsed), savedAt: stat.mtime.toISOString() };
      } catch { return { data: null, savedAt: null }; }
    });
  }
  async playerState(agent) {
    if (!agent.playerUuid || !UUID.test(agent.playerUuid)) return {
      agent, freshness: 'unavailable', unavailableReason: '原角色 UUID 尚未核实，暂不读取存档', connectionEpoch: null, seq: null
    };
    const uuid = agent.playerUuid;
    const [player, essentials, stats, gameplay, life, professions] = await Promise.all([
      this.playerNbt(uuid),
      this.document(path.join(this.config.serverDir, 'plugins', 'Essentials', 'userdata', uuid + '.yml'), 'yaml'),
      this.document(path.join(this.config.serverDir, 'world', 'stats', uuid + '.json')),
      this.plugin('config.yml'), this.plugin('world-life-ledger.yml'), this.plugin('profession-ledger.json')
    ]);
    const data = player.data; const custom = stats.data?.stats?.['minecraft:custom'] || {};
    const guild = gameplay.data?.['guild-players']?.[uuid];
    const personalLife = life.data?.players?.[uuid];
    const profile = essentials.data;
    return { schemaVersion: 1, agent, freshness: data ? 'saved' : 'unavailable',
      source: 'Paper.saved-player-data', observedAt: new Date().toISOString(), savedAt: player.savedAt,
      connectionEpoch: null, seq: null,
      unavailableReason: data ? null : '暂未读取到这个角色的存档快照',
      liveState: { available: false, reason: '原客户端尚未接入实时状态连接器' },
      vitals: data ? { health: finite(data.Health), food: finite(data.foodLevel), level: finite(data.XpLevel), experience: finite(data.XpTotal), gameMode: finite(data.playerGameType), dimension: typeof data.Dimension === 'string' ? data.Dimension : null } : null,
      savedPosition: data && Array.isArray(data.Pos) ? data.Pos.map(finite) : null,
      inventory: normalizeInventory(data?.Inventory),
      stats: { savedAt: stats.savedAt, playTicks: finite(custom['minecraft:play_time']), deaths: finite(custom['minecraft:deaths']),
        mobKills: finite(custom['minecraft:mob_kills']), playerKills: finite(custom['minecraft:player_kills']),
        walkCentimeters: finite(custom['minecraft:walk_one_cm']), jumps: finite(custom['minecraft:jump']),
        blocksMined: stats.data?.stats?.['minecraft:mined'] ? Object.values(stats.data.stats['minecraft:mined']).reduce((sum, count) => sum + (finite(count) ?? 0), 0) : null },
      account: { lastLoginAt: iso(profile?.timestamps?.login), lastLogoutAt: iso(profile?.timestamps?.logout),
        balance: profile?.money != null ? String(profile.money) : null, source: 'Essentials.saved-profile', savedAt: essentials.savedAt },
      progress: { savedAt: gameplay.savedAt, guildSavedAt: gameplay.savedAt, lifeSavedAt: life.savedAt, professionSavedAt: professions.savedAt, guild: guild || null, life: personalLife || null,
        profession: professions.data?.players?.[uuid] || professions.data?.[uuid] || null },
      connection: { body: 'external', portalConnected: false, controlAvailable: false,
        reason: '目前只读取服务器记录，接管需要原执行器提供暂停与释放回执' } };
  }
}
