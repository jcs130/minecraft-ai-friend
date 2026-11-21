import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fail } from './protocol.mjs';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const kinds = new Set(['mineflayer', 'numen', 'maid', 'villager']);
const valid = (pattern, value) => typeof value === 'string' && pattern.test(value);

function binding(value) {
  if (!kinds.has(value?.kind) || !valid(id, value?.bodyId)) throw new Error('Invalid body binding');
  const player = value.kind === 'mineflayer' || value.kind === 'numen';
  const nativeId = player ? value.playerUuid : value.entityUuid;
  if (!valid(uuid, nativeId)) throw new Error('Invalid native body UUID');
  return { kind: value.kind, bodyId: value.bodyId, ...(player ? { playerUuid: nativeId } : { entityUuid: nativeId }) };
}

function canTransfer(source, target, adapters, custody) {
  return !!source && !!target && source.kind !== target.kind &&
    (custody || Boolean(source.playerUuid) === Boolean(target.playerUuid)) &&
    !!adapters[source.kind]?.release && !!adapters[target.kind]?.acquire;
}

function requestIdentity(characterId, requestId) {
  if (!valid(id, characterId) || !valid(id, requestId)) {
    throw fail('BODY_HANDOFF_INVALID_ID', '角色和换身请求编号无效。', 400);
  }
}

function owned(row, ownerId) {
  if (!row || row.owner_id !== ownerId) throw fail('BODY_HANDOFF_NOT_FOUND', '未找到这个已授权的角色。', 404);
  return row;
}

function receipt(row) {
  if (!row) throw fail('BODY_HANDOFF_REQUEST_NOT_FOUND', '未找到原换身请求。', 404);
  return {
    characterId: row.character_id,
    requestId: row.request_id,
    targetKind: row.target,
    status: row.status,
    phase: row.phase,
    generation: row.generation,
    activeKind: row.active_kind,
    reason: row.reason,
  };
}

