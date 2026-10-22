import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { skillPresentation, observeWhenPlaying } from './viewer-state.mjs';
const uuid = '663f458a-3ec8-3a00-8224-c4a0aea197b5', now = Date.parse('2026-10-22T08:00:00Z');
const row = (channel, age, value) => ({ channel, observedAt: new Date(now - age).toISOString(), value });
test('preassigned offline UUID never registers a PLAY channel during handshake or configuration', () => {
  const bot = new EventEmitter(); bot._client = { uuid, state: 'handshaking' };
  let registered = 0, cleaned = 0;
  const view = observeWhenPlaying(bot, () => { registered++; return { snapshot: () => ({ own: uuid }), close: () => cleaned++ }; });
  assert.equal(registered, 0); assert.equal(view.snapshot(), null);
  bot._client.state = 'configuration'; bot.entity = { id: 0 }; bot.emit('spawn'); assert.equal(registered, 0);
  bot._client.state = 'play'; bot.emit('spawn'); bot.emit('spawn'); assert.equal(registered, 1);
  assert.equal(view.snapshot().own, uuid); bot.emit('end'); assert.equal(view.snapshot(), null);
  view.close(); assert.equal(cleaned, 1); assert.equal(bot.listenerCount('spawn'), 0);
});
test('HUD merges only its own real receipts; newer mana updates preserve the skill catalogue', () => {
  const state = { available: true, bodyId: uuid, states: {
    full: row('mcviewer:state', 3000, { mana: { current: 10, max: 30 }, skills: [{ id: 'mining', name: '采矿', level: 7 }], abilities: [{ id: 'home', name: '归乡', cooldownMs: 8000, cooldownRemainingMs: 4000 }] }),
    mana: row('mcagent:state', 1000, { mana: { current: 12, max: 30 } }) } };
  const value = skillPresentation(state, uuid, now);
  assert.deepEqual(value.mana, { current: 12, max: 30 }); assert.equal(value.skills[0].level, 7);
  assert.equal(value.abilities[0].cooldownMs, 8000); assert.equal(value.abilities[0].cooldownRemainingMs, 1000);
  assert.equal(value.stale, false); assert.equal(state.states.full.value.abilities[0].cooldownRemainingMs, 4000);
});
test('no foreign/default 20 mana and ambiguous cooldown is explicitly unknown', () => {
  assert.equal(skillPresentation({ available: true, bodyId: 'other', states: {} }, uuid, now), null);
  assert.equal(skillPresentation({ available: true, bodyId: uuid, states: {} }, uuid, now), null);
  const value = skillPresentation({ available: true, bodyId: uuid, states: { row: row('mcviewer:state', 16000, { abilities: [{ id: 'home', name: '归乡', cooldownMs: 8000 }] }) } }, uuid, now);
  assert.equal(value.mana, null); assert.equal(value.stale, true); assert.equal(value.abilities[0].cooldownRemainingMs, null);
});
