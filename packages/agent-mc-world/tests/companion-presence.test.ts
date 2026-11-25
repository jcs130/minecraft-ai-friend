import { describe, expect, it } from 'vitest';
import { companionPresenceChange, entityIdentityOwnedBySelf, type EntityIdentity } from '../core/entity-identity.ts';
import { narrateWorldSegments, type WorldSnapshot } from '../core/terrain.ts';

function snapshot(entities: WorldSnapshot['entities']): WorldSnapshot {
  return {
    position: { x: 0, y: 0, z: 0 }, dimension: 'overworld', health: 20, maxHealth: 20, food: 20,
    oxygen: 20, inWater: false, invSynced: true, timeOfDay: 6000, realTime: '2026-11-25T01:00:00.000Z',
    light: 15, raining: false, biome: 'plains', gameMode: 'survival', heldItem: null, inventory: [],
    equipment: [], effects: [], entities, entitiesOmitted: 0, standingOn: 'grass_block', nearbyBlocks: [],
    players: [], terrain: [], blocksScanned: false, motion: 'still', speed: 0, facing: 'north', heading: null, onGround: true,
  };
}

function companionEntity(overrides: Partial<WorldSnapshot['entities'][number]> = {}): WorldSnapshot['entities'][number] {
  return {
    entityId: 509, uuid: '00000000-0000-4000-8000-000000000509', customName: '肥鱼', name: 'maid', kind: 'animal',
    distance: 3, direction: 'south', dy: 0, visible: true,
    observation: { source: 'line-of-sight', visibility: 'visible', lineOfSight: true },
    note: '服务端角色身份=maid，归属本人，entityId=509，名字「肥鱼」',
    companion: { key: '00000000-0000-4000-8000-000000000509', label: '肥鱼' },
    ...overrides,
  };
}

function lifeKey(entities: WorldSnapshot['entities']): string | undefined {
  return narrateWorldSegments(snapshot(entities)).find(segment => segment.key === 'life')?.cmp;
}

describe('stable companion presence', () => {
  it('announces an encounter or verified reunion, not ordinary visibility jitter', () => {
    expect(companionPresenceChange(undefined, 100_000, true)).toBe('encounter');
    expect(companionPresenceChange({ lastSeenAt: 99_000, announcedAt: null }, 100_000, true)).toBe('encounter');
    expect(companionPresenceChange({ lastSeenAt: 99_999, announcedAt: 90_000 }, 100_000, true)).toBeNull();
    expect(companionPresenceChange({ lastSeenAt: 69_999, announcedAt: 90_000 }, 100_000, true)).toBe('reunion');
    expect(companionPresenceChange({ lastSeenAt: 10_000, announcedAt: 90_000 }, 100_000, false)).toBeNull();
  });

  it('recognizes only the current player as the semantic owner', () => {
    const identity: EntityIdentity = {
      uuid: '00000000-0000-4000-8000-000000000509', kind: 'maid', name: '肥鱼', label: '肥鱼',
      source: 'fixture', observedAt: '2026-11-25T01:00:00.000Z', ownerUuid: '11111111-1111-4111-8111-111111111111',
    };
    expect(entityIdentityOwnedBySelf({ player: { uuid: '11111111-1111-4111-8111-111111111111' } }, identity)).toBe(true);
    expect(entityIdentityOwnedBySelf({ player: { uuid: '22222222-2222-4222-8222-222222222222' } }, identity)).toBe(false);
    expect(entityIdentityOwnedBySelf({}, identity)).toBe(false);
  });

  it('keeps the life comparison stable across companion direction, distance and occlusion', () => {
    const baseline = lifeKey([companionEntity()]);
    expect(lifeKey([companionEntity({ direction: 'west', distance: 8, dy: 2 })])).toBe(baseline);
    expect(lifeKey([companionEntity({
      visible: false, observation: { source: 'nearby-entity-tracking', visibility: 'occluded', lineOfSight: false },
    })])).toBe(baseline);
    expect(lifeKey([companionEntity({ companion: { key: 'other-uuid', label: '肥鱼' } })])).not.toBe(baseline);
  });

  it('still reports movement of entities that are not stable companions', () => {
    const entity = companionEntity({ companion: undefined, name: 'cow', kind: 'animal', customName: undefined });
    expect(lifeKey([entity])).not.toBe(lifeKey([{ ...entity, direction: 'north', distance: 9 }]));
  });

  it('keeps companion presence in the main snapshot but omits it from the commentary projection', () => {
    const cow = companionEntity({ companion: undefined, name: 'cow', kind: 'animal', customName: undefined, note: undefined });
    const life = narrateWorldSegments(snapshot([companionEntity(), cow])).find(segment => segment.key === 'life');
    expect(life?.text).toContain('肥鱼');
    expect(life?.text).toContain('牛');
    expect(life?.commentaryText).not.toContain('肥鱼');
    expect(life?.commentaryText).toContain('牛');
  });

  it('recognizes the producer ownership note when the extracted companion field is absent', () => {
    const life = narrateWorldSegments(snapshot([companionEntity({
      companion: undefined,
      identity: { uuid: '00000000-0000-4000-8000-000000000509', kind: 'maid', name: '肥鱼', label: '肥鱼',
        source: 'fixture', observedAt: '2026-11-25T01:00:00.000Z', ownerUuid: '11111111-1111-4111-8111-111111111111' },
      note: '服务端角色身份=maid，归属本人，entityId=524，名字「肥鱼」',
    })])).find(segment => segment.key === 'life');
    expect(life?.text).toContain('肥鱼');
    expect(life?.commentaryText).not.toContain('肥鱼');
  });
});
