import { createHmac } from 'node:crypto';

/**
 * Coordinator hooks for a game-thread native-body custody provider. A controller lease
 * alone cannot park a living mob; only install a provider that owns the physical body,
 * its local controller, and the confirmation journal. No provider is configured by default.
 */
const supported = new Set(['maid', 'villager']);
const playerKinds = new Set(['mineflayer', 'numen']);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const digest = /^[0-9a-f]{64}$/;

function nativeRequest(kind, phase, context) {
  const body = ['park', 'fence', 'cancel'].includes(phase) ? context?.source : context?.target;
  const player = playerKinds.has(kind);
  const entityUuid = player ? body?.playerUuid : body?.entityUuid;
  if (!body || body.kind !== kind || typeof body.bodyId !== 'string' || !id.test(body.bodyId) ||
      typeof entityUuid !== 'string' || !uuid.test(entityUuid) ||
      (player ? body.entityUuid !== undefined : body.playerUuid !== undefined) ||
      typeof context.characterId !== 'string' || !id.test(context.characterId) ||
      typeof context.operationId !== 'string' || !id.test(context.operationId) ||
      typeof context.ownerId !== 'string' || !uuid.test(context.ownerId) ||
      !Number.isSafeInteger(context.generation) || context.generation < 1) {
    throw new TypeError('Invalid registered native body handoff');
  }
  return Object.freeze({
    phase, kind, bodyId: body.bodyId, entityUuid,
    operationId: context.operationId, characterId: context.characterId,
    ownerId: context.ownerId, generation: context.generation,
  });
}

function matches(request, receipt) {
  return receipt && Object.entries(request).every(([key, value]) => receipt[key] === value);
}

function parked(receipt) {
  return receipt.physicalState === 'parked' && receipt.controllerState === 'fenced' &&
    receipt.recoveryAdmission === 'held_in_all_worlds' &&
    typeof receipt.snapshotSha256 === 'string' && digest.test(receipt.snapshotSha256);
}

function result(request, state) {
  const uuidField = playerKinds.has(request.kind) ? 'playerUuid' : 'entityUuid';
  return { state, bodyId: request.bodyId, [uuidField]: request.entityUuid };
}

function committed(phase, receipt) {
  if (receipt.durable !== true || receipt.state !== 'committed') return false;
  return phase === 'park' ? parked(receipt)
    : receipt.physicalState === 'active' && receipt.controllerState === 'exclusive' &&
      receipt.originalIdentityVerified === true && receipt.snapshotRestored === true;
}

function hooks(kind, provider) {
  async function apply(phase, context) {
    const request = nativeRequest(kind, phase, context);
    // A lost POST might already have changed the world. Only the coordinator can resolve
    // that original operation; never automatically dispatch it again from here.
    const receipt = await provider[phase](request);
    if (matches(request, receipt)) {
      if (receipt.state === 'blocked' && receipt.effectsApplied === false) {
        // The coordinator may reopen the old control loop after a refusal. An unloaded
        // or missing source cannot prove the original loop is safe to resume.
        if (phase !== 'park' || (receipt.physicalState === 'active' && receipt.controllerState === 'exclusive')) {
          return result(request, 'blocked');
        }
      }
      if (committed(phase, receipt)) return result(request, phase === 'park' ? 'released' : 'acquired');
    }
    return result(request, 'unknown');
  }

  return Object.freeze({
    async preflight(context) {
      const request = nativeRequest(kind, 'inspect', context);
      const receipt = await provider.inspect(request);
      const sameOriginal = playerKinds.has(kind) && context.source.playerUuid === context.target.playerUuid &&
        receipt?.physicalState === 'shared_original' && receipt.controllerState === 'reserved_after_release';
      return Boolean(matches(request, receipt) && receipt.available === true && (parked(receipt) || sameOriginal));
    },
    release(context) { return apply('park', context); },
    acquire(context) { return apply('resume', context); },
    ...(provider.result ? { async result(context) {
      const phase = context.source.kind === kind ? 'park' : 'resume';
      const generation = phase === 'park' ? context.generation - 1 : context.generation;
      const request = nativeRequest(kind, phase, { ...context, generation });
      const receipt = await provider.result({ ...request, phase: 'result', originalPhase: phase });
      const verified = matches(request, receipt) && committed(phase, receipt);
      return {
        ...result(request, verified ? (phase === 'park' ? 'released' : 'acquired') : 'unknown'),
        generation: context.generation,
        operationId: context.operationId,
      };
    } } : {}),
  });
}

/** Keys are advertised only for complete, explicitly registered native providers. */
export function nativeEntityHandoffAdapters(providers = {}) {
  const adapters = {};
  for (const [kind, provider] of Object.entries(providers)) {
    if (!supported.has(kind) || !provider || ['inspect', 'park', 'resume'].some(key => typeof provider[key] !== 'function')) {
      throw new TypeError('Expected a native maid or villager custody provider with inspect, park and resume');
    }
    adapters[kind] = hooks(kind, provider);
  }
  return Object.freeze(adapters);
}