export class BodyHandoffStore {
  constructor(filename) {
    this.ownsDatabase = typeof filename === 'string';
    this.db = this.ownsDatabase ? new DatabaseSync(filename) : filename;
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS handoff_characters (
        character_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, bindings TEXT NOT NULL,
        active_kind TEXT, generation INTEGER NOT NULL, status TEXT NOT NULL, pending TEXT,
        autonomous INTEGER NOT NULL, combined_custody INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS handoff_bodies (
        native_uuid TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES handoff_characters
      );
      CREATE TABLE IF NOT EXISTS handoff_requests (
        character_id TEXT NOT NULL REFERENCES handoff_characters, request_id TEXT NOT NULL,
        source TEXT NOT NULL, target TEXT NOT NULL, expected_generation INTEGER NOT NULL,
        status TEXT NOT NULL, phase TEXT NOT NULL, active_kind TEXT, generation INTEGER NOT NULL,
        reason TEXT, PRIMARY KEY (character_id, request_id)
      );
    `);
    if (!this.db.prepare("PRAGMA table_info(handoff_characters)").all().some(column => column.name === 'combined_custody')) {
      this.db.exec('ALTER TABLE handoff_characters ADD COLUMN combined_custody INTEGER NOT NULL DEFAULT 0');
    }
  }

  close() { if (this.ownsDatabase) this.db.close(); }

  transaction(run) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  register({ characterId, ownerId, active, targets, generation = 1, autonomous = false, combinedCustody = false }) {
    if (!valid(id, characterId) || !valid(uuid, ownerId) || !Number.isSafeInteger(generation) || generation < 1 ||
        !Array.isArray(targets) || targets.length < 1) throw new Error('Invalid character registration');
    const start = binding(active);
    const bindings = [start, ...targets.map(binding)].sort((left, right) => left.kind.localeCompare(right.kind));
    const players = bindings.filter(body => body.playerUuid);
    if (new Set(bindings.map(body => body.kind)).size !== bindings.length ||
        new Set(players.map(body => body.playerUuid)).size > 1 ||
        new Set(bindings.filter(body => body.entityUuid).map(body => body.entityUuid)).size !== bindings.length - players.length ||
        bindings.some(body => body.entityUuid && body.entityUuid === players[0]?.playerUuid)) {
      throw new Error('Ambiguous native body binding');
    }
    if (combinedCustody && (!players.length || players.length === bindings.length)) {
      throw new Error('Combined body custody requires an original player and a registered native body');
    }
    return this.transaction(() => {
      const saved = this.character(characterId);
      const encoded = JSON.stringify(bindings);
      if (saved) {
        if (saved.owner_id !== ownerId || saved.bindings !== encoded ||
            saved.combined_custody !== Number(combinedCustody === true)) throw new Error('Stored character binding changed');
        this.db.prepare('UPDATE handoff_characters SET autonomous = ? WHERE character_id = ?')
          .run(Number(autonomous === true), characterId);
        return;
      }
      this.db.prepare("INSERT INTO handoff_characters (character_id, owner_id, bindings, active_kind, generation, status, pending, autonomous, combined_custody) VALUES (?, ?, ?, ?, ?, 'ready', NULL, ?, ?)")
        .run(characterId, ownerId, encoded, start.kind, generation, Number(autonomous === true), Number(combinedCustody === true));
      const insert = this.db.prepare('INSERT INTO handoff_bodies VALUES (?, ?)');
      for (const nativeId of new Set(bindings.map(body => body.playerUuid ?? body.entityUuid))) insert.run(nativeId, characterId);
    });
  }

  character(characterId) {
    return this.db.prepare('SELECT * FROM handoff_characters WHERE character_id = ?').get(characterId);
  }

  characters(ownerId) {
    return this.db.prepare('SELECT * FROM handoff_characters WHERE owner_id = ? ORDER BY character_id').all(ownerId);
  }

  forNativeBody(nativeId) {
    return this.db.prepare('SELECT c.* FROM handoff_characters c JOIN handoff_bodies b USING (character_id) WHERE b.native_uuid = ?').get(nativeId);
  }

  // The hosting service holds its existing exclusive process-owner SQLite lock.
  // A crashed worker is never replaced by a replay of release or acquire.
  markInterrupted() {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT * FROM handoff_characters WHERE status = 'switching'").all();
      const markRequest = this.db.prepare("UPDATE handoff_requests SET status = 'recovery_required', active_kind = NULL, generation = ?, reason = 'SERVICE_RESTART' WHERE character_id = ? AND request_id = ?");
      const markCharacter = this.db.prepare("UPDATE handoff_characters SET status = 'recovery_required', active_kind = NULL, generation = ? WHERE character_id = ?");
      for (const row of rows) {
        const phase = this.request(row.character_id, row.pending).phase;
        const generation = row.generation + Number(phase === 'releasing');
        markRequest.run(generation, row.character_id, row.pending);
        markCharacter.run(generation, row.character_id);
      }
    });
  }

  request(characterId, requestId) {
    return this.db.prepare('SELECT * FROM handoff_requests WHERE character_id = ? AND request_id = ?').get(characterId, requestId);
  }

  begin({ characterId, requestId, targetKind, expectedGeneration }, ownerId, adaptersFor) {
    return this.transaction(() => {
      const row = owned(this.character(characterId), ownerId);
      const existing = this.request(characterId, requestId);
      if (existing) {
        if (existing.target !== targetKind || existing.expected_generation !== expectedGeneration) {
          throw fail('BODY_HANDOFF_REQUEST_CONFLICT', '此请求编号已用于另一项换身请求。', 409);
        }
        return { result: receipt(existing) };
      }
      if (row.status !== 'ready') throw fail('BODY_HANDOFF_BUSY', '请先查询原换身请求。', 409);
      if (row.generation !== expectedGeneration) throw fail('BODY_HANDOFF_STALE', '控制版本已改变，请重新读取角色状态。', 409);
      const bindings = JSON.parse(row.bindings);
      const source = bindings.find(body => body.kind === row.active_kind);
      const target = bindings.find(body => body.kind === targetKind);
      if (!canTransfer(source, target, adaptersFor(row), row.combined_custody === 1)) {
        throw fail('BODY_HANDOFF_TARGET_UNAVAILABLE', '该角色没有可用的目标身体。', 409);
      }
      this.db.prepare("INSERT INTO handoff_requests VALUES (?, ?, ?, ?, ?, 'switching', 'releasing', ?, ?, NULL)")
        .run(characterId, requestId, source.kind, targetKind, expectedGeneration, source.kind, row.generation);
      this.db.prepare("UPDATE handoff_characters SET status = 'switching', pending = ? WHERE character_id = ?")
        .run(requestId, characterId);
      return { context: Object.freeze({
        operationId: requestId, characterId, ownerId, generation: row.generation, combinedCustody: row.combined_custody === 1,
        source: Object.freeze(source), target: Object.freeze(target),
      }) };
    });
  }

  transition(context, step, reason = null) {
    const { characterId, operationId, source, target } = context;
    return this.transaction(() => {
      const row = this.character(characterId);
      const operation = this.request(characterId, operationId);
      if (row?.pending !== operationId || operation.status !== 'switching') throw new Error('Lost handoff transaction');
      let activeKind = null;
      let generation = row.generation;
      let status = 'recovery_required';
      let phase = operation.phase;
      if (step === 'blocked' && phase === 'releasing') {
        activeKind = source.kind;
        status = 'blocked';
      } else if (step === 'released' && phase === 'releasing') {
        generation++;
        status = 'switching';
        phase = 'acquiring';
      } else if (step === 'acquired' && phase === 'acquiring') {
        activeKind = target.kind;
        status = 'completed';
        phase = 'completed';
      } else if (phase === 'releasing') {
        generation++;
      }
      const pending = status === 'switching' || status === 'recovery_required';
      this.db.prepare('UPDATE handoff_requests SET status = ?, phase = ?, active_kind = ?, generation = ?, reason = ? WHERE character_id = ? AND request_id = ?')
        .run(status, phase, activeKind, generation, reason, characterId, operationId);
      this.db.prepare('UPDATE handoff_characters SET status = ?, active_kind = ?, generation = ?, pending = ? WHERE character_id = ?')
        .run(pending ? status : 'ready', activeKind, generation, pending ? operationId : null, characterId);
      return receipt(this.request(characterId, operationId));
    });
  }

  settleRecovered(row, operation, activeKind, status) {
    return this.transaction(() => {
      const current = this.character(row.character_id);
      if (current.status !== 'recovery_required' || current.pending !== operation.request_id ||
          current.generation !== row.generation) return null;
      this.db.prepare('UPDATE handoff_requests SET status = ?, phase = ?, active_kind = ?, reason = ? WHERE character_id = ? AND request_id = ?')
        .run(status, 'reconciled', activeKind, 'ORIGINAL_RECEIPTS_CONFIRMED', row.character_id, operation.request_id);
      this.db.prepare("UPDATE handoff_characters SET status = 'ready', active_kind = ?, pending = NULL WHERE character_id = ?")
        .run(activeKind, row.character_id);
      return receipt(this.request(row.character_id, operation.request_id));
    });
  }
}

function proves(result, state, body) {
  return result?.state === state && result.bodyId === body.bodyId &&
    result.playerUuid === body.playerUuid && result.entityUuid === body.entityUuid;
}

export class BodyHandoffCoordinator {
  constructor({ store, adapters, combinedAdapters = {}, onProblem = () => {} }) {
    this.store = store;
    this.adapters = adapters;
    this.combinedAdapters = combinedAdapters;
    this.onProblem = onProblem;
    this.processing = new Set();
  }

  adaptersFor(row) { return row.combined_custody === 1 ? this.combinedAdapters : this.adapters; }

  describe(row) {
    const bodies = JSON.parse(row.bindings);
    const active = bodies.find(body => body.kind === row.active_kind);
    const adapters = this.adaptersFor(row);
    const targetKinds = row.status === 'ready'
      ? bodies.filter(body => canTransfer(active, body, adapters, row.combined_custody === 1)).map(body => body.kind)
      : [];
    return {
      characterId: row.character_id, activeKind: row.active_kind, targetKinds,
      generation: row.generation, status: row.status, pendingRequestId: row.pending, autonomous: row.autonomous === 1,
    };
  }

  list({ ownerId }) { return this.store.characters(ownerId).map(row => this.describe(row)); }

  current(characterId, { ownerId }) {
    if (!valid(id, characterId)) throw fail('BODY_HANDOFF_INVALID_ID', '角色编号无效。', 400);
    return this.describe(owned(this.store.character(characterId), ownerId));
  }

  lookup({ characterId, requestId }, { ownerId }) {
    requestIdentity(characterId, requestId);
    owned(this.store.character(characterId), ownerId);
    return receipt(this.store.request(characterId, requestId));
  }

  async assets(characterId, { ownerId }) {
    const state = this.current(characterId, { ownerId });
    if (state.status !== 'ready') throw fail('BODY_HANDOFF_BUSY', '角色交接期间请先查询原换身请求。', 409);
    const row = this.store.character(characterId);
    const bodies = JSON.parse(row.bindings);
    const active = bodies.find(body => body.kind === state.activeKind);
    const originalPlayerUuid = bodies.find(body => body.playerUuid)?.playerUuid;
    const read = this.adaptersFor(row)[active.kind]?.assets;
    if (!read || !originalPlayerUuid) throw fail('BODY_ASSETS_UNAVAILABLE', '该角色当前没有可读取的原玩家账簿。', 409);
    const assets = await read({
      characterId, ownerId, generation: state.generation, operationId: randomUUID(), target: active, originalPlayerUuid,
    });
    this.assertControl({ characterId, kind: active.kind, bodyId: active.bodyId, generation: state.generation }, { ownerId });
    if (!assets) throw fail('BODY_ASSETS_UNAVAILABLE', '游戏服尚未确认该角色的原玩家账簿。', 409);
    return assets;
  }

  async reconcile({ characterId, requestId }, { ownerId }) {
    requestIdentity(characterId, requestId);
    const row = owned(this.store.character(characterId), ownerId);
    const operation = this.store.request(characterId, requestId);
    const prior = receipt(operation);
    if (prior.status !== 'recovery_required' || row.pending !== requestId) return prior;
    const bindings = JSON.parse(row.bindings);
    const target = bindings.find(body => body.kind === operation.target);
    const source = bindings.find(body => body.kind === operation.source);
    if (!source || !target) return prior;
    const adapters = this.adaptersFor(row);
    const readSource = adapters[source.kind]?.result;
    const readTarget = adapters[target.kind]?.result;
    if (!readSource || !readTarget) return prior;
    const cursor = Object.freeze({
      characterId, operationId: requestId, ownerId, generation: row.generation, combinedCustody: row.combined_custody === 1,
      source: Object.freeze(source), target: Object.freeze(target),
    });
    // Only conclusive native receipts for the original operation can end recovery.
    let oldReceipt, newReceipt;
    try {
      [oldReceipt, newReceipt] = await Promise.all([
        readSource(cursor), readTarget(cursor),
      ]);
    }
    catch { return prior; }
    const matches = result => result?.operationId === requestId && result.generation === row.generation;
    if (!matches(oldReceipt) || !matches(newReceipt)) return prior;
    if (proves(oldReceipt, 'released', source) && proves(newReceipt, 'acquired', target)) {
      const result = this.store.settleRecovered(row, operation, target.kind, 'completed');
      if (result) await this.notifyDriver(adapters[target.kind], 'complete', cursor, result);
      return result ?? this.lookup({ characterId, requestId }, { ownerId });
    }
    if (proves(oldReceipt, 'retained', source) && proves(newReceipt, 'absent', target)) {
      const result = this.store.settleRecovered(row, operation, source.kind, 'blocked');
      if (result) await this.notifyDriver(adapters[source.kind], 'blocked', cursor, result);
      return result ?? this.lookup({ characterId, requestId }, { ownerId });
    }
    return prior;
  }

  assertControl({ characterId, kind, bodyId, generation }, { ownerId }) {
    if (!valid(id, characterId)) throw fail('BODY_HANDOFF_INVALID_ID', '角色编号无效。', 400);
    const row = owned(this.store.character(characterId), ownerId);
    if (row.status !== 'ready' || row.active_kind !== kind || row.generation !== generation ||
        !JSON.parse(row.bindings).some(body => body.kind === kind && body.bodyId === bodyId)) {
      throw fail('BODY_HANDOFF_CONTROL_CHANGED', '此身体的控制权已改变。', 409);
    }
  }

  authorizeController({ characterId, kind, bodyId, generation }, { ownerId }) {
    this.assertControl({ characterId, kind, bodyId, generation }, { ownerId });
    if (this.store.character(characterId).autonomous !== 1) {
      throw fail('BODY_HANDOFF_AUTONOMY_DISABLED', '该角色尚未授权自主换身。', 403);
    }
  }

  reserve(params, ownerId) {
    requestIdentity(params.characterId, params.requestId);
    if (!kinds.has(params.targetKind) || !Number.isSafeInteger(params.expectedGeneration) ||
        params.expectedGeneration < 1 || params.expectedGeneration >= Number.MAX_SAFE_INTEGER) {
      throw fail('BODY_HANDOFF_INVALID_REQUEST', '目标身体或控制版本无效。', 400);
    }
    return this.store.begin(params, ownerId, row => this.adaptersFor(row));
  }

  async switchBody(params, { ownerId }) {
    const { result, context } = this.reserve(params, ownerId);
    return result ?? await this.run(context);
  }

  enqueue(params, { ownerId }) {
    const { result, context } = this.reserve(params, ownerId);
    if (result) return result;
    const pending = this.lookup(params, { ownerId });
    setImmediate(() => {
      this.run(context).catch(() => this.onProblem({ code: 'BODY_HANDOFF_STORAGE_ERROR', characterId: context.characterId }));
    });
    return pending;
  }

  controllerSwitch(params, controller, authority) {
    const current = this.current(params.characterId, authority);
    if (controller.characterId !== current.characterId || params.expectedGeneration !== controller.generation) {
      throw fail('BODY_HANDOFF_CONTROL_CHANGED', '此身体的控制授权无效。', 409);
    }
    if (!this.store.request(params.characterId, params.requestId)) this.authorizeController(controller, authority);
    return this.enqueue(params, authority);
  }

  controllerPort(controller, authority) {
    const bound = Object.freeze({ ...controller });
    const owner = Object.freeze({ ownerId: authority.ownerId });
    return async message => {
      if (message?.characterId !== bound.characterId) {
        throw fail('BODY_HANDOFF_CONTROL_CHANGED', '客户端未获授权管理该角色。', 403);
      }
      const { characterId, requestId, targetKind, expectedGeneration } = message;
      if (message.op === 'current') return this.current(characterId, owner);
      if (message.op === 'lookup') return this.reconcile({ characterId, requestId }, owner);
      if (message.op === 'controllerSwitch') {
        return this.controllerSwitch({ characterId, requestId, targetKind, expectedGeneration }, bound, owner);
      }
      throw fail('BODY_HANDOFF_INVALID_REQUEST', '不支持该换身操作。', 400);
    };
  }

  async run(context) {
    const job = this.transfer(context);
    this.processing.add(job);
    try { return await job; } finally { this.processing.delete(job); }
  }

  async close() {
    await new Promise(resolve => setImmediate(resolve));
    await Promise.allSettled([...this.processing]);
  }

  async finishBlocked(context, reason) {
    const result = this.store.transition(context, 'blocked', reason);
    await this.notifyDriver(this.portsFor(context)[context.source.kind], 'blocked', context, result);
    return result;
  }

  portsFor(context) { return context.combinedCustody ? this.combinedAdapters : this.adapters; }

  async notifyDriver(adapter, method, context, result) {
    try { await adapter?.[method]?.(context, result); }
    catch { this.onProblem({ code: 'BODY_HANDOFF_RECEIPT_NOT_DELIVERED', characterId: context.characterId }); }
  }

  async transfer(context) {
    const adapters = this.portsFor(context);
    const source = adapters[context.source.kind];
    const target = adapters[context.target.kind];
    let ready = true;
    try {
      // A failed preflight leaves the old driver in place and doesn't consume its generation.
      if (target.preflight) ready = await target.preflight(context) === true;
    } catch {
      ready = false;
    }
    if (!ready) return this.finishBlocked(context, 'TARGET_NOT_READY');
    let release;
    try {
      release = await source.release(context);
    } catch {
      return this.store.transition(context, 'unknown', 'SOURCE_RELEASE_UNCONFIRMED');
    }
    if (proves(release, 'blocked', context.source)) {
      return this.finishBlocked(context, 'SOURCE_NOT_READY');
    }
    if (!proves(release, 'released', context.source)) {
      return this.store.transition(context, 'unknown', 'SOURCE_RELEASE_UNCONFIRMED');
    }
    const released = this.store.transition(context, 'released');
    const successor = Object.freeze({ ...context, generation: released.generation });
    let acquire;
    try {
      acquire = await target.acquire(successor);
    } catch {
      return this.store.transition(successor, 'unknown', 'TARGET_ACQUIRE_UNCONFIRMED');
    }
    if (!proves(acquire, 'acquired', context.target)) {
      return this.store.transition(successor, 'unknown', 'TARGET_ACQUIRE_UNCONFIRMED');
    }
    const result = this.store.transition(successor, 'acquired');
    // A desktop may still be awaiting the committed generation. If delivery
    // fails it can fetch this original receipt, without reconnecting again.
    await this.notifyDriver(target, 'complete', successor, result);
    return result;
  }
}
