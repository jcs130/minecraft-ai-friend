// Public projections only. This module never returns a source object wholesale.
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const text = (value, max = 180) => typeof value === 'string' ? value.slice(0, max) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const bool = value => typeof value === 'boolean' ? value : null;
const qa = name => /^(QD(?:Smoke|GuildProbe|Probe|Audit|GoddessProbe|NpcProbe|TradeProbe|ContentProbe|Skin|Model|Irons|CliProbe|TravelProbe)|QSTest|ProbeBot|RenderBot|TaroProbe|PacketProbe|QiandengTest)/i.test(name);
const playerName = name => /^[A-Za-z0-9_]{1,16}$/.test(name) && !qa(name);
const iso = value => Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
export const chinaDate = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

export function projectWorld({ heartbeat, state, waypoints, atoms, catalog, rawCatalog, npc, guildHealth, board, fame, warnings = [] }, now = Date.now()) {
  const h = object(heartbeat), n = object(npc), gh = object(guildHealth), b = object(board);
  const provider = object(h.agentProvider), capabilities = object(provider.capabilities);
  const definitions = new Map(list(object(atoms).atoms).map(atom => [atom.id, atom]));
  const raw = object(rawCatalog), details = object(raw.featuredDetails), archived = object(raw.archived);
  const skills = { available: !!catalog, featured: [], archived: [], archivedCount: 0, passiveCount: 0 };
  if (catalog) {
    skills.featured = catalog.featured.map(id => {
      const atom = definitions.get(id) ?? {}, detail = object(details[id]);
      return { id, name: text(detail.name || atom.name || id), icon: text(catalog.icons.get(id)),
        reason: text(catalog.entries.get(id)?.reason, 450), words: list(atom.words).map(word => text(word, 50)).slice(0, 12),
        mana: number(object(atom.cost).mana), requiredLevel: number(atom.requiredLevel) };
    });
    skills.archived = [...catalog.entries].filter(([, entry]) => entry.status === 'archived').map(([id, entry]) => ({
      id, name: text(definitions.get(id)?.name || id), reason: text(entry.reason, 450),
      kind: text(object(archived[id]).kind), nativeHints: entry.nativeHints.map(value => text(value, 100)),
    }));
    skills.passiveCount = skills.archived.filter(row => row.kind === 'passive').length;
    skills.archivedCount = skills.archived.length - skills.passiveCount;
  }
  return {
    schema: 1, generatedAt: new Date(now).toISOString(), available: true,
    world: { available: number(h.ts) !== null, updatedAt: iso(number(h.ts)), goddess: text(h.goddess, 64),
      observedPlayers: list(h.watching).filter(name => typeof name === 'string' && !qa(name)).map(name => text(name, 64)), uptimeSec: number(h.uptimeSec) },
    agent: { id: text(provider.id, 64) || 'unknown', label: text(provider.label, 80) || '等待运行信息',
      capabilities: { chat: capabilities.chat === true, task: capabilities.task === true } },
    npc: { available: number(n.updated_at) !== null, updatedAt: iso(number(n.updated_at) * 1000),
      llmEnabled: bool(n.llm_enabled), spawnMissing: bool(n.spawn_missing),
      threads: Object.entries(object(n.threads)).map(([name, ok]) => ({ name: text(name, 64), ok: ok === true })) },
    skills,
    players: Object.entries(object(object(state).players)).filter(([name]) => playerName(name)).slice(0, 200).map(([name, value]) => {
      const row = object(value);
      return { name: text(name, 64), level: number(row.level), mana: number(row.mana), maxMana: number(row.maxMana),
        learnedCount: list(row.learned).length, passiveCount: list(row.passives).length };
    }),
    waypoints: list(object(waypoints).shared).slice(0, 200).map(row => ({ id: number(row.id), name: text(row.name, 80),
      x: number(row.x), y: number(row.y), z: number(row.z), dimension: text(row.dim, 100) })),
    guild: { available: Array.isArray(b.board), date: text(b.date, 10), stale: b.date !== chinaDate(now),
      updatedAt: iso(number(gh.last_success_at) * 1000), pollingError: text(gh.error_type, 80) || null,
      autogenerate: bool(gh.autogenerate), basicQuests: bool(gh.basic_quests),
      board: list(b.board).slice(0, 100).map(row => ({ no: number(row.no), title: text(row.title, 180), type: text(row.type, 32),
        rank: number(row.rank) !== null ? `阶位 ${row.rank}` : text(row.rank, 20), status: text(row.status, 24), reward: number(row.reward), fame: number(row.fame),
        claimNote: row.status === 'open' ? '记录为开放，接取条件以游戏内校验为准' : row.status === 'claimed' ? '已领取，进度以游戏内为准' : '历史状态记录' })),
      fame: Object.entries(object(fame)).filter(([name]) => !qa(name)).slice(0, 200).map(([name, value]) => ({
        name: text(name, 64), fame: number(value?.fame), done: number(value?.done), rank: text(value?.rank, 20),
      })).sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0)),
    },
    warnings: warnings.map(value => text(value, 200)).slice(0, 20),
  };
}

