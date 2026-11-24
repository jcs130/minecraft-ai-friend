import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTangerine, tangerineConfigOverlay, maxAuthLoginAccount, VULCAN_WARNING_KEYWORDS } from '../src/profile.mjs';
import { classifyTangerinePhase, createTangerineRoute } from '../src/route.mjs';

test('pack is host-scoped: other servers are never matched implicitly', () => {
  assert.equal(matchesTangerine({ host: 'mc.tangerinecology.top' }), true);
  assert.equal(matchesTangerine({ host: 'MC.TangerineCology.top.' }), true);
  assert.equal(matchesTangerine({ host: '4.mcyyy.com' }), false);
  assert.equal(matchesTangerine({ host: 'localhost' }), false);
  assert.equal(matchesTangerine({ host: 'localhost' }, { force: true }), true);
});

test('overlay fills 26.2/fakeHost, turns pace limits on, keeps SVC off and explicit values', () => {
  const cfg = tangerineConfigOverlay({ host: 'mc.tangerinecology.top', version: 'auto', miningLimits: { warningKeywords: ['自定义'] }, simpleVoiceChat: { officialJar: '/x.jar' } });
  assert.equal(cfg.version, '26.2');
  assert.equal(cfg.fakeHost, 'mc.tangerinecology.top');
  assert.equal(cfg.movementPace.enabled, true);
  assert.equal(cfg.miningLimits.enabled, true);
  assert.ok(cfg.miningLimits.warningKeywords.includes('自定义'));
  for (const k of VULCAN_WARNING_KEYWORDS) assert.ok(cfg.miningLimits.warningKeywords.includes(k));
  assert.equal(cfg.simpleVoiceChat.enabled, false);
  assert.equal(cfg.simpleVoiceChat.officialJar, '/x.jar');
  assert.equal(cfg.simpleVoiceChat.compatibilityVersion, 20);
  assert.equal(tangerineConfigOverlay({ version: '1.21.1' }).version, '26.2');
  assert.equal(tangerineConfigOverlay({ version: '1.21.11', fakeHost: 'a.b' }, { keepVersion: true }).version, '1.21.11');
  assert.equal(tangerineConfigOverlay({ fakeHost: 'a.b' }).fakeHost, 'a.b');
  assert.equal(tangerineConfigOverlay({ simpleVoiceChat: { enabled: true } }).simpleVoiceChat.enabled, true);
});

test('MaxAuth entry only references a credential, never carries one', () => {
  const account = maxAuthLoginAccount({ username: 'ag_test', credentialEnv: 'TANGERINE_TEST_PASSWORD' });
  assert.equal(account.server, 'mc.tangerinecology.top:25565');
  assert.equal(account.command, 'login');
  assert.equal(account.credentialEnv, 'TANGERINE_TEST_PASSWORD');
  assert.equal('password' in account, false);
  assert.throws(() => maxAuthLoginAccount({ username: 'ag_test' }), /CREDENTIAL_REFERENCE/);
  assert.throws(() => maxAuthLoginAccount({ username: 'ag_test', password: 'x' }), /CREDENTIAL_REFERENCE/);
});

test('phase comes from the observed command trees (limbo 27 / lobby 152 / main 521 roots)', () => {
  assert.equal(classifyTangerinePhase([]), 'unknown');
  assert.equal(classifyTangerinePhase(['l', 'login', 'maxauth', 'mauth', 'voicechatproxy']), 'limbo');
  assert.equal(classifyTangerinePhase(['cmi', 'login', 'main', 'rtp', 'voicechatproxy']), 'lobby');
  assert.equal(classifyTangerinePhase(['huskhomes:tpa', 'login', 'main', 'spawn', 'voicechat', 'voicechatproxy']), 'main');
});

test('route sends /main once after login in the lobby, retries boundedly, opens SVC only in main', () => {
  let t = 0, roots = ['login', 'maxauth'], loggedIn = false;
  const sent = [], events = [];
  const route = createTangerineRoute({ rootLiterals: () => roots, loggedIn: () => loggedIn, send: (c) => sent.push(c), now: () => t, onEvent: (e) => events.push(e) },
    { retryAfterMs: 20_000, settleMs: 2_000, maxMainAttempts: 2 });
  route.tick(); assert.equal(route.phase(), 'limbo'); assert.equal(route.voiceAllowed(), false);
  roots = ['login', 'main']; route.tick(); t += 5_000; route.tick();
  assert.deepEqual(sent, [], 'no /main before authoritative login');
  loggedIn = true; route.tick(); assert.deepEqual(sent, ['/main']);
  t += 1_000; route.tick(); assert.equal(sent.length, 1, 'no resend inside retry window');
  t += 20_000; route.tick(); assert.equal(sent.length, 2);
  t += 20_000; route.tick(); assert.equal(sent.length, 2); assert.equal(route.snapshot().gaveUp, 'MAIN_ROUTE_ATTEMPTS_EXHAUSTED');
  roots = ['main', 'voicechat']; route.tick();
  assert.equal(route.phase(), 'main'); assert.equal(route.voiceAllowed(), true);
  route.stop(); assert.equal(route.voiceAllowed(), false);
  assert.ok(events.some((e) => e.event === 'main-sent'));
});

test('autoMain:false never sends commands', () => {
  const sent = [];
  const route = createTangerineRoute({ rootLiterals: () => ['main'], loggedIn: () => true, send: (c) => sent.push(c), now: () => 1e9 }, { autoMain: false });
  route.tick(); route.tick();
  assert.deepEqual(sent, []);
});
