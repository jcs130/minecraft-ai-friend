import test from 'node:test';
import assert from 'node:assert/strict';
import { eyeBaseName, eyeRules, eyeLoginAllowed } from './agent-eye-names.mjs';
const registry = { schemaVersion: 1, pairs: [{ agent: 'CortiLan', eye: 'CortiEye' }] };
test('case-insensitive suffix, legacy alias, bounds and no substring or observer chains', () => {
  assert.equal(eyeBaseName('NEKOeYe'), 'NEKO'); assert.equal(eyeBaseName('NEKO_eye'), 'NEKO');
  for (const name of ['eye', 'EyeMiddle', 'GoddessEye', 'Nekoeyeeye', '.BedrockEye', 'A'.repeat(17)]) assert.equal(eyeBaseName(name), null);
  const rules = eyeRules(registry, ['NEKOeYe', 'NEKO_eye', 'CortiEye', 'live', 'EyeMiddle']);
  assert.equal(rules.pairs.length, 3); assert.equal(rules.pairs[0].agent, 'CortiLan'); assert.ok(rules.free.has('live'));
  assert.equal(eyeRules({ ...registry, autoNameEyes: false }, ['NEKOeye']).pairs.length, 1);
  assert.equal(eyeRules(registry, Array.from({ length: 30 }, (_, i) => `A${i}eye`)).pairs.length, 16);
  assert.throws(() => eyeRules({ ...registry, pairs: [{ agent: 'a' }, { agent: 'a_eye' }] }));
});
test('derived Eyes inherit only their exact target trusted ingress; live requires its own grant', () => {
  const access = { schemaVersion: 1, allowUnregisteredGuests: true, accounts: [{ name: 'NEKO', allowedIps: ['192.0.2.10'] }] };
  assert.equal(eyeLoginAllowed(registry, access, 'NEKOeye', '192.0.2.10'), true);
  assert.equal(eyeLoginAllowed(registry, access, 'NEKOeye', '192.0.2.11'), false);
  assert.equal(eyeLoginAllowed(registry, access, 'OtherEye', '192.0.2.10'), false);
  assert.equal(eyeLoginAllowed(registry, access, 'CortiEye', '192.0.2.10'), false);
  assert.equal(eyeLoginAllowed(registry, access, 'live', '192.0.2.10'), false);
  assert.equal(eyeLoginAllowed(registry, access, 'Guest', '192.0.2.10'), true);
  access.accounts.push({ name: 'live', allowedIps: ['192.0.2.10'] });
  assert.equal(eyeLoginAllowed(registry, access, 'LIVE', '192.0.2.10'), true);
  assert.equal(eyeLoginAllowed(registry, access, 'LIVE', '192.0.2.11'), false);
});
