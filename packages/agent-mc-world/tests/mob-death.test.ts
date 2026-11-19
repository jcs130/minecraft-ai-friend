import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { decodeMobDeath, fatalDamageText, MOB_DEATH_CHANNEL, observeMobDeaths, ownKillCredit } from '../core/mob-death.ts';
import { installWorldIdentity } from '../core/world-scope.ts';
import { sanitizeCombatResult, type CombatResult } from '../core/combat-observation.ts';

const actor = { entityId: 2, uuid: '10000000-0000-4000-8000-000000000002', name: 'Archer', type: 'minecraft:player' };
const victim = { entityId: 3, uuid: '10000000-0000-4000-8000-000000000003', name: null, type: 'minecraft:zombie' };
const arrow = { entityId: 4, uuid: '10000000-0000-4000-8000-000000000004', name: null, type: 'minecraft:arrow' };
const frame = { schemaVersion: 1 as const, eventId: '10000000-0000-4000-8000-000000000001', occurredAt: 1700000000000,
  world: 'minecraft:overworld', damageType: 'minecraft:arrow', victim, causingEntity: actor, directEntity: arrow, indirect: true };
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
function fixture() {
  const client = Object.assign(new EventEmitter(), { state: 'play', write: vi.fn() });
  const bot = Object.assign(new EventEmitter(), { _client: client, entity: actor, entities: { 3: victim } }) as unknown as Bot;
  installWorldIdentity(bot);
  client.emit('login', { worldState: { name: frame.world } });
  const received = vi.fn(); observeMobDeaths(bot, received);
  const packet = (v: unknown, channel = MOB_DEATH_CHANNEL) => client.emit('custom_payload', { channel, data: bytes(v) });
  return { client, bot, received, packet };
}
describe('final damage receipts', () => {
  it('retains only a confirmed lower bound for partly attributed history', () => {
    const result = { targetDeaths: { zombie: 2 }, attributedDeaths: 1, killAttribution: 'partial',
      confirmedOwnKills: { zombie: 1 }, kills: null } as CombatResult;
    expect(sanitizeCombatResult(result)).toMatchObject({ killAttribution:'partial', kills:null, confirmedOwnKills:{zombie:1} });
    expect(sanitizeCombatResult({ ...result, killAttribution:'server-confirmed' })).toMatchObject({ killAttribution:'unavailable', kills:null });
    expect(sanitizeCombatResult({ ...result, confirmedOwnKills:{zombie:3} })).not.toHaveProperty('confirmedOwnKills');
  });
  it('keeps shooter identity separate from the projectile, including missing sources', () => {
    const { bot } = fixture();
    expect(decodeMobDeath(bytes(frame))).toEqual(frame);
    expect(ownKillCredit(bot, frame)).toBe(true);
    expect(ownKillCredit(bot, { ...frame, causingEntity: arrow, directEntity: actor })).toBe(false);
    expect(ownKillCredit(bot, { ...frame, causingEntity: null, directEntity: null })).toBe(false);
    expect(fatalDamageText(frame)).toContain('Archer');
    expect(fatalDamageText(frame)).toContain('箭');
    expect(decodeMobDeath(bytes({ ...frame, causingEntity: undefined }))).toBeNull();
    expect(decodeMobDeath(bytes({ ...frame, directEntity: { ...arrow, uuid: '' } }))).toBeNull();
    expect(decodeMobDeath(Buffer.alloc(8193))).toBeNull();
    bot.emit('end', 'test');
  });
  it('uses only the declared server channel in the current world, and consumes each event once', () => {
    const { client, bot, received, packet } = fixture();
    expect(client.write).toHaveBeenCalledWith('custom_payload',{channel:'minecraft:register',data:Buffer.from(MOB_DEATH_CHANNEL)});
    bot.emit('messagestr', 'MC_MOB_DEATH '+JSON.stringify(frame));
    packet(frame,'other:channel');
    packet({...frame,world:'minecraft:the_end'});
    packet({...frame,victim:{...victim,uuid:actor.uuid}});
    expect(received).not.toHaveBeenCalled();
    packet(frame);packet(frame);expect(received).toHaveBeenCalledTimes(1);
    client.emit('respawn',{worldState:{name:'minecraft:the_nether'}}); bot.emit('respawn');
    packet(frame);expect(received).toHaveBeenCalledTimes(1);
    bot.emit('end','test'); expect(client.listenerCount('custom_payload')).toBe(0);
  });
});