function driverProof(proof, state, request) {
  return proof?.state === state && proof.bodyId === request.bodyId &&
    proof.playerUuid === request.entityUuid && proof.entityUuid === undefined;
}

/** A game opt-in wraps the original player adapters with physical custody.
 * The original test of the connection and durable save still takes place. */
export function combinedBodyHandoffAdapters(provider, adapters) {
  if (['inspect', 'park', 'resume', 'fence', 'cancel', 'admit', 'result'].some(method => typeof provider?.[method] !== 'function')) {
    throw new TypeError('Combined custody requires the game-side control and original receipt endpoints');
  }
  const combined = { ...nativeEntityHandoffAdapters({ maid: provider, villager: provider }) };
  for (const kind of playerKinds) {
    const driver = adapters[kind];
    if (!driver?.release || !driver?.acquire || !driver?.preflight) continue;
    const native = hooks(kind, provider);
    combined[kind] = {
      ...native,
      async preflight(context) {
        return await driver.preflight(context) === true && await native.preflight(context);
      },
      async release(context) {
        const request = nativeRequest(kind, 'fence', context);
        const fence = await provider.fence(request);
        if (!matches(request, fence)) return result(request, 'unknown');
        if (fence.state === 'blocked' && fence.effectsApplied === false &&
            fence.physicalState === 'active' && fence.controllerState === 'exclusive') return result(request, 'blocked');
        if (fence.state !== 'committed' || fence.durable !== true ||
            fence.controllerState !== 'fenced') return result(request, 'unknown');
        const released = await driver.release(context);
        if (driverProof(released, 'blocked', request)) {
          const cancel = nativeRequest(kind, 'cancel', context);
          const receipt = await provider.cancel(cancel);
          return result(request, matches(cancel, receipt) && receipt.state === 'committed' &&
            receipt.durable === true && receipt.physicalState === 'active' &&
            receipt.controllerState === 'exclusive' ? 'blocked' : 'unknown');
        }
        if (!driverProof(released, 'released', request)) return result(request, 'unknown');
        return native.release(context);
      },
      async acquire(context) {
        const request = nativeRequest(kind, 'admit', context);
        const admitted = await provider.admit(request);
        if (!matches(request, admitted) || admitted.state !== 'committed' ||
            admitted.durable !== true || admitted.controllerState !== 'reserved') return result(request, 'unknown');
        const acquired = await driver.acquire(context);
        if (!driverProof(acquired, 'acquired', request)) return result(request, 'unknown');
        return native.acquire(context);
      },
      complete: driver.complete,
      blocked: driver.blocked,
    };
  }
  if (typeof provider.assets === 'function') {
    for (const [kind, adapter] of Object.entries(combined)) {
      combined[kind] = Object.freeze({ ...adapter, async assets(context) {
        const request = nativeRequest(kind, 'assets', context);
        const receipt = await provider.assets(request);
        if (!matches(request, receipt) || receipt.available !== true || receipt.access !== 'read_only' ||
            receipt.originalPlayerUuid !== context.originalPlayerUuid) return null;
        const { sampledAt, access, carriedInventory, playerInventory, worldPermissions, playerLedgers, villagerCommissions } = receipt;
        return { sampledAt, access, carriedInventory, playerInventory, worldPermissions, playerLedgers, villagerCommissions };
      } });
    }
  }
  return Object.freeze(combined);
}

/** The portal never sees this endpoint or key. The game must independently
 * validate its configured character/body binding before changing a body. */
export function nativeResidentHandoffClient({ endpoint, controlKey, fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/v1/native-resident-handoff' || url.username || url.password || url.search || url.hash ||
      !Buffer.isBuffer(controlKey) || controlKey.length !== 32) {
    throw new Error('Explicit private native body control required');
  }
  async function call(phase, request) {
    if (request?.phase !== phase || (!supported.has(request.kind) && !playerKinds.has(request.kind))) {
      throw new Error('Invalid native body phase');
    }
    const payload = Buffer.from(JSON.stringify({ ...request, expires: Date.now() + 45_000 })).toString('base64url');
    const signature = createHmac('sha256', controlKey).update(payload).digest('base64url');
    const response = await fetcher(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload, signature }),
    });
    if (!response.ok) throw new Error('Original native body receipt unavailable');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16_384) throw new Error('Native body receipt is too large');
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const { originalPhase, ...scope } = request;
    if (originalPhase) scope.phase = originalPhase;
    if (!matches(scope, result)) throw new Error('Original native body receipt does not match');
    return result;
  }
  return {
    inspect: request => call('inspect', request),
    park: request => call('park', request),
    resume: request => call('resume', request),
    fence: request => call('fence', request),
    cancel: request => call('cancel', request),
    admit: request => call('admit', request),
    assets: request => call('assets', request),
    result: request => call('result', request),
  };
}
