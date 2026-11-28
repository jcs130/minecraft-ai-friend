import { unwrapNbt } from './nbt-text.mjs';
import { randomUUID } from 'node:crypto';
import type { Bot } from 'mineflayer';
import type { WorldIdentityObservation } from '../src/contracts/world-scope.ts';

interface State {
  connection: string;
  key: string | null;
  revision: number;
  source: WorldIdentityObservation['source'];
  observedAt: string | null;
  bedRules?: Map<string, boolean>;
  hasLocalBedOverrides?: boolean;
  hasTimedBedOverrides?: boolean;
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
  // Prismarine's registry projects dimensions to height and minY, dropping bed_works.
  const registry = (packet: {id?:string;entries?:{key:string;value?:{value?:Record<string,unknown>}}[]}) => {
    if (!Array.isArray(packet.entries)) return;
    const ruleKey = 'minecraft:gameplay/bed_rule';
    const attribute = (tag:unknown) => {
      const attributes = (tag as {value?:Record<string,unknown>} | undefined)?.value;
      return attributes?.[ruleKey] ?? attributes?.['gameplay/bed_rule'];
    };
    // Location/time overrides cannot safely be evaluated from dimension alone.
    if (packet.id === 'minecraft:worldgen/biome' || packet.id === 'minecraft:timeline') {
      const timeline=packet.id === 'minecraft:timeline';
      const hasOverride=packet.entries.some(e=>attribute(e.value?.value?.[timeline?'tracks':'attributes'])!==undefined);
      if(timeline) state.hasTimedBedOverrides=hasOverride;
      else state.hasLocalBedOverrides=hasOverride;
      return;
    }
    if (packet.id !== 'minecraft:dimension_type') return;
    state.bedRules = new Map();
    for (const entry of packet.entries) {
      const fields=entry.value?.value;
      const legacy = unwrapNbt(fields?.bed_works);
      const rule = unwrapNbt(attribute(fields?.attributes)) as {can_sleep?:string;explodes?:unknown}|undefined;
      const vanilla = entry.key === 'minecraft:overworld';
      state.bedRules.set(entry.key, vanilla && (legacy!==undefined ? legacy===1 || legacy===true :
        rule===undefined ? fields===undefined || fields.attributes!==undefined :
        (rule.can_sleep==='when_dark' || rule.can_sleep==='always') && !rule.explodes));
    }
  };
  client.on('registry_data', registry);
  const login = (packet: unknown) => {
    const codec = (packet as {dimensionCodec?:{value?:Record<string,unknown>}})?.dimensionCodec;
    if(codec?.value?.['minecraft:dimension_type']) {
      const types=unwrapNbt(codec.value['minecraft:dimension_type']) as {value?:{name:string;element?:{bed_works?:number}}[]};
      state.bedRules=new Map((types.value??[]).map(row=>[row.name,row.element?.bed_works===1]));
    }
    observe('vanilla-login',packet);
  };
  const respawn = (packet: unknown) => observe('vanilla-respawn', packet);
  // Run before Mineflayer emits its derived game/respawn events.
  client.prependListener('login', login);
  client.prependListener('respawn', respawn);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    client.off('registry_data',registry); state.bedRules=undefined;
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

/** Only attempt unattended rest with a positive dimension rule. Old pre-datapack
 * versions have fixed vanilla Overworld rules. Unknown server-defined types stay unknown. */
export function bedsWorkHere(bot: Bot): boolean {
  const type = bot.game?.dimension as string | undefined;
  if (!type) return false;
  const id = type.includes(':') ? type : 'minecraft:' + type;
  const rules = states.get(bot)?.bedRules;
  const state=states.get(bot);
  if(id!=='minecraft:overworld' || state?.hasLocalBedOverrides || state?.hasTimedBedOverrides) return false;
  if (rules) return rules.get(id) === true;
  return !!bot.supportFeature?.('dimensionIsAnInt');
}

/** Namespace spatial records by server realm AND native world. Unknown worlds never share a persistent key. */
export function worldScopedRealm(realm: string, bot: Bot | null | undefined): string {
  if (!bot) return JSON.stringify([realm, 'unobserved-world']);
  const state = stateOf(bot);
  return JSON.stringify([realm, state.key === null
    ? ['unknown-world', state.connection, state.revision] : ['vanilla-world', state.key]]);
}
