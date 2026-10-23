import type { EventEmitter } from 'node:events';

type ProtocolClient = EventEmitter & { state?: string; write: (name: string, ...args: any[]) => any };
const readiness = new WeakMap<EventEmitter, () => boolean>();
const movementPackets = new Set(['position', 'position_look', 'look', 'flying', 'vehicle_move', 'steer_vehicle', 'steer_boat', 'player_input']);

/** Missing installation preserves old fixture/client behavior; an active configuration never means ready. */
export function configurationTransportReady(client: EventEmitter & { state?: string }): boolean {
  return readiness.get(client)?.() ?? (client.state === undefined || client.state === 'play');
}

/** A transfer must not serialize old-world movement using configuration packet IDs.
 * Disabling simulation alone is insufficient: Mineflayer still emits position updates.
 * Resume the saved physics setting only after a fresh PLAY position arrives. */
export function installConfigurationPhaseGuard(bot: { _client: ProtocolClient; physicsEnabled?: boolean }): () => void {
  const client = bot._client, originalWrite = client.write, cleanupReplies = installConfigurationRoundCleanup(client);
  let awaitingPosition = false, savedPhysics: boolean | undefined, disposed = false;
  const enter = (state: string) => {
    if (state !== 'configuration') return;
    awaitingPosition = true;
    if (savedPhysics === undefined && typeof bot.physicsEnabled === 'boolean') savedPhysics = bot.physicsEnabled;
    if (typeof bot.physicsEnabled === 'boolean') bot.physicsEnabled = false;
  };
  const position = () => {
    if (client.state !== 'play') return;
    awaitingPosition = false;
    if (savedPhysics !== undefined) { bot.physicsEnabled = savedPhysics; savedPhysics = undefined; }
  };
  const write: ProtocolClient['write'] = function (name, ...args) {
    if (!disposed && movementPackets.has(name) && (client.state === 'configuration' || awaitingPosition)) return;
    return originalWrite.call(client, name, ...args);
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    cleanupReplies(); readiness.delete(client);
    if (client.write === write) client.write = originalWrite;
    client.removeListener('state', enter); client.removeListener('position', position); client.removeListener('end', dispose);
  };
  client.write = write;
  readiness.set(client, () => (client.state === undefined || client.state === 'play') && !awaitingPosition);
  client.on('state', enter); client.prependListener('position', position); client.once('end', dispose);
  if (client.state === 'configuration') enter(client.state);
  return dispose;
}

/** Expire unanswered one-shot configuration replies before a proxy starts another round.
 * minecraft-protocol may install a known-packs listener even when a login lobby never asks
 * for packs. Keeping it until the backend's next round sends two replies to one request.
 * Persistent observers and listeners that predate the round are left in place. */
export function installConfigurationRoundCleanup(client: EventEmitter): () => void {
  const replies = ['select_known_packs', 'code_of_conduct'];
  const baseline = new Map<string, Set<Function>>();
  let disposed = false;
  const enter = (state: string) => {
    if (state === 'configuration') for (const event of replies) baseline.set(event, new Set(client.rawListeners(event)));
  };
  const finish = () => {
    for (const [event, existing] of baseline) for (const listener of client.rawListeners(event)) {
      if (!existing.has(listener) && typeof (listener as { listener?: unknown }).listener === 'function')
        client.removeListener(event, listener as (...args: unknown[]) => void);
    }
    baseline.clear();
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    finish(); client.removeListener('state', enter); client.removeListener('finish_configuration', finish); client.removeListener('end', dispose);
  };
  client.on('state', enter); client.on('finish_configuration', finish); client.once('end', dispose);
  return dispose;
}
