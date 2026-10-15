import { expect, it } from 'vitest';
import { isOwnDeathTranslation } from '../core/death-cause.ts';
import { methodHarness } from './method-harness.ts';

const uuid = '12345678-1234-1234-1234-123456789abc';
const message = (victim: unknown, killer: unknown = { text: 'OtherPlayer' }) => ({
  translate: 'death.attack.player', with: [victim, killer], toString: () => 'Victim was slain by ActualPlayer',
});
it('uses the exact victim argument, never the killer or a rendered-name substring', () => {
  expect(isOwnDeathTranslation(message({ text: 'ActualPlayer' }), 'ActualPlayer', uuid)).toBe(true);
  expect(isOwnDeathTranslation(message('ActualPlayer'), 'ActualPlayer', uuid)).toBe(true);
  expect(isOwnDeathTranslation(message({ text: 'Victim' }, { text: 'ActualPlayer' }), 'ActualPlayer', uuid)).toBe(false);
  expect(isOwnDeathTranslation(message({ text: 'ActualPlayer2' }), 'ActualPlayer', uuid)).toBe(false);
  expect(isOwnDeathTranslation({ translate: 'death.attack.player', toString: () => 'ActualPlayer died' }, 'ActualPlayer', uuid)).toBe(false);
  expect(isOwnDeathTranslation({ json: message({ text: 'ActualPlayer' }) }, 'ActualPlayer', uuid)).toBe(true);
});
it('rejects conflicting player UUID evidence even when rendered text matches', () => {
  const victim = (id: string) => ({ text: 'ActualPlayer', hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:player', id } } });
  expect(isOwnDeathTranslation(message(victim(uuid)), 'ActualPlayer', uuid)).toBe(true);
  expect(isOwnDeathTranslation(message(victim('different-uuid')), 'ActualPlayer', uuid)).toBe(false);
  expect(isOwnDeathTranslation(message(victim(uuid)), 'ActualPlayer')).toBe(false);
});
it('clears correlated pending cause on native life change and ignores a stale connection', () => {
  const r = methodHarness();
  const world = r.world as any;
  try {
    Object.assign(r.bot, { username: 'ActualPlayer', player: { uuid } });
    world.hookMessageEvents(r.bot);
    r.bot.emit('message', message({ text: 'Victim' }, { text: 'ActualPlayer' }), 'system');
    expect(world.pendingDeathCause).toBeNull();
    r.bot.emit('message', message({ text: 'ActualPlayer' }), 'system');
    expect(world.pendingDeathCause).toMatchObject({ key: 'death.attack.player' });
    r.bot.emit('respawn');
    expect(world.pendingDeathCause).toBeNull();
    r.bot.emit('message', message({ text: 'ActualPlayer' }), 'system');
    r.bot.emit('spawn');
    expect(world.pendingDeathCause).toBeNull();
    world.bridge.bot = null;
    r.bot.emit('message', message({ text: 'ActualPlayer' }), 'system');
    expect(world.pendingDeathCause).toBeNull();
  } finally { r.close(); }
});
