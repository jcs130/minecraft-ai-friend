import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const generation = value => Number.isSafeInteger(value) && value >= 1;
const hash = value => createHash('sha256').update(value).digest('hex');
const kinds = new Set(['mineflayer', 'numen', 'maid', 'villager']);
const failure = (status, code) => Object.assign(new Error(code), { status, code });

/**
 * One authorized enrollment, one desktop process, one exact player binding.
 * Enrollment and coordinator injection belong to the trusted host.
 */
export function createDeviceHandoffBroker({
  clock = Date.now, timeoutMs = 30_000, heartbeatMs = 6000, maxEnrollments = 64,
} = {}) {
  const credentials = new Map();
  const bindings = new Map();
  const endpoint = '/v1/device-handoff';
  let coordinator;

  function revoke(device) {
    credentials.delete(device.key);
    bindings.delete(device.binding.characterId);
    for (const entry of device.commands.values()) {
      if (entry.state === 'queued' || entry.state === 'issued') {
        entry.finish('unknown', undefined);
      }
    }
  }

  function enroll(binding, { ttlMs = 8 * 60 * 60_000 } = {}) {
    const { ownerId, characterId, playerUuid, bodyId } = binding;
    if (![ownerId, characterId, bodyId].every(id) || !uuid(playerUuid) ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 24 * 60 * 60_000) {
      throw failure(400, 'DEVICE_BINDING_INVALID');
    }
    if (!coordinator) throw failure(503, 'DEVICE_HOST_UNAVAILABLE');
    coordinator.current(characterId, { ownerId });
    const row = coordinator.store.character(characterId);
    if (!JSON.parse(row.bindings).some(body => body.kind === 'mineflayer' &&
        body.bodyId === bodyId && body.playerUuid === playerUuid)) throw failure(403, 'DEVICE_SCOPE_MISMATCH');
    for (const existing of bindings.values()) if (clock() >= existing.expiresAt) revoke(existing);
    if (bindings.has(characterId)) throw failure(409, 'DEVICE_ALREADY_ENROLLED');
    if (bindings.size >= maxEnrollments) throw failure(503, 'DEVICE_CAPACITY');
    const token = 'qdh_' + randomBytes(32).toString('base64url');
    const key = hash(token), expiresAt = clock() + ttlMs;
    const device = { key, expiresAt, binding: { ownerId, characterId, playerUuid, bodyId },
      instanceId: null, generation: null, lastSeen: 0, commands: new Map(), inflight: null };
    bindings.set(characterId, device);
    credentials.set(key, device);
    return { token, expiresAt, endpoint };
  }

  function ownedBinding(characterId, { ownerId }) {
    coordinator.current(characterId, { ownerId });
    const body = JSON.parse(coordinator.store.character(characterId).bindings).find(row => row.kind === 'mineflayer');
    if (!body) throw failure(404, 'DEVICE_BODY_UNAVAILABLE');
    return { characterId, ownerId, bodyId: body.bodyId, playerUuid: body.playerUuid };
  }

  function authenticate(authorization, body) {
    const match = /^Bearer (qdh_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    const device = match && credentials.get(hash(match[1]));
    if (!device || clock() >= device.expiresAt) {
      if (device) revoke(device);
      throw failure(401, 'DEVICE_UNAUTHORIZED');
    }
    if (!uuid(body.instanceId) || body.characterId !== device.binding.characterId) {
      throw failure(403, 'DEVICE_SCOPE_MISMATCH');
    }
    if (!device.instanceId && body.op === 'hello') device.instanceId = body.instanceId;
    if (device.instanceId !== body.instanceId) throw failure(409, 'DEVICE_INSTANCE_CONFLICT');
    device.lastSeen = clock();
    return device;
  }

  function correlation(device, entry) {
    return { commandId: entry.command.commandId, requestId: entry.command.requestId,
      generation: entry.command.generation, action: entry.command.action, characterId: device.binding.characterId };
  }

  function commandResult(action, value, playerUuid) {
    if (action === 'ready' && typeof value === 'boolean') return value;
    if ((action === 'witness' || action === 'refresh') && value === null) return undefined;
    if (action === 'release' && ['blocked', 'disconnected'].includes(value?.state)) return { state: value.state };
    if (action === 'connect' && value?.state === 'connected' && value.playerUuid === playerUuid) {
      return { state: value.state, playerUuid };
    }
    throw failure(400, 'DEVICE_REPLY_INVALID');
  }

  async function dispatch(authorization, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(400, 'DEVICE_REQUEST_INVALID');
    const device = authenticate(authorization, body);
    const { characterId, ownerId, bodyId, playerUuid } = device.binding;
    const owner = { ownerId };
    const current = coordinator.current(characterId, owner);
    if (body.op === 'hello') {
      device.generation ??= current.generation;
      return { characterId, playerUuid, generation: device.generation };
    }
    if (body.op === 'next') {
      const entry = device.inflight;
      if (entry?.state !== 'queued') return { command: null };
      entry.state = 'issued';
      return { command: { ...entry.command } };
    }
    if (body.op === 'answer') {
      const entry = [...device.commands.values()].find(row => row.command.commandId === body.commandId);
      if (!entry || Object.entries(correlation(device, entry)).some(([field, expected]) => body[field] !== expected)) {
        throw failure(409, 'DEVICE_REPLY_MISMATCH');
      }
      if (!['issued', 'completed', 'declined'].includes(entry.state)) throw failure(409, 'DEVICE_REPLY_CLOSED');
      if (typeof body.ok !== 'boolean') throw failure(400, 'DEVICE_REPLY_INVALID');
      const result = body.ok ? commandResult(entry.command.action, body.result, playerUuid) : undefined;
      const state = body.ok ? 'completed' : 'declined';
      if (entry.state === 'issued') {
        if (state === 'completed' && entry.command.action === 'connect') device.generation = entry.command.generation;
        entry.finish(state, result);
      }
      if (entry.state !== state || JSON.stringify(entry.result) !== JSON.stringify(result)) {
        throw failure(409, 'DEVICE_REPLY_CONFLICT');
      }
      return { accepted: true };
    }
    if (body.op === 'current') return current;
    if (!id(body.requestId)) throw failure(400, 'DEVICE_REQUEST_INVALID');
    if (body.op === 'lookup') return coordinator.lookup({ characterId, requestId: body.requestId }, owner);
    if (body.op === 'controllerSwitch' && generation(body.expectedGeneration) && kinds.has(body.targetKind)) {
      if (body.expectedGeneration !== device.generation) throw failure(409, 'DEVICE_SCOPE_CHANGED');
      const port = coordinator.controllerPort({ characterId, bodyId, kind: 'mineflayer',
        generation: body.expectedGeneration }, owner);
      return port({ op: body.op, characterId, requestId: body.requestId, targetKind: body.targetKind,
        expectedGeneration: body.expectedGeneration });
    }
    throw failure(400, 'DEVICE_REQUEST_INVALID');
  }

  function issue(device, action, issuedGeneration, requestId, nonce) {
    if (!id(requestId) || !generation(issuedGeneration)) throw failure(400, 'DEVICE_COMMAND_INVALID');
    const key = JSON.stringify([requestId, issuedGeneration, action]);
    if (device.commands.has(key)) {
      const existing = device.commands.get(key);
      if (existing.command.nonce !== nonce) throw failure(409, 'DEVICE_COMMAND_CONFLICT');
      return existing.promise;
    }
    if (device.inflight || device.commands.size >= 1024) throw failure(409, 'DEVICE_COMMAND_BUSY');
    const command = { commandId: randomUUID(), action, requestId, generation: issuedGeneration, ...(nonce ? { nonce } : {}) };
    const entry = { command, state: 'queued', result: undefined };
    entry.promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => entry.finish('unknown', undefined), timeoutMs);
      timer.unref();
      entry.finish = (state, result) => {
        clearTimeout(timer);
        entry.state = state;
        entry.result = result;
        if (device.inflight === entry) device.inflight = null;
        if (state === 'completed') resolve(result);
        else reject(failure(409, state === 'unknown' ? 'DEVICE_RESULT_UNKNOWN' : 'DEVICE_COMMAND_DECLINED'));
      };
    });
    device.commands.set(key, entry);
    device.inflight = entry;
    return entry.promise;
  }

  function clientFor(characterId, playerUuid, context) {
    const device = bindings.get(characterId);
    if (!device?.instanceId || device.binding.playerUuid !== playerUuid || clock() >= device.expiresAt ||
        clock() - device.lastSeen > heartbeatMs || !generation(context?.generation)) return null;
    const currentGeneration = context.generation;
    const run = (action, requestId, nonce) => issue(device, action, currentGeneration, requestId, nonce);
    // A port minted before a revoke must never dispatch onto a replacement enrollment.
    const exactGeneration = input => {
      if (input !== currentGeneration || credentials.get(device.key) !== device || clock() >= device.expiresAt) {
        throw failure(409, 'DEVICE_SCOPE_CHANGED');
      }
    };
    return {
      readyForHandoff(requestId, nextGeneration) { exactGeneration(nextGeneration); return run('ready', requestId); },
      witnessBodyHandoff({ requestId, generation: version, nonce }) {
        exactGeneration(version);
        if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{32,64}$/.test(nonce)) throw failure(400, 'DEVICE_WITNESS_INVALID');
        return run('witness', requestId, nonce);
      },
      releaseForBodyHandoff({ requestId, generation: version }) { exactGeneration(version); return run('release', requestId); },
      connectForBodyHandoff(requestId) { exactGeneration(currentGeneration); return run('connect', requestId); },
      refreshBodyHandoff(requestId) { exactGeneration(currentGeneration); return run('refresh', requestId); },
    };
  }

  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  async function handle(req, res) {
    if (req.url !== endpoint || req.method !== 'POST') return json(res, 404, { error: 'NOT_FOUND' });
    try {
      if (req.headers.origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
        throw failure(400, 'DEVICE_REQUEST_INVALID');
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) throw failure(413, 'DEVICE_REQUEST_TOO_LARGE');
        chunks.push(chunk);
      }
      const value = await dispatch(req.headers.authorization, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return json(res, 200, { value });
    } catch (error) {
      // Keep device credentials, game secrets and native errors out of HTTP responses.
      return json(res, error instanceof SyntaxError ? 400 : error.status ?? 503,
        { error: /^[A-Z_]{1,80}$/.test(error.code ?? '') ? error.code : 'DEVICE_REQUEST_FAILED' });
    }
  }

  return {
    attach(handoff) {
      if (coordinator && handoff !== coordinator) throw failure(409, 'DEVICE_HOST_ALREADY_ATTACHED');
      coordinator = handoff;
    },
    enroll, clientFor, handle,
    available(characterId, authority) {
      ownedBinding(characterId, authority);
      return { eligible: true };
    },
    enrollOwned(characterId, authority) {
      return enroll(ownedBinding(characterId, authority));
    },
    revokeOwned(characterId, authority) {
      ownedBinding(characterId, authority);
      const device = bindings.get(characterId);
      if (device) revoke(device);
      return { revoked: true };
    },
    revoke(characterId) {
      const device = bindings.get(characterId);
      if (device) revoke(device);
    },
    async listen(port = 0) {
      const server = createServer(handle);
      server.requestTimeout = 8000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      return server;
    },
  };
}
