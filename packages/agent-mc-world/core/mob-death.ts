import type { Bot } from 'mineflayer';
import type { DeathEntityRef, MobDeathReceipt } from '../src/contracts/mob-death.ts';
import { declareDecodedChannels } from './decoded-channels.ts';
import { zhEntity } from './names.ts';
import { readWorldIdentity } from './world-scope.ts';

export const MOB_DEATH_CHANNEL = 'mcagent:mob_death';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const key = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const registryKey = (v: unknown): v is string => typeof v === 'string' && v.length <= 256 && key.test(v);
const validId = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);

function reference(v: any): DeathEntityRef | null {
  if (!v || !validId(v.uuid) || !Number.isSafeInteger(v.entityId) || v.entityId < 0
    || !(v.type === null || registryKey(v.type))
    || !(v.name === null || (typeof v.name === 'string' && v.name.length <= 160 && !/[\p{Cc}\p{Cf}]/u.test(v.name)))) return null;
  return { entityId: v.entityId, uuid: v.uuid.toLowerCase(), type: v.type, name: v.name };
}

export function decodeMobDeath(bytes: unknown): MobDeathReceipt | null {
  if (!Buffer.isBuffer(bytes) || bytes.length > 8192) return null;
  try {
    const v = JSON.parse(bytes.toString('utf8'));
    if (v?.schemaVersion !== 1 || !validId(v.eventId) || !Number.isSafeInteger(v.occurredAt) || v.occurredAt <= 0
      || !registryKey(v.world) || !registryKey(v.damageType) || typeof v.indirect !== 'boolean') return null;
    const victim = reference(v.victim), causingEntity = reference(v.causingEntity), directEntity = reference(v.directEntity);
    if (!victim || (!causingEntity && v.causingEntity !== null) || (!directEntity && v.directEntity !== null)) return null;
    return { schemaVersion: 1, eventId: v.eventId.toLowerCase(), occurredAt: v.occurredAt, world: v.world,
      victim, damageType: v.damageType, causingEntity, directEntity, indirect: v.indirect };
  } catch { return null; }
}

export function ownKillCredit(bot: Bot, receipt: MobDeathReceipt): boolean | null {
  if (!receipt.causingEntity) return false;
  const own = bot.entity?.uuid ?? bot.player?.uuid;
  return own ? receipt.causingEntity.uuid === own.toLowerCase() : null;
}

export function fatalDamageText(receipt: MobDeathReceipt): string {
  const label = (ref: DeathEntityRef) => ref.name ?? (ref.type ? zhEntity(ref.type.replace(/^minecraft:/, '')) : '未命名实体');
  const { causingEntity: actor, directEntity: direct, damageType } = receipt;
  const via = direct && direct.uuid !== actor?.uuid ? '，直接来源为' + label(direct) : '';
  return label(receipt.victim) + '死亡，致命伤害为 ' + damageType + (actor ? '，来自' + label(actor) : '，无归属实体') + via + '。';
}

/** One report per server event on this connection. Chat text never enters this decoder. */
export function observeMobDeaths(bot: Bot, onDeath: (receipt: MobDeathReceipt) => void): void {
  const seen = new Set<string>();
  const register = () => { declareDecodedChannels(bot._client, [MOB_DEATH_CHANNEL]); };
  const reset = () => seen.clear();
  const receive = (packet: { channel?: string; data?: unknown }) => {
    if (packet.channel !== MOB_DEATH_CHANNEL) return;
    const receipt = decodeMobDeath(packet.data);
    if (!receipt || seen.has(receipt.eventId)) return;
    const world = readWorldIdentity(bot).key;
    const tracked = bot.entities?.[receipt.victim.entityId]?.uuid?.toLowerCase();
    if (world ? receipt.world !== world : tracked !== receipt.victim.uuid) return;
    if (tracked && tracked !== receipt.victim.uuid) return;
    seen.add(receipt.eventId);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
    onDeath(receipt);
  };
  register();
  bot.on('spawn', register);
  bot.on('respawn', reset);
  bot._client.on('custom_payload', receive);
  bot.once('end', () => {
    seen.clear();
    bot.off('spawn', register);
    bot.off('respawn', reset);
    bot._client.off('custom_payload', receive);
  });
}
