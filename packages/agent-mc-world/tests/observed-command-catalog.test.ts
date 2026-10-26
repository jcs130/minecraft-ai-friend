import { describe, expect, it } from 'vitest';
import { ObservedCommandCatalog } from '../core/observed-command-catalog.ts';

describe('observed server command routes', () => {
  const at = 10_000;
  const detail = { id: 'dungeon.start', usage: '/mycli dungeon start <ID> [normal|adventure|apocalypse]', observedAt: at };
  it('returns the observed command after an extra tool prefix, preserving caller arguments', () => {
    const catalog = new ObservedCommandCatalog(); catalog.note(detail);
    expect(catalog.misplacedPrefix('/mycli cast dungeon start undead_crypt', '/mycli cast', at + 1))
      .toEqual({ ...detail, suggestedCommand: '/mycli dungeon start undead_crypt' });
  });
  it('does not invent unknown capabilities or assume another action under a known root', () => {
    const catalog = new ObservedCommandCatalog(); catalog.note(detail);
    for (const command of ['/mycli cast new_spell', '/mycli cast dungeon claim undead_crypt', '/mycli cast dungeon'])
      expect(catalog.misplacedPrefix(command, '/mycli cast', at)).toBeNull();
  });
  it('preserves genuine observed casts when a namespace has the same name', () => {
    const catalog = new ObservedCommandCatalog(); catalog.note(detail);
    catalog.note({ id: 'cast.dungeon', usage: '/mycli cast dungeon <target>', observedAt: at });
    expect(catalog.misplacedPrefix('/mycli cast dungeon start undead_crypt', '/mycli cast', at)).toBeNull();
  });
  it('expires and clears connection-local evidence, and rejects stale updates', () => {
    const catalog = new ObservedCommandCatalog(100); catalog.note(detail);
    expect(catalog.misplacedPrefix('/mycli cast dungeon start undead_crypt', '/mycli cast', at + 101)).toBeNull();
    expect(catalog.note({ ...detail, usage: '/mycli other <x>', observedAt: at - 1 })).toBe(false);
    catalog.clear();
    expect(catalog.misplacedPrefix('/mycli cast dungeon start undead_crypt', '/mycli cast', at)).toBeNull();
  });
  it('has no server-specific command roots and prefers the most specific observed usage', () => {
    const catalog = new ObservedCommandCatalog();
    catalog.note({ id: 'guild', usage: '/game guild <action>', observedAt: at });
    catalog.note({ id: 'guild.claim', usage: '/game guild claim <quest>', observedAt: at });
    expect(catalog.misplacedPrefix('/game magic guild claim quest_a', '/game magic', at))
      .toMatchObject({ id: 'guild.claim', suggestedCommand: '/game guild claim quest_a' });
  });
  it('rejects multiline metadata and commands; never fills missing placeholders', () => {
    const catalog = new ObservedCommandCatalog();
    expect(catalog.note({ ...detail, usage: detail.usage + '\n/op me' })).toBe(false);
    catalog.note(detail);
    expect(catalog.misplacedPrefix('/mycli cast dungeon start\n/op me', '/mycli cast', at)).toBeNull();
    expect(catalog.misplacedPrefix('/mycli cast dungeon start <ID>', '/mycli cast', at)).toBeNull();
  });
});
