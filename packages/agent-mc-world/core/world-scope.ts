import { randomUUID } from 'node:crypto';
import type { Bot } from 'mineflayer';
import type { WorldIdentityObservation } from '../src/contracts/world-scope.ts';

interface State {
  connection: string;
  key: string | null;
  revision: number;
  source: WorldIdentityObservation['source'];
  observedAt: string | null;
  dispose?: () => void;
}
const states = new WeakMap<Bot, State>();
function stateOf(bot: Bot): State {
  let state = states.get(bot);
  if (!state) {
    state = { connection: randomUUID(), key: null, revision: 0, source: 'unknown', observedAt: null };
    states.set(bot, state);
  }
  return state;
}
function levelKey(packet: unknown): string | null {
  if (!packet || typeof packet !== 'object') return null;
  const value = packet as Record<string, unknown>;
  const nested = value.worldState;
  const key = nested && typeof nested === 'object'
    ? (nested as Record<string, unknown>).name : value.worldName;
  // Accept only the protocol field. Do not substitute dimension/type, registry entries or chat text.
  return typeof key === 'string' && key.length > 0 && key.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(key)
    ? key : null;
}

/** Attach to the existing connection only; does not connect, poll, send commands or mutate bot.game. */
export function installWorldIdentity(bot: Bot): () => void {
  const state = stateOf(bot);
  if (state.dispose) return state.dispose;
  const client = bot._client;
  let disposed = false;
  const observe = (source: 'vanilla-login' | 'vanilla-respawn', packet: unknown) => {
    if (disposed) return;
    const key = levelKey(packet);
    if (key !== state.key || key === null) state.revision++;
    state.key = key;
    state.source = key === null ? 'unknown' : source;
    state.observedAt = new Date().toISOString();
  };
  const login = (packet: unknown) => observe('vanilla-login', packet);
  const respawn = (packet: unknown) => observe('vanilla-respawn', packet);
  // Run before Mineflayer emits its derived game/respawn events.
  client.prependListener('login', login);
  client.prependListener('respawn', respawn);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    client.off('login', login); client.off('respawn', respawn); bot.off('end', dispose);
    state.key = null; state.source = 'unknown'; state.observedAt = null; state.revision++;
    state.dispose = undefined;
  };
  state.dispose = dispose;
  bot.once('end', dispose);
  return dispose;
}

/** Metadata from received native packets. Missing server UUID/run identity remains null. */
export function readWorldIdentity(bot: Bot | null | undefined): WorldIdentityObservation {
  const state = bot ? stateOf(bot) : null;
  const type = bot?.game?.dimension;
  return { schema: 'agent-mc-world-identity/v1', key: state?.key ?? null, uuid: null, instanceId: null,
    dimensionType: typeof type === 'string' && type.length > 0 ? type : null,
    source: state?.source ?? 'unknown', revision: state?.revision ?? 0, observedAt: state?.observedAt ?? null };
}

/** Namespace spatial records by server realm AND native world. Unknown worlds never share a persistent key. */
export function worldScopedRealm(realm: string, bot: Bot | null | undefined): string {
  if (!bot) return JSON.stringify([realm, 'unobserved-world']);
  const state = stateOf(bot);
  return JSON.stringify([realm, state.key === null
    ? ['unknown-world', state.connection, state.revision] : ['vanilla-world', state.key]]);
}
