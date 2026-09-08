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

const partyStates = new Set(['running', 'waiting', 'unconfigured', 'unavailable']);
const partyMessageStates = ['pending', 'unknown', 'submitted', 'answered', 'expired', 'failed'];
const partyCode = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : null;
const partyStamp = (value, scale = 1) => typeof value === 'number' && Number.isFinite(value)
  && value > 0 && value * scale <= 8640000000000000 ? new Date(value * scale).toISOString() : null;
const partyText = (value, limit) => text(value, limit)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[身份已隐藏]')
  .replace(/\b(?:Bearer\s+\S+|(?:token|api[_-]?key|password|secret|session[_-]?id)\s*[:=]\s*["']?[^\s,"']+)/gi, '[内部资料已隐藏]');
const partyHearing = raw => {
  const value = object(raw), receipt = object(value.receipt);
  const heard = value.state === 'heard' && receipt.heard === true && receipt.phase === 'heard'
    && (receipt.channel === 'msg' || (receipt.channel === 'nearby' && receipt.radius === 24
      && Number.isFinite(receipt.distance) && receipt.distance >= 0 && receipt.distance <= 24));
  return { heard, channel: ['nearby', 'msg'].includes(receipt.channel) ? receipt.channel : null,
    state: ['pending', 'unknown', 'heard', 'rejected', 'expired'].includes(value.state) ? value.state : 'unknown',
    distance: heard && receipt.channel === 'nearby' ? receipt.distance : null, at: heard ? partyStamp(receipt.emittedAt) : null };
};

/** Independent party freshness; never expose body UUIDs, session routing or driver credentials. */
export function projectParty(raw, now = Date.now()) {
  const value = object(raw), updatedAt = partyStamp(value.updatedAt);
  if (value.schema !== 1 || typeof value.enabled !== 'boolean' || !partyStates.has(value.status) || !updatedAt)
    return { available: false, stale: true, updatedAt: null, enabled: false,
      status: raw == null ? 'unconfigured' : 'unavailable', members: [], messages: [] };
  const ageSeconds = (now - value.updatedAt) / 1000, budget = object(value.budget);
  const members = list(value.members).slice(0, 2).filter(row => typeof row?.agentId === 'string'
    && /^[A-Za-z0-9_.:-]{1,64}$/.test(row.agentId) && ['survivor', 'maid'].includes(row.kind))
    .map(row => ({ agentId: row.agentId, displayName: partyText(row.displayName, 64) || '名称待设置', kind: row.kind }));
  const memberIds = new Set(members.map(row => row.agentId));
  if (value.enabled && (list(value.members).length !== 2 || memberIds.size !== 2 || new Set(members.map(row => row.kind)).size !== 2))
    return { available: false, stale: true, updatedAt, enabled: false, status: 'unavailable', members: [], messages: [] };
  return { available: true, updatedAt, stale: ageSeconds < -5 || ageSeconds > 90, enabled: value.enabled,
    status: value.status, error: partyCode(value.error), members,
    counts: Object.fromEntries(partyMessageStates.map(key => [key, count(object(value.counts)[key])])),
    budget: { reservedDispatches24h: count(budget.reservedDispatches24h), dailyDispatchCap: count(budget.dailyDispatchCap),
      remaining: count(budget.remaining), blocked: bool(budget.blocked), nextDispatchAt: partyStamp(budget.nextDispatchAt, 1000) },
    messages: list(value.messages).slice(0, 8).filter(row => partyMessageStates.includes(row?.status)).map(row => {
      const reply = object(row.reply), senderId = object(reply.sender).agentId;
      const hearing = partyHearing(row.worldDelivery), replyHearing = partyHearing(reply.worldDelivery || row.replyDelivery);
      const frameworkInterruption = replyHearing.heard && typeof reply.text === 'string'
        && /^Max iterations \([0-9]+\) reached$/.test(reply.text.trim());
      return { status: row.status, createdAt: partyStamp(row.createdAt, 1000), hearing, replyHearing,
        frameworkInterruption,
        senderAgentId: memberIds.has(object(row.sender).agentId) ? row.sender.agentId : null,
        text: hearing.heard ? partyText(row.text, 160) : null,
        detail: frameworkInterruption ? 'native_framework_interruption' : partyCode(row.detail), reply: hearing.heard && replyHearing.heard && typeof reply.text === 'string' && memberIds.has(senderId)
          ? { text: partyText(reply.text, 160), createdAt: partyStamp(reply.createdAt, 1000), senderAgentId: senderId } : null };
    }) };
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
const nonnegative = value => number(value) !== null && value >= 0 ? value : null;
const survivorPosition = raw => { const value = object(raw); return { x: number(value.x), y: number(value.y), z: number(value.z) }; };
const survivorItems = (raw, signed = false) => Object.fromEntries(Object.entries(object(raw))
  .filter(([key, n]) => key.length <= 100 && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(key)
    && Number.isSafeInteger(n) && (signed || n >= 0)).slice(0, 64));
function survivorAction(raw) {
  const value = object(raw), response = object(value.result);
  return { tool: optionalText(value.tool, 40), code: optionalText(response.code, 60), ok: bool(response.ok),
    completionConfirmed: bool(response.completionConfirmed), acceptedAt: number(value.acceptedAt) };
}
function survivorGameSkills(raw) {
  const value = object(raw);
  if (value.schema !== 1 || value.available !== true || value.historicalQuery !== true)
    return { available: false, historicalQuery: true };
  const abilityRows = raw => list(raw).slice(0, 24).filter(row => typeof row?.id === 'string'
    && row.id.length <= 100 && /^[a-z0-9_.-]+(?::[a-z0-9_./-]+)?$/.test(row.id)).map(row => ({
      id: row.id, name: text(row.name, 64) || row.id, level: count(row.level), mana: nonnegative(row.mana),
      cooldownMs: nonnegative(row.cooldownMs), ready: bool(row.ready) }));
  const progression = object(value.pufferfish), attributes = object(value.attributes);
  return { available: true, historicalQuery: true, observedAt: nonnegative(value.observedAt),
    sourceObservedAt: Object.fromEntries(['status', 'skills', 'spells irons'].map(key =>
      [key, nonnegative(object(value.sourceObservedAt)[key])])),
    legacyLevel: count(value.playerLevel), legacySkillsKnown: bool(value.legacySkillsKnown),
    learned: abilityRows(value.learned), eligible: abilityRows(value.currentlyAvailable), locked: abilityRows(value.locked),
    nativeSpells: abilityRows(value.nativeSpells), nativeSpellsKnown: bool(value.nativeSpellsKnown),
    nativeLevel: count(value.nativeLevel), nativeMana: nonnegative(value.nativeMana), nativeMaxMana: nonnegative(value.nativeMaxMana),
    legacyMana: nonnegative(value.legacyMana), legacyMaxMana: nonnegative(value.legacyMaxMana),
    attributes: Object.fromEntries(['health', 'maxHealth', 'maxMana', 'manaRegen', 'spellPower', 'spellResist',
      'cooldownReduction', 'castTimeReduction'].map(key => [key, nonnegative(attributes[key])])),
    pufferfish: { known: bool(progression.known), ok: bool(progression.ok),
      categories: list(progression.categories).slice(0, 12).filter(row => typeof row?.id === 'string'
        && row.id.length <= 80 && /^[a-z0-9_.-]+(?::[a-z0-9_./-]+)?$/.test(row.id)).map(row => ({
          id: row.id, available: bool(row.available), level: count(row.level), experience: nonnegative(row.experience),
          pointsTotal: count(row.points_total), pointsSpent: count(row.points_spent), pointsLeft: count(row.points_left) })) },
    truncated: value.truncated === true };
}
function survivorNavigationOutcome(raw) {
  const value = object(raw);
  if (!['success', 'failed', 'timeout', 'cancelled'].includes(value.state) || typeof value.success !== 'boolean'
      || value.success !== (value.state === 'success') || typeof value.task_id !== 'string'
      || !value.task_id || typeof value.navigation_epoch !== 'string' || !value.navigation_epoch) return null;
  return { taskId: text(value.task_id, 128), epoch: text(value.navigation_epoch, 64), state: value.state,
    success: value.success, reason: text(value.reason, 400), finishedAt: nonnegative(value.finished_at),
    mode: optionalText(value.navigation_mode, 40), worldInteractionBlocked: bool(value.world_interaction_blocked) };
}
function survivorSkillBooks(raw) {
  return list(raw).slice(0, 12).filter(row => row?.id === 'minecraft:written_book'
    && Number.isSafeInteger(row.count) && row.count > 0 && row.count <= 64
    && Number.isSafeInteger(row.slot) && row.slot >= 0 && row.slot <= 40
    && typeof row.bookName === 'string' && row.bookName.length > 0 && row.bookName.length <= 64).map(row => {
      const recognized = row.recognized === true && row.recognition === 'recognized'
        && typeof row.skill_id === 'string' && /^[a-z0-9_.-]{1,100}$/.test(row.skill_id);
      return { id: row.id, count: row.count, slot: row.slot, bookName: row.bookName, recognized,
        recognition: recognized ? 'recognized' : ['unrecognized', 'catalog_unavailable', 'ambiguous'].includes(row.recognition)
          ? row.recognition : 'unrecognized', historicalCatalog: true, catalogObservedAt: nonnegative(row.catalogObservedAt),
        ...(recognized ? { skillId: row.skill_id, name: text(row.name, 64), requiredLevel: count(row.requiredLevel),
          type: ['active', 'passive'].includes(row.type) ? row.type : null, knownLearned: bool(row.knownLearned) } : {}) };
    });
}
function survivorAdventure(raw) {
  const value = object(raw);
  if (value.schema !== 1) return {available: false};
  const resources = object(value.resources), equipment = object(value.equipment), body = object(value.body);
  const opportunities = object(value.opportunities), guild = object(opportunities.guild), villagers = object(opportunities.villagers);
  const itemId = id => typeof id === 'string' && id.length <= 128 && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id);
  return {available: true, fresh: bool(body.fresh), observedAt: nonnegative(body.observedAt), truncated: value.truncated === true,
    resources: {known: resources.known === true, items: Object.fromEntries(['food', 'tools', 'materials', 'agriculture', 'other'].map(key =>
      [key, resources.known === true ? list(object(resources.items)[key]).slice(0, 8).filter(row => itemId(row?.id)
        && count(row.count) !== null && row.count > 0).map(row => ({id: row.id, count: row.count})) : []]))},
    equipment: {known: equipment.known === true, slots: equipment.known === true ? list(equipment.slots).slice(0, 6).filter(row =>
      ['mainhand', 'offhand', 'head', 'chest', 'legs', 'feet'].includes(row?.slot) && itemId(row?.id)).map(row => ({slot: row.slot, id: row.id})) : []},
    actionTools: list(object(value.capabilities).actionTools).slice(0, 32).filter(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(name)),
    guild: {known: guild.known === true, fresh: bool(guild.fresh), board: guild.known === true ? list(guild.board).slice(0, 8).map(row => ({
      no: count(row?.no), title: text(row?.title, 100), type: text(row?.type, 32), status: text(row?.status, 40), reward: count(row?.reward)})) : []},
    villagers: {known: villagers.known === true, fresh: bool(villagers.fresh), offersKnown: false,
      nearby: villagers.known === true ? list(villagers.nearby).slice(0, 4).filter(row =>
        ['minecraft:villager', 'minecraft:wandering_trader'].includes(row?.type)).map(row => ({type: row.type, distance: nonnegative(row.distance)})) : []}};
}
function survivorConstructionAreas(raw) {
  const bounds = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
  return list(raw).slice(0, 8).filter(row => typeof row?.dimension === 'string' && row.dimension.length <= 100
    && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(row.dimension) && bounds.every(key => Number.isSafeInteger(row[key]))
    && ['X', 'Y', 'Z'].every(axis => row['min' + axis] <= row['max' + axis])).map(row => ({
      name: optionalText(row.name, 80), dimension: row.dimension, ...Object.fromEntries(bounds.map(key => [key, row[key]]))}));
}
function survivorGuild(raw, actorUuid) {
  const value = object(raw);
  if (value.ok !== true || value.code !== 'guild_observed' || value.historicalQuery !== true || value.actor !== 'Kirito'
    || typeof actorUuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUuid) || value.actorUuid !== actorUuid)
    return {available: false, historicalQuery: true};
  const item = id => typeof id === 'string' && id.length <= 100 && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) ? id : null;
  return {available: true, historicalQuery: true, observedAt: nonnegative(value.observedAt),
    boardDate: text(value.boardDate, 10), truncated: bool(value.truncated),
    contracts: list(value.quests).slice(0, 24).filter(row => list(row?.claimedBy).includes('Kirito')
      && typeof row?.questId === 'string' && /^\d{4}-\d{2}-\d{2}:\d{1,2}$/.test(row.questId)).map(row => ({
      questId: row.questId, title: text(row.title, 120), type: text(row.type, 32), status: text(row.status, 40),
      itemId: item(row.itemId), count: count(row.count), blockedReason: optionalText(row.blockedReason, 100),
      acceptance: optionalText(row.acceptance, 160), rankRequired: count(row.rankRequired),
      objective: {mobId: item(row.objective?.mobId), count: count(row.objective?.count),
        dimension: item(row.objective?.dimension), radius: nonnegative(row.objective?.radius)} }))};
}
export function projectSurvivor(raw, now = Date.now()) {
  const value = object(raw);
  if (value.schema !== 1 || value.project !== 'qiandengji-survivor' || value.bodyName !== 'Kirito' || value.character !== '桐人'
      || typeof value.generatedAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.generatedAt))
    return { available: false, stale: true, generatedAt: null };
  const body = object(value.body), budgets = object(value.budgets), decision = object(value.lastDecision);
  const perception = object(value.perception), environment = object(value.environment), world = object(environment.world);
  return { available: true, ...freshness(value.generatedAt, now, 90), generatedAt: optionalText(value.generatedAt, 64),
    character: '桐人', bodyName: 'Kirito', status: text(value.status, 64), enabled: bool(value.enabled),
    goal: text(value.goal, 1200), pauseReason: optionalText(value.pauseReason, 120),
    autonomous: bool(value.autonomous), nextReviewAt: number(value.nextReviewAt),
    goalState: optionalText(value.goalState, 40), wakeReason: optionalText(value.wakeReason, 60),
    perception: { pendingCount: count(perception.pendingCount),
      events: list(perception.events).slice(0, 12).map(row => ({ kind: text(row?.kind, 60),
        at: number(row?.at), speaker: text(row?.speaker, 64), text: text(row?.text, 320),
        beforeHp: number(row?.beforeHp), afterHp: number(row?.afterHp), addressed: bool(row?.addressed) })),
      sources: Object.entries(object(perception.sources)).slice(0, 4).map(([name, item]) =>
        ({ name: text(name, 64), available: bool(item?.available) })) },
    environment: { available: bool(environment.ok), biome: optionalText(body.biome, 160),
      weather: optionalText(world.weather, 64), dark: bool(world.is_dark_outside),
      entities: list(environment.entities).slice(0, 20).map(row => ({ type: text(row?.type, 100),
        name: optionalText(row?.name, 80), distance: number(row?.distance) })) },
    lastDecision: value.lastDecision && typeof value.lastDecision === 'object' && !Array.isArray(value.lastDecision)
      ? { turnId: optionalText(decision.turnId, 128), at: optionalText(decision.at, 64), completed: bool(decision.completed),
        actions: list(decision.actions).slice(-2).map(survivorAction) } : null,
    body: { online: bool(body.online), hp: number(body.hp), hunger: number(body.hunger),
      position: survivorPosition(body.position), counts: survivorItems(body.counts),
      ownedSkillBooks: survivorSkillBooks(body.ownedSkillBooks), skillBooksTruncated: bool(body.skillBooksTruncated) },
    gameSkills: survivorGameSkills(value.gameSkills), adventure: survivorAdventure(value.adventure),
    constructionAreasKnown: Array.isArray(value.constructionAreas), constructionAreas: survivorConstructionAreas(value.constructionAreas),
    guild: survivorGuild(value.guild, value.bodyUuid),
    budgets: Object.fromEntries(['decisionsUsed', 'decisionLimit', 'cooldownSeconds', 'modelRequests', 'promptTokens', 'completionTokens'].map(key => [key, count(budgets[key])])),
    skills: list(value.skills).slice(0, 40).map(row => ({ name: text(row?.name, 80), description: text(row?.description, 400),
      activeVersion: optionalText(row?.activeVersion, 80), draftVersion: optionalText(row?.draftVersion, 80) })),
    episodes: list(value.episodes).slice(-12).map(row => ({ at: optionalText(row?.at, 64), kind: text(row?.kind, 60),
      turnId: optionalText(row?.turnId, 128), taskId: optionalText(row?.taskId, 128), completed: bool(row?.completed),
      action: optionalText(row?.action, 40), inventoryDelta: survivorItems(row?.inventoryDelta, true),
      navigationOutcome: row?.action === 'goto' ? survivorNavigationOutcome(row?.navigationOutcome) : null,
      positionBefore: survivorPosition(row?.positionBefore), positionAfter: survivorPosition(row?.positionAfter),
      name: optionalText(row?.name, 80), version: optionalText(row?.version, 80), status: optionalText(row?.status, 60),
      reason: optionalText(row?.reason, 500), errorType: optionalText(row?.errorType, 80) })) };
}
const operationsRoles = ['mc-god', 'default', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto'];
const roundUsage = value => ({ modelCalls: count(value.modelCalls), promptTokens: count(value.promptTokens),
  completionTokens: count(value.completionTokens), elapsedSeconds: nonnegative(value.elapsedSeconds) });
function projectOperationsRound(raw) {
  if (raw?.schema !== 1 || raw?.project !== 'qiandengji-ops') return null;
  const sourceRoles = list(raw.roles);
  const roles = sourceRoles.slice(0, 6).filter(row => row && operationsRoles.includes(row.role))
    .map(row => ({ role: row.role, ok: row.ok === true, requestId: optionalText(row.requestId, 100),
      summary: optionalText(row.summary, 1600), errorType: optionalText(row.errorType, 60), ...roundUsage(row) }));
  const usage = roundUsage(raw);
  const completeRoster = roles.length > 0 && roles.length === sourceRoles.length
    && new Set(roles.map(row => row.role)).size === roles.length;
  for (const field of ['modelCalls', 'promptTokens', 'completionTokens']) {
    if (raw[field] == null && completeRoster && roles.every(row => row[field] !== null)) {
      usage[field] = count(roles.reduce((total, row) => total + row[field], 0));
    }
  }
  if (raw.elapsedSeconds == null) {
    const timestamp = value => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    const elapsed = (timestamp(raw.finishedAt) - timestamp(raw.startedAt)) / 1000;
    usage.elapsedSeconds = nonnegative(elapsed)
      ?? (completeRoster && roles.length === 1 ? roles[0].elapsedSeconds : null);
  }
  return { runId: optionalText(raw.runId, 100), ok: raw.ok === true,
    finishedAt: optionalText(raw.finishedAt, 64), mode: 'manual', ...usage, roles };
}
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
    teamPolicy: available && value.teamPolicy && typeof value.teamPolicy === 'object' && !Array.isArray(value.teamPolicy) ? {
      packageVersion: optionalText(value.teamPolicy.packageVersion, 40),
      mode: value.teamPolicy.mode === 'manual' ? 'manual' : null,
      maxConcurrentModels: count(value.teamPolicy.maxConcurrentModels), maxQueriesPerMinute: count(value.teamPolicy.maxQueriesPerMinute),
      maxIterations: count(value.teamPolicy.maxIterations), automaticRetries: bool(value.teamPolicy.automaticRetries),
      delegationCooldownSeconds: count(value.teamPolicy.delegationCooldownSeconds), maxDelegationsPerDay: count(value.teamPolicy.maxDelegationsPerDay),
      scheduledJobs: count(value.teamPolicy.scheduledJobs), heartbeat: bool(value.teamPolicy.heartbeat),
      roleSkills: Object.fromEntries(operationsRoles.map(role => [role,
        Array.isArray(object(value.teamPolicy.roleSkills)[role])
          ? [...new Set(value.teamPolicy.roleSkills[role].filter(skill => typeof skill === 'string' && skill.trim()).map(skill => text(skill, 100)))].slice(0, 12)
          : null])),
    } : null,
    teamUsage: available && value.teamUsage && typeof value.teamUsage === 'object' && !Array.isArray(value.teamUsage) ? {
      callCount: count(value.teamUsage.callCount), promptTokens: count(value.teamUsage.promptTokens),
      completionTokens: count(value.teamUsage.completionTokens), cachedTokens: count(value.teamUsage.cachedTokens),
      window: value.teamUsage.window === 'today' ? 'today' : null, generatedAt: optionalText(value.teamUsage.generatedAt, 64),
    } : null,
    teamRound: available ? projectOperationsRound(value.teamRound) : null,
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