export function freshness(timestamp, now = Date.now(), limitSeconds = 90) {
  const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  const ageSeconds = Number.isFinite(time) ? Math.round((now - time) / 1000) : null;
  return { stale: ageSeconds === null || ageSeconds < -5 || ageSeconds > limitSeconds, ageSeconds };
}

export function projectHealth(raw, now = Date.now()) {
  const value = object(raw), status = freshness(value.checked_at, now, 300);
  return { available: typeof value.checked_at === 'string', checkedAt: text(value.checked_at, 40) || null,
    ...status, ok: value.ok === true,
    services: Object.entries(object(value.services)).map(([name, row]) => ({ name: text(name, 64), ok: row?.ok === true,
      state: text(row?.state, 30), health: text(row?.health, 30), purpose: text(row?.purpose, 180) })),
  };
}

const optionalText = (value, max = 180) => typeof value === 'string' ? value.slice(0, max) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function operationsEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Public console addresses never need credentials in a query or fragment.
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}

export function projectOperations(raw, now = Date.now()) {
  const value = object(raw);
  const collections = ['runtimes', 'agents', 'services', 'issues', 'commands'];
  const isoStamp = typeof value.generatedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.generatedAt);
  const stamp = isoStamp ? Date.parse(value.generatedAt) : NaN;
  const calendarDay = isoStamp ? Date.parse(value.generatedAt.slice(0, 10) + 'T00:00:00Z') : NaN;
  const valid = value.schema === 1 && value.project === 'qiandengji' && Number.isFinite(stamp)
    && Number.isFinite(calendarDay) && new Date(calendarDay).toISOString().slice(0, 10) === value.generatedAt.slice(0, 10)
    && collections.every(key => Array.isArray(value[key]));
  const ageSeconds = valid ? (now - stamp) / 1000 : null;
  const reason = !valid ? 'unavailable' : ageSeconds < 0 ? 'future' : ageSeconds > 300 ? 'expired' : null;
  const available = valid && reason !== 'future';
  const selected = key => available ? value[key].slice(0, key === 'agents' ? 200 : 100)
    .filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
  return {
    schema: 1, project: 'qiandengji', available, generatedAt: valid ? new Date(stamp).toISOString() : null,
    stale: reason !== null, staleReason: reason, ageSeconds, ttlSeconds: 300,
    runtimes: selected('runtimes').map(row => ({
      id: optionalText(row.id, 64), label: optionalText(row.label, 100), kind: optionalText(row.kind, 40),
      version: optionalText(row.version, 60), endpoint: operationsEndpoint(row.endpoint), state: optionalText(row.state, 40),
      purpose: optionalText(row.purpose, 360), enabledAgentCount: count(row.enabledAgentCount), agentCount: count(row.agentCount),
    })),
    agents: selected('agents').map(row => ({
      id: optionalText(row.id, 64), label: optionalText(row.label, 100), runtimeId: optionalText(row.runtimeId, 64),
      enabled: bool(row.enabled), role: optionalText(row.role, 360), modelProvider: optionalText(row.modelProvider, 100),
      model: optionalText(row.model, 100), toolCount: count(row.toolCount), mcpCount: count(row.mcpCount), jobCount: count(row.jobCount),
    })),
    services: selected('services').map(row => ({
      id: optionalText(row.id, 64), label: optionalText(row.label, 100), group: optionalText(row.group, 80),
      container: optionalText(row.container, 100), state: optionalText(row.state, 40), health: optionalText(row.health, 40),
      purpose: optionalText(row.purpose, 360), managedBy: optionalText(row.managedBy, 100),
      dependencies: list(row.dependencies).filter(item => typeof item === 'string').slice(0, 30).map(item => text(item, 64)),
    })),
    issues: selected('issues').map(row => ({
      code: optionalText(row.code, 80), severity: ['error', 'warning', 'info'].includes(row.severity) ? row.severity : null,
      title: optionalText(row.title, 140), detail: optionalText(row.detail, 600),
    })),
    commands: selected('commands').map(row => ({ label: optionalText(row.label, 100), command: optionalText(row.command, 800) })),
  };
}
